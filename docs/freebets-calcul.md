# Le calcul des conversions de freebets

Un freebet (FB, 1 FB = 1 €) est une mise offerte par un bookmaker : si le pari
gagne, il paie le gain **sans rendre la mise** (`mise × (cote − 1)`) ; s'il
perd, il ne coûte rien. Le moteur transforme les FB d'un compte en **cash
garanti**, quoi qu'il arrive, de deux façons :

- **entre bookmakers** : uniquement des FB, jamais d'argent réel. Un pari
  simple, ou un combiné de 2 ou 3 matchs (jusqu'à 27 issues), dont chaque issue
  est un pari en FB chez un bookmaker précis. Jamais toutes les issues du pari
  chez le même bookmaker ;
- **contre l'exchange** : les FB d'un bookmaker sont misés sur une issue, et
  cette issue est « layée » sur l'exchange. Au plus trois conversions, sur des
  matchs différents.

Le moteur est dans `src/freebets/engine/`. Ce document explique **pourquoi** il
est fait ainsi, ce qui est prouvé, ce qui est mesuré et ce qui ne l'est pas.
Les données (base de cotes, portefeuille, API) ne sont pas dans le moteur : il
ne reçoit que des tableaux de nombres et n'importe que ses propres fichiers
(`tests/freebets/engine/architecture.test.ts` le vérifie), ce qui lui permet de
tourner tel quel dans un `worker_threads`.

La méthode a été mise au point sur un prototype écrit avant le moteur (hors
dépôt, non conservé), puis le moteur l'a repris en la durcissant. Les mesures
« de la première phase » ci-dessous viennent de ce prototype ; les autres ont été
faites sur le moteur du dépôt.

| Fichier | Rôle |
| --- | --- |
| `types.ts` | `Match`, `Bet`, `Plan`, options, constantes (3 matchs, 3 issues, 27 issues au plus, cote maximale 1 000, cash minimal 0,01 FB) |
| `simplex.ts` | simplexe dense (règle de Bland après une série de pivots dégénérés) : sert au sommet final et de juge aux tests |
| `columnGeneration.ts` | le programme linéaire d'un combiné, résolu exactement par génération de colonnes |
| `combo.ts` | `solveCombo` : un combiné, avec la règle de couverture, la mise minimale et l'arrondi au centime |
| `bounds.ts` | les deux bornes qui permettent d'écarter un combiné sans le résoudre |
| `funnel.ts` | `topPlans` : les trois meilleurs combinés disjoints parmi des centaines de matchs |
| `exchange.ts` | `convertAgainstExchange` : la meilleure chaîne de conversions contre l'exchange |

## 1. Entre bookmakers : le modèle

Un combiné de N matchs a une **cellule** par combinaison d'issues (3 × 3 × 2 =
18 pour deux matchs de foot et un de tennis). Le bookmaker `b` peut parier la
cellule `j` seulement s'il cote tous les matchs, à la cote combinée `c_bj` (le
produit de ses cotes) ; un FB y gagne `a_bj = c_bj − 1`. Seuls les bookmakers
qui ont des FB peuvent porter un pari. Avec `x_bj` FB misés :

```
maximiser G
  sous  Σ_b a_bj · x_bj ≥ G      pour chaque cellule j   (chaque issue paie au moins G)
        Σ_j x_bj ≤ F_b           pour chaque bookmaker b (le budget de FB)
        règle de couverture, mise minimale, centimes (sections 3 à 5)
```

