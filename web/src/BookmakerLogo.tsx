import { BOOKMAKER_BRANDING } from "./bookmakers";

// A bookmaker's icon in place of its name. The name stays as alt text, so
// screen readers still read it, and as a tooltip. Next to the written name,
// the icon is `decorative`: read twice, "Winamax Winamax", it would only add
// noise. A bookmaker without an icon gets a badge with its name's initial, of
// the icon's size, so that every site is told apart at a glance (the owner,
// 25/10/2026); one the UI knows nothing of keeps its id.
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
  if (!brand.logo) {
    return (
      <span
        className="bookmaker-logo bookmaker-badge"
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : brand.name}
        aria-hidden={decorative ? true : undefined}
        title={decorative ? undefined : brand.name}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.6) }}
      >
        {brand.name.charAt(0).toUpperCase()}
      </span>
    );
  }
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
