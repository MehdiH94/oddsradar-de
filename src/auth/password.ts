import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// scrypt, one of the OWASP-listed password hashes, from node:crypto (no native
// dependency). N=2^16, r=8, p=2 is OWASP's equivalent of N=2^17, p=1 at half
// the memory (64 MB per hash, which matters on a small VPS). The parameters
// are written in the stored string, so a hash made with older ones still
// verifies and needsRehash() says when to redo it.
export interface ScryptCost {
  N: number;
  r: number;
  p: number;
}

export const DEFAULT_COST: ScryptCost = { N: 2 ** 16, r: 8, p: 2 };

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const FORMAT = "scrypt";

// scrypt refuses more than 32 MB unless told: 128 * N * r bytes, plus room.
function maxmem({ N, r, p }: ScryptCost): number {
  return 128 * N * r * p + 16 * 1024 * 1024;
}

function derive(password: string, salt: Buffer, cost: ScryptCost, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, length, { ...cost, maxmem: maxmem(cost) }, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });
}

export async function hashPassword(password: string, cost: ScryptCost = DEFAULT_COST): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, cost, KEY_LENGTH);
  return [FORMAT, cost.N, cost.r, cost.p, salt.toString("base64"), key.toString("base64")].join("$");
}

function parse(stored: string): { cost: ScryptCost; salt: Buffer; key: Buffer } | null {
  const [format, N, r, p, salt, key] = stored.split("$");
  if (format !== FORMAT || !key) return null;
  const cost = { N: Number(N), r: Number(r), p: Number(p) };
  if (![cost.N, cost.r, cost.p].every((n) => Number.isInteger(n) && n > 0)) return null;
  return { cost, salt: Buffer.from(salt, "base64"), key: Buffer.from(key, "base64") };
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = stored.length < 500 ? parse(stored) : null;
  if (!parsed) return false;
  const key = await derive(password, parsed.salt, parsed.cost, parsed.key.length);
  return key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
}

export function needsRehash(stored: string, cost: ScryptCost = DEFAULT_COST): boolean {
  const parsed = parse(stored);
  return !parsed || parsed.cost.N !== cost.N || parsed.cost.r !== cost.r || parsed.cost.p !== cost.p;
}

// NIST 800-63B: length matters, composition rules don't. At least 12
// characters (the maximum only bounds the work an attacker can ask for), not
// a well-known password, not the email.
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

const COMMON = new Set([
  "password1234",
  "password12345",
  "motdepasse12",
  "motdepasse123",
  "123456789012",
  "1234567890123",
  "azertyuiop12",
  "azertyuiopqs",
  "qwertyuiop12",
  "qwertyuiopas",
  "iloveyou1234",
  "changeme1234",
  "welcome12345",
  "administrator",
  "coteradar1234",
  "coteradar2026",
  "footballfootball",
  // The German testers' own (beta, 10/2026): their keyboard's row, their words.
  "passwort1234",
  "passwort12345",
  "hallo1234567",
  "qwertzuiop12",
  "qwertzuiopue",
  "qwertzuiopü1",
  "schalke04schalke",
  "bayernmuenchen",
  "bayernmünchen",
  "borussiadortmund",
  "fussballfussball",
  "oddsblitzer1234",
  "oddsblitzer2026",
]);

export function passwordProblem(password: string, email = ""): string | null {
  if (password.length < PASSWORD_MIN) return `Das Passwort muss mindestens ${PASSWORD_MIN} Zeichen lang sein.`;
  if (password.length > PASSWORD_MAX) return `Das Passwort darf höchstens ${PASSWORD_MAX} Zeichen lang sein.`;
  const lower = password.toLowerCase();
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (COMMON.has(lower) || /^(.)\1+$/.test(password) || lower === email.toLowerCase() || (local.length >= 4 && lower.includes(local))) {
    return "Dieses Passwort ist zu leicht zu erraten.";
  }
  return null;
}
