import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import styles from "./Dropdown.module.css";

const MenuContext = createContext<{ closeAfterPick: () => void } | null>(null);

// A button that sums up a filter ("Tri : Meilleur TRJ") and opens its options
// in a panel underneath. The options stay native radio buttons and checkboxes
// (MenuGroup, MenuOption). Escape, a click outside or tabbing away closes it.
export function Dropdown({ label, summary, children }: { label: string; summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Whether the last action in the panel came from a mouse or a finger rather
  // than the keyboard, whose arrow keys pick a radio button on each press.
  const pointerRef = useRef(false);
  const panelId = useId();

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  // On opening: keep the panel on screen, then go to the current option, so
  // that the arrow keys work straight away.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    if (panel.getBoundingClientRect().right > document.documentElement.clientWidth) {
      panel.dataset.align = "end";
    }
    (panel.querySelector<HTMLElement>("input:checked") ?? panel.querySelector<HTMLElement>("input"))?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={styles.root}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          close();
        }
      }}
      onBlur={(event) => {
        // Only towards another element: switching windows keeps it open.
        const next = event.relatedTarget;
        if (open && next && !rootRef.current?.contains(next)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={styles.button}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
      >
        {label}: <span className={styles.summary}>{summary}</span>
        <ChevronDown size={16} className={styles.chevron} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          className={styles.panel}
          onPointerDown={() => {
            pointerRef.current = true;
          }}
          onKeyDown={(event) => {
            pointerRef.current = false;
            // On an option, not on a search field or a button of the panel.
            if (event.key === "Enter" && (event.target as HTMLInputElement).type?.match(/^(radio|checkbox)$/)) {
              event.preventDefault();
              close();
            }
          }}
        >
          <MenuContext
            value={{
              closeAfterPick: () => {
                if (pointerRef.current) close();
              },
            }}
          >
            {children}
          </MenuContext>
        </div>
      )}
    </div>
  );
}

// The options of a Dropdown, named for screen readers.
export function MenuGroup({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className={styles.group}>
      <legend className="visually-hidden">{legend}</legend>
      {children}
    </fieldset>
  );
}

// One option: a native radio button or checkbox and its label. `closeOnPick`
// closes the menu once a click picks it; the keyboard closes it with Enter.
export function MenuOption({
  type,
  name,
  checked,
  onChange,
  closeOnPick = false,
  children,
}: {
  type: "radio" | "checkbox";
  name?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  closeOnPick?: boolean;
  children: ReactNode;
}) {
  const menu = useContext(MenuContext);
  return (
    <label className={styles.option}>
      <input
        type={type}
        name={name}
        className={styles.input}
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked);
          if (closeOnPick) menu?.closeAfterPick();
        }}
      />
      {children}
    </label>
  );
}
