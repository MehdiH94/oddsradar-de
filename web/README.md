# CoteRadar — dashboard

Interface React (Vite) du comparateur. Elle lit l'API du backend (`/api/*`) et
affiche les cotes. En production, c'est le process web du backend qui sert le
build (`web/dist`).

```bash
npm install
npm run dev     # http://localhost:5173, /api renvoye vers http://localhost:3000
npm run lint
npm test
npm run build
```

## Mobile first

L'usage principal du site est sur téléphone : chaque nouveau développement
se conçoit d'abord pour un écran de 375 px et son accessibilité au doigt,
puis s'élargit pour le desktop (styles de base = téléphone, puis
`@media (min-width: ...)`). Voir les règles dans
[CONTRIBUTING.md](../CONTRIBUTING.md), « Conventions du dashboard ».

## Organisation

| Chemin | Rôle |
| --- | --- |
| `src/main.tsx`, `src/Root.tsx`, `src/routes.ts` | Les deux pages du site, sans routeur : `Root` affiche l'accueil (`/`) ou le dashboard (`/cotes`, chargé à la demande, `src/dashboard.ts`) selon l'adresse, et redirige les anciens liens du dashboard (`/?sport=…`, `/?match=…`) vers `/cotes`. `routes.ts` : les chemins, les liens vers le dashboard, `navigate` ; `components/Link.tsx` : un lien qui change de page sans recharger. Le serveur doit connaître chaque chemin (`SPA_PATHS`, `src/api/server.ts`). |
| `src/HomePage.tsx`, `src/useHomeStats.ts`, `src/components/HomeHeader.tsx`, `src/components/HomeLive.tsx` | La page d'accueil : présentation du produit, chiffres et vrais value bets lus dans l'API (`/api/events`, `/api/sports`, `/api/value-bets`, avec un repli statique si elle échoue), FAQ. |
| `src/App.tsx` | État de la page : filtres, page, requêtes toutes les 30 s, URL (dont `?match=<id>`, la page d'un match, avec le retour du navigateur). |
| `src/components/` | Bannière de prévention des jeux (`GamblingBanner`, collée en haut de l'écran), en-tête, navigation (`AppNav` : barre du bas sur téléphone, sélecteur dans l'en-tête sur desktop), barre de filtres, panneau « Filtres » du téléphone (`FilterSheet`, sur `Sheet`), « Voir plus » (`LoadMore`) et pagination, écrans de chargement, d'erreur et vides, pastille de cote, meilleure cote d'une issue (`BestPrice`), badge TRJ, pied de page. |
| `src/useMediaQuery.ts` | `useIsWide()` (768 px) et `useIsTable()` (1024 px) : quand passer de la mise en page du téléphone à celle du desktop. Les tests rendent le desktop, sauf avec `mockPhone()` (`src/testUtils.ts`, voir `App.phone.test.tsx`). |
| `src/OddsTable.tsx`, `src/OutrightTable.tsx` | Matchs en cartes (téléphone et tablette) ou en tableau (desktop, dès 1024 px), et cartes des courses. |
| `src/MatchPage.tsx`, `src/components/MarketCard.tsx` | Page d'un match : ses marchés en rubriques repliables, une carte par marché (tableau Ligne / Plus / Moins pour les +/- buts), actualisée toutes les 60 s. |
| `src/styles/tokens.css` | Couleurs, typo, espacements, en clair et en sombre. |
| `src/styles/base.css` | Styles de toute la page (police, focus, tableaux). |
| `src/format.ts`, `src/sports.ts` | Formats français (cotes, TRJ, dates) et noms et emojis des sports. |

Chaque composant a son CSS Module (`*.module.css`) et son test à côté.

Voir le [README](../README.md) du projet pour l'ensemble, et
[CONTRIBUTING.md](../CONTRIBUTING.md) pour faire une modification et la
mettre en production.
