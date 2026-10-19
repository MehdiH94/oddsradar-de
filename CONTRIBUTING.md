# Faire évoluer OddsBlitzer et le mettre en production

Ce guide explique comment modifier le projet, vérifier la modification, puis
la mettre en ligne. Le README décrit l'installation et la mise en place du
serveur. Ici, on part d'un projet déjà en production.

## En bref

1. Créer une branche `feat/…` ou `fix/…` **depuis `development`**.
2. Modifier le code et ajouter un test qui couvre la modification.
3. Lancer les vérifications, les mêmes que la CI (section 5).
4. Ouvrir une pull request **vers `development`**. La CI la teste ; une fois
   fusionnée, GitHub Actions déploie `development` sur le site de test
   <https://staging.odds-blitzer.de> en 1 à 2 minutes.
5. Vérifier la modification sur le site de test.
6. Pour une mise en production, ouvrir une pull request
   **`development` → `main`**. Une fois fusionnée, le commit est déployé sur
   <https://odds-blitzer.de>, à condition d'avoir tourné sur le site de test.

Rien n'arrive sur `main` autrement que par `development`, et un commit qui
échoue aux tests ou qui n'est pas passé par le site de test n'est jamais
déployé en production (section 6).

## 1. Organisation du projet

```
Winamax, Betclic, Vbet, CircusBet, DAZN Bet, NetBet, Genybet, Unibet, Betsson, PMU ──> worker (toutes les POLL_INTERVAL_MINUTES) ──> SQLite <── API ──> dashboard
                     scrape, rapproche les matchs, enregistre       (data/)    Express   React
                     + tous les marchés des matchs de foot, de tennis, de basket, de hockey
                       sur glace, de football américain, de rugby à XV et de handball des 48 h
                       (toutes les MARKETS_INTERVAL_MINUTES)
```

Deux process tournent en production, sous forme de deux services systemd
qui partagent le même fichier SQLite :

- `oddsradar-worker` interroge les bookmakers à intervalle régulier et
  enregistre les cotes ;
- `oddsradar-web` sert l'API sur `/api/*` et le dashboard compilé
  (`web/dist`), sur le même port.

| Chemin | Rôle |
| --- | --- |
| `src/scraper/` | Un fichier par bookmaker (`winamax.ts`, `betclic.ts`, `vbet.ts` (aussi CircusBet et DAZN Bet, sur le même serveur Swarm), `unibet.ts`, `betsson.ts`, `pmu.ts`, `betby.ts` pour Betify (la plateforme Betby), et `sportnco.ts` pour NetBet et Genybet, sur la plateforme SportNCo) et `run.ts`, le cycle de scraping (`pool.ts` : les tâches lancées quelques-unes à la fois). Les marchés d'un match : `winamaxMarkets.ts`, `betclicMarkets.ts`, `pmuMarkets.ts`, `betbyMarkets.ts` et `marketsRun.ts`, leur cycle. |
| `src/markets/` | Catalogue des marchés (`catalog.ts`) : les familles communes aux deux bookmakers, par sport (foot, tennis), leurs rubriques, leurs libellés et leurs issues. `tennis.ts` : les tournois de tennis dont on lit tous les marchés (ATP, WTA, Grand Chelem). |
| `src/matcher/` | Rapprochement d'un même match entre bookmakers (`match.ts`) et normalisation des noms. |
| `src/db/` | Schéma SQLite (`client.ts`), requêtes de lecture et d'écriture (`repository.ts`), marchés d'un match pour sa page (`eventDetail.ts`), calcul du TRJ (`payoutRate.ts`). |
| `src/api/` | Routes HTTP (`server.ts`) et démarrage du process web (`index.ts`). |
| `src/worker/` | Démarrage du worker et planification des cycles. |
| `tests/` | Tests du backend, même arborescence que `src/`. `tests/scraper/fixtures/` contient de vraies réponses des bookmakers. |
| `e2e/` | Tests end-to-end (Playwright) des chemins critiques, section 5 : `server.ts` lance la vraie API sur une base semée (`seed.ts`), `fixtures.ts` dit ce que le semis contient, un fichier `*.spec.ts` par famille de parcours. |
| `web/src/` | Site React : la page d'accueil (`/`, `HomePage.tsx`) et le dashboard (`/odds`, `App.tsx`), choisis par `Root.tsx`. Chaque composant a son test à côté (`OddsTable.tsx` et `OddsTable.test.tsx`). |
| `deploy/` | Script de déploiement et unités systemd ; `deploy/staging/` : ceux du site de test. |
| `.github/workflows/` | `test.yml` (les vérifications : les tests, puis le job `e2e`), `ci.yml` (les pull requests), `deploy-staging.yml` (déploiement de `development`), `deploy.yml` (déploiement de `main`, gardé par le job `gate`), `sync-development.yml`. |

Le backend (racine) et le dashboard (`web/`) sont deux packages npm séparés.
Chacun a son `package.json`, son `package-lock.json` et ses tests.

## 2. Installer le projet sur sa machine

Il faut Node.js 23.4 ou plus récent ; la CI utilise Node 24.

```bash
git clone https://github.com/MehdiH94/oddsradar-de.git
cd oddsradar-de
npm install
cp .env.example .env
cd web && npm install && cd ..
```

## 3. Lancer l'application en local

Dans trois terminaux :

```bash
npm run worker            # scrape les bookmakers et remplit data/coteradar.sqlite
npm run api               # API sur http://localhost:3000
cd web && npm run dev     # dashboard sur http://localhost:5173, recharge a chaque sauvegarde
```

