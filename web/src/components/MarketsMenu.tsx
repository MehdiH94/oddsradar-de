import { Dropdown, MenuGroup, MenuOption } from "./Dropdown";
import { MARKETS_OPTIONS } from "./filterOptions";

// "Marchés : Tous", opening on every match or only those with players'
// markets (scorers, assisters, decisive players), which bookmakers offer for
// some matches only, a day or two before. A click picks and closes.
export function MarketsMenu({ players, onChange }: { players: boolean; onChange: (players: boolean) => void }) {
  const current = MARKETS_OPTIONS.find((option) => option.value === players) ?? MARKETS_OPTIONS[0];
  return (
    <Dropdown label="Marchés" summary={current.summary}>
      <MenuGroup legend="Garder les matchs">
        {MARKETS_OPTIONS.map((option) => (
          <MenuOption
            key={option.label}
            type="radio"
            name="markets"
            checked={option.value === players}
            onChange={() => onChange(option.value)}
            closeOnPick
          >
            {option.label}
          </MenuOption>
        ))}
      </MenuGroup>
    </Dropdown>
  );
}
