import type { EventSort } from "../api";
import { Dropdown, MenuGroup, MenuOption } from "./Dropdown";
import { SORT_LABELS } from "./filterOptions";

// "Sort: Best payout", opening on the given sort orders: "Best value"
// for the sports the reference prices, and first in the value bets' category.
// A click on one picks it and closes the menu; the arrow keys go through them.
export function SortMenu({
  value,
  onChange,
  orders = ["trj", "start"],
}: {
  value: EventSort;
  onChange: (sort: EventSort) => void;
  orders?: readonly EventSort[];
}) {
  const current = orders.includes(value) ? value : orders[0];
  return (
    <Dropdown label="Sort" summary={SORT_LABELS[current]}>
      <MenuGroup legend="Sort by">
        {orders.map((order) => (
          <MenuOption
            key={order}
            type="radio"
            name="sort"
            checked={order === value}
            onChange={() => onChange(order)}
            closeOnPick
          >
            {SORT_LABELS[order]}
          </MenuOption>
        ))}
      </MenuGroup>
    </Dropdown>
  );
}
