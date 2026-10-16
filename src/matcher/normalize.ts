// Letters NFD doesn't split into a letter and an accent: "Højlund" is
// "Hojlund", not "Hjlund".
const LETTERS: Record<string, string> = { ø: "o", æ: "ae", œ: "oe", ß: "ss", ł: "l", đ: "d", ı: "i", þ: "th", ð: "d" };

// The matcher normalizes the same few thousand names again for every pair of
// events it compares: remembered, up to a limit that a long-running worker
// can't outgrow.
const CACHE_LIMIT = 50_000;
const cache = new Map<string, string>();

export function normalizeName(name: string): string {
  const known = cache.get(name);
  if (known !== undefined) return known;
  const normalized = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[øæœßłđıþð]/g, (c) => LETTERS[c])
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(name, normalized);
  return normalized;
}

// German writes an umlaut as its letter and an "e" when the letter is missing:
// "München" is "Muenchen", "Köln" "Koeln", and the English sites drop it
// ("Monchengladbach"). normalizeName strips the umlaut ("munchen"), so the
// digraphs are folded the same way, on a normalized name. Applied to both
// names a comparison looks at, never to the words the matcher lists itself
// ("groningue", "ligue"), which normalizeName's output is checked against.
export function foldGermanDigraphs(normalized: string): string {
  return normalized.replace(/([aou])e/g, "$1");
}
