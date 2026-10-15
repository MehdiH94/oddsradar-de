# Optimisations SQLite (sans historique des cotes)

Suite de [db-audit.md](db-audit.md). Décision : **on reste sur SQLite tant que
l'historique des cotes n'existe pas.** Ce fichier dit ce qui a été fait pour la
base des cotes d'ici là, ce qui a été essayé et abandonné (avec les mesures), et
ce qui reste à faire ou à mesurer en production.

Quand l'historique arrivera, ces optimisations ne suffiront plus : il faudra
passer à PostgreSQL (voir la fin).

## Comment c'est mesuré, et ce que ça ne prouve pas

Les chiffres viennent d'une **copie de la base de dev** (`data/coteradar.sqlite`,
131 Mo, 686 k lignes dans `event_market_odds`, 2 019 matchs, copiée avec
`VACUUM INTO` dans un dossier temporaire). Le plus gros match a 8 476 lignes dans
`event_market_odds`, 5 894 pour un seul bookmaker.

- Ce n'est **pas la production** : la base de dev est ancienne (3 bookmakers) et
  les durées sont celles d'une machine WSL. Les écarts de taille sont fiables,
  les durées sont des ordres de grandeur.
- Les mesures d'écriture ont été faites sur `/tmp`, qui est un **tmpfs** : un
  `fsync` n'y coûte presque rien. Sur le disque du VPS, les gains liés à
  `synchronous` seront probablement plus grands.

## Ce qui est fait

### 1. `event_market_odds` en une seule structure (migration 1)

La table faisait 93 % de la base et stockait ses données trois fois : les lignes
(avec une colonne `id` que rien ne lit), l'index de la clé unique, et l'index
`event_market_odds_by_market`. Elle est maintenant une table `WITHOUT ROWID`
dont la clé primaire est `(event_id, market, bookmaker_id, selection)`, sans
index secondaire ([src/db/client.ts](../src/db/client.ts)).

| Mesure (copie de dev) | Avant | Après |
| --- | --- | --- |
| Taille de la table et de ses index | 173,4 Mo | **76,6 Mo (-56 %)** |
| Écriture d'un lot de 5 894 lignes | 28,5 à 36,7 ms | 12 à 16 ms |
| Agrégat surebets d'un match | 4,8 ms | 3,7 ms |
| Lecture d'un marché d'un match | 0,01 ms | 0,01 ms |
| `countMarkets`, 200 plus gros matchs | 52 ms | 75 ms (plus lent) |

Le dernier point est le prix du changement : `countMarkets` perdait son index
couvrant. Il reste largement sous la milliseconde par match d'une page ; si la
page des value bets (tous les matchs des 48 h, cachée 30 s) en souffrait, la
réponse serait de compter les marchés d'un match quand on les écrit (comme
`surebet_markets`), pas de remettre l'index.

**Répétition de la migration** sur une copie de la base de dev : 1,8 s pour
686 k lignes, `PRAGMA integrity_check` ok, aucune violation de clé étrangère,
mêmes nombres de lignes. **Le fichier ne rétrécit pas** (122 Mo de pages libres
après la copie) : voir « À faire sur le VPS ».

Ne pas faire `WITHOUT ROWID` seul, en gardant l'ancienne clé et l'index
`by_market` : mesuré à -18 % seulement, et l'agrégat surebets passe de 3,4 à
6,5 ms. Le gain vient de la clé réordonnée et de la disparition de l'index
secondaire.

### 2. Migrations versionnées pour la base des cotes

`MIGRATIONS` dans `client.ts`, sur le modèle de `src/auth/db.ts` : une fonction
par version, dans une transaction `BEGIN IMMEDIATE`, la version relue une fois
le verrou pris. Le worker et l'API ouvrent la base ensemble au déploiement : le
second attend (60 s au plus pendant une migration, 5 s pour une requête) puis
voit que c'est fait. `SCHEMA` et `ADDED_COLUMNS` restent pour ce qui existait
avant ; voir CONTRIBUTING.md, « Structure de la base ».

### 3. Réglages de la connexion à la base des cotes

