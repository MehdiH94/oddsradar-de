# OddsBlitzer

Ce dépôt est OddsBlitzer (odds-blitzer.de, VPS 141.95.86.176). CoteRadar
(cote-radar.fr, dépôt ouassimBenMosbah/coteRadar, VPS 141.94.244.108) est un
autre projet : ne jamais s'y connecter, y déployer, ni modifier son dépôt ou
ses secrets.

Comparateur de cotes (value bets et surebets) : un worker qui scrape dix
bookmakers et l'exchange, une API Express + SQLite, un dashboard React
(`web/`). Le code, les commentaires et les tests sont en anglais ; le texte de
l'interface est en français.

## Workflow Git (impératif)

`feat/…` ou `fix/…` depuis `development` -> pull request vers `development`
(CI) -> déploiement automatique sur staging -> vérification -> pull request
`development` -> `main` -> production. **Jamais de commit, de push ni de merge
sur `main`.** Détails et règles : `.claude/rules/git-workflow.md` et
CONTRIBUTING.md, section 6.

## À lire

- CONTRIBUTING.md : organisation du projet, vérifications avant de pousser
  (section 5, les mêmes que la CI), parcours d'une modification, déploiement.
- README.md : installation, mise en place du serveur et du site de test.
