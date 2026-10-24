# Pourquoi la plupart des surebets sont 20bet contre l'exchange (octobre 2026)

Question du propriétaire (backlog #27, 22/10/2026) : la plupart des surebets
du site opposent 20bet à l'exchange. Est-ce normal, ou un défaut ?

**Réponse courte : c'est surtout structurel.** 20bet et l'exchange sont les
deux seules sources sans taxe allemande sur les paris. Une cote chez un
bookmaker allemand est stockée nette de 5 % ou 5,3 %, donc elle bat beaucoup
plus rarement le lay de l'exchange. Deux causes possibles de faux surebets
restent à mesurer sur les vraies données : l'écart de temps entre les lectures
des deux jambes, et les lays sans argent derrière. `npm run surebet-report`
les mesure (voir plus bas).

Les données de production ne sont pas lisibles depuis l'environnement de
développement : l'API demande un compte, et le serveur n'y est pas accessible.
Cette note part donc du code ; les chiffres réels viendront du rapport lancé
sur le serveur.

## 1. La taxe : un avantage de ~5 % pour 20bet (structurel)

Les scrapers stockent chaque cote nette de la taxe que le bookmaker prend
(`src/scraper/stakeTax.ts`) : 5 % chez LeoVegas, Merkur Bets, Sportingbet,
888sport et VBET, 5,3 % chez Admiralbet, bet-at-home, Betway et ODDSET. 20bet
(licence de Curaçao) n'en prend pas, Tipico et Winamax la paient eux-mêmes
(#38) : leurs cotes restent entières.

Un surebet « lay » (back chez un bookmaker, lay du même résultat sur
l'exchange) demande `back × 0,97 / (lay − 0,03) > 1`, soit `back > (lay −
0,03) / 0,97`, à cause des 3 % de commission (`EXCHANGE_COMMISSION`,
`src/db/surebets.ts`).

Exemple : une issue dont l'exchange donne back 1,98 / lay 2,02 (cote juste ≈ 2).

| | Cote habituelle (marge de 6 %) | Cote stockée | Cote qu'il faut pour un surebet | Écart à combler |
| --- | --- | --- | --- | --- |
| 20bet | 1,89 | 1,89 | 2,05 | **+8,7 %** |
| Tipico, Winamax | 1,89 | 1,89 | 2,05 | +8,7 % |
| bookmaker allemand à 5,3 % | 1,89 | 1,79 | 2,05 | **+14,8 %** |

Il suffit donc qu'une cote de 20bet soit en retard ou généreuse de ~9 % pour
faire un surebet ; un bookmaker allemand doit l'être de ~15 %, ce qui arrive
rarement et tombe souvent sous le garde-fou des cotes hors ligne
(`SUREBET_OUT_OF_LINE`). Tipico et Winamax ont le même avantage que 20bet,
mais The Odds API ne lit que sept championnats de football (`ODDS_API_COMPETITIONS`),
quand 20bet couvre tous les sports : d'où sa place à part.

Ces surebets sont réels **si la cote de 20bet est encore la bonne au moment de
parier**, et si on accepte de jouer chez un bookmaker sans licence allemande.

## 2. L'écart de temps entre les deux jambes (à mesurer)

Une cote reste à l'affiche trois cycles (`CYCLES_BEFORE_ODDS_EXPIRE`, 15 min
avec le cycle de 5 min). Si 20bet n'a pas été relu au dernier cycle (échec,
429, page manquante), sa cote peut dater de 10 à 15 minutes, face à un lay de
l'exchange relu il y a une minute. Une cote qui a bougé entre-temps fait un
faux surebet. Rien dans `src/db/surebets.ts` ne compare aujourd'hui les
heures de lecture des jambes.

Le test de `tests/db/surebetReport.test.ts` le montre : une cote de 20bet lue
il y a 12 minutes fait toujours un surebet affiché.

À trancher avec le rapport : si les surebets 20bet / exchange ont souvent un
écart de lecture supérieur à un cycle, il faut écarter ceux dont les jambes
sont lues trop loin l'une de l'autre. Le seuil doit tenir compte des marchés
du cycle « markets », relus toutes les 15 min seulement : un seuil unique de
5 min supprimerait tous leurs surebets.

## 3. Les lays sans argent (à mesurer)

Le site montre un surebet dont le lay n'a que 2 € derrière
(`SUREBET_THIN_MIN_SIZE`), marqué « nur … zum Layen ». Les alertes Discord
écartent ceux sous 20 € (`thin`). Le rapport affiche la somme de chaque lay.

## 4. Mauvais match ou mauvaise issue (couvert en partie)

Équipes inversées, autre match, prolongations comptées d'un côté et pas de
l'autre : le garde-fou des cotes hors ligne (#26, 15 points de probabilité)
écarte les cas grossiers. Un écart de règle plus fin (prolongations,
abandon au tennis) passe dessous ; le rapport donne le marché de chaque
surebet pour les repérer.

## Lancer le rapport sur le serveur

Sur le VPS, dans le dossier de l'application, avec le compte du service (le
rapport lit la base du worker sans toucher aux cotes, avec la version compilée,
`dist/`, celle que le déploiement construit) :

```bash
cd /opt/oddsradar
sudo -u oddsradar npm run surebet-report        # alertes des 7 derniers jours
sudo -u oddsradar npm run surebet-report -- 3   # des 3 derniers jours
```

Il donne :

1. les surebets envoyés sur Discord par paire de sources, et leur profit moyen ;
2. les surebets envoyés à +5 % ou plus, du plus haut au plus bas : le match,
   le marché, chaque jambe avec sa cote, le coup d'envoi et l'heure d'envoi,
   pour vérifier à la main s'il s'agit d'un mauvais match ou d'une vraie cote
   (Merkur Bets + 20bet à +15,5 % en moyenne, rapport du 24/10/2026) ;
3. les surebets affichés maintenant par paire, avec l'écart de lecture
   médian et maximal de leurs jambes ;
4. chaque surebet affiché : ses jambes, leur cote, l'argent du lay, l'heure de
   lecture de chacune.

Colle le résultat dans le salon Discord de feedback : l'agent backlog en fera
la tâche suivante (le seuil d'écart de lecture, si c'est la cause).
