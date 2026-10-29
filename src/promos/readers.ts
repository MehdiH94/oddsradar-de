import { fetchAdmiralbetPromos } from "./admiralbet";
import { fetchBetathomePromos } from "./betathome";
import { fetchMerkurbetsPromos } from "./merkurbets";
import { fetchNeobetPromos } from "./neobet";
import { PromoReader } from "./sitePromos";
import { fetchTwentybetPromos } from "./twentybet";

// The bookmakers whose promotions the site reads itself, each with its reader:
// read hourly by the web process (src/api/index.ts), reported by
// `npm run promo-status` (src/tools/promoStatus.ts).
export const PROMO_READERS: Readonly<Record<string, PromoReader>> = {
  betathome: fetchBetathomePromos,
  neobet: fetchNeobetPromos,
  admiralbet: fetchAdmiralbetPromos,
  twentybet: fetchTwentybetPromos,
  merkurbets: fetchMerkurbetsPromos,
};
