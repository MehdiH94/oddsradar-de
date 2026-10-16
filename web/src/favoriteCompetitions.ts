// The competitions the "Compétition" menu puts first, in this order: the five
// big European football leagues and the Champions League. Bookmakers name the
// same competition in their own way ("LaLiga EA Sports", "Ligue des Champions
// de l'UEFA - Phase de ligue"), so each is recognised by the start of its name,
// and the lookalikes are left out: the women's, the qualifiers, the second
// divisions ("Bundesliga 2", "LaLiga Hypermotion") and the namesakes of other
// countries ("Brasileiro Serie A").

// The name without case, accents or punctuation: "Ligue 1 McDonald's®" is
// "ligue 1 mcdonald s".
export function normalizeCompetition(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// The women's, the qualifiers and a second division are other competitions.
const LOOKALIKE = /\b(feminin\w*|femmes?|women|womens|qualif\w*|hypermotion)\b|\bf$/;
const SECOND_DIVISION = /^2\b/;

interface Favorite {
  label: string;
  // What the normalized name starts with.
  start: RegExp;
}

export const FAVORITE_COMPETITIONS: readonly Favorite[] = [
  { label: "Bundesliga", start: /^bundesliga\b/ },
  { label: "Champions League", start: /^(uefa )?(ligue des champions|champions league)\b/ },
  { label: "Premier League", start: /^premier league\b/ },
  { label: "La Liga", start: /^la ?liga\b/ },
  { label: "Serie A", start: /^serie a\b/ },
  { label: "Ligue 1", start: /^ligue 1\b/ },
];

// The place of a competition among the favorites (0 for the first), or null
// when it is not one. Only football has favorites: "PDC Premier League" is
// darts.
export function favoriteRank(sport: string, name: string): number | null {
  if (sport !== "football") return null;
  const key = normalizeCompetition(name);
  if (LOOKALIKE.test(key)) return null;
  const rank = FAVORITE_COMPETITIONS.findIndex(({ start }) => {
    const found = start.exec(key);
    return found !== null && !SECOND_DIVISION.test(key.slice(found[0].length).trim());
  });
  return rank === -1 ? null : rank;
}
