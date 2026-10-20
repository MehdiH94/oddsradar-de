// German amounts: "14,12", "10,67 €", "75,6 %" (a figure and its unit held together by a non-breaking space).

const TWO_DECIMALS = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const EURO = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const RATE = new Intl.NumberFormat("de-DE", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const PERCENT = new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 1 });

// Freebets: "14,12". Two decimals, a freebet is worth a cent.
export const formatFb = (value: number) => TWO_DECIMALS.format(value);

// Euros: "10,67 €".
export const formatEuro = (value: number) => EURO.format(value);

// A plan's rate (cash / freebets used), 0.7558 -> "75,6 %".
export const formatRate = (rate: number) => RATE.format(rate);

// A commission, 0.03 -> "3 %".
export const formatCommission = (rate: number) => PERCENT.format(rate);

// Odds: 4.6 -> "4,60".
export const formatOdds = (value: number) => TWO_DECIMALS.format(value);

// What the field of a freebets amount holds: "12,5", "30", "" for nothing.
export const amountText = (value: number | undefined) => (value && value > 0 ? String(value).replace(".", ",") : "");

// The amount a field holds, in FB: null when it is not one. Empty is nothing (0), a comma or a dot
// are both decimal marks, except dots grouping thousands the German way ("1.000", "2.500,50"), and
// the server's ceiling (src/freebets/wallet.ts, MAX_FREEBET) is respected.
export const MAX_FREEBET = 10_000;
const THOUSANDS = /^[1-9]\d{0,2}(\.\d{3})+(,\d*)?$/;
export function parseAmount(text: string): number | null {
  const compact = text.trim().replace(/\s/g, "");
  const cleaned = (THOUSANDS.test(compact) ? compact.replace(/\./g, "") : compact).replace(",", ".");
  if (cleaned === "") return 0;
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === ".") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value <= MAX_FREEBET ? Math.round(value * 100) / 100 : null;
}

// The time of day a price was read at: "07:12", "—" for none.
const TIME_FORMAT = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
export const readAt = (iso: string) => (iso && !Number.isNaN(new Date(iso).getTime()) ? TIME_FORMAT.format(new Date(iso)) : "—");
