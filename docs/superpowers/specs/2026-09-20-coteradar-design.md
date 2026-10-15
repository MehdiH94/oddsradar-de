# CoteRadar — design

## Contexte

Le projet `ev-poc-logger` (POC EV+ : cote soft vs cote sharp dé-viguée via The
Odds API, log CSV) est abandonné. Pivot complet vers **CoteRadar** : un
comparateur de cotes qui scrape en direct les books FR et affiche un tableau
comparatif dans un dashboard web.

Le repo git est conservé (même historique), mais tout le code applicatif du
POC est supprimé et remplacé.

## Périmètre

- **Pas de calcul EV / référence sharp.** Pur comparateur côte à côte.
- **Bookmakers couverts :** Winamax, Betclic, Unibet. Unibet avait été écarté
  en v1 (site protégé par DataDome, contourner l'anti-bot hors cadre). Révisé
  le 2026-10-05 : ses routes JSON `/lvs-api/` répondent à un simple `fetch`
  (token anonyme + pages de 50), sans cookie ni navigateur, donc sans
  contournement. Si DataDome se met à bloquer (403), le scraper échoue seul
  et on ne cherche pas à le contourner (`src/scraper/unibet.ts`).
- **Sports/marchés :** tous ceux disponibles chez ces books, sans filtrage
  a priori.
- **Source de données :** scraping direct des sites (pas The Odds API — elle
  ne couvre pas tous les marchés FR).
- **Rafraîchissement :** polling périodique côté serveur (intervalle
  configurable, type `POLL_INTERVAL_MINUTES`), pas de refresh à la demande.
- **Hébergement :** VPS, process qui tourne en continu.
- **Matching des événements entre books :** automatique (fuzzy matching sur
  noms d'équipes/joueurs + date/heure), pas de mapping manuel.
- **Stockage :** SQLite (fichier local, pas de service DB séparé — suffisant
  pour ce volume et un seul serveur).

### Risque à noter

Le scraping direct de sites de bookmakers peut être contraire à leurs CGU.
Décision assumée par l'utilisateur (usage perso, pas de charge agressive).

## Architecture

Deux process séparés partageant la même base SQLite :

1. **Worker de scraping** — cron interne, déclenche à intervalle régulier un
   passage sur les 3 scrapers en parallèle, écrit en base.
2. **Serveur web** — API + sert le frontend, lit la base en lecture seule.

Séparer les deux évite qu'un scraping lent ou en échec bloque le dashboard,
et permet de redémarrer/déboguer l'un sans toucher à l'autre. Un seul VPS,
deux process gérés par systemd/pm2 — pas de queue/Redis, pas de scaling
distribué : inutile à cette échelle (3 bookmakers).

## Composants

- **`scraper/`** — un module Playwright par bookmaker (`winamax.ts`,
  `betclic.ts`, `unibet.ts`). Chacun retourne une liste d'événements/marchés/
  cotes bruts dans un format normalisé commun. Playwright est nécessaire car
  les sites de paris FR sont des SPA JS (pas de scraping HTML statique
  suffisant).
- **`matcher/`** — logique pure (aucune dépendance réseau/navigateur) qui
  rapproche les événements normalisés des 3 scrapers en "événements
  canoniques" (fuzzy match noms + date/heure) et aligne les marchés
  équivalents (1X2, over/under, etc.) entre bookmakers.
- **`db/`** — schéma SQLite :
  - `bookmakers` (id, nom)
  - `events` (id canonique, sport, libellé, date/heure)
  - `event_bookmaker_odds` (event_id, bookmaker_id, marché, sélection, cote,
    scraped_at)
  Le worker écrit, l'API lit.
- **`api/`** — Express, endpoints en lecture seule : liste des événements
  avec cotes des 3 books côte à côte, filtrable par sport, avec fraîcheur
  des données par bookmaker/événement.
- **`web/`** — React + Vite : tableau comparatif, filtres sport/date, tri,
  mise en évidence de la meilleure cote par ligne.

## Flux de données

```
Scheduler (interval)
  → 3 scrapers en parallèle (isolés, un échec n'affecte pas les autres)
  → normalisation (format commun)
  → matching fuzzy (matcher/)
  → upsert SQLite (event_bookmaker_odds, horodaté)
  → API lit le dernier état par événement
  → frontend affiche, se rafraîchit par polling HTTP (pas de websockets)
```

## Gestion des erreurs

- Chaque scraper tourne dans son propre try/catch : un site qui change son
  HTML et casse un sélecteur n'affecte pas les 2 autres.
- Chaque ligne de cote est horodatée ; l'API calcule une fraîcheur et le
  frontend affiche un badge si une cote est trop vieille (bookmaker en échec
  depuis plusieurs cycles) plutôt que de la faire disparaître silencieusement.
- Retry simple (1-2 tentatives) sur échec réseau transitoire avant
  d'abandonner le cycle pour ce bookmaker.

## Tests

- **`matcher/`** — tests unitaires purs avec fixtures (paires de noms à
  rapprocher/rejeter). Rapide, fiable, sans navigateur.
- **`scraper/`** — tests contre des fixtures HTML sauvegardées (pas le site
  en direct), pour éviter la fragilité/lenteur de tests réseau ; vérifie que
  le parsing survit à la structure connue.
- **`api/`** — tests d'intégration légers avec une SQLite de test seedée.

## Migration

- Suppression complète de `src/`, `README.md`, `.env.example`, `package.json`
  actuels (contenu POC EV).
- Nouveau `README.md` décrivant CoteRadar, son installation et son
  fonctionnement.
- `.github/workflows/ev-poc.yml` supprimé (plus de sens dans le nouveau
  contexte ; à remplacer si besoin par un workflow CI adapté, hors scope de
  cette spec).
