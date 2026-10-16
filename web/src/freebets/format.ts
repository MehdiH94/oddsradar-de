// English amounts: "14.12", "€10.67", "75.6%".

// Freebets: "14.12". Two decimals, a freebet is worth a cent.
export const formatFb = (value: number) => value.toFixed(2);

// Euros: "€10.67".
export const formatEuro = (value: number) => `€${value.toFixed(2)}`;

// A plan's rate (cash / freebets used), 0.7558 -> "75.6%".
export const formatRate = (rate: number) => `${(rate * 100).toFixed(1)}%`;

// What the field of a freebets amount holds: "12.5", "30", "" for nothing.
export const amountText = (value: number | undefined) => (value && value > 0 ? String(value) : "");

// The amount a field holds, in FB: null when it is not one. Empty is nothing (0), a comma or a dot
// are both decimal marks, and the server's ceiling (src/freebets/wallet.ts, MAX_FREEBET) is respected.
export const MAX_FREEBET = 10_000;
export function parseAmount(text: string): number | null {
  const cleaned = text.trim().replace(/\s/g, "").replace(",", ".");
  if (cleaned === "") return 0;
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === ".") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value <= MAX_FREEBET ? Math.round(value * 100) / 100 : null;
}

// The time of day a price was read at: "07:12", "—" for none.
const TIME_FORMAT = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
export const readAt = (iso: string) => (iso && !Number.isNaN(new Date(iso).getTime()) ? TIME_FORMAT.format(new Date(iso)) : "—");