Le serveur de dev Vite transmet les appels `/api` au port 3000. Le worker a
besoin d'accéder aux sites des bookmakers. Sans lui, le tableau reste vide,
mais les tests passent quand même : ils n'utilisent que des données
enregistrées.

## 4. Faire une modification

### Où intervenir

| Pour changer… | Fichiers | Tests |
| --- | --- | --- |
| Une colonne ou l'affichage du tableau | `web/src/OddsTable.tsx` et `OddsTable.module.css` (la mise en cartes sur mobile y est aussi), `web/src/components/PriceChip.tsx`, `PayoutBadge.tsx` | `web/src/OddsTable.test.tsx` |
| Les cartes des courses (cyclisme, F1, golf, ski...) | `web/src/OutrightTable.tsx`, `src/matcher/match.ts` (rapprochement par concurrents communs) | `web/src/OutrightTable.test.tsx`, `tests/matcher/match.test.ts` |
| Les vainqueurs de competition (Ligue 1, Roland-Garros, NBA... : un seul participant, son titre, dans un sport de match ; affichés dans la liste des matchs, sous ceux de leur sport) | `COMPETITION_WINNER_SPORTS`, `isCompetitionWinnerTitle` et `hasOutrights` dans `src/scraper/canonical.ts` (les sports lus, les titres qui ne sont pas un vainqueur) ; `validateRawEvent.ts` ; chaque scraper (`unibet.ts`, `vbet.ts`, `sportnco.ts`, `winamax.ts`, `betclic.ts`, `betsson.ts`, `pmu.ts`) ; `competitionSimilarity` dans `src/matcher/match.ts` (le titre, la saison, les candidats, jamais la date) ; `src/db/competition.ts` (comment une requete les reconnait) ; `kind=competition`, `kind=all` et le filtre `competition` (`competitionName`, `getCompetitions`) dans `src/db/repository.ts` et `src/api/server.ts` ; `web/src/App.tsx` et `web/src/components/CompetitionMenu.tsx` (le menu « Compétition », et `FilterSheet.tsx` sur téléphone) | `tests/matcher/match.test.ts`, `tests/scraper/*.test.ts` (captures reelles : `unibet-competitions-page`, `vbet-competition-winners`, `sportnco-netbet-competition-winners`), `tests/db/repository.test.ts`, `tests/api/server.test.ts`, `web/src/App.test.tsx`, `e2e/odds.spec.ts` |
| Les filtres, le tri, la pagination | `web/src/App.tsx` (état, URL, requêtes), `web/src/components/` (`FilterBar`, `SportTabs`, `SearchBox`, `SortMenu`, `BookmakerMenu`, `MarketsMenu`, `CompetitionMenu` et `CompetitionPicker` (les competitions phares, le repli et la recherche : `favoriteCompetitions.ts`, `competitionList.ts`), `Dropdown`, `Pagination`), `web/src/api.ts`, puis `src/api/server.ts` et `src/db/repository.ts` si l'API doit changer | `web/src/App.test.tsx`, `web/src/components/*.test.tsx`, `tests/api/`, `tests/db/` |
| La page d'un match (rubriques, cartes des marchés) | `web/src/MatchPage.tsx`, `web/src/components/MarketCard.tsx`, puis `src/db/eventDetail.ts` pour ce que renvoie `GET /api/events/:id` | `web/src/MatchPage.test.tsx`, `tests/db/eventDetail.test.ts` |
| Un marché à reconnaître chez les deux bookmakers, son libellé, sa rubrique (golf : les marchés de plusieurs gagnants, `winners` dans `catalog.ts`, lus par leur titre dans `golfMarketOf` de `winamaxMarkets.ts` et `betclicMarkets.ts`) | `src/markets/catalog.ts` (la famille, avec son sport et son unité), puis `src/scraper/winamaxMarkets.ts` (son `marketId` Winamax, dans la table du sport : `FOOTBALL_MARKETS` ou `TENNIS_MARKETS`, Winamax réutilisant certains ids d'un sport à l'autre) et `src/scraper/betclicMarkets.ts` (le nom du marché Betclic). Le journal du worker compte à chaque cycle les marchés reconnus de chaque bookmaker, par sport | `tests/markets/catalog.test.ts`, `tests/scraper/markets.test.ts`, `tests/scraper/tennisMarkets.test.ts` (sur trois vrais matchs ATP) |
| Les marchés d'un autre sport (hockey sur glace, football américain, rugby à XV, handball) : une famille de plus, ou un bookmaker de plus pour un sport | `src/markets/catalog.ts` (`SPORT_SECTIONS` pour la page du match ; `alsoFor` pour qu'une famille du foot ou du basket vaille aussi pour lui), puis la table du sport dans le lecteur du bookmaker (`src/scraper/pmuMarkets.ts`, `sportncoMarkets.ts` pour NetBet et Genybet, `vbetMarkets.ts` pour Vbet, CircusBet et DAZN Bet, `unibetMarkets.ts`) et `MARKETS_BY_BOOKMAKER` dans `src/scraper/marketsRun.ts` (un bookmaker n'est interrogé que pour les sports dont il a un lecteur). Une table ne s'écrit que sur une vraie réponse, dans `tests/scraper/fixtures/` | `tests/markets/catalog.test.ts` (chaque famille d'un sport a sa rubrique), le test du lecteur, `tests/scraper/marketsRun.test.ts`, `tests/db/eventDetail.test.ts` |
| L'en-tête, le pied de page, les écrans de chargement, d'erreur et vides | `web/src/components/AppHeader.tsx`, `AppFooter.tsx`, `StatusViews.tsx` | `web/src/App.test.tsx` |
| Les couleurs, la typo, les espacements (clair et sombre) | `web/src/styles/tokens.css`, puis `base.css` pour les styles de toute la page | Relire les contrastes (voir Conventions) |
| Le nom ou l'emoji d'un sport | `web/src/sports.ts` | `web/src/sports.test.ts` |
| Les sports favoris (l'étoile, 3 au plus, en tête de la rangée) | `web/src/favoriteSports.ts` (ordre, plafond, copie dans le `localStorage`), `web/src/components/SportTabs.tsx` et son CSS, `web/src/App.tsx` | `web/src/favoriteSports.test.ts`, `web/src/components/SportTabs.test.tsx`, `web/src/App.test.tsx` |
| Les réglages gardés avec le compte (sport, tri, bookmakers, joueurs, sports favoris), retrouvés d'un appareil à l'autre : l'adresse prime, sinon ceux du compte ; enregistrés une seconde après le dernier changement | `src/auth/preferences.ts` (validation, requêtes), `src/auth/preferencesRoutes.ts` (`GET`/`PUT /api/preferences`), table `user_preferences` dans `src/auth/db.ts`, `web/src/preferences.ts` (chargement, fusion avec l'adresse), `web/src/usePreferencesSync.ts`, `web/src/Root.tsx` (les charge avant le dashboard) | `tests/auth/preferences.test.ts`, `tests/api/protection.test.ts`, `web/src/preferences.test.ts`, `web/src/usePreferencesSync.test.ts`, `web/src/App.test.tsx` |
| Le portefeuille de freebets du compte (FB par bookmaker, 1 FB = 1 €), remplacé en entier à chaque enregistrement | `src/freebets/wallet.ts` (validation, requêtes en une transaction), `src/freebets/walletRoutes.ts` (`GET`/`PUT /api/freebets/wallet`), table `user_freebets` dans `src/auth/db.ts` (montants en centimes entiers) | `tests/freebets/wallet.test.ts`, `tests/api/protection.test.ts` |
| Ce que la page Freebets demande au moteur et ce qu'elle reçoit : `GET /api/freebets/conversions?mode=bookmakers&legs=1\|2\|3` ou `?mode=exchange&bookmaker=…` (plus `sports=a,b`), le portefeuille étant toujours lu côté serveur | `src/db/freebets.ts` (les matchs de la semaine : marché principal à 2 ou 3 issues, cotes fraîches, lay de l'exchange), `src/freebets/conversions.ts` (la requête, ce qu'on demande au moteur, les plans et la chaîne mis en forme, au centime), `src/freebets/conversionsRoutes.ts` (cache, 429, 503), `src/freebets/pool.ts` et `worker.ts` (le calcul dans un `worker_threads`, une file, un délai), branchés dans `src/api/server.ts` et `index.ts` (`FREEBETS_CACHE_SECONDS`) | `tests/db/freebets.test.ts`, `tests/freebets/conversions.test.ts`, `tests/freebets/pool.test.ts` (vrai worker et faux workers), `tests/api/freebets.test.ts`, `tests/api/protection.test.ts` |
| Le calcul des conversions de freebets (le meilleur plan d'un combiné, le top 3 parmi tous les matchs, la chaîne contre l'exchange) : méthode, preuves, mesures et limites dans [docs/freebets-calcul.md](docs/freebets-calcul.md) | `src/freebets/engine/` (`combo.ts` un combiné : programme linéaire, règle de couverture, mise minimale, centimes ; `funnel.ts` et `bounds.ts` le tri des combinés ; `exchange.ts` ; `columnGeneration.ts` et `simplex.ts` les solveurs). Le moteur n'importe que ses propres fichiers : pas de base, pas d'Express | `tests/freebets/engine/` (juges indépendants : simplexe dense, énumération, scipy figé dans `fixtures/`) |
| La page Freebets (`/freebets`, réservée aux comptes) : le portefeuille saisi, le mode (entre bookmakers, contre l'exchange), le format, les sports, le top 3 et le détail des paris à placer ; les réglages vivent dans l'adresse | `web/src/freebets/` (`FreebetsPage.tsx` assemble ; `useWallet.ts` enregistre 800 ms après la dernière frappe, `useConversions.ts` demande 250 ms après le dernier réglage, annule et rafraîchit chaque minute ; `settings.ts` lit et écrit l'adresse ; `format.ts` les montants ; `ExchangeView.tsx`, `PlanDetail.tsx`, `Placement.tsx`, `OddsNotice.tsx` la mise en garde sur les cotes), l'entrée « Freebets » de `web/src/components/AppNav.tsx`, `web/src/Root.tsx` (le chemin, la garde de connexion), `FREEBETS_PATH` dans `web/src/routes.ts` et `SPA_PATHS` dans `src/api/server.ts` | `web/src/freebets/*.test.ts(x)` (`FreebetsPage.test.tsx` avec `fetch` stubbé et horloge simulée, axe), `web/src/Root.test.tsx`, `web/src/App.test.tsx`, `tests/api/server.test.ts`, `e2e/freebets.spec.ts` |
| Le rapprochement des matchs entre bookmakers | `src/matcher/match.ts` | `tests/matcher/match.test.ts` |
| La récupération des cotes d'un bookmaker | `src/scraper/<bookmaker>.ts` | `tests/scraper/` |
| Le calcul du TRJ | `src/db/payoutRate.ts` | `tests/db/payoutRate.test.ts` |
| La référence (cote juste de l'exchange) : sa collecte, le rapprochement de ses matchs, ses garde-fous | `src/reference/exchange.ts` (recherche, détails d'un match, socket des prix et lignes asiatiques, cote juste, fiabilité des cotes joueurs), `src/reference/match.ts` (noms en anglais, sens des équipes), `src/reference/run.ts` (le cycle du worker), `src/reference/players.ts` (ses marchés joueurs), `src/reference/tennis.ts` et `tennisRun.ts` (le tennis : noms des joueurs, marchés, cote juste, son cycle), `src/reference/sports.ts` et `sportsRun.ts` (les autres sports de face-à-face : le marché de l'exchange de chacun, ses matchs « Away @ Home », son cycle), `src/reference/golf.ts` et `golfRun.ts` (les tournois de golf des 7 prochains jours : le vainqueur de chacun sur l'exchange, sa cote juste par joueur), `src/db/reference.ts`, `src/db/playerReference.ts` et `src/db/tennisReference.ts` (ses tables), `src/db/tennisValue.ts` (value bets tennis) | `tests/reference/` (sur des réponses réelles de l'exchange, dont `tennis.test.ts`, `tennisRun.test.ts`, `sports.test.ts` et `sportsRun.test.ts`) |
| Les comptes : inscription, connexion, sessions, emails, rôles | `src/auth/` (`routes.ts` les routes, `store.ts` les requêtes, `password.ts`, `middleware.ts` : `requireAuth`, `requireRole`, CSRF), `src/auth/db.ts` (**migrations versionnées** : en ajouter une, ne jamais modifier une migration livrée), `web/src/auth/` (contexte, pages), `web/src/Root.tsx` (la garde de `/odds`) | `tests/auth/`, `tests/api/protection.test.ts`, `web/src/Root.test.tsx` |
| Les alertes Discord (gems) | `src/alerts/gems.ts` (seuils, message, envoi), `src/db/alerts.ts` (gems envoyées, état), `src/worker/index.ts` (après chaque cycle de la référence), `GET /api/alerts` dans `src/api/server.ts`, `deploy/deploy.sh` (`apply_settings`) et `.github/workflows/deploy.yml` (le secret `DISCORD_WEBHOOK_URL`) | `tests/alerts/gems.test.ts`, `tests/deploy/settings.test.ts`, `tests/api/server.test.ts` |
| Les métriques des marchés joueurs de l'exchange | `src/db/playerStats.ts` (compteurs, signaux vus, bilan), `src/reference/players.ts` (`recordPlayerSignals`), `GET /api/stats/players` dans `src/api/server.ts` | `tests/reference/players.test.ts`, `tests/api/server.test.ts` |
| Les surebets : TRJ au-dessus de 100 % entre bookmakers, avec les cotes back de l'exchange (commission de 3 %, 20 € au moins) ou back/lay, « à vérifier » au-delà de 110 %, alertes Discord | `src/db/surebets.ts` (`getSurebets`, `surebets` de `/api/value-bets` ; `withoutSurebets`, les value bets sans les cotes qui font un surebet, sur le site et dans les alertes), `src/db/marketGrid.ts` (le TRJ d'un marché, partagé avec `src/db/eventDetail.ts` et `src/db/payoutRate.ts`), `src/alerts/gems.ts` (`surebetsMessage`), `web/src/SurebetsTable.tsx`, `web/src/App.tsx` | `tests/db/surebets.test.ts` (sur un vrai match de tennis : aces, jeux...), `tests/db/eventDetail.test.ts`, `tests/alerts/gems.test.ts`, `tests/api/server.test.ts`, `web/src/SurebetsTable.test.tsx`, `web/src/App.test.tsx` |
| Les value bets : seuil, tri, affichage, catégorie « Value bets » | `src/db/value.ts` (seuil de 1 %), `src/db/playerValue.ts` (les joueurs : cote juste, plafond du lay, cotes suspectes comptées mais pas affichées, `SHOWN_BASES`), `src/db/repository.ts` (`sort=value`, `getValueBets` pour `/api/value-bets`), `web/src/value.ts`, `web/src/ValueBetsTable.tsx`, `web/src/sports.ts` (`VALUE_BETS`), `web/src/App.tsx`, `web/src/components/FairOdds.tsx`, `PriceChip.tsx`, `ReferenceNote.tsx` | `tests/db/value.test.ts`, `tests/db/playerValue.test.ts`, `tests/api/server.test.ts`, `web/src/ValueBetsTable.test.tsx`, `web/src/App.test.tsx`, `web/src/OddsTable.test.tsx`, `web/src/components/MarketCard.test.tsx` |
| La fréquence de scraping (1N2 et autres marchés), le port | `.env` du serveur (pas de code, voir section 8) | |

### Explorer l'API d'un bookmaker

Aucun bookmaker ne documente son API. Pour savoir quoi demander :

- **Betclic** (gRPC-Web, `offering.begmedia.com`) : le code JavaScript du
  site contient la description de chaque méthode et de chaque message (noms
  et numéros de champs). www.betclic.fr refuse les connexions hors de France,
  mais le Web Archive garde ses fichiers `main-*.js` (voir le commentaire en
  tête de `src/scraper/betclic.ts`). Une méthode inexistante répond
  `grpc-status: 12`.
- **Winamax** (Socket.IO) : le nom des routes (`sport:<id>`, `match:<id>`)
  se trouve dans le fichier `main.*.js` de `s.winamax.fr`.
- **Vbet** (websocket `wss://swarm-2.vbet.fr/`, protocole « Swarm » de
  BetConstruct) : les messages que le site envoie se lisent dans l'onglet
  réseau du navigateur ; `get_market_type` donne les marchés de chaque sport
  (leur `market_type`, voir `MAIN_MARKETS` dans `src/scraper/vbet.ts`).
  CircusBet et DAZN Bet sont sur le même serveur : la page de chaque site
  donne `springParams.swarmUrl` (l'adresse) et `springConfig.partnerId`
  (l'identifiant de site de `request_session`) ; `scripts/probe-bundles.mjs`
  les relève, et `CIRCUSBET` / `DAZNBET` dans `src/scraper/vbet.ts` les portent.
- **NetBet** (SportNCo, `ws.netbet.fr`) : `component/datatree` rend une
  page entière (`url_key` : `/football`...), `component/data` un seul de ses
  composants (`menu_az_sportcatcomp`, les compétitions ;
  `prematch_event_list`, les matchs). Genybet est sur la même plateforme
  (`ws.genybet.fr`, mêmes composants, mêmes cotes) et se lit de la même façon
  (`GENYBET` dans `src/scraper/sportnco.ts`) ; son pare-feu a rejeté le serveur
  le 5/10/2026 à quatre requêtes simultanées, d'où deux à la fois : s'il le
  rejette de nouveau, son scraper échoue seul.
- **Betsson** (`velsv-bson-ssb-pr.betsson.fr/services/content/get`, un POST JSON
  sans compte, `contentId: {type, id}`) : le site est une SPA, ces appels se
  lisent dans l'onglet réseau. `boNavigationList` / `1355/top` donne les sports
  et leur code (`focontentid`), `eventListBySportTypeDate` /
  `<code>/<AAAAMMJJ>0000/<AAAAMMJJ>2359/<page>/200/D` les matchs d'un sport avec
  leurs marchés et leurs cotes (en fractions : `currentpriceup /
  currentpricedown + 1`). Une liste vide répond `CONTENT_NOT_FOUND` en HTTP 200.
  Les épreuves des sports sans face-à-face (`idfoeventtype: "OUTRIGHT"`) sont
  dans la même liste, après les matchs : leur gagnant est le marché dont le
  titre finit par `Winner` ou `Vainqueur` (`WINNER_MARKET`), les coureurs sans
  cote n'ont pas de prix.
- **PMU** (`eu.offering-api.kambicdn.com/offering/v2018/pmusportsfr`, l'API
  publique de Kambi : des GET JSON sans compte) : le site
  (`www.pmu.fr/sport/`) est une SPA, ces appels se lisent dans l'onglet réseau.
  `group.json` donne les sports (`termKey`), `listView/<termKey>.json` les
  matchs et les épreuves avec leurs offres principales (`betOffers`). Les cotes
  sont en millièmes (`odds: 1470`). Un résultat est l'offre de type `Match`
  étiquetée `MAIN` ; un vainqueur d'épreuve (événement `COMPETITION`) est
  l'offre `Winner`, `GP Winner` ou `Finishing Position` (`WINNER_OFFER`).
  `betoffer/event/<id>,<id>….json` donne tous les marchés de ces matchs : un
  marché est l'identifiant de son critère (`criterion.id`, le même d'un match à
  l'autre ; la table de `src/scraper/pmuMarkets.ts` va de cet identifiant à une
  famille du catalogue), ses issues ont un type (`OT_OVER`, `OT_YES`…), une
  ligne en millièmes (`line: 2500` est 2,5) et, pour un joueur, `participant`.
  Un tournoi de golf a des offres de même critère (`Finishing Position`) qu'on
  distingue par leur `description` (« Vainqueur », « Top 5 »…) : voir `golfOffer`
  dans `src/scraper/pmuMarkets.ts`.
- **Betify** (`api-h-<hash>.sptpub.com`, le flux de Betby : des GET JSON sans
  compte ; l'hôte se lit dans le script du « renderer » que
  `flex.betify10.sh/fr/sport/launch` indique) : `…/prematch/brand/<marque>/fr/0`
  liste les fichiers du flux, qui donnent sports, tournois et matchs avec leur
  marché principal. `…/event/fr/<id>` donne tous les marchés d'un match : un
  marché est un numéro (la table de `src/scraper/betbyMarkets.ts` va de ce numéro
  à une famille du catalogue), ses prix sont par variante (`total=2.5`) puis par
  issue, et les noms des issues viennent des descriptions (`{$competitor1}` est la
  première équipe, `match nul` le nul ; un prix `0.0` avec `b: 1` est bloqué).
- Un bookmaker qui renvoie une page anti-robots (Cloudflare, DataDome...)
  n'est pas lu : on ne contourne pas ces protections.
- Les icônes des bookmakers sont dans `web/src/assets/bookmakers/`. Celles de
  Genybet, CircusBet, DAZN Bet et Betify se trouvent par leur nom de fichier
  (`genybet.png`, `circusbet.png`, `daznbet.png`, `betify.png`, aussi `.ico`, `.svg`, `.webp`,
  `.jpg`) : sans fichier, l'interface écrit le nom. `npm run icons` les
  télécharge, d'abord depuis le site du bookmaker, sinon depuis un service de
  favicons ; à regarder avant de les commiter.

### Conventions

- Code, commentaires et tests en anglais ; textes affichés à l'utilisateur
  en français.
- Chaque correction ou nouveauté est accompagnée d'un test. Pour un bug, on
  écrit d'abord le test qui le reproduit, puis la correction.
- Un changement qui touche un chemin critique (section 5) garde ses tests
  end-to-end au vert, et en ajoute un si le parcours est nouveau.
- Messages de commit courts, préfixés par le type de changement : `feat:`
  (nouveauté), `fix:` (correction), `test:`, `docs:`, `ci:`, `chore:`. Par
  exemple : `feat: show each match's kick-off date and time`.

### Ajouter une page au site

Le site n'a pas de routeur : `web/src/Root.tsx` choisit la page d'après le
chemin. Pour en ajouter une :

- ajouter son chemin dans `web/src/routes.ts` et son cas dans `Root.tsx` ;
- l'ajouter aussi à `SPA_PATHS` dans `src/api/server.ts`, sans quoi un
  rechargement de la page donne une 404 (le serveur ne renvoie `index.html`
  que pour les chemins listés) ;
- si la page montre des données, elle appelle une route `/api` : celles-ci sont
  protégées d'office (`requireAuth` dans `createServer`), et la page doit
  passer par `RequireAuth` dans `Root.tsx` comme `/odds` (sans quoi le
  visiteur voit des erreurs au lieu de la page de connexion) ;
- les adresses publiques existantes ne changent pas : les alertes Discord et
  les liens partagés pointent vers `/?match=…` ; `Root` les envoie vers
  `/odds` (`isDashboardQuery` dans `routes.ts`).

### Conventions du dashboard

- **Styles** : un CSS Module par composant (`Foo.module.css` à côté de
  `Foo.tsx`). Aucune couleur, taille de texte ou marge écrite en dur : on
  utilise les variables de `web/src/styles/tokens.css`. Le thème sombre y
  redéfinit les mêmes variables : une nouvelle couleur s'ajoute toujours dans
  les deux thèmes.
- **Accessibilité** :
  - un contrôle stylé garde son élément natif, même masqué (bouton radio,
    case à cocher). Le clavier, les lecteurs d'écran et les tests continuent
    alors de le trouver ;
  - une information ne passe jamais par la couleur seule, comme la coche de
    la meilleure cote ;
  - le texte garde un contraste d'au moins 4,5:1, en clair comme en sombre ;
  - `App.test.tsx` lance axe sur la page rendue ; les contrastes, eux, se
    vérifient dans un vrai navigateur.
- **Mobile first** : l'usage principal du site est sur téléphone. Tout
  nouveau développement front-end part du téléphone, puis ajoute le desktop :
  - on conçoit d'abord l'écran à 375 px de large et son accessibilité au
    doigt, puis on élargit. Les styles de base d'un composant sont ceux du
    téléphone ; les écrans plus larges les complètent par des
    `@media (min-width: 768px)` (ou `1024px`), jamais par des `max-width` ;
  - une cible tactile fait 44 px au moins (`--tap`, `--control-height`) ;
  - rien ne passe que par le survol : une explication n'est jamais
    seulement dans un attribut `title` (invisible au doigt) ;
  - ce qui sert le plus (les cotes, les value bets) se voit sans défiler ;
    les réglages secondaires vont dans le panneau « Filtres » ;
  - on vérifie chaque changement visuel à 320, 375 puis 1280 px de large,
    sans défilement horizontal de la page, en clair et en sombre.

## 5. Vérifier avant de pousser

La CI lance exactement ces commandes. Si elles passent en local, le job de
test passera aussi :

```bash
# Backend, depuis la racine
npx tsc --noEmit -p .
npm test

# Dashboard
cd web
npm run lint
npm test
npm run build

# Chemins critiques (end-to-end), depuis la racine
npx tsc --noEmit -p e2e
npm run e2e
```

`npm run e2e` construit le dashboard puis lance les specs dans un vrai
navigateur : la première fois, `npx playwright install chromium` télécharge
celui-ci. Les specs ont leur propre serveur, sur le port 3100 et sur des bases
jetables (`e2e/.tmp/`) : ni le worker ni le port 3000 ne sont nécessaires. En
cas d'échec, `npx playwright show-report` ouvre le rapport, et la CI en garde
une copie (artefact `playwright-report`).

### Les chemins critiques

Une pull request ne se fusionne que si les tests end-to-end passent : c'est une
case de sa liste, et le job `e2e` de la CI la vérifie (il bloque aussi les
déploiements, `test.yml` étant partagé). Ils couvrent les parcours qui ne
doivent jamais casser, ceux dont la panne se voit tout de suite côté
utilisateur et que les tests unitaires, en jsdom ou avec supertest, ne voient
pas (cookies, redirections, rechargement d'une page, site construit servi par
l'API) :

| Parcours | Spec | Ce qui est vérifié |
| --- | --- | --- |
| Inscription | `accounts.spec.ts` | Créer un compte, être refusé tant que l'adresse n'est pas confirmée, confirmer par le lien de l'email, se connecter |
| Mot de passe oublié | `accounts.spec.ts` | Demander le lien, en choisir un nouveau mot de passe, l'ancien est refusé |
| Déconnexion | `accounts.spec.ts` | La session est fermée : le tableau de bord et l'API sont de nouveau fermés |
| Accès protégé | `access.spec.ts` | Un visiteur anonyme sur `/odds` est envoyé à `/login?next=…` et revient où il était ; `/api` répond 401 sans session, sauf `/api/health` et `/api/public/home` |
| Rechargement des pages | `access.spec.ts` | Chaque page du site (`SPA_PATHS`) s'ouvre aussi directement, pas par une 404 |
| Administration | `admin.spec.ts` | Un visiteur ou un compte ordinaire n'entre pas sur `/admin` ; un admin liste les comptes, en bloque un (déconnecté aussitôt, refusé à la connexion) et nomme un autre admin |
| Les cotes | `odds.spec.ts` | La liste des matchs et la meilleure cote de chaque issue, les filtres (sport, recherche, bookmakers) gardés dans l'adresse |
| Les value bets | `odds.spec.ts` | Chaque pari contre la cote juste, le plus gros écart en premier |
| La page d'un match | `odds.spec.ts` | Ouverte depuis les value bets, tous ses marchés, le lien retour |
| Les surebets | `odds.spec.ts` | Chaque jambe (bookmaker, cote, mise), le TRJ et le gain |
| Les freebets | `freebets.spec.ts` | Un compte saisit ses FB (enregistrés avec le compte, relus au rechargement), voit le top 3 et où placer chaque pari, copie la liste ; le mode exchange (pari + lay, chaque cas) ; les réglages gardés dans l'adresse ; un compte neuf est invité à saisir ses FB ; un visiteur est renvoyé à `/login?next=…` et l'API lui répond 401 |

Ce qui n'y est pas : le cycle du worker (il dépend des sites des bookmakers,
et ses tests utilisent de vraies réponses enregistrées), l'accueil public et
l'affichage sur téléphone (`web/src/*.test.tsx`).

Pour **ajouter un parcours critique**, ou en changer un :

- le spec va dans `e2e/`, avec les matchs et les cotes qu'il lui faut ajoutés à
  `e2e/seed.ts` et décrits dans `e2e/fixtures.ts` ; la ligne du tableau
  ci-dessus suit ;
- on le voit d'abord **échouer** pour la bonne raison (on casse le code qu'il
  protège, par exemple `requireAuth`, ou on retire une page de `SPA_PATHS`),
  puis passer ;
- on cherche les éléments par leur rôle et leur nom (`getByRole`), comme le
  fait un lecteur d'écran, pas par une classe CSS ; on ne lit jamais l'heure,
  qui dépend du jour où le test tourne ; une cote du semis suffit à reconnaître
  un match.

## 6. Le parcours d'une modification : de la branche à la production

Deux branches durables, trois environnements :

| Branche | Site | Déployé par |
| --- | --- | --- |
| `feat/…`, `fix/…` | aucun (tests de la CI seulement) | |
| `development` | <https://staging.odds-blitzer.de> (site de test) | `deploy-staging` à chaque push |
| `main` | <https://odds-blitzer.de> (production) | `deploy` à chaque push, si le `gate` passe |

### Une modification (feature ou bug)

```bash
git switch development && git pull
git switch -c feat/ma-modification     # ou fix/…
# … modifier, tester, commiter (section 5) …
git push -u origin feat/ma-modification
gh pr create --base development
```

La pull request lance le workflow `ci` : les vérifications de la section 5
sur une machine GitHub. Fusionner avec un **merge commit** quand elle est
verte. Le push sur `development` lance `deploy-staging` : tests, déploiement
sur le VPS dans `/opt/oddsradar-staging`, vérification que le site de test
répond. Vérifier alors la modification sur le site de test.

Le site de test a ses propres bases (jamais celles de la production), son
propre worker, qui scrape toutes les 45 minutes plutôt que toutes les 5 (même
IP que la production : voir `deploy/staging/.env.staging.example`), et pas
d'alertes Discord.

### Mettre en production

Quand `development` contient ce qu'on veut livrer, et que le site de test a
été vérifié :

```bash
gh pr create --base main --head development --title "Release: …"
```

Le workflow `ci` teste la pull request, et son job `promotion-guard` échoue
si elle ne vient pas de `development`. Fusionner avec un **merge commit**.
Le push sur `main` lance le workflow `deploy`, qui comporte trois jobs :

1. **test** : les vérifications de la section 5 ;
2. **gate**, seulement si `test` est vert : le commit doit venir de
   `development`, et ce code doit avoir été déployé avec succès sur le site
   de test (tests et vérification de santé compris), et `main` ne doit rien
   contenir de plus que lui. Sinon rien n'est déployé et le log dit
   pourquoi ;
3. **deploy**, seulement si `gate` est vert. Le job se connecte au VPS en
   SSH et lance `deploy/deploy.sh` sur le commit testé. Le script :
   - récupère ce commit ;
   - réinstalle les dépendances (`npm ci`) et compile le backend et le
     dashboard ;
   - redémarre les deux services ;
   - vérifie que l'API répond et que le worker tourne.

   Le job vérifie enfin que le site répond depuis l'extérieur.

Le tout prend environ 1 à 2 minutes. Un seul déploiement par environnement
tourne à la fois et il n'est jamais interrompu. Si plusieurs pushes arrivent
pendant qu'il tourne, seul le plus récent est déployé ensuite. Après la
mise en production, `sync-development` fusionne `main` dans `development`
pour que les deux branches restent alignées.

### Hotfix

Un bug en production se corrige comme tout le reste : branche `fix/…` depuis
`development`, pull request vers `development`, vérification sur le site de
test, pull request vers `main`. Il n'y a pas de raccourci vers `main` : le
`gate` refuserait de le déployer.

### Ce qui garantit la règle

GitHub ne propose pas les protections de branche sur un dépôt privé gratuit.
La règle « rien sur `main` sans être passé par `development` » repose donc
sur :

- `promotion-guard` et les tests de `ci` sur chaque pull request ;
- le `gate` du déploiement de production : un commit poussé directement sur
  `main` n'est jamais déployé ;
- les règles de `.claude/rules/git-workflow.md` et les permissions de
  `.claude/settings.json` pour Claude Code.

Un push direct sur `main` reste techniquement possible, mais il n'a aucun
effet sur la production et fait échouer le workflow `deploy`.

Le déploiement conserve `.env` et `data/` (la base SQLite) : ces fichiers ne
sont pas suivis par git. Il écrase en revanche toute modification faite à la
main sur le serveur dans un fichier suivi par git.

## 7. Si quelque chose se passe mal

GitHub envoie un mail quand un run échoue. Cliquer sur le job en rouge pour
voir l'étape fautive et son log.

**Le job `test` est rouge.** Rien n'a été déployé et l'environnement tourne
toujours sur la version précédente. Corriger, relancer les vérifications en
local, puis pousser à nouveau.

**Le job `gate` est rouge** (production). Le log dit pourquoi : le commit a
été poussé directement sur `main`, ou le site de test n'a pas encore reçu ce
code. Dans le second cas, attendre que `deploy-staging` soit vert sur
`development`, puis relancer le run (« Re-run all jobs »). Dans le premier,
corriger par `development` : un commit poussé à la main sur `main` ne sera
jamais déployé.

**Le job `deploy` est rouge** (production ou test). Le message `[deploy] ERROR: …` du log indique
la cause :

| Message | Cause probable et solution |
| --- | --- |
| `Secrets VPS_SSH_KEY / VPS_KNOWN_HOSTS manquants` (pour le site de test : `STAGING_VPS_SSH_KEY`), `Permission denied`, `Host key verification failed` | Les secrets GitHub ou la clé du serveur ont changé : refaire la mise en place du README (« Deploiement automatique »). |
| `git fetch failed` | Le VPS ne peut plus lire le dépôt : voir la clé de déploiement dans le README. |
| `the API does not answer`, `… is not running` | La nouvelle version plante au démarrage. Lire les logs sur le VPS, puis corriger ou revenir en arrière. |

**Revenir en arrière.** Le plus propre est d'annuler le commit fautif. Le
retour arrière suit alors le même chemin qu'une modification normale : une
branche `fix/…` depuis `development` qui contient le `git revert`, puis les
pull requests vers `development` et vers `main` du parcours de la section 6.

```bash
git revert <sha-du-commit>      # ou -m 1 <sha> pour un merge commit
```

En urgence, on peut aussi relancer un ancien run vert de `deploy` (Actions >
le run > « Re-run all jobs »). Il redéploie son propre commit. Ce n'est que
temporaire : le prochain push sur `main` redéploie `main`.

**Sur le VPS** (`ssh oddsradar@141.95.86.176`) :

```bash
sudo systemctl status oddsradar-worker oddsradar-web   # état des services
journalctl -u oddsradar-web -n 100                     # 100 dernières lignes du log
journalctl -u oddsradar-worker -f                      # log en direct (Ctrl+C pour quitter)
/opt/oddsradar/deploy/deploy.sh                        # redéployer main à la main
/opt/oddsradar/deploy/deploy.sh <sha>                  # redéployer un commit précis de main
journalctl -u oddsradar-staging-worker -n 100          # le site de test : mêmes commandes
                                                       # avec oddsradar-staging-web/-worker
```

## 8. Ce que le déploiement automatique ne fait pas

Ces changements se font à la main sur le VPS, en plus du push (pour le site de
test : `/opt/oddsradar-staging`, ses services `oddsradar-staging-*` et ses
unités dans `deploy/staging/`) :

- **Réglages dans `.env`** (`PORT`, `POLL_INTERVAL_MINUTES`,
  `MARKETS_INTERVAL_MINUTES`, `DB_PATH`) :
  modifier `/opt/oddsradar/.env`, puis
  `sudo systemctl restart oddsradar-worker oddsradar-web`. Si le port
  change, mettre aussi à jour `APP_URL` dans
  `.github/workflows/deploy.yml`.
- **Unités systemd** (`deploy/*.service`) : les recopier et les recharger.

  ```bash
  sudo cp /opt/oddsradar/deploy/*.service /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl restart oddsradar-worker oddsradar-web
  ```

- **Structure de la base** : `src/db/client.ts` crée les tables qui manquent
  (`SCHEMA`) et ajoute à une table existante les colonnes listées dans
  `ADDED_COLUMNS` (une colonne ajoutée va dans le `CREATE TABLE` **et** dans
  cette liste, avec une valeur par défaut ; `tests/db/client.test.ts` le
  vérifie). Tout autre changement (renommer, retirer, changer une clé,
  reconstruire une table) est une **migration versionnée** : une fonction de
  plus à la fin de `MIGRATIONS`, dans la même transaction que le
  `PRAGMA user_version` qui la suit, sans jamais modifier une migration déjà
  livrée (comme `src/auth/db.ts`). Elle doit marcher sur une base neuve **et**
  sur une base existante, et ne rien perdre de ce qui ne se reconstruit pas
  (`reference_player_stats`, `reference_player_signals`,
  `reference_player_cycles`, `gem_alerts`) ; le test de la première migration
  montre comment fabriquer une ancienne base. Une migration qui copie une
  table demande autant de place disque libre que la table pendant la copie.
  Le worker et l'API ouvrent la base ensemble au déploiement : le second
  attend la fin de la migration du premier. Le fichier ne rétrécit pas après
  une migration qui supprime des données ; pour rendre l'espace au disque,
  services arrêtés : `sqlite3 data/coteradar.sqlite "PRAGMA wal_checkpoint(TRUNCATE); VACUUM;"`.

- **Version de Node.js et paquets système du VPS**.
- **Clés et secrets** (`VPS_SSH_KEY`, `VPS_KNOWN_HOSTS`, clé de lecture du
  dépôt) : voir le README. Une clé privée ne se copie que dans un secret
  GitHub. Jamais dans un chat, un ticket ou un commit.

## 9. Avec Claude Code

On peut aussi demander une modification à Claude Code, en français, en
décrivant le résultat attendu. Il crée une branche depuis `development`,
modifie le code et les tests, lance les vérifications de la section 5, ouvre
la pull request vers `development` et suit le déploiement sur le site de test
jusqu'au vert. Il ne pousse ni ne fusionne jamais sur `main` : la mise en
production (pull request `development` → `main`) ne se fait que sur demande
explicite. Ses règles sont dans `.claude/rules/git-workflow.md`. Les règles
de ce guide s'appliquent de la même façon, en particulier la dernière de la
section 8 : ne jamais lui donner de clé privée.
