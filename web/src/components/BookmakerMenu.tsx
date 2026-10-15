import { ALL_BOOKMAKERS, BOOKMAKER_BRANDING } from "../bookmakers";
import { BookmakerLogo } from "../BookmakerLogo";
import { Dropdown, MenuGroup, MenuOption } from "./Dropdown";

const bookmakerName = (bookmaker: string) => BOOKMAKER_BRANDING[bookmaker]?.name ?? bookmaker;

// "Bookmakers : Tous", opening on one checkbox per bookmaker, ticked when its
// prices are compared. Stays open to tick several.
export function BookmakerMenu({
  selected,
  onChange,
}: {
  selected: readonly string[];
  onChange: (bookmakers: string[]) => void;
}) {
  function toggle(bookmaker: string, checked: boolean) {
    // Filtering ALL_BOOKMAKERS (rather than pushing onto `selected`) keeps the
    // emitted list in a stable order regardless of which checkbox was
    // clicked, so downstream column order never depends on click order.
    onChange(ALL_BOOKMAKERS.filter((b) => (b === bookmaker ? checked : selected.includes(b))));
  }

  return (
    <Dropdown label="Bookmakers" summary={summarize(selected)}>
      <MenuGroup legend="Bookmakers comparés">
        {ALL_BOOKMAKERS.map((bookmaker) => (
          <MenuOption
            key={bookmaker}
            type="checkbox"
            checked={selected.includes(bookmaker)}
            onChange={(checked) => toggle(bookmaker, checked)}
          >
            <BookmakerLogo bookmaker={bookmaker} size={18} decorative />
            {bookmakerName(bookmaker)}
          </MenuOption>
        ))}
      </MenuGroup>
    </Dropdown>
  );
}

function summarize(selected: readonly string[]): string {
  const ticked = ALL_BOOKMAKERS.filter((bookmaker) => selected.includes(bookmaker));
  if (ticked.length === ALL_BOOKMAKERS.length) return "Tous";
  if (ticked.length === 0) return "Aucun";
  if (ticked.length === 1) return bookmakerName(ticked[0]);
  return `${ticked.length} sur ${ALL_BOOKMAKERS.length}`;
}
