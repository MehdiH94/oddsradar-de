import { createHash, randomBytes } from "node:crypto";

// A secret handed out once (a session cookie, an email link): 256 random
// bits. The database keeps only its SHA-256, so a leaked copy of it opens
// nothing. No salt or slow hash needed: the token is not guessable.
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
