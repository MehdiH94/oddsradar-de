import { Dropdown, MenuGroup, MenuOption } from "./Dropdown";
import { CompetitionPicker } from "./CompetitionPicker";

// "Wettbewerb: Alle", opening on the competitions of the sport shown (the
// matches' and the winners'): picking one keeps its matches and its winner.
// Football's big leagues come first, the list is folded, and a field searches
// it (CompetitionPicker).
export function CompetitionMenu({
  sport,
  value,
  competitions,
  onChange,
}: {
  sport: string;
  // "" for every competition.
  value: string;
  competitions: readonly string[];
  onChange: (competition: string) => void;
}) {
  return (
    <Dropdown label="Wettbewerb" summary={value || "Alle"}>
      <MenuGroup legend="Wettbewerb">
        <CompetitionPicker
          sport={sport}
          value={value}
          competitions={competitions}
          onChange={onChange}
          autoFocusSearch
          renderOption={(choice) => (
            <MenuOption
              key={choice.value}
              type="radio"
              name="competition"
              checked={choice.value === value}
              onChange={() => onChange(choice.value)}
              closeOnPick
            >
              {choice.label}
            </MenuOption>
          )}
        />
      </MenuGroup>
    </Dropdown>
  );
}
