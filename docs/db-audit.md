# Audit de la base de données (octobre 2026)

Question : SQLite convient-il encore à CoteRadar, maintenant qu'il a des
comptes utilisateurs, et bientôt des rôles et des administrateurs ?

**Verdict : oui, on reste sur SQLite.** Rien dans le projet n'impose
aujourd'hui un serveur de base de données. Trois points sont à corriger, et ils
le sont (ou sont documentés) avec la mise en place des comptes.

## Ce que la base contient

| Données | Volume | Écriture | Si on les perd |
| --- | --- | --- | --- |
| Cotes (`events`, `event_bookmaker_odds`, `event_market_odds`...) | ~1 million de lignes | un seul écrivain, le worker, toutes les 5 à 15 min | rien : le worker les reconstruit au cycle suivant |
| Référence de l'exchange (`reference_*`) | quelques dizaines de milliers de lignes | le worker | idem, hors statistiques de joueurs |
| Statistiques et alertes (`reference_player_stats`, `gem_alerts`...) | petit, croissant | le worker | historique perdu |
| **Comptes** (`users`, `sessions`, `auth_tokens`, `auth_events`) | quelques lignes par inscrit | le process web, quelques écritures par minute au plus | **irremplaçable** |

Accès : essentiellement des lectures par l'API (listes paginées, TRJ, value
bets avec un cache de 30 s), des upserts en place par le worker, aucune série
temporelle des cotes (seul le dernier prix est gardé).

## Pourquoi SQLite suffit

- Un seul VPS, deux process, **un seul écrivain** par fichier : le cas pour
  lequel SQLite en mode WAL est conçu. Les lecteurs ne bloquent pas l'écrivain.
- Les écritures des comptes sont négligeables devant celles du worker.
- Aucun service à installer, superviser, sauvegarder ni sécuriser en plus.
- Un SGBD client-serveur apporterait de la latence réseau, une
  configuration, et une migration complète du worker, de l'API et des tests,
  sans résoudre un problème qu'on a.

## Les trois risques, et ce qui est fait

1. **Les comptes ne se reconstruisent pas, les cotes si.** Les comptes vivent
   donc dans leur propre fichier, `data/auth.sqlite` (`AUTH_DB_PATH`), que
   seul le process web ouvre. Le worker, ses 1 million de lignes et ses
   suppressions ne les touchent jamais ; on les sauvegarde et on les restaure
   séparément ; et le jour d'une migration vers PostgreSQL, seul ce fichier
   (quelques tables) est concerné.
2. **Pas de migrations.** Les deux bases ont maintenant des **migrations
   versionnées** (`PRAGMA user_version`, chacune dans une transaction) :
   `src/auth/db.ts` pour les comptes (la deuxième ajoute `user_preferences`,
   les filtres et sports favoris de chaque compte, en JSON validé, supprimés
   avec lui ; la quatrième `user_freebets`, les freebets de chaque compte par
   bookmaker, en centimes, supprimés avec lui) et `src/db/client.ts` pour les
   cotes, où la première a refait `event_market_odds` en une seule structure
   ([sqlite-optimizations.md](sqlite-optimizations.md)). `CREATE TABLE IF NOT
   EXISTS` et `ADDED_COLUMNS` ne servent plus qu'à ce qui a existé avant elles.
   Les rôles futurs s'ajouteront comme une migration de plus.
3. **Aucune sauvegarde.** `deploy/backup-db.sh` fait une copie cohérente
   (`sqlite3 .backup`, API en marche) puis la vérifie (`PRAGMA integrity_check`) :
   `auth.sqlite` toutes les heures, 30 jours gardés ; `coteradar.sqlite` chaque
   dimanche, 4 copies (les stats des joueurs et les alertes envoyées ne se
   reconstruisent pas). À copier aussi hors du VPS (le disque du serveur n'est
   pas une sauvegarde).

Un point d'attention : `node:sqlite` est **synchrone**. Une requête lente bloque
tout le process web (c'est pour cela que `/api/value-bets` est mis en cache), et
le hachage des mots de passe, lui, est fait de manière asynchrone
(`crypto.scrypt`) pour ne jamais bloquer le serveur.

## Quand passer à PostgreSQL

Reconsidérer si l'un de ces signaux apparaît :

- **plusieurs instances web** (le limiteur de tentatives en mémoire et SQLite
  sur un fichier local ne se partagent pas entre serveurs) ;
- **un historique des cotes** (mouvements de cotes, courbes, backtests) :
  c'est de la série temporelle, avec beaucoup d'écritures et des requêtes
  d'agrégation ; PostgreSQL (avec TimescaleDB si besoin) y est plus adapté ;
- **contention d'écriture mesurée** (`database is locked` dans les logs malgré
  le `busy_timeout`) ;
- **besoin transactionnel entre services** (paiements, abonnements) ou
  d'outils d'analyse sur les comptes.

Le chemin le moins coûteux : migrer d'abord les comptes (petites tables, déjà
isolées, migrations versionnées), puis les cotes si l'historique l'exige.
