# OddsBlitzer

Comparateur de cotes avant-match entre bookmakers francais (Winamax, Betclic,
Vbet, CircusBet, DAZN Bet, NetBet, Genybet, Unibet, Betsson et PMU, plus Betify, qui n'est pas agree ANJ) : un worker recupere les cotes toutes les quelques
minutes, rapproche un meme match d'un bookmaker a l'autre, et une API +
dashboard web affichent un tableau comparatif.

## Usage principal : le mobile

Le site s'utilise d'abord sur téléphone. Tout nouveau développement front-end
se conçoit donc **mobile first** :

1. on pense d'abord l'écran d'un téléphone (320 à 430 px de large) et son
   accessibilité : cibles tactiles de 44 px au moins, contenu utile visible
   sans défiler, rien qui ne passe que par le survol de la souris (pas
   d'info réservée à un `title`), aucun défilement horizontal de la page ;
2. on ajoute ensuite la version desktop, en élargissant : les styles de base
   d'un composant sont ceux du téléphone, et les écrans plus larges les
   complètent par des `@media (min-width: ...)`, jamais l'inverse.

Le détail des règles est dans [CONTRIBUTING.md](CONTRIBUTING.md), section
« Conventions du dashboard ».

Les dix bookmakers agrees donnent le marche principal de chaque match (1N2 ou
vainqueur) et, pour les matchs de foot, de tennis, de basket, de hockey sur glace, de
football americain, de rugby a XV et de handball des 48 h a
venir, chaque autre marche qu'une famille du catalogue (`src/markets/catalog.ts`)
couvre (buteurs, totaux...) ; Winamax et Betclic gardent en plus, sous leur
propre nom, ceux qu'aucune famille ne couvre. Au golf, ils donnent le vainqueur de chaque tournoi, comme
Winamax et Betclic (un meme tournoi est date et nomme differemment d'un
bookmaker a l'autre, `GOLF_TOURNAMENTS` dans `src/matcher/match.ts`). Unibet
donne aussi celui des epreuves des autres sports sans face-a-face (cyclisme,
Formule 1 et ses seances, moto, ski, biathlon, Nascar et Formule 2 sous
« automobile »), pas le saut a ski (absent de son menu le 7/10/2026). Son rugby
est celui a XV. Unibet ecrit une equipe en 14 caracteres au plus et coupe les
noms plus longs (« Hap.Tel Aviv », « Gimnasia Y Esg », « OKC Thunder ») : le
rapprochement les reconnait (`compressedNameScore` et `isCityCodeOfName` dans
`src/matcher/match.ts`), un nom dont la fin est perdue ne suffisant pas seul.
Les autres operateurs agrees ANJ testes le 5/10/2026
refusent les requetes automatisees (page anti-robots DataDome pour les pages
de Parions Sport, qui renvoie desormais vers Unibet ; Cloudflare pour Olybet
et bet365, qui repondaient encore par un defi Cloudflare (403) le 12/10/2026
depuis un poste en France ; CircusBet et DAZN Bet repondent depuis, voir
plus bas) ou ne repondent pas (Feelingbet) : ils ne sont pas lus, sans
contourner ces protections. Genybet, sur la meme plateforme que NetBet et aux
memes cotes, est lu comme lui (`ws.genybet.fr`) mais doucement, deux requetes a
la fois : son pare-feu avait rejete le serveur apres quelques cycles le
5/10/2026, et si cela se reproduit son scraper echoue seul. CircusBet et DAZN
Bet sont sur le serveur Swarm de Vbet (`wss://swarm-2.vbet.fr/`, l'adresse
`springParams.swarmUrl` de leurs pages le 12/10/2026), chacun avec l'identifiant
de son site (`springConfig.partnerId`), et sont lus comme Vbet, session
anonyme comprise : les cotes de ces trois sites viennent du meme fournisseur et
sont voisines. Les lecteurs sont valides sur des captures de Vbet, pas sur des
reponses de ces deux sites. Bwin et PokerStars Sports repondaient le
12/10/2026, mais leurs pages ne disent pas ou leur front lit les cotes (rien
dans leurs scripts, 307 Ko et 10 Mo) : ils ne sont pas lus, faute de l'API
visible dans l'onglet Reseau d'un navigateur. Unibet est lu par ses
routes JSON `/lvs-api/` (jeton anonyme, pages de 50), qui repondaient sans
cookie ni navigateur le 6/10/2026 depuis un poste de developpement ; si
DataDome les bloque (403) depuis le serveur, le scraper echoue seul et on ne
cherche pas a le contourner. Betsson est lu par le service de contenu public
de son site (`velsv-bson-ssb-pr.betsson.fr/services/content/get`, un POST JSON
sans jeton ni cookie, une liste de 200 matchs par page et par sport, ses cotes
en fractions converties en decimales), pour ses matchs et pour le vainqueur
des epreuves des sports sans face-a-face qu'il offre : le 8/10/2026 la
Formule 1 (chaque seance d'un Grand Prix, le titre des pilotes) et le MotoGP ;
le golf et le cyclisme n'y avaient aucun evenement, le ski et le biathlon pas
encore de code dans son menu. PMU est lu par l'API publique de Kambi que son site de paris
sportifs interroge (`eu.offering-api.kambicdn.com/offering/v2018/pmusportsfr`, des
GET JSON sans jeton ni cookie, qui repondaient le 11/10/2026 depuis un poste de
developpement ; depuis le serveur, a verifier au premier deploiement) :
`group.json` donne les sports, `listView/<sport>.json` les matchs des prochains
jours et les epreuves, avec leur marche principal (les cotes en milliemes : 1470
est 1,47). Il donne le resultat des matchs qui n'ont pas commence et le
vainqueur des epreuves du golf, du cyclisme, de la Formule 1 et des sports
d'hiver (ski alpin, biathlon) ; le resultat du rugby a XIII n'est pas dans sa
liste, et son moto, son ski de fond et son
saut a ski n'avaient aucun evenement. Les marches d'un match viennent de
`betoffer/event/<id>.json` (10 matchs par requete) : un marche est l'identifiant
de son critere (`criterion.id`, le meme d'un match a l'autre, un par equipe
pour les marches d'une equipe), ses issues ont un type (`OT_OVER`, `OT_YES`...),
une ligne en milliemes et, pour un joueur, son nom ; PMU donne les totaux, les
handicaps, la double chance, les mi-temps, le score exact, les buteurs, le tennis
(jeux, sets, set 1) et au basket les points, l'ecart, le premier quart-temps et les
combines points / rebonds / passes (`src/scraper/pmuMarkets.ts`), sur les lignes
en .5 seulement. D'un tournoi de golf, `betoffer/event/<id>.json` donne le Top 5,
10 et 20 (l'offre « Finishing Position », qu'on distingue par sa `description` :
« Vainqueur » est le marche principal, « Top 5 »...), le leader apres chaque tour et
le meilleur joueur de chaque nationalite ; les « Top N - Nuls inclus » (une regle
d'egalite que les autres bookmakers n'ont pas), l'ordre exact et les trous en un ne
sont pas lus. A cote du tournoi, PMU liste le meme champ sans son favori (« ... Winner
without Rory McIlroy 2026 ») : ce n'est pas un second tournoi et il est ecarte. Si CloudFront ou un anti-bot les bloque (403)
depuis le serveur, le scraper echoue seul et on ne cherche pas a le contourner.
Bwin et PokerStars Sports repondent depuis la France et restent a integrer.

Betify, qui n'est pas agree par l'ANJ, est lu par le flux de Betby (`sptpub.com`),
la plateforme que son site de paris interroge : des GET JSON sans jeton ni cookie,
que Cloudflare, qui garde les pages de Betify, ne protege pas (le 14/10/2026,
depuis un poste de developpement ; depuis le serveur, a verifier au premier
deploiement). `POST flex.betify10.sh/fr/sport/launch` donne la marque et le script
du « renderer », qui nomme l'hote de l'API (`api-h-<hash>.sptpub.com`, relu a chaque
cycle, le dernier connu servant de repli) ; `/api/v4/prematch/brand/<marque>/fr/0`
liste les fichiers du flux, chacun donnant les sports, les tournois et les matchs
avec leurs marches (des numeros, dont `/api/v3/descriptions/brand/<marque>/markets/fr`
donne les noms et les issues). Le listing de Betify donne le marche principal des
matchs de tous ses sports de match (football, tennis, basket, hockey sur glace,
baseball, handball, volley-ball, football americain et australien, boxe, MMA, tennis
de table, badminton, rugby a XV et a XIII, snooker, cricket, echecs, padel,
flechettes, floorball, basket a trois, squash, water-polo, futsal, natation) : le
resultat (1N2) ou le vainqueur, celui du hockey en temps reglementaire quand il
existe. Il donne aussi le vainqueur des courses et des championnats du golf, de la
Formule 1, du cyclisme, du ski alpin et de fond, du saut a ski, du biathlon, du moto
et de l'automobile (Nascar, Formule 2, voitures de tourisme) : un evenement de type
`tournament` ou `stage` dont les deux « competiteurs » sont le titre et un
marqueur (« Winner »), et dont les coureurs sont les issues du marche « Vainqueur »
(2000000) ou « Pronostic libre du championnat » (534) ; leurs noms ne sont que dans
les descriptions de l'evenement (`/api/v3/descriptions/brand/<marque>/event/<id>/fr`,
une requete chacun). Les e-sports, les matchs virtuels et les vainqueurs de
tournoi des autres sports ne sont pas lus. Ses cotes d'un match bloque (prix a 0)
font ecarter le match, plutot que d'en lire une partie. Les autres marches des matchs de foot, de tennis
et de basket des 48 h a venir viennent de la page du match :
`/api/v4/prematch/brand/<marque>/event/fr/<id>` donne tous ses marches (183 pour un
match de Ligue des champions) et `/api/v3/descriptions/brand/<marque>/event/<id>/fr`
les noms de joueurs que les descriptions de tous les marches ne donnent pas. Un
marche est un numero, le meme d'un match a l'autre (la table de
`src/scraper/betbyMarkets.ts` va de ce numero a une famille du catalogue) ; ses
prix sont par variante (`total=2.5`, `hcp=-1.5`, ou un joueur) puis par issue,
nommees par leur description (`{$competitor1}`, `plus de {total}`, `oui`). Seules
les lignes en .5 sont lues, et ni les corners, ni les cartons, ni les tirs, ni la
parite : aucune famille ne les couvre. D'un tournoi de golf, la page donne les Top N
(« Terminer dans le Top 10 ») et le leader apres un tour. Le nom de domaine de Betify
change (`betify10.sh` le 14/10/2026) : c'est `BETIFY` dans `src/scraper/betby.ts`.

Le site a deux pages : une page d'accueil (`/`) qui presente le produit
(ce qu'il compare, ce qu'est un value bet, la conversion de freebets (une
section et le lien vers `/freebets`), quelques vrais value bets du
moment et les chiffres de l'API, avec un exemple et des chiffres vides quand
l'API ne repond pas) et mene au dashboard, a `/odds`. Les anciens liens du
dashboard, `/?sport=...` ou `/?match=...` (les alertes Discord, les liens
partages), sont rediriges vers `/odds` avec les memes parametres ; un `/` avec
une autre query (`?utm_source=...`) reste sur l'accueil. Le serveur renvoie le
meme `index.html` pour `/` et `/odds` (`SPA_PATHS`, `src/api/server.ts`),
si bien qu'un rechargement de `/odds` ne tombe pas sur une 404.

Le dashboard montre, par sport (football par defaut) :

- pour chaque match : l'heure et le jour de debut, les equipes et leur
  competition, puis son TRJ (taux de retour aux joueurs) calcule avec la
  meilleure cote de chaque issue. Le TRJ s'affiche en badge, de faible a
  eleve, avec la mention « Surebet » a partir de 100 % ;
- les cotes 1 / N / 2 de chaque bookmaker (1 / 2 pour les sports sans match
  nul), en pastilles avec l'icone du bookmaker. La meilleure cote de chaque
  issue est en vert et cochee, egalites comprises ;
- pour les matchs des prochaines 48 h de foot, de tennis (ATP, WTA, Grand
  Chelem), de basket, de baseball, de football americain, de hockey, de
  rugby a XV et de MMA, une reference : sous les cotes de chaque issue du
  1N2 (ou du vainqueur), sa « cote juste », celle de l'exchange Betfair (lu
  via Piwi247) sans sa marge. Une cote Winamax ou Betclic qui la depasse d'au
  moins 1 % est un value bet : encadree, avec son ecart (« +2,1 % »). La
  reference ne compte ni dans la meilleure cote ni dans le TRJ ;
- pour les courses de Formule 1 des 7 prochains jours (`src/reference/f1.ts`,
  `f1Run.ts`), la meme reference que le golf sur le vainqueur : la cote juste
  sous le nom de chaque pilote dont les prix de l'exchange sont assez serres.
  L'exchange est cherche par « Formula 1 » et « Grand Prix » ; le journal du
  worker (`[reference:f1]`) compte les courses trouvees et celles chiffrees.
  Un sprint (« Sprint Race » a l'exchange) et la course du dimanche ont la
  meme grille, comme les qualifications (« Overall Qualifying Winner » et
  « Sprint Qualifying Winner », lues dans les marches de l'evenement du GP) :
  chacun n'est rapproche que d'un marche de son genre, a moins de 36 h (4 jours
  pour une qualification, datee a la course a l'exchange) ;
- pour les tournois de golf des 7 prochains jours, la meme reference sur le
  vainqueur : sous le nom de chaque joueur dont les prix de l'exchange sont
  assez serres (20 % d'ecart entre l'achat et la vente, 20 € de chaque cote),
  sa cote juste ; un prix de bookmaker au moins 5 % au-dessus est un value bet
  (une gem Discord a partir de 15 %), et l'exchange entre dans les surebets
  pour les joueurs ou il a 20 € a l'achat. Les majeurs des mois a venir n'ont
  pas de reference : l'exchange y cote trop peu de joueurs ;
- sur la page d'un match, la meme cote juste pour les buteurs, premiers
  buteurs et « marque au moins 2 / 3 buts », quand l'exchange les cote avec
  assez d'argent, et des value bets a partir de 5 % ; sinon un plafond
  (« Juste ≤ 2,60 », le lay de l'exchange ; voir « La reference » plus bas) ;
- une categorie « Value bets », en tete des sports, qui les regroupe tous :
  une ligne par pari (une cote d'un bookmaker coche, un match peut en avoir
  plusieurs) avec le match, l'issue, la cote, la cote juste (ou son plafond)
  et l'ecart, du
  plus gros ecart au plus petit ou par date de debut, sur une seule page ;
  au-dessus, les surebets (TRJ au-dessus de 100 %, entre les bookmakers ou
  avec l'exchange ; voir « Les surebets » plus bas) ;
- pour les matchs de foot des prochaines 48 h, un lien « +N marches » qui
  ouvre la page du match (sa propre adresse, `?match=<id>`) : tous ses
  marches, ranges en rubriques repliables (Resultat, Buts, 1re mi-temps,
  2e mi-temps, Score exact, Buteurs et passeurs, Combines). Chaque marche
  est une carte avec la cote de chaque bookmaker par issue, la meilleure en
  vert, et son TRJ quand ses issues couvrent tous les cas (un bookmaker peut
  n'en coter qu'une partie : Betclic n'a que le « + de » de ses aces, Winamax
  les deux ; sauf avec un « autre score », qui n'est pas le meme d'un
  bookmaker a l'autre). Les +/- buts
  forment un tableau par ligne (1,5, 2,5...), les buteurs se cherchent par
  nom. Sont compares tous les marches que les deux bookmakers proposent :
  resultat, handicaps, buts (lignes, tranches, minute du premier but,
  penalty, tete, coup franc), mi-temps, scores exacts, buteurs (et par
  mi-temps, doubles et triples chances, duos), joueurs decisifs et
  combines. La 2e mi-temps n'est proposee que par Betclic, sauf ses
  buteurs. Les autres marches qu'un seul bookmaker propose sont a part,
  replies (« Seulement chez Winamax »...). Le nom de la competition, sous le
  sport, est un lien : il mene a la liste des matchs filtree sur cette
  competition (ses matchs et son vainqueur ; `competitionFilter` dans la
  reponse de `GET /api/events/:id`, le meme nom que le menu « Competition ») ;
- la meme page pour les matchs de tennis ATP, WTA et du Grand Chelem des
  prochaines 48 h (pas les Challengers, l'ITF ni les doubles), avec la cote
  juste de l'exchange et les value bets sur le vainqueur, le handicap jeux,
  le nombre de jeux et les sets (voir « La reference ») : rubriques
  Match (handicaps jeux et sets, vainqueur du 1er set et du match, vainqueur
  et nombre de jeux), Sets (score en sets, nombre de sets, gagne au moins un
  set, tie-break, set gagne 6-0), Jeux (nombre de jeux, jeux de chaque
  joueur), Par set (vainqueur des 1er et 2e sets, handicap, jeux et score du
  1er set) et Aces et breaks (aces du match et de chaque joueur, plus
  d'aces, premier break, breaks). Betclic ne propose les aces qu'au-dessus
  d'une ligne (« + de 9,5 ») : pas de TRJ pour eux. Winamax seul propose le
  score apres 2, 4 ou 6 jeux et le premier jeu de service, Betclic seul les
  scores multi-choix du 1er set et les combines « perd le 1er set et gagne »
  ;
- la meme page pour les matchs de basket des prochaines 48 h, chez les six
  bookmakers : rubriques Resultat (le vainqueur du match, prolongations
  comprises, le resultat en temps reglementaire avec le nul, qui peut valoir 12
  ou plus, remboursé si nul, handicap, prolongation oui/non, mi-temps / fin de
  match, une equipe gagne les deux mi-temps ou tous les quarts-temps), Points
  (nombre de points du match et de chaque equipe, vainqueur et nombre de
  points, quart-temps et mi-temps les plus prolifiques), 1re et 2e mi-temps et
  Quart-temps (resultat, remboursé si nul, handicap, points du match et de
  chaque equipe), puis les joueurs, une rubrique par statistique (points,
  rebonds, passes decisives, paniers a 3 points, points + rebonds + passes et
  ses sommes deux a deux) et une carte par joueur avec ses lignes en tableau
  (« Ligne / Plus / Moins ») ; le meilleur marqueur et le double-double se
  cotent par joueur. Un palier (« 20 points ou plus », chez Winamax, Betclic,
  Unibet, Vbet et Betsson) est le « plus de 19,5 » : il se compare au plus/moins
  de Winamax, Unibet, Betsson et NetBet, et a leurs paliers, sans « moins ». Les
  noms de joueurs sont ranges sous l'orthographe du bookmaker de reference
  (Betclic, puis Winamax) : « Lo, Maodo », « S.Umude » et « Maodo Lo » sont
  un seul joueur. Le match, son handicap et ses totaux comptent les
  prolongations ; une mi-temps, un quart-temps et le resultat non. Les lignes
  entieres (un total de 174) sont ecartees : un push rembourse, les autres
  bookmakers n'en ont pas. Au handicap, Betclic donne l'ecart de points
  (« gagne de 13 ou + » : -12,5) ; Unibet donne en Euroligue un handicap en
  temps reglementaire, qu'on ne lit pas, et en WNBA un handicap du match. La
  cote juste de l'exchange vaut pour le vainqueur, le handicap et le total
  (ses seuls marches de basket), aux seules lignes qu'un bookmaker liste : il
  en a 72 de handicap et 141 de total. La liste d'Unibet ne donne que le
  resultat en temps reglementaire (ou, pour les ligues sans nul, un « Face a
  Face » en temps reglementaire, qu'il ne faut pas lire comme le vainqueur) :
  son vainqueur vient des marches du match (rafraichis toutes les
  MARKETS_INTERVAL_MINUTES minutes) et s'ajoute a sa ligne de la liste tant
  que le bookmaker liste le match. Le tableau compare le marche que le plus de
  bookmakers listent, pas le premier du premier bookmaker ;
- la meme page pour les matchs de hockey sur glace, de football americain, de rugby
  a XV et de handball des prochaines 48 h, chez les bookmakers qui ont un lecteur pour
  eux (`MARKETS_BY_BOOKMAKER` dans `src/scraper/marketsRun.ts` : les autres ne sont pas
  interroges pour ces sports, Betclic lirait sinon leurs marches comme ceux du foot) :
  PMU, Vbet, CircusBet et DAZN Bet les quatre, NetBet et Genybet les quatre (le rugby
  n'y a que le resultat de la 1re mi-temps), Unibet le hockey, le football americain
  et le handball (une page de rugby n'y a que le resultat et un handicap a trois
  issues). Winamax, Betclic, Betsson et Betify n'ont pas de lecteur : leurs API ne
  repondent pas depuis l'environnement de developpement, et un lecteur ne s'ecrit que
  sur de vraies reponses. Au hockey, le resultat de la liste est celui du temps
  reglementaire, comme les familles sans prefixe (resultat, remboursé si nul, double
  chance, handicap, totaux, buts de chaque equipe, les deux equipes marquent) ; ce
  qui compte la prolongation et les tirs au but est a part (`ot_handicap`,
  `ot_total_goals`, `ot_team_goals`), et chaque periode a ses familles (`p1_` a
  `p3_`) : un bookmaker qui ne dit pas de quel temps est son pari n'est pas lu. Au
  football americain, le match, son handicap et ses totaux comptent la prolongation,
  comme au basket ; la 1re mi-temps et chaque quart-temps non. La 2e mi-temps n'est
  lue que la ou le pari dit qu'il compte la prolongation (PMU, deux paris chez NetBet) ;
  chez Vbet et Unibet, qui ne le disent pas, elle ne l'est pas, ni les paris en temps
  reglementaire. Chez Vbet, « Team 1 » et
  « Team 2 » du titre d'un marche suivent l'ordre des equipes du match : on s'y fie
  pour les totaux d'une equipe, car le « Home » et le « Away » du type de marche sont
  l'equipe qui recoit et celle qui se deplace, que les matchs americains listent dans
  l'ordre inverse. Pas lus : le volley-ball, le baseball et le MMA, dont les
  marches (manches et courses, points et sets, distance, rounds et methode)
  demandent des familles nouvelles, et les marches de buteurs et de joueurs de ces
  sports ;
- pour les sports sans face-a-face (cyclisme, Formule 1, golf, ski, biathlon,
  moto, automobile) : une carte par course ou tournoi, avec ses concurrents
  classes et la cote de chaque bookmaker. Les 10 favoris s'affichent, les
  autres se deplient ; a partir de 30 concurrents, un champ permet d'en
  chercher un ;
- dans la liste des matchs (`/api/events?kind=all` ; `kind=competition` ne donne
  qu'eux), le vainqueur des competitions des sports de match (Ligue 1, Coupe de
  France, Ligue des champions, Roland-Garros, NBA...) : une carte par
  competition, sous les matchs de son sport, comme une course, avec la
  meilleure cote de chaque candidat et le TRJ. Ils sont lus
  chez Unibet (`eType: "R"`, une centaine de competitions le 14/10/2026), Vbet, CircusBet et
  DAZN Bet (un « jeu » sans deuxieme equipe, marche `Winner`), NetBet et Genybet
  (le composant `final_winner` de la page de chaque sport). Winamax (un « match »
  sans noms de camp, dont le pari est « Vainqueur »), Betclic (un match sans
  concurrent), Betsson (un evenement `OUTRIGHT`) et PMU (ce que la liste du sport
  donne : le 14/10/2026, presque rien) sont lus de la meme facon, sur la seule
  capture reelle qu'on en a (le championnat d'Europe de volley-ball de Winamax, le
  NPC de rugby de Betsson) : a verifier en staging.
  Betify n'en donne pas : son flux liste le tournoi sans cote (pas de lecteur
  tant qu'une capture n'a pas montre ou elles sont). Un bookmaker date une
  competition par sa prochaine journee (Vbet), son debut ou la fin de la saison
  (Unibet, NetBet...) : le rapprochement ne regarde pas les dates mais le titre
  (ses mots, son numero, sa saison : « Ligue 1 26/27 » et « Ligue 1
  2026/2027 » sont la meme) et les candidats, les hommes et les femmes etant
  separes. La competition est datee de la plus tardive des dates des
  bookmakers. Seul le vainqueur est lu : le Top 4, le meilleur buteur, la
  relegation, le vainqueur d'une division ou d'une conference, « Vainqueur sans
  le PSG »... sont d'autres paris (`isCompetitionWinnerTitle`, dans
  `src/scraper/canonical.ts`). Ils sont dans la liste des matchs (et dans
  les sports qu'elle propose), mais ni dans les marches ou la reference, ni
  dans les value bets ni les surebets (l'API des matchs sans `kind` ne les
  donne pas non plus) : le vainqueur d'une competition peut ne pas se jouer
  pareil d'un bookmaker a l'autre (egalites, retraits, champs differents) ;
- pour les tournois de golf des 7 prochains jours, un lien « +N marches » qui
  ouvre la page du tournoi : le vainqueur, puis les marches de plusieurs
  gagnants (« Dans le Top 5 », 10, 20...) et le leader apres un tour, chez
  Winamax, Betclic, Unibet, Vbet (CircusBet et DAZN Bet), PMU et Betify (NetBet et
  Genybet n'ont que le vainqueur, verifie le 14/10/2026 ; Betsson n'a pas de
  marche de golf lu, faute de capture), et le meilleur de chaque nationalite
  (« Meilleur Americain »..., chez Winamax, Betclic, Unibet, Betify et PMU ; Vbet les
  lirait, mais n'en avait liste aucun le 6/10/2026). Un Top N a N
  gagnants : son TRJ est N divise par la somme des inverses des meilleures
  cotes, et un surebet y est toujours « a verifier » (chaque bookmaker
  partage a sa facon l'egalite a la derniere place). L'exchange cote aussi
  les Top 5, 10 et 20 : sa cote juste sous chaque joueur assez serre, les
  value bets des 5 % et les surebets, comme pour les buteurs d'un match ;
- une alerte Discord a chaque nouvelle « gem », un gros value bet (voir
  « Alertes Discord » plus bas) ;
- deux listes, les value bets (et leurs surebets) et les matchs, sport par
  sport : sur telephone, une barre en bas de l'ecran passe de l'une a l'autre
  et ouvre les filtres ; sur desktop, un selecteur dans l'en-tete ;
- les puces de sport (la ligne defile sur le cote, avec des fleches a la
  souris, les sports favoris en tete) et la recherche avec suggestions
  (touche `/`), toujours visibles. Les autres filtres : le tri, par TRJ (par
  defaut), par date de debut (avec un titre pour chaque jour) ou, pour les
  sports qui ont une reference, par meilleure value, les bookmakers compares
  et, pour le foot, les marches (tous les matchs, ou seulement ceux qui ont
  des marches joueurs : buteurs, passeurs, joueurs decisifs, que les
  bookmakers ne proposent pas pour tous les matchs), et la competition (la
  Ligue 1, l'ATP Shanghai... : ses matchs et le vainqueur de la competition ;
  `/api/competitions?sport=` en donne la liste, sans la saison : « Ligue 1
  2026/2027 » est la « Ligue 1 », `competitionName` dans `src/db/competition.ts`).
  Le menu, replie par defaut, met en tete les competitions phares du foot (Ligue 1,
  Serie A, LaLiga, Bundesliga, Premier League, Ligue des champions, reconnues
  par le debut de leur nom : `web/src/favoriteCompetitions.ts`, sans leurs
  homonymes feminins, qualifications ou divisions 2), puis trois autres dans
  l'ordre alphabetique ; un bouton affiche toutes les competitions, et un champ
  de recherche les filtre au fil de la frappe ;
  Sur telephone, ils sont
  dans un panneau « Filtres » qui monte du bas de l'ecran ; sur desktop, ce
  sont des menus deroulants dans la barre de filtres. Un bouton remet tous
  les filtres par defaut ;
- des filtres et une page gardes dans l'URL (rechargement ou lien partage) ;
- sur telephone, chaque match est une carte qui montre la meilleure cote de
  chaque issue en grand (« Comparer » deplie celles de chaque bookmaker) et la
  liste s'allonge avec « Voir 20 matchs de plus » ; sur desktop, un tableau
  avec toutes les cotes et une pagination numerotee (20 resultats par page) ;
- l'heure de la derniere mise a jour avec un bouton pour actualiser, et des
  ecrans clairs pendant le chargement, en cas d'erreur ou sans resultat.

Le site suit le theme clair ou sombre du systeme. Il est verifie avec axe
(WCAG 2.2 AA), au format telephone comme desktop.

Seuls les matchs pas encore commences sont listes : un match disparait des
son coup d'envoi.

Production : <https://odds-blitzer.de>, deployee automatiquement a chaque push
sur `main`. Site de test : <https://staging.odds-blitzer.de>, deploye
automatiquement a chaque push sur `development` : rien n'arrive sur `main`
sans y etre passe. **Pour modifier le projet et mettre la modification en
prod, voir [CONTRIBUTING.md](CONTRIBUTING.md).**

## Prerequis

Node.js >= 23.4 (utilise le module natif `node:sqlite`, sans flag experimental
a partir de cette version).

## Installation

```bash
npm install
cp .env.example .env
```

Aucun navigateur n'est necessaire : le worker interroge directement les API
internes des bookmakers (flux Socket.IO pour Winamax, gRPC-Web pour Betclic,
websocket « Swarm » de BetConstruct pour Vbet, CircusBet et DAZN Bet, requetes JSON a l'API SportNCo
pour NetBet, deux a la fois).

## Lancer en developpement

Deux process separes, partagent le meme fichier SQLite (`DB_PATH`) :

```bash
npm run worker   # scrape Winamax, Betclic, Vbet, CircusBet, DAZN Bet, NetBet, Genybet, Unibet, Betsson, PMU et Betify toutes les
                 # POLL_INTERVAL_MINUTES minutes (leur marche principal),
                 # et tous les marches des matchs de foot, de tennis
                 # (ATP, WTA, Grand Chelem) et de basket des 48 h a venir
                 # toutes les MARKETS_INTERVAL_MINUTES minutes, et la cote
                 # juste de leur 1N2 (la reference) toutes les
                 # POLL_INTERVAL_MINUTES minutes
npm run api      # sert l'API sur PORT, + le dashboard build si web/dist existe
```

Une cote que le worker n'a pas rafraichie depuis 3 cycles (15 min avec
`POLL_INTERVAL_MINUTES=5`) est consideree comme retiree par le bookmaker : elle
n'est plus affichee, et un match sans aucune cote a jour disparait du tableau.
Si le worker est arrete plus longtemps, le tableau se vide donc au lieu
d'afficher des cotes perimees. Les autres marches d'un match suivent la meme
regle a leur rythme : 3 cycles de marches, soit 45 min avec
`MARKETS_INTERVAL_MINUTES=15`. Toutes les cotes d'un match commence depuis
plus d'un jour sont supprimees.

Frontend (dossier `web/`, package.json separe) — en developpement on utilise le
serveur de dev Vite plutot que les fichiers statiques :

```bash
cd web && npm install && npm run dev   # http://localhost:5173, /api renvoye vers le port 3000
```

Tests : `npm test` a la racine (backend) et dans `web/` (dashboard). Le detail
des verifications lancees par la CI est dans [CONTRIBUTING.md](CONTRIBUTING.md).

Voir `docs/superpowers/specs/2026-09-20-coteradar-design.md` pour le design
complet, et `docs/superpowers/plans/2026-09-20-coteradar-plan.md` pour le
detail de l'implementation.

## La reference (cote juste)

Le worker cherche chaque match de foot des 7 jours a venir sur l'exchange de
Piwi247 (plateforme Orbit, liquidite Betfair), par le nom de ses equipes (en
anglais la-bas : les noms de pays sont traduits), une seule fois : le lien
est garde, avec l'ordre de nos equipes qu'il suit. Un match peut changer
d'ordre sans changer d'identifiant (un bookmaker l'affiche dans l'autre
sens) : le lien est alors retourne, pour que chaque prix de l'exchange reste
sur son equipe. Sans cela, le 6/10/2026, le favori Norvege (U21) de
l'exchange etait compte pour Israel (U21), qui ressortait en value bet et en
surebet chez tous les bookmakers. A chaque cycle, il lit les prix de ces
matchs sur le socket du site, sans compte. La cote juste d'une issue est le
prix milieu entre le meilleur back et le meilleur lay, les trois issues
ramenees a 100 % (la marge de l'exchange, environ 2 %, retiree). Pas de cote
juste quand un lay depasse son back de plus de 10 % : trop peu de parieurs
sur le marche pour s'y fier. Elle vieillit comme les cotes (3 cycles).

Les matchs des 48 h a venir sont lus a chaque cycle, avec les marches des
joueurs ; ceux de 48 h a 7 jours, dont les prix bougent peu, un cycle sur
deux (toutes les 9 minutes au plus, sous les 15 minutes ou un prix reste
affiche), sans les joueurs, et recherches de nouveau toutes les 2 heures
quand l'exchange ne les a pas encore (30 minutes pour les plus proches) :
le proprietaire veut la cote de Piwi sur chaque match du site (25/10/2026),
et les bookmakers listent les matchs jusqu'a une semaine a l'avance
(`src/reference/horizon.ts`).

Les marches joueurs de l'exchange (buteur, premier buteur, 2 buts ou plus,
triple) arrivent un jour ou deux avant le match, avec de l'argent surtout
sur les gros matchs. Le worker relit la liste des marches de chaque match
toutes les 30 min, lit leurs prix avec le 1N2 et rapproche les noms des
joueurs de ceux des bookmakers (« Ousmane Dembele » = « Ousmane Dembélé »).
Ces marches sont plus sujets a la variance, et les cotes des bookmakers y
varient plus : un joueur est donc juge a part (`src/db/playerValue.ts`),
de la premiere de ces trois facons qui s'applique :

- **cote juste** : back et lay ecartes de 20 % au plus, avec au moins 20 € au
  meilleur back et au meilleur lay. C'est le prix milieu, sans normalisation
  (un marche buteur a plusieurs gagnants). Value bet a partir de 5 % ;
- **plafond** : l'exchange cote le joueur de trop loin, mais son lay (la cote
  a laquelle on y parie contre lui, toujours avec de l'argent) borne ce qu'il
  vaut. Une cote 5 % au-dessus de ce lay est un value bet, et la page du
  match montre « Juste ≤ 2,60 » ;
- **cote suspecte** : l'exchange ne cote pas le joueur. Une cote 30 % au-dessus
  de celle de l'autre bookmaker est comptee, mais pas affichee : le 2 octobre,
  il y en avait 4 017 sur 58 matchs, et 662 rien que sur les 9 gros matchs
  que l'exchange cotait. Les deux bookmakers s'ecartent couramment de 30 % sur
  ces marches (cotes uniformes sur les outsiders : premier buteur, 2 buts,
  triple), erreur ou pas. Les compter permet de chercher une regle plus
  etroite (`SHOWN_BASES` dans `src/db/playerValue.ts`).

Pour juger ces marches, chaque lecture est comptee, meme apres le match
(`src/db/playerStats.ts`) : combien de joueurs cotes et a quel niveau
(affiche : 20 % et 20 € ; aussi serre qu'un 1N2 : 10 % et 20 € ; 10 % seul ;
20 % avec 10 € ; simplement cote), et chaque cote Winamax ou Betclic
au-dessus de ce que vaut un joueur, par facon, des 1 % (10 % pour une cote
suspecte), avec son meilleur ecart, ce a quoi elle est comparee et sa duree
de vie. `GET /api/stats/players?since=<date ISO>` (3 jours par defaut) en
fait le bilan : totaux par niveau, signaux par facon et par ecart (1, 3, 5,
10, 20 % ; 10, 20, 30, 50 % pour les cotes suspectes), matchs et
competitions tries par liquidite, chaque signal (affiche sur le site ou
non), courbe par heure (value bets, paris au-dessus du lay et cotes
suspectes de chaque cycle).

Pour le tennis (`src/reference/tennis.ts`, `tennisRun.ts`), le worker
cherche sur l'exchange chaque match ATP, WTA ou du Grand Chelem des 48 h a
venir par le nom d'un joueur (« Swiatek » ; l'exchange ecrit « Vekic »,
« M Bouzkova », « Xin Sun »), une fois, en notant s'il nomme les joueurs
dans l'autre sens. Il relit la liste de ses marches toutes les 30 min et
les prix de tous a chaque cycle : vainqueur, handicap jeux et nombre de
jeux (des marches a lignes asiatiques : un prix par ligne ; seules les
lignes en ,5 sont gardees), score en sets, nombre de sets, vainqueur des
1er et 2e sets, chaque joueur gagne au moins un set. Leurs regles :

- **vainqueur** : comme un 1N2. Cote juste quand back et lay sont ecartes
  de 10 % au plus, value bet a partir de 1 %, gem a partir de 5 %. Elle
  s'affiche aussi dans la liste du tennis, qui se trie par value ;
- **les autres** : comme les joueurs. Cote juste quand chaque issue a back
  et lay ecartes de 20 % au plus avec 20 € de chaque cote, value bet a
  partir de 5 %, sinon le lay comme plafond (5 %), gem a partir de 15 %.
  La cote juste est le prix milieu ramene a 100 % sur les issues du marche
  (2 pour une ligne, 4 pour le score en sets), et seulement quand elles y
  sont toutes. Les aces et les breaks n'ont pas de cote juste : l'exchange
  ne les cote pas.

Pour les autres sports de face-a-face (`src/reference/sports.ts`,
`sportsRun.ts`), le worker cherche chaque match des 7 jours a venir (comme
le foot, ceux au-dela de 48 h un cycle sur deux) sur
l'exchange par le nom d'une de ses equipes (« lightning »), ou le nom de
famille d'un combattant (« volkanovski »), une fois, 60 recherches par
cycle au plus, et lit le marche de l'exchange qui a la meme regle que celui
des bookmakers. Releve du 4 octobre 2026 :

| Sport | Marche de l'exchange | Notre marche |
|---|---|---|
| Basket | Moneyline, prolongations comprises | Vainqueur |
| Baseball | Moneyline, manches supplementaires comprises | Vainqueur |
| Football americain | Moneyline, prolongation comprise | Vainqueur |
| Hockey sur glace | 60 Minute 3 Way Match Odds (nul « Tie ») | 1N2 (temps reglementaire) |
| Rugby a XV | Match Odds | 1N2 |
| MMA | Fight Result | Vainqueur |

Les bookmakers ont souvent les deux marches, « Vainqueur » (prolongations
comprises) et « Resultat » (temps reglementaire, avec le nul) : leur cote
n'est comparee a la cote juste que sur le meme marche que celui de
l'exchange (1N2 contre 1N2, vainqueur contre vainqueur), jamais l'un contre
l'autre. Et le marche principal d'un match n'est lu chez un bookmaker que si
son titre est « Resultat... » ou « Vainqueur... » : le 4 octobre, Winamax
mettait en premier un handicap (« Ecart de points (handicap) »,
Montpellier -28,5) sur un match de rugby desequilibre, et « Nombre de buts »
sur deux matchs de foot, dont les 2 issues se seraient lues comme un
vainqueur. Ce match est alors laisse de cote chez ce bookmaker, comme un
« Vainqueur (rembourse si match nul) ».

Leur regle est celle du 1N2 du foot : cote juste quand back et lay sont
ecartes de 10 % au plus (sans minimum d'argent), le prix milieu ramene a
100 % sur les issues ; value bet a partir de 1 %, gem a partir de 5 %. Ils
se trient par value dans leur liste. Ce jour-la, la NFL et le baseball
(MLB, KBO, NPB) avaient toujours des prix serres, le basket et l'UFC
souvent, le hockey (avant la saison NHL) et le rugby rarement. L'exchange
ecrit les matchs americains « Away @ Home » : l'ordre est remis a
l'endroit. Laisses de cote : la boxe (l'exchange a un nul, les bookmakers
non), le handball et le rugby a XIII (introuvables sur l'exchange), les
autres courses (trop peu d'argent sur leurs vainqueurs : 1 golfeur sur 77
cote serre avec 20 €, rien pour le cyclisme, le ski, le biathlon, la NASCAR
ou le MotoGP ; la Formule 1 est la seule chiffree). Une recherche ne renvoie que 10 matchs : une equipe au nom
banal (« Racing 92 ») ou nommee autrement la-bas (« LOU Rugby », « Lyon »)
n'est pas trouvee.

La categorie « Value bets » lit `GET /api/value-bets` (`q`, `bookmakers`,
`sort=value|start`) : chaque cote 1N2 ou vainqueur d'un match pas encore
commence (de tous les sports ci-dessus) au moins 1 % au-dessus de sa cote
juste, et chaque cote
joueur ou d'un autre marche de tennis jugee ainsi (sauf les cotes
suspectes), avec son match, ce a quoi elle est comparee (`basis` : `fair`
ou `lay`) et son ecart. Une cote qui fait un surebet n'y est pas : elle
n'est que dans les surebets (voir « Les surebets »).

Limites : c'est l'API interne d'un site, qui peut changer sans prevenir ; la
liquidite est faible sur les petits matchs, et sur les marches joueurs hors
des gros matchs ; la commission de l'exchange (3 % des gains) n'est comptee que dans
les surebets, pas dans la cote juste ; les passeurs n'ont pas de cote juste (l'exchange n'en propose
pas).

## Les surebets

La categorie « Value bets » montre aussi, au-dessus des value bets, chaque
surebet des matchs et des courses pas encore commences
(`src/db/surebets.ts`, `surebets` dans `GET /api/value-bets`) : un marche
dont les meilleures cotes garantissent un gain quoi qu'il arrive, avec les
paris a placer pour 100 € (ou, a quel prix, combien), le TRJ et le gain. Sur
n'importe quel marche lu : le marche principal de chaque sport, tous ceux du
foot et du tennis (aces, jeux, handicaps, buts...), les courses (quand un
bookmaker cote tout le champ). Trois sortes :

- **entre les bookmakers** : la meilleure cote de chaque issue, chez
  Winamax ou Betclic, par les regles du TRJ de la page d'un match ;
- **avec l'exchange** : ses cotes « back » s'ajoutent aux leurs, nettes de
  sa commission de 3 % (1 + (cote - 1) x 0,97), quand il cote toutes les
  issues avec au moins 20 € a chaque prix (le 1N2 du foot, tous les marches
  du tennis, le marche principal des autres sports) ;
- **parie chez un bookmaker, « laye » sur l'exchange** : une issue que le
  bookmaker paie plus que le lay de l'exchange. Le gain
  est garanti quand cote x 0,97 / (lay - 0,03) depasse 1 ; la mise du lay
  est 100 x cote / (lay - 0,03), pour 100 € chez le bookmaker. Cela vaut
  aussi pour les buteurs, qui n'ont pas de TRJ. Sous 20 € au lay (2 € au
  moins), le surebet est montre avec « liquidite limitee » et la somme
  offerte (« seulement X € a layer ») : le gain ne vaut que pour cette
  somme. Il n'est pas envoye sur Discord, et la gem de sa cote l'est
  (9/10/2026 : le 2-2 de Kosovo F. - Autriche F. a 100 contre un lay a 85).

Une cote qui fait un surebet n'est montree qu'ici, plus dans les value
bets (depuis le 6/10/2026) : celle qu'un lay de l'exchange paie quoi qu'il
arrive (la meilleure, celle du surebet, comme celles des autres bookmakers
au-dessus du lay), ou celle qui, a la place de la cote de son issue dans un
surebet de toutes les issues, garde le TRJ au-dessus de 100 %. Meme regle
pour les alertes Discord, meme quand le surebet, « a verifier », n'est pas
envoye.

Sur Discord, la carte d'un surebet dit comme celle d'une gem ou regarder
et pas quoi parier : le TRJ, le match, le coup d'envoi, le gain en
pourcentage et le lien vers la page du match, ni le marche, ni les paris,
ni les mises. Deux surebets differents du meme match (une autre
combinaison de bookmakers, ou un autre marche) sont toujours deux alertes.

Une alerte (gem ou surebet) ne promet que des paris qui tiennent
(18/10/2026) : jamais un surebet « a verifier », seulement des cotes que le
dernier cycle de lecture a relues au meme prix (une cote suspendue ou
retiree reste sur le site trois cycles, pas dans les alertes), et vues a
deux cycles de suite, cinq minutes d'ecart : une erreur de cote corrigee
dans les minutes qui suivent, comme 20bet en fait, n'est jamais envoyee.

Les cotes boostees de 20bet (18/10/2026) sont montrees a cote de sa cote,
avec un eclair : 20bet les calcule sur sa page a partir du boost de son API
(`api/v4/boosted-odds`), et `boostedPrice` (`src/scraper/twentybet.ts`)
reprend ce calcul a l'identique. Elles ne comptent ni pour la meilleure
cote, ni dans les surebets, les value bets ou les alertes : un boost est
souvent plafonne en mise.

Seuls les bookmakers coches comptent (l'exchange toujours), du plus gros TRJ
au plus petit ou par date. Au-dela de 110 %, un surebet est marque « a
verifier » : c'est presque toujours deux regles ou deux lignes differentes,
ou une cote perimee. Limites : les regles d'un meme marche peuvent differer
entre bookmakers (abandon au tennis, prolongations), une cote change entre
deux mises, un bookmaker peut limiter la mise, et l'argent de l'exchange se
reduit au fil des paris.

Les marches du cycle des marches sont pres d'un million de cotes : le
surebet entre bookmakers de chacun est cherche quand ses cotes sont
enregistrees, et le marche note (`surebet_markets`). La categorie ne relit
que ces marches-la et ceux que l'exchange cote. Si les surebets echouent,
l'API les renvoie vides (erreur dans les logs) et les value bets s'affichent
quand meme.

### Surebets pris et rappel avant le match

Chaque surebet a un bouton « Genommen? » : un surebet marque pris est grise et
passe en fin de liste, sur tous les appareils du compte
(`user_taken_surebets` dans `auth.sqlite`, `/api/taken-surebets`,
`src/auth/takenSurebets.ts`). Quand l'un de ses paris est sur l'exchange (un
lay ou un back), la case « Erinnerung 1 Std. vorher » est cochee d'office :
une heure avant le coup d'envoi, le compte recoit un e-mail (le SMTP des
comptes) pour verifier que ce pari est bien matche sur le marche, un pari non
matche laissant les autres sans couverture (le proprietaire, 26/10/2026). Le
processus web l'envoie (`src/auth/surebetReminders.ts`, chaque minute), une
fois ; un surebet est oublie deux jours apres le match, 200 au plus par
compte.

Au-dessus de la liste des value bets, « Meine Surebets (N) » regroupe les
surebets pris du compte, meme ceux qui ont quitte la liste depuis (une cote a
bouge) : le match, les paris et les cotes tels que pris, le coup d'envoi
(« Gespielt » une fois commence), ce qu'il valait une fois pris (« +2,4 % ·
2,40 € auf 100 € », le TRJ garde a la prise dans `payout_rate`, qu'un nouvel
envoi ne change pas), l'etat du rappel (demande ou envoye) et un lien vers la
page du match (`web/src/MyTakenSurebets.tsx`). En tete, un resume : combien
de surebets, leur TRJ moyen et le gain attendu pour 100 € sur chacune.

### Promos

La page « Promos » (`/promos`, pour les comptes) range les promotions des
bookmakers par site, une carte par bookmaker, celui dont une promo finit le
plus tot en premier. Chaque promo a un titre, ses conditions, un lien, une
date de fin, et un bouton « Genommen? » : une promo prise est grisee et passe
en fin de liste, sur tous les appareils du compte (`promos` et
`user_promo_taken` dans `auth.sqlite`, `/api/promos`, `src/auth/promos.ts`).

Pour l'instant le compte les note lui-meme, depuis un e-mail ou un canal
Telegram (le formulaire « Promo eintragen ») : un bookmaker que le site
connait est reconnu sous son nom, un autre (un site crypto) garde celui
qu'on a ecrit. 300 promos au plus par compte ; une promo est oubliee deux
semaines apres sa fin. La table prevoit deja celles que le site trouvera
lui-meme (`source` : `site`, `telegram`, `email`, visibles par tous les
comptes, chacun les marquant pour lui) : les pages promotions des
bookmakers et les canaux Telegram publics suivront (le proprietaire,
26/10/2026).

Le site lit aussi lui-meme les promos de certains bookmakers, sur leur page
promotions publique (`src/promos/`, une minute apres le demarrage du
processus web puis toutes les heures) : pour l'instant bet-at-home, dont la
page porte sa liste en JSON (`promotionsData`), les promos sport seulement.
Elles sont a tous les comptes (`source = 'site'`, une ligne par
`source_key`, mise a jour sur place pour garder les marques « prise ») ; une
promo qui quitte la page est retiree. Une page qui ne repond pas ou sans sa
liste ne retire rien. Aucune protection anti-robot n'est contournee : un
bookmaker qui en a une n'est pas lu. Chaque promo trouvee pour la premiere
fois est annoncee dans le salon Discord des testeurs (celui des gems,
`DISCORD_WEBHOOK_URL`), un message par bookmaker, en allemand, avec un lien
vers la page Promos (`src/alerts/newPromos.ts`) ; une promo deja en base
n'est jamais annoncee de nouveau.

La veille de la fin d'une promo, le compte recoit un e-mail (le SMTP des
comptes) qui liste ses promos ouvertes, non marquees prises, finissant dans
les 24 heures, chacune une fois (`src/auth/promoReminders.ts`, toutes les
10 minutes dans le processus web ; `user_promo_reminded`). La case « E-Mail
am Vortag » de la page l'active ou le coupe (`user_promo_settings`, active
par defaut ; `PUT /api/promos/settings`).

## Alertes Discord

Le worker previent un salon Discord a chaque nouvelle « gem », un gros value
bet (`src/alerts/gems.ts`) : une cote 1N2 ou vainqueur d'un match (de tous
les sports qui ont une reference) au moins 5 % au-dessus de la cote juste,
ou une cote joueur au moins 15 % au-dessus de la sienne (ou de son
plafond, le lay de l'exchange). Les cotes suspectes, qui ne sont pas des
value bets sur le site, n'en declenchent pas.

Apres chaque cycle de la reference (toutes les 5 min), il envoie les gems
qu'il n'a pas encore envoyees : une carte par gem, qui dit ou regarder et
pas quoi parier (ecart, match, coup d'envoi a l'heure du lecteur, lien vers
la page du match, sur le titre et sur une ligne « Spiel auf OddsBlitzer
ansehen »), en allemand comme le site, ni l'issue, ni le bookmaker, ni la cote), 10 au
plus par message et 6000 caracteres de texte au plus pour l'ensemble des
cartes (la limite de Discord), la suite au cycle suivant. Chaque message est
verifie avant d'etre envoye. **Une seule alerte par match, marche (son
intitule) et issue (une equipe, un joueur)**, meme si elle disparait puis
revient : le vainqueur d'un tournoi de golf, son Top 5 et son Top 10 sont
trois alertes, un deuxieme joueur du meme marche une autre ; la meme issue
chez un autre bookmaker n'en est pas une (la meilleure cote part la
premiere). Si
Discord ne repond pas, rien n'est marque envoye et le cycle suivant
reessaie. Quand Discord limite les envois (erreur 429) en demandant d'attendre
10 secondes au plus (en-tete `Retry-After`), le worker attend et renvoie tout
de suite, deux fois au plus ; sinon le cycle suivant reessaie.
`GET /api/alerts` dit si le worker a un webhook, sa derniere
erreur et les 20 dernieres gems envoyees (jamais l'adresse du webhook).

Il envoie aussi chaque nouveau surebet (voir « Les surebets »), des 100 % de
TRJ, ceux « a verifier » compris (la carte porte alors « A verifier » dans son
titre et un champ qui dit pourquoi : TRJ au-dessus de 110 %, ou marche a
plusieurs gagnants comme un Top 5 de golf), mais pas ceux a liquidite
limitee : une carte par surebet (TRJ, marche, chaque
pari pour 100 € : ou, a quel prix, quelle mise, le match, le coup d'envoi,
le gain), 10 au plus par message. Une seule alerte par surebet et par
combinaison (quelle issue, chez qui) : si la meilleure cote d'une issue
change de bookmaker, c'est une nouvelle alerte. Une cote qui fait un
surebet n'est jamais envoyee comme gem.

Mise en place, une seule fois :

1. dans Discord : Parametres du serveur > Integrations > Webhooks > Nouveau
   webhook, choisir le salon, puis « Copier l'URL du webhook » ;
2. dans GitHub : Settings > Secrets and variables > Actions > New repository
   secret, nom `DISCORD_WEBHOOK_URL`, valeur l'URL copiee. C'est un secret :
   qui l'a peut ecrire dans le salon ;
3. relancer le deploiement (Actions > deploy > Run workflow). Le message
   « OddsBlitzer ist mit diesem Kanal verbunden » arrive aussitot : c'est la preuve
   que tout marche.

Le deploiement ecrit le secret dans le `.env` du VPS (voir « Deploiement
automatique ») : pour couper les alertes, supprimer le secret et relancer le
deploiement. En developpement, mettre `DISCORD_WEBHOOK_URL` dans son `.env`.

### Sante des bookmakers (administrateurs)

Chaque cycle de lecture note, par bookmaker, l'heure, le nombre de matchs lus
ou l'erreur (`src/db/bookmakerStatus.ts`). La page `/admin`, onglet
« Bookmakers », les montre : OK, en echec ou sans match depuis moins de 30 min,
ou « Down » (aucun match depuis 30 min). Un bookmaker qui tombe, puis qui
revient, est signale une fois chacun dans un salon Discord **reserve aux
administrateurs** (`src/alerts/health.ts`), jamais dans celui des alertes que
lisent les utilisateurs : secret GitHub `DISCORD_ADMIN_WEBHOOK_URL` (le webhook
d'un salon prive), que le deploiement de la production ecrit dans `.env`.
Sans lui, la page `/admin` reste la seule source.

L'exchange de reference est surveille de meme (`src/alerts/exchange.ts`) :
quand toutes ses requetes echouent depuis 15 minutes (trois cycles), le
salon des administrateurs recoit un message avec la derniere erreur et la
reparation (relancer `oddsradar-exchange-vpn` et `oddsradar-exchange-proxy`,
puis `sudo /usr/local/sbin/oddsradar-exchange-vpn check`), puis un autre
quand il repond de nouveau. Le 25/10/2026, son tunnel hors d'Allemagne
(`deploy/exchange-vpn.sh`) ne resolvait plus aucun nom : aucune cote de
reference pendant des heures, sans que personne le sache.

### Prix suspects (administrateurs)

Un surebet dont une cote s'ecarte de plus de 15 points de probabilite des
autres sources pour la meme issue est un suspect (`SUREBET_OUT_OF_LINE`,
`src/db/surebets.ts`) : equipes inversees, vieux prix ou autre match chez une
source, ou une vraie cote, que le proprietaire veut pouvoir jouer
(24/10/2026). Le site l'affiche quand meme dans la liste des surebets, marque
« ⚠️ verdächtig », la cote en cause suivie du prix des autres sources. Il
n'entre jamais dans les alertes des testeurs. Apres chaque cycle de reference,
le worker signale chacun une fois dans le salon Discord des administrateurs
(`DISCORD_ADMIN_WEBHOOK_URL`, `src/alerts/quality.ts`), 5 par cycle au plus :
le match, le coup d'envoi, le profit, chaque pari pour 100 € avec sa mise,
l'heure de lecture de sa cote (« read 12 min ago » : un vieux prix se voit
tout de suite) et le lien de la page du match chez le bookmaker, puis la cote
en cause et le lien du match. Un suspect encore la apres 7 jours est signale de nouveau.

### Mises en production (administrateurs)

Apres chaque deploiement, le job `announce` de `deploy.yml` previent le salon
Discord des administrateurs (`DISCORD_ADMIN_WEBHOOK_URL`) : chaque
fonctionnalite ou correction arrivee en production (pull request d'une branche
`feat/…` ou `fix/…`, avec son titre et son lien) et chaque deploiement en
echec. La documentation, la CI et les taches de maintenance ne sont pas
annoncees (`deploy/announce.sh`).

### Rapport de sante hebdomadaire (administrateurs)

Chaque dimanche a partir de 18 h (heure de Berlin), l'API envoie un message au
salon Discord des administrateurs (`DISCORD_ADMIN_WEBHOOK_URL`) avec ce
qu'affichent `vps-report bookmakers` et `vps-report promos` : l'etat et les
matchs de chaque bookmaker, les credits et le rythme de The Odds API, les
promotions et la derniere bonne lecture de chaque lecteur de promos
(`src/alerts/weeklyReport.ts`). Le dimanche envoye est garde dans `alert_state`,
pour qu'un redemarrage ne l'envoie pas deux fois.

### Retours des testeurs

Le bouton « Send feedback » de l'en-tete (icone bulle, comptes connectes)
envoie un message avec la page ou il a ete ecrit (`POST /api/feedback`, 10 par
heure et par compte, 2000 caracteres au plus). Les messages sont gardes dans la
base des comptes (table `feedback`, `src/auth/feedback.ts`) et listes dans
`/admin`, onglet « Feedback », ou un administrateur les marque traites.

## Comptes et HTTPS

Les cotes, les value bets, les surebets et les pages de match sont reserves
aux comptes : toute route `/api/*` (sauf `/api/auth/*`, `/api/health` et
`/api/public/home`, des totaux sans aucune cote) repond 401 sans session, et
`/odds` renvoie vers `/login`. Une route ajoutee plus tard sous `/api` est
protegee d'office. La page d'accueil reste publique et ne montre qu'un exemple
de value bet.

- **Parcours** : inscription (`/signup`), email de confirmation
  (`/verify-email?token=...`, valable 24 h), connexion (`/login`), mot de
  passe oublie (`/forgot-password`, lien de `/reset-password`
  valable 1 h). Un compte non confirme ne peut pas se connecter.
- **Securite** (`src/auth/`) : mots de passe haches en scrypt (12 caracteres au
  moins, pas de regle de composition) ; session = jeton aleatoire dans un
  cookie `HttpOnly; Secure; SameSite=Lax` (`__Host-session`), dont seul le
  SHA-256 est garde en base ; expiration apres 7 jours d'inactivite et 30 jours
  au plus ; liens des emails a usage unique, haches en base ; reponses
  identiques que l'email existe ou non ; limitation des tentatives (en
  memoire, un seul process web) ; CSRF par `SameSite`, JSON seul et controle de
  l'en-tete `Origin` ; en-tetes `helmet` (CSP, HSTS...). Un changement de mot
  de passe deconnecte tous les appareils.
- **Roles** : `users.role` vaut `user` ou `admin`. `requireAuth` garde les
  routes de donnees ; `requireRole("admin")` (`src/auth/middleware.ts`) garde
  `/api/admin/*`. Le premier administrateur se cree sur le serveur :
  `npm run create-admin -- email@exemple.fr` (le compte existe deja, ou le mot
  de passe est demande). Ensuite, un admin en nomme d'autres depuis la page
  `/admin`.
- **Administration** (`/admin`, reservee aux admins) : onglet Utilisateurs avec
  email, compte valide ou non, abonnement (colonne `subscription_status`,
  `none` pour tous tant que le paiement n'existe pas), role et statut. Un admin
  peut bloquer / debloquer un compte (il est deconnecte aussitot) et nommer ou
  retirer un admin, jamais sur son propre compte. Chaque action laisse une trace
  dans `auth_events` (`admin_*`).
- **Base** : les comptes sont dans `data/auth.sqlite` (`AUTH_DB_PATH`), a part
  de la base des cotes ; migrations versionnees, sauvegarde toutes les heures. Voir
  [docs/db-audit.md](docs/db-audit.md).

En developpement, sans `SMTP_HOST`, les emails (donc les liens de confirmation)
sont ecrits dans le terminal de `npm run api`.

### Mise en production

1. **HTTPS** : un nom de domaine pointant vers le VPS, les ports 80 et 443
   ouverts, Caddy installe, puis `deploy/Caddyfile` (domaine a remplacer) copie
   dans `/etc/caddy/`. Dans `/opt/oddsradar/.env` : `PUBLIC_URL=https://<domaine>`,
   `TRUST_PROXY=1` et `HOST=127.0.0.1` (seul Caddy atteint alors l'API). Variable
   de depot GitHub `APP_URL` = `https://<domaine>` (la verification du
   deploiement l'interroge).
2. **Emails** : secrets GitHub `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
   `SMTP_PASSWORD` et `SMTP_FROM` (n'importe quel service SMTP : Brevo,
   Mailjet, OVH...). Le deploiement les ecrit dans `.env`. **Sans `SMTP_HOST` et
   `SMTP_FROM`, le service web refuse de demarrer** (`NODE_ENV=production`) : un
   compte ne pourrait jamais etre confirme.
3. **Sauvegarde** : `sudo apt install sqlite3`, puis
   `sudo cp deploy/oddsradar-backup*.{service,timer} /etc/systemd/system/`,
   `sudo systemctl daemon-reload` et
   `sudo systemctl enable --now oddsradar-backup.timer oddsradar-backup-odds.timer`.
   Le deploiement n'installe pas ces fichiers : a refaire a la main quand ils
   changent. Deux copies, faites par `deploy/backup-db.sh` (copie coherente
   pendant que les services tournent, puis `PRAGMA integrity_check` ; une copie
   abimee est gardee a part en `.corrupt` et fait echouer l'unite, visible dans
   `systemctl status` ou `journalctl -u oddsradar-backup`) :
   - les **comptes** (`auth.sqlite`), toutes les heures, 30 jours gardes ;
   - la **base des cotes** (`coteradar.sqlite`), chaque dimanche, 4 copies : les
     cotes se reconstruisent, pas les stats des joueurs ni les alertes envoyees.

   Les copies sont dans `/opt/oddsradar/backups/`, **sur le meme disque** : en
   recopier regulierement hors du VPS (un disque qui tombe emporte le serveur
   et ses sauvegardes). Essayer de temps en temps de restaurer une copie sur
   une machine de test.

## Déploiement (VPS)

Installation initiale d'un serveur, a faire une seule fois. Ensuite, chaque
push sur `main` est deploye automatiquement (voir plus bas).

```bash
git clone <repo> /opt/oddsradar
cd /opt/oddsradar

# Backend : installation complete (PAS --production -- `npm run build` lance
# `tsc`, et typescript est une devDependency ; avec --production le build
# echoue et `dist/` n'est jamais cree, alors que les deux unites systemd
# pointent dessus).
npm install
npm run build

# Frontend : doit etre build aussi, c'est le process web qui le sert.
cd web && npm install && npm run build && cd ..

cp .env.example .env   # puis editer .env
sudo cp deploy/*.service /etc/systemd/system/
sudo systemctl enable --now oddsradar-worker oddsradar-web
```

`oddsradar-web.service` est autonome : le process web sert l'API sur `/api/*`
**et** le dashboard build (`web/dist`) comme fichiers statiques, sur le meme
`PORT`. Pour un VPS perso, rien d'autre n'est necessaire — il suffit d'ouvrir
`http://<vps>:<PORT>`.

Un reverse proxy (nginx, Caddy) reste utile pour TLS, un nom de domaine ou le
passage sur le port 443, mais c'est une option, pas une etape obligatoire du
deploiement.

### Deploiement automatique

Chaque push sur `main` lance le workflow `.github/workflows/deploy.yml` :

1. job `test` (`test.yml`, commun a tous les workflows) : typecheck et tests
   du backend, puis lint, tests et build du dashboard (`web/`) ;
2. job `gate`, seulement si les tests passent : le commit doit venir de
   `development` et ce code doit avoir ete deploye avec succes sur le site de
   test (voir « Environnement de test ») ;
3. job `deploy`, seulement si le `gate` passe : connexion SSH au VPS avec
   une cle qui ne peut rien faire d'autre que lancer `deploy/deploy.sh` sur le
   commit teste. Le script recupere ce commit (`git reset --hard` : `.env` et
   `data/` sont conserves, les modifications locales des fichiers suivis sont
   ecrasees), lance `npm ci` et les deux builds, redemarre les deux services
   et verifie que l'API repond et que le worker tourne ;
4. le job verifie enfin que le site repond depuis l'exterieur.

Le job passe aussi au VPS, sur l'entree standard de la commande SSH, les
reglages gardes dans GitHub : le secret `DISCORD_WEBHOOK_URL` (voir
« Alertes Discord ») et l'adresse du site (`PUBLIC_URL`). `deploy/deploy.sh`
n'accepte que ces deux cles, verifie leur forme (sans jamais les afficher)
et les ecrit dans `.env` ; une valeur vide retire la ligne. Le secret GitHub
fait donc foi : ne pas modifier ces deux lignes de `.env` a la main.

Un echec rend le run rouge dans l'onglet Actions (et GitHub envoie un mail).
Pour relancer un deploiement : Actions > deploy > Run workflow, ou "Re-run" sur
un run existant (relancer un ancien run redeploie son commit, ce qui sert de
retour arriere).

#### Mise en place (une seule fois)

A lancer **sur le VPS** (pas sur une machine de developpement), connecte en
tant que l'utilisateur des services. Verifier d'abord qu'on est au bon
endroit : la commande doit afficher `oddsradar` puis `/opt/oddsradar`.

```bash
whoami && ls -d /opt/oddsradar
```

Puis, en un seul bloc (il s'arrete a la premiere erreur) :

```bash
cd /opt/oddsradar && git pull origin main \
&& GIT_TERMINAL_PROMPT=0 git fetch origin main && echo FETCH-OK \
&& { sudo -n true && echo SUDO-OK || echo SUDO-KO; } \
&& mkdir -p -m 700 ~/.ssh \
&& ssh-keygen -t ed25519 -N "" -C github-deploy -f ~/.ssh/github_deploy \
&& echo "command=\"/opt/oddsradar/deploy/deploy.sh\",restrict $(cat ~/.ssh/github_deploy.pub)" >> ~/.ssh/authorized_keys \
&& for f in /etc/ssh/ssh_host_*_key.pub; do echo "141.95.86.176 $(cut -d' ' -f1,2 "$f")"; done
```

Puis dans GitHub : Settings > Secrets and variables > Actions > New repository
secret, deux fois :

- `VPS_KNOWN_HOSTS` : toutes les lignes `141.95.86.176 ...` affichees a la
  fin (ce sont les cles publiques du serveur) ;
- `VPS_SSH_KEY` : la sortie complete de `cat ~/.ssh/github_deploy`, lignes
  `BEGIN` et `END` comprises. C'est une cle privee : la copier uniquement
  dans ce secret, nulle part ailleurs, puis la supprimer du VPS avec
  `rm ~/.ssh/github_deploy ~/.ssh/github_deploy.pub`.

Si `FETCH-OK` ne s'affiche pas, le VPS ne peut pas lire le depot (prive) sans
mot de passe. Lui donner une cle en lecture seule :

```bash
ssh-keygen -t ed25519 -N "" -C oddsradar-vps -f ~/.ssh/oddsradar_repo
cat ~/.ssh/oddsradar_repo.pub   # GitHub : Settings > Deploy keys > Add deploy key (sans ecriture)
printf 'Host github.com\n  IdentityFile ~/.ssh/oddsradar_repo\n' >> ~/.ssh/config
git -C /opt/oddsradar remote set-url origin git@github.com:MehdiH94/oddsradar-de.git
ssh -o StrictHostKeyChecking=accept-new -T git@github.com   # accepte la cle de GitHub
```

Si `SUDO-KO` s'affiche, autoriser uniquement le redemarrage des
services :

```bash
echo 'oddsradar ALL=(root) NOPASSWD: /usr/bin/systemctl restart oddsradar-worker oddsradar-web' \
  | sudo tee /etc/sudoers.d/oddsradar-deploy
sudo chmod 440 /etc/sudoers.d/oddsradar-deploy
```

#### Deployer a la main

Le meme script sert sans GitHub, depuis le VPS :

```bash
/opt/oddsradar/deploy/deploy.sh          # dernier commit de main
/opt/oddsradar/deploy/deploy.sh <sha>    # un commit precis de main
```

En cas de probleme apres un deploiement :

```bash
sudo systemctl status oddsradar-worker oddsradar-web
journalctl -u oddsradar-worker -f   # Ctrl+C pour quitter
```

### Rapports du VPS

Le workflow `vps-report` (Actions > vps-report > Run workflow) demande au VPS
un rapport en lecture seule et le met dans son log et dans un artefact :

- `surebet-report` : `npm run surebet-report`, sur le nombre de jours choisi ;
- `probe` : la sonde des bookmakers bloques hors d'Allemagne
  (`scripts/probe-geo-bookmakers.mjs`), puis son fichier ;
- `status` : le commit deploye, la place libre, l'etat des services et leurs
  dernieres lignes de log ;
- `bookmakers` : la derniere lecture de chaque bookmaker (`npm run
  bookmaker-status`) : son etat (OK, FAILING, EMPTY, DOWN), quand il a ete lu,
  combien de matchs, sa derniere bonne lecture et sa derniere erreur, comme
  l'onglet « Bookmakers » de `/admin` ; puis les credits restants de The Odds
  API (Tipico, Winamax, Pinnacle), lus dans le cache du worker
  (`data/odds-api-cache.json`), que l'onglet montre aussi, avec l'intervalle de lecture etale pour tenir jusqu'au 1er du mois ;
- `exchange` : la sortie de l'exchange hors d'Allemagne
  (`deploy/exchange-vpn.sh`) : l'etat du tunnel et du proxy, leurs dernieres
  lignes de log, et une recherche sur l'exchange a travers le proxy (HTTP 200
  quand tout va bien) ;
- `promo-pages` : les pages promotions des bookmakers vues d'Allemagne
  (`scripts/probe-promo-pages.mjs`) : leur reponse, une page anti-robot
  eventuelle, les cles de leur etat et les adresses qui parlent de promos,
  pour ecrire les lecteurs de `src/promos/` ;
- `promo-network` : les requetes que ces pages font dans un navigateur
  (`scripts/probe-promo-network.mjs`, le Chromium de Playwright de `probe`),
  celles qui parlent de promos en premier, avec leurs en-tetes de requete
  (sans les cookies) et le debut de leur reponse ;
- `promo-samples` : les listes de promos publiques trouvees ainsi
  (Sportingbet, neobet, Admiralbet, 20bet et son miroir), lues d'Allemagne et imprimees en
  entier (`scripts/probe-promo-samples.mjs`), pour ecrire leurs lecteurs ;
- `pinnacle` : si les cotes publiques de Pinnacle (l'API que lit son propre
  site, sans cle) repondent depuis l'Allemagne : les ligues de football, puis
  les matchs et les cotes de la Bundesliga, le debut de chaque reponse ;
- `promos` : les promos que chaque lecteur de `src/promos/` a trouvees en
  production (`npm run promo-status`, les bases ouvertes en lecture seule) :
  combien, la derniere trouvee et quand, son dernier passage reussi (et
  combien il en a lu), et l'etat de son alerte admin (EMPTY s'il n'a rien,
  FAILING depuis quand, avec sa derniere erreur). La meme chose dans l'onglet
  « Promos » de `/admin`.

Claude Code le lance lui-meme quand il a besoin d'un de ces rapports. Il passe
par sa propre cle SSH, dont la commande forcee est `deploy/vps-report.sh` :
quoi qu'on lui demande, le VPS n'execute que ce script, qui refuse tout ce qui
n'est pas dans la liste ci-dessus. Il n'ecrit dans aucune base, ne redemarre
rien, ne deploie pas et n'affiche aucun reglage.

#### Mise en place (une seule fois)

Sur le VPS, en tant que l'utilisateur des services (`sudo -iu oddsradar`
depuis le compte `ubuntu`). La premiere commande doit afficher `oddsradar`
puis le chemin du script :

```bash
whoami && ls /opt/oddsradar/deploy/vps-report.sh
```

Puis, en un seul bloc :

```bash
ssh-keygen -t ed25519 -N "" -C github-report -f ~/.ssh/github_report \
&& { [ -z "$(tail -c1 ~/.ssh/authorized_keys)" ] || echo >> ~/.ssh/authorized_keys; } \
&& echo "command=\"/opt/oddsradar/deploy/vps-report.sh\",restrict $(cat ~/.ssh/github_report.pub)" >> ~/.ssh/authorized_keys \
&& cat ~/.ssh/github_report
```

Dans GitHub : Settings > Secrets and variables > Actions > New repository
secret, `VPS_REPORT_SSH_KEY` : toute la sortie de la derniere commande, lignes
`BEGIN` et `END` comprises (`VPS_KNOWN_HOSTS` sert deja au deploiement). C'est
une cle privee : la copier uniquement dans ce secret, puis la supprimer du VPS
avec `rm ~/.ssh/github_report ~/.ssh/github_report.pub`.

Facultatif, pour que `status` montre aussi les logs des services (depuis le
compte `ubuntu`) : `sudo usermod -aG systemd-journal oddsradar`.

### Environnement de test

> **Plus utilise depuis le 20/10/2026.** Le site n'ayant ni trafic ni
> clients, il n'y a plus qu'un environnement, la production : les pull
> requests vont directement sur `main` (CONTRIBUTING.md, section 6), et les
> workflows `deploy-staging` et `sync-development` sont supprimes. Pour
> arreter les anciens services sur le VPS :
> `sudo systemctl disable --now oddsradar-staging-worker oddsradar-staging-web`.
> La suite decrit l'ancienne mise en place, gardee pour pouvoir la refaire.

`staging.odds-blitzer.de` montre toujours le dernier etat de la branche
`development`. C'est le meme VPS que la production, mais un autre dossier
(`/opt/oddsradar-staging`), d'autres services (`oddsradar-staging-worker`,
`oddsradar-staging-web`, port 3001) et d'autres bases : celles de la
production ne sont jamais touchees. Son worker scrape toutes les 45 minutes
(meme IP que la production) et n'envoie aucune alerte Discord.

Chaque push sur `development` lance `.github/workflows/deploy-staging.yml`
(tests, deploiement, verification du site), avec sa propre cle SSH dont la
commande forcee deploie `development` vers les services de test, et rien
d'autre. Le job `gate` de `deploy.yml` refuse ensuite de deployer en
production un commit qui n'a pas ete deploye avec succes sur le site de test.

#### Mise en place (une seule fois)

1. **DNS** : un enregistrement `A` `staging.odds-blitzer.de` vers
   `141.95.86.176`.
2. **Sur le VPS**, en tant que `oddsradar` (une fois la branche `development`
   contenant `deploy/staging/` fusionnee). `/opt` appartient a root : le
   dossier est d'abord cree au nom de `oddsradar`, puis le depot y est clone :

   ```bash
   sudo install -d -o oddsradar -g oddsradar -m 755 /opt/oddsradar-staging \
   && git clone git@github.com:MehdiH94/oddsradar-de.git /opt/oddsradar-staging \
   && cd /opt/oddsradar-staging && git checkout development \
   && mkdir -p data \
   && cp deploy/staging/.env.staging.example .env && chmod 600 .env \
   && sqlite3 /opt/oddsradar/data/coteradar.sqlite ".backup /opt/oddsradar-staging/data/coteradar.sqlite" \
   && sudo cp deploy/staging/*.service /etc/systemd/system/ && sudo systemctl daemon-reload \
   && sudo systemctl enable oddsradar-staging-worker oddsradar-staging-web
   ```

   La copie de la base des cotes evite un site de test vide pendant le premier
   cycle ; ne jamais copier `auth.sqlite`. Les services sont actives sans etre
   demarres : le premier deploiement construit l'application.

   La regle sudoers est validee par `visudo` avant d'etre installee, pour
   qu'une faute de frappe ne puisse pas casser `sudo` :

   ```bash
   echo 'oddsradar ALL=(root) NOPASSWD: /usr/bin/systemctl restart oddsradar-staging-worker oddsradar-staging-web' \
     > /tmp/oddsradar-staging-deploy \
   && sudo visudo -cf /tmp/oddsradar-staging-deploy \
   && sudo install -m 440 -o root -g root /tmp/oddsradar-staging-deploy /etc/sudoers.d/oddsradar-staging-deploy \
   && rm /tmp/oddsradar-staging-deploy && sudo visudo -c
   ```

   Puis le bloc Caddy du site de test, ajoute a la fin de
   `/etc/caddy/Caddyfile` apres une sauvegarde, et valide avant tout
   rechargement :

   ```bash
   sudo cp -p /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%Y%m%d-%H%M%S) \
   && printf '\n' | sudo tee -a /etc/caddy/Caddyfile >/dev/null \
   && sudo tee -a /etc/caddy/Caddyfile < /opt/oddsradar-staging/deploy/staging/Caddyfile.snippet >/dev/null \
   && sudo -u caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
   ```

   Ne recharger Caddy qu'une fois le DNS en place
   (`dig +short staging.odds-blitzer.de @1.1.1.1` doit repondre
   `141.95.86.176`) : sinon Caddy demande tout de suite un certificat pour un
   nom qui ne pointe pas encore vers le serveur, et Let's Encrypt limite le
   nombre d'echecs par heure.

   ```bash
   sudo systemctl reload caddy
   curl -sI https://odds-blitzer.de | head -1                               # la production repond toujours
   curl -sI https://staging.odds-blitzer.de | grep -iE '^HTTP|x-robots'     # 502 normal avant le premier deploiement
   ```

3. **Cle SSH du deploiement de test**, sur le VPS (meme demarche que pour la
   production). La premiere ligne evite que la nouvelle cle se colle a la
   derniere ligne d'`authorized_keys` si celle-ci ne finit pas par un saut de
   ligne ; les lignes existantes ne sont pas modifiees :

   ```bash
   { [ -z "$(tail -c1 ~/.ssh/authorized_keys)" ] || echo >> ~/.ssh/authorized_keys; } \
   && ssh-keygen -t ed25519 -N "" -C github-deploy-staging -f ~/.ssh/github_deploy_staging \
   && echo "command=\"env DEPLOY_BRANCH=development DEPLOY_SERVICES='oddsradar-staging-worker oddsradar-staging-web' /opt/oddsradar-staging/deploy/deploy.sh\",restrict $(cat ~/.ssh/github_deploy_staging.pub)" >> ~/.ssh/authorized_keys
   ```

   Puis, **depuis le PC** (avec `gh` connecte au compte proprietaire du depot),
   le secret `STAGING_VPS_SSH_KEY` et la variable `STAGING_URL`. La cle privee
   passe directement du VPS au secret, sans jamais etre affichee :

   ```bash
   ( set -o pipefail; ssh oddsradar@141.95.86.176 'test -s ~/.ssh/github_deploy_staging && cat ~/.ssh/github_deploy_staging' \
     | gh secret set STAGING_VPS_SSH_KEY --repo MehdiH94/oddsradar-de ) && echo "secret OK"
   gh variable set STAGING_URL --body "https://staging.odds-blitzer.de" --repo MehdiH94/oddsradar-de
   gh secret list --repo MehdiH94/oddsradar-de; gh variable list --repo MehdiH94/oddsradar-de
   ```

   Une fois `STAGING_VPS_SSH_KEY` dans la liste, supprimer la cle du VPS :
   `rm ~/.ssh/github_deploy_staging ~/.ssh/github_deploy_staging.pub` (la
   ligne d'`authorized_keys` reste). `VPS_KNOWN_HOSTS` et les secrets `SMTP_*`
   de la production sont reutilises.
4. Lancer le premier deploiement (Actions > deploy-staging > Run workflow, ou
   `gh workflow run deploy-staging.yml --repo MehdiH94/oddsradar-de --ref development`),
   puis creer un compte administrateur de test (email et mot de passe tapes
   dans le terminal, distincts de ceux de la production) :
   `cd /opt/oddsradar-staging && npm run create-admin`.

Le site de test se deploie a la main comme la production :

```bash
DEPLOY_BRANCH=development DEPLOY_SERVICES='oddsradar-staging-worker oddsradar-staging-web' \
  /opt/oddsradar-staging/deploy/deploy.sh
```