- `synchronous = NORMAL` : en mode WAL, pas de corruption possible, mais une
  coupure de courant peut perdre les dernières transactions ; les cotes se
  reconstruisent à chaque cycle. **Jamais pour `auth.sqlite`** (testé). Mesuré
  -25 % par lot (37 -> 27 ms), à confirmer sur le VPS.
- `journal_size_limit` à 64 Mo : le WAL ne garde pas la taille de son plus gros
  cycle.
- `PRAGMA optimize` à l'ouverture. Non mesuré : hygiène.
- Index `events_by_start` sur `events(start_time)` : la liste lisait la table
  entière puis la triait. Négligeable à 2 000 matchs, mais `events` ne fait que
  grossir.

### 4. Rétention à 180 jours

`reference_player_stats`, `reference_player_signals`, `reference_player_cycles`
et `gem_alerts` n'étaient jamais purgées. `forgetOldStats` supprime ce qui date de
plus de 180 jours (dernière lecture, ou date d'envoi), à la fin du cycle des
marchés. Les stats affichées ne remontent donc plus au-delà de 6 mois.

### 5. Sauvegarde

`deploy/backup-db.sh` fait la copie, lance `PRAGMA integrity_check`, garde à
part une copie abîmée (`.corrupt`) en faisant échouer l'unité, et ne supprime
les anciennes qu'après une bonne copie. `auth.sqlite` : toutes les heures,
30 jours. `coteradar.sqlite` : chaque dimanche, 4 copies (les stats de joueurs et
les alertes ne se reconstruisent pas). Les unités systemd ne sont **pas**
installées par le déploiement (README, « Mise en production », point 3).

## Essayé et abandonné

| Idée | Pourquoi pas |
| --- | --- |
| Upsert + purge des lignes non revues, au lieu de supprimer puis réinsérer | Le gain (36,7 -> 16,9 ms) venait de l'ancienne table, qui avait trois structures à maintenir. Sur la nouvelle, supprimer + réinsérer coûte 15 à 16 ms contre 18 à 21 ms pour upsert + purge. La purge par `scraped_at` aurait aussi manqué une ligne si deux écritures partageaient le même horodatage. |
| `cache_size` à 64 Mo, `temp_store=MEMORY`, `mmap_size` à 256 Mo | Aucun gain mesurable sur `countMarkets`, l'agrégat surebets ni la lecture des joueurs (écarts dans le bruit des mesures). |
| `WITHOUT ROWID` sur l'ancienne clé | Voir plus haut : -18 % seulement et des lectures plus lentes. |

## À faire sur le VPS (par vous)

1. Installer les unités de sauvegarde (README, point 3) et recopier les copies
   hors du VPS.
2. Après le déploiement de la migration, services arrêtés, rendre l'espace au
   disque : `sqlite3 data/coteradar.sqlite "PRAGMA wal_checkpoint(TRUNCATE); VACUUM;"`.
   Il faut de la place libre pour la copie temporaire (la taille de la base).
3. Mesurer, avant et après, ce que cette branche a vraiment rapporté :
   - taille de `coteradar.sqlite` et de son WAL ;
   - présence de `database is locked` dans `journalctl -u coteradar-web -u coteradar-worker` ;
   - durée d'un cycle du worker par rapport à son intervalle (le scheduler signale
     `skipping tick`) ;
   - retard de l'event loop de l'API (`perf_hooks.monitorEventLoopDelay`) : il dit
     si les requêtes synchrones gênent les visiteurs.
4. Disque : la migration a besoin, pendant la copie, d'autant de place que la
   table (environ 77 Mo sur la base de dev, plus sur la production).

## Après les optimisations

Ces changements retardent le besoin d'un serveur de base de données, ils ne
changent pas sa nature : un seul écrivain, un accès synchrone, une seule
machine. L'historique des cotes (écriture continue, agrégations sur de longues
périodes, rétention par partitions) est exactement ce qui sort de ce cadre.
Quand il est décidé : migrer les comptes puis l'état courant des cotes vers
PostgreSQL **avant** d'écrire le premier historique (voir db-audit.md, « Quand
passer à PostgreSQL »). La table ci-dessus, avec sa clé réordonnée, se porte
telle quelle vers PostgreSQL.