Sans budget à respecter, le taux se calcule à la main : chaque cellule doit
payer `G`, donc coûte au moins `G / a*_j` FB (`a*_j` : le meilleur gain par FB),
et `taux = G / FB utilisés = 1 / Σ_j 1/(c*_j − 1)`. Pour trois matchs cotés
pareil par trois bookmakers qui ont 55 FB chacun (165 FB sur 27 issues), cela
donne **81,06 % et 133,75 €**. Avec des budgets, le programme linéaire atteint
la même valeur (`tests/freebets/engine/combo.test.ts`, « exemple d'or »), et
une fois les mises arrondies au centime le plan garantit **133,63 €** (80,99 %).

## 2. Résoudre un combiné exactement : génération de colonnes

Le programme a une ligne par cellule et par bookmaker (jusqu'à 37). À
l'optimum (avant la règle de couverture et la mise minimale), **chaque bookmaker
dépense tout son budget et chaque cellule paie exactement G** : un bookmaker qui
cote le combiné porte toutes ses cellules, donc un reste de budget peut relever
toutes les cellules à la fois, et une cellule au-dessus de G peut céder du budget
aux autres. Le problème revient à acheter G de gain sur chaque cellule, chez
le bookmaker de son choix, sans dépasser aucun budget. Une **colonne** est une
affectation cellule → bookmaker ; jouée avec le poids `w`, elle paie `w` à toutes
les cellules et coûte `w · W_b` FB chez `b`, où `W_b` est la somme des `1/a_bj`
des cellules qu'il porte. Le problème maître n'a donc qu'**une ligne par
bookmaker** (10 au plus). Il y a trop de colonnes pour les lister, mais les prix
duals du petit problème disent laquelle ajouter : celle qui donne chaque cellule
au bookmaker de plus bas `prix / a_bj` (un minimum par cellule). Un simplexe
révisé qui garde l'inverse de sa base ajoute une colonne par tour ; quand aucune
n'améliore, la solution est optimale.

Chaque tour donne aussi une **borne supérieure prouvée** (les prix positifs,
divisés par le coût de la colonne la moins chère, sont une solution duale) :
avec une `target`, le calcul s'arrête dès qu'un combiné ne peut plus battre le
plan déjà trouvé. C'est ce qui rend le tri des combinés rapide (section 6).

Mesures : 0,01 à 0,3 ms par programme (de 3 à 10 bookmakers, 1 à 3 matchs). Pour
3 matchs (27 cellules) c'est 23 à 28 % du temps du simplexe dense ; pour un pari
simple (3 cellules) le simplexe dense va aussi vite. Identique au simplexe dense
sur environ 160 000 programmes aléatoires (cotes jusqu'à 40, portefeuilles très
inégaux, paris interdits), écart maximal 1e-11 ; identique à scipy/HiGHS (écart
inférieur à 1e-7) sur 999 des 1 000 programmes de la première phase et sur 69
programmes figés (`tests/freebets/engine/fixtures/lp-oracle.json`). Le millième
est un portefeuille de 1 FB sur 18 cellules dont certaines demandent moins d'un
demi-centime de FB : le programme est faisable, pas le plan au centime.

## 3. La règle « jamais toutes les issues chez le même bookmaker »

« Aucun bookmaker ne porte toutes les cellules » équivaut exactement à « chaque
bookmaker a **au moins une cellule vide** ». Si la solution du programme viole la
règle chez `b`, on essaie chacune des cellules de `b` comme cellule vide (la plus
petite mise d'abord, la moins chère à abandonner), on garde la meilleure, et une
branche ne peut jamais valoir plus que son parent, d'où l'élagage. Une branche peut
violer la règle chez un autre bookmaker : la profondeur va donc **jusqu'au nombre de
bookmakers** (3 ne suffisait pas : un cas à 4 bookmakers était faux, trouvé par
les tests). Un plafond de programmes (`maxLps`, 400) borne le travail ;
s'il est atteint, `Plan.exact` vaut `false`. Un dernier contrôle
(`holdsEveryCell`) revérifie la règle sur les paris qui seront vraiment placés.

Vérifié contre une énumération exhaustive (un choix de cellule vide par
bookmaker) : 300 portefeuilles sur 300, écart 2e-15, aucun plan en infraction.
La règle compte : elle mord dans 14 % des portefeuilles à 2 matchs, où elle coûte
16 % de cash en moyenne.

## 4. La mise minimale

Un bookmaker refuse les mises trop petites : 0,1 FB par défaut (à régler
bookmaker par bookmaker, voir les limites). Un pari vaut donc 0, ou au moins ce
minimum : une variable « semi-continue ». Le programme linéaire donne parfois une
mise plus petite (0,06 FB sur un outsider par exemple). Interdire ce pari et
recommencer suffit presque toujours, mais perd tout le plan quand cette mise était
le seul moyen de couvrir sa cellule, ce qui arrive avec de petits portefeuilles
(une cellule restée sans bookmaker). Le moteur fait donc un **séparation-évaluation
sur les mises trop petites** d'un sommet du programme : chacune est soit relevée au
minimum, soit interdite, et le programme est résolu à nouveau par le simplexe dense
(qui prend les paris forcés en réécrivant le problème sur ce qu'ils ont au-dessus
du minimum). Une première solution vient du relèvement de toutes les mises trop
petites à la fois. La recherche s'arrête à 30 programmes (`exact: false`), et ne se
lance que si interdire coûte plus de 0,01 % : sinon rien ne change.

Mesures contre le programme en nombres entiers de scipy (HiGHS, écart fermé) sur
1 368 combinés de portefeuilles de 1 à 60 FB par bookmaker, où ce programme trouve
un plan : le moteur en trouve un dans tous les cas (la version précédente en
manquait 42), jamais au-dessus de l'optimum, écart moyen 0,05 %, 1 351 cas à moins
de 0,1 %, 39 recherches coupées au plafond (`exact: false`). Sur les 48 cas figés
(`fixtures/minstake-oracle.json`), les recherches menées à leur terme sont à moins
de 0,003 % de l'optimum. Pire cas : un portefeuille de 5 FB pour 27 cellules, 32 %
sous l'optimum et signalé `exact: false`. Avec des portefeuilles de 12 FB et plus
par bookmaker, l'écart à l'optimum avant arrondi est inférieur à 0,01 %.

## 5. L'arrondi au centime

Les mises sont des centimes de FB, et un centime sur un combiné de 3 matchs bouge
une cellule de plusieurs FB. Arrondir chaque mise au plus proche perdait 0,16 % du
plan en moyenne (0,6 % avec 4 à 15 FB par bookmaker). Le moteur arrondit puis
améliore : des mouvements d'un centime relèvent la cellule qui garantit le moins,
avec un centime resté dans le budget du bookmaker ou pris sur un autre de ses
paris qui peut le céder. Un mouvement garde chaque pari au minimum ou au-dessus et
n'en ajoute aucun, donc la règle de couverture reste celle du programme. Le cash
affiché est le minimum des gains **recalculés sur les mises arrondies** : ce que
l'utilisateur voit est exactement ce que ses paris garantissent.

Perte restante, du programme au plan arrondi : 0,08 % en moyenne (0,36 % au pire)
pour 3 matchs avec 10 à 60 FB par bookmaker, 0,3 % avec 4 à 15 FB, 0,02 % pour 2
matchs. Contre l'arrondi simple sur 5 600 combinés aléatoires : aucun plan moins
bon, 61 % meilleurs.

## 6. Choisir les meilleurs combinés : l'entonnoir

Avec M matchs, résoudre tous les triplets est impossible (M = 1 000 fait 166
millions de triplets). Chaque étage coûte plus et écarte plus que le précédent, et
les étages 2 à 4 ne perdent rien : leurs bornes sont des **majorants prouvés**
(à la tolérance `epsilon` près).

**Étage 1, par match, O(M).** Avec les meilleures cotes **des seuls bookmakers qui
ont des FB** : `S1 = Σ 1/cote` (l'inverse du TRJ) et `S2 = Σ 1/cote²` (le
déséquilibre, grand quand un favori est coté 1,20). On écarte les matchs cotés
par moins de deux de ces bookmakers (la règle de couverture ne pourrait pas être
respectée), puis on garde les matchs les moins « dominés » sur (S1, S2) : un TRJ
trop bas ou des cotes déséquilibrées tombent d'eux-mêmes. **Matchs gardés : tous
pour un pari simple, 200 pour deux matchs, 50 pour trois**, et jamais plus de
100 000 combinés (`MAX_COMBOS`). C'est la seule heuristique de l'entonnoir.

**Étage 2, une borne en O(1) par combinaison.** `taux ≤ 1 / (ΠS1 + ΠS2)`.
Preuve : une cellule coûte au moins `G / a*_j`, donc `taux ≤ 1 / Σ_j 1/(c*_j − 1)`.
Avec `p = 1/c`, `1/(c − 1) = p/(1 − p) = p + p² + p³ + … ≥ p + p²`. Enfin les
cellules forment un produit : `Σ_j p_j = ΠS1` et `Σ_j p_j² = ΠS2`, et la meilleure
cote combinée d'un bookmaker est au plus le produit des meilleures cotes de
chaque match.

**Étage 3, une borne qui tient compte du portefeuille**, sans allocation (4 µs).
Pour tout `μ_j ≥ 0` de somme 1, `G = Σ_j μ_j G ≤ Σ_j μ_j Σ_b a_bj x_bj ≤
Σ_b F_b · max_j μ_j a_bj`. Avec `μ_j ∝ 1/a*_j` :
`G ≤ Σ_b F_b · max_j (a_bj / a*_j) / Σ_j 1/a*_j`.

**Étage 4, la sélection.** Le meilleur combiné p1, puis le meilleur sans match
commun avec p1, puis le meilleur sans match commun avec p1 ni p2 (pour que les trois
soient de vraies alternatives), meilleure borne d'abord. Un seuil fixe ne suffit pas
pour des plans disjoints (le troisième cash peut baisser quand un meilleur plan
arrive), d'où cette sélection séquentielle. Un candidat passe d'abord quelques tours
de génération de colonnes qui prouvent le plus souvent qu'il ne peut pas battre le
plan connu (1 300 tests rapides pour 9 résolutions complètes sur 1 000 matchs), et
on s'arrête quand aucune borne ne dépasse le plan de plus de `epsilon` = 0,5 %. Le
classement est par **cash garanti**, pas par taux : un plan à 85 % qui n'absorbe
que 40 FB perd contre un plan à 82 % qui en absorbe 69. Une échéance (1,5 s, dont
60 % au plus pour les bornes) renvoie le meilleur trouvé avec `partial: true`.

Mesures :

- bornes : aucune violation sur 986 000 tirages aléatoires de la première phase et
  300 000 de plus sur le code du dépôt (portefeuilles très inégaux, cotes jusqu'à
  40). La borne de l'étage 3 vaut en moyenne 98 % du cash réel sur des combinés
  réalistes, 83 % sur ces tirages volontairement extrêmes ;
- entonnoir sans coupe ni tolérance contre l'énumération exhaustive : 200
  comparaisons sur 200 identiques (il avait révélé deux erreurs de la première
  version) ;
- perte due aux coupes de l'étage 1 (première phase, 40 cas à 100-150 matchs, 3
  matchs par combiné) : 50 matchs gardés perdent 0,61 % de cash au pire et 0,16 %
  en moyenne quand il y a une perte ; 30 matchs gardés perdraient 3,5 %, 70 matchs
  0,31 %. Sur un plan à 60 € de cash, le pire écart est d'environ 0,4 €.

## 7. Contre l'exchange

Le FB est misé chez le bookmaker à la cote `back`, l'issue est « layée » sur
l'exchange à la cote `lay` pour une mise `S`, avec la commission `k` (3 %,
`EXCHANGE_COMMISSION` de `src/db/surebets.ts`, passée par l'appelant). Si
l'issue gagne : `F (back − 1) − S (lay − 1)` ; sinon `S (1 − k)`. Les deux sont
égaux pour `S = F (back − 1) / (lay − k)`, d'où :

```
taux = (back − 1)(1 − k) / (lay − k)       à avancer = S (lay − 1)
FB convertibles pour une liquidité L = L (lay − k) / (back − 1)
```

(Le taux vaut `backLayRate − (1 − k)/(lay − k)` de `src/db/surebets.ts` : un FB
ne rend pas la mise. Un test le vérifie.) La liquidité limite chaque conversion ; ce
qui n'est pas converti va sur un autre match, jusqu'à trois conversions, une seule
issue par match. **Le glouton par taux n'est pas exact** avec cette limite : une
issue à fort taux et à peu de liquidité prend une des trois places à une issue qui
convertirait bien plus (battu dans 4,3 % des cas, jusqu'à 84 % de cash en moins).
Le moteur cherche donc exactement le meilleur ensemble de trois conversions au plus
par séparation-évaluation : issues triées par taux, un ensemble est complété par
taux décroissant, chacune jusqu'à sa capacité, et une branche est coupée quand ni
« taux × FB restants » ni la valeur que peuvent garantir les capacités restantes ne
peut battre la meilleure chaîne. Une première chaîne (les issues dont la capacité
vaut le plus) évite d'explorer 26 000 branches quand la liquidité est le facteur
limitant.

Mesures : identique au meilleur ensemble trouvé par énumération des sous-ensembles
(simplexe dense pour remplir) sur 200 marchés aléatoires, et à scipy (programme en
nombres entiers, écart nul) sur 40 marchés figés
(`fixtures/exchange-oracle.json`) et 400 de la première phase ; la chaîne de la
maquette est retrouvée (14,12 / 12,17 / 3,72 FB, 22,06 € de cash, 74,64 € à
avancer ; à la page, qui arrondit chaque étape au centime : 14,12 / 12,17 /
3,71 FB, 22,05 € et 74,62 €, ce que la maquette affiche aussi) ; 5 ms pour 2 000
issues.

## 8. Temps

Temps du `topPlans` complet (échéance de 1,5 s, ε = 0,5 %, 12 tirages par
configuration, de 100 à 1 000 matchs, 3, 6 ou 10 bookmakers, avec ou sans sports
mélangés), en millisecondes :

| Matchs par combiné | médiane des p50 | médiane des p95 | pire cas |
| --- | --- | --- | --- |
| 1 | 2 | 5 | 58 |
| 2 | 30 | 48 | 110 |
| 3 | 84 | 180 | 681 |

Aucune coupure à l'échéance. Les petits portefeuilles (2 à 6 FB par bookmaker) en
combinés de 3 matchs demandent plus (p50 220 à 270 ms, p95 jusqu'à 800 ms) à cause
de la section 4. `topPlans` est synchrone et peut durer plusieurs centaines de
millisecondes : la route `GET /api/freebets/conversions` le fait tourner dans un
`worker_threads` (`src/freebets/pool.ts`), un calcul à la fois, les autres en file
(16 au plus, puis 503), un calcul qui dépasse 10 s est arrêté. Sur 1 000 matchs et 6
bookmakers, la recherche de combinés de 3 matchs répond en 340 ms par la route ; le
thread principal ne perd plus que la lecture des matchs dans la base (150 ms,
gardée 30 s pour tous les comptes) au lieu de 320 ms de blocage avec le calcul
dans le même thread.

## 9. Ce que la vérification a trouvé

Les points du moteur qui paraissent étranges viennent de là :

- une génération de colonnes qui écrêtait les prix duals négatifs et ignorait les
  colonnes de mou concluait à tort qu'elle avait convergé quand beaucoup de paris
  étaient interdits (221 au lieu de 314) ; les prix sont maintenant les vrais prix
  duals, et la tolérance est de 1e-9 (1e-7 laissait 3e-8 d'écart) ;
- la profondeur de la règle de couverture (section 3) ;
- le seuil statique de l'entonnoir pour des plans disjoints (section 6) ;
- le glouton de l'exchange (section 7) ;
- les mises trop petites faisaient perdre des plans entiers aux petits
  portefeuilles (section 4) : trouvé en comparant le moteur au prototype d'origine
  sur 2 000 combinés, puis au programme en nombres entiers ;
- l'arrondi au plus proche (section 5).

## 10. Limites

- **Aucune donnée réelle** n'a servi à régler le moteur (aucune base de cotes dans
  l'environnement de développement) : marchés synthétiques réalistes (marge de 3,5 à
  7,5 %, 30 % de matchs à 2 issues, bookmakers qui cotent 85 % des matchs, portefeuilles
  équilibrés et très inégaux). Les seuils (matchs gardés, ε) sont à recaler sur un
  instantané de la vraie base avant de s'y fier.
- **Mise minimale unique** de 0,1 FB pour tous les bookmakers ; les vraies mises
  minimales (et maximales sur les combinés) sont à relever bookmaker par bookmaker.
  La page le dit sous les résultats (« Le calcul ne connaît ni les mises minimales
  ni les mises maximales de chaque bookmaker »), avec la mise en garde sur les cotes
  indicatives (`OddsNotice`, `web/src/freebets/`).
- **Une issue peut être répartie sur deux bookmakers.** L'interdire (une issue, un
  bookmaker) coûterait 1,2 % de cash en moyenne (jusqu'à 5,3 %) ; 4,3 paris de plus
  que d'issues en moyenne (7 au plus).
- **Petits portefeuilles et mises minimales élevées** (par exemple 0,5 FB sur 27
  cellules avec moins de 30 FB) : le plan est valide mais peut être loin de
  l'optimum, ou manquer ; `Plan.exact` le dit quand la recherche a été coupée.
- **Marchés principaux seulement** (1N2, vainqueur), des 7 prochains jours, aux cotes
  que le tableau de bord montre encore (même règle de fraîcheur) ; une course ou un
  tournoi de golf (un vainqueur parmi N) n'est pas converti, ni un bookmaker qui ne
  cote pas toutes les issues (un nul suspendu). Les cotes bougent entre le calcul
  et le placement : l'heure de la plus ancienne cote utilisée accompagne chaque plan.
- La perte d'arrondi au centime (section 5) et les coupes de l'entonnoir
  (section 6) sont des pertes connues, de l'ordre de 0,1 à 0,5 % du cash.

## 11. Rejouer les vérifications

`npx vitest run tests/freebets/engine` (quelques secondes) rejoue les contrôles de
la CI : le programme contre scipy (`fixtures/lp-oracle.json`), la règle de couverture
contre l'énumération, la mise minimale contre le programme en nombres entiers
(`fixtures/minstake-oracle.json`), l'entonnoir contre la recherche exhaustive, les
bornes, l'exchange contre l'énumération et le programme en nombres entiers
(`fixtures/exchange-oracle.json`), et les budgets d'opérations (nombre de
programmes résolus, pas de temps mesuré). Les valeurs des fixtures ont été
calculées hors du dépôt avec `scipy.optimize.linprog` et `scipy.optimize.milp`
(HiGHS) ; pour les recalculer : `pip install scipy numpy`, puis résoudre le
programme décrit en tête du fichier de test qui les lit.
