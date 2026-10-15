import { vi } from "vitest";

// jsdom has no matchMedia: the components then render the desktop's layout
// (useIsWide). A test of the phone's layout calls this first;
// vi.unstubAllGlobals puts things back.
export function mockPhone() {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: !/min-width/.test(query),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList
  );
}
