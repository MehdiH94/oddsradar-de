import { BOOKMAKER_BRANDING } from "./bookmakers";

// A bookmaker's icon in place of its name. The name stays as alt text, so
// screen readers still read it, and as a tooltip. Next to the written name,
// the icon is `decorative`: read twice, "Winamax Winamax", it would only add
// noise. A bookmaker without an icon keeps its plain name (its branding's, or
// its id when it has none).
export function BookmakerLogo({
  bookmaker,
  size = 20,
  decorative = false,
}: {
  bookmaker: string;
  size?: number;
  decorative?: boolean;
}) {
  const brand = BOOKMAKER_BRANDING[bookmaker];
  if (!brand) return decorative ? null : <>{bookmaker}</>;
  if (!brand.logo) return decorative ? null : <>{brand.name}</>;
  return (
    <img
      className="bookmaker-logo"
      src={brand.logo}
      alt={decorative ? "" : brand.name}
      title={decorative ? undefined : brand.name}
      width={size}
      height={size}
    />
  );
}
