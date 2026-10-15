import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  MAX_FAVORITES,
  canAddFavorite,
  loadFavorites,
  orderSports,
  saveFavorites,
  toggleFavorite,
  useFavoriteSports,
} from "./favoriteSports";

const KEY = "coteradar.favoriteSports";

describe("orderSports", () => {
  const sports = ["basketball", "football", "golf", "tennis"];

  it("puts the favorites first, in the order they were starred, then the others as they came", () => {
    expect(orderSports(sports, ["tennis", "basketball"])).toEqual(["tennis", "basketball", "football", "golf"]);
  });

  it("leaves the sports alone when there is no favorite", () => {
    expect(orderSports(sports, [])).toEqual(sports);
  });

  it("leaves out a favorite that has no odds today, without losing a sport", () => {
    expect(orderSports(["football", "tennis"], ["golf", "tennis"])).toEqual(["tennis", "football"]);
  });
});

describe("canAddFavorite", () => {
  it("is open while there are fewer than three", () => {
    expect(canAddFavorite([], [])).toBe(true);
    expect(canAddFavorite(["football", "tennis"], ["football", "tennis", "golf"])).toBe(true);
  });

  it("is closed at three, all of them shown", () => {
    expect(MAX_FAVORITES).toBe(3);
    expect(canAddFavorite(["football", "tennis", "golf"], ["football", "tennis", "golf", "rugby"])).toBe(false);
  });

  it("stays open at three while one of them is not shown: it can make room", () => {
    expect(canAddFavorite(["football", "tennis", "golf"], ["football", "tennis", "rugby"])).toBe(true);
  });
});

describe("toggleFavorite", () => {
  const available = ["football", "tennis", "golf", "rugby", "handball"];

  it("adds a sport at the end", () => {
    expect(toggleFavorite(["football"], "tennis", available)).toEqual(["football", "tennis"]);
  });

  it("removes a sport that is one already, and keeps the others' order", () => {
    expect(toggleFavorite(["football", "tennis", "golf"], "tennis", available)).toEqual(["football", "golf"]);
  });

  it("refuses a fourth one", () => {
    const favorites = ["football", "tennis", "golf"];
    expect(toggleFavorite(favorites, "rugby", available)).toEqual(favorites);
  });

  it("still removes one at three", () => {
    expect(toggleFavorite(["football", "tennis", "golf"], "golf", available)).toEqual(["football", "tennis"]);
  });

  it("makes room by dropping the oldest favorite that has no odds today", () => {
    // Biathlon and cycling are not in `available`: biathlon is the older.
    expect(toggleFavorite(["biathlon", "football", "cyclisme"], "rugby", available)).toEqual([
      "football",
      "cyclisme",
      "rugby",
    ]);
  });

  it("keeps a favorite that has no odds today while there is room", () => {
    expect(toggleFavorite(["biathlon", "football"], "rugby", available)).toEqual(["biathlon", "football", "rugby"]);
  });

  it("does not change the list it is given", () => {
    const favorites = ["football"];
    toggleFavorite(favorites, "tennis", available);
    expect(favorites).toEqual(["football"]);
  });
});

describe("the stored favorites", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("start empty", () => {
    expect(loadFavorites()).toEqual([]);
  });

  it("come back as they were saved", () => {
    saveFavorites(["tennis", "football"]);

    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(["tennis", "football"]);
    expect(loadFavorites()).toEqual(["tennis", "football"]);
  });

  it("are empty again when what is stored is not a list", () => {
    localStorage.setItem(KEY, "{not json");
    expect(loadFavorites()).toEqual([]);
    localStorage.setItem(KEY, JSON.stringify({ football: true }));
    expect(loadFavorites()).toEqual([]);
  });

  it("keep only the sports' names, once each, at most three", () => {
    localStorage.setItem(KEY, JSON.stringify(["football", 3, null, "football", "tennis", "golf", "rugby"]));

    expect(loadFavorites()).toEqual(["football", "tennis", "golf"]);
  });

  it("don't break the page when the browser refuses its storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });

    expect(loadFavorites()).toEqual([]);
    expect(() => saveFavorites(["football"])).not.toThrow();
  });
});

describe("useFavoriteSports", () => {
  const available = ["football", "tennis", "golf", "rugby"];

  afterEach(() => localStorage.clear());

  it("starts from the stored favorites", () => {
    saveFavorites(["tennis"]);

    const { result } = renderHook(() => useFavoriteSports(available));

    expect(result.current.favorites).toEqual(["tennis"]);
  });

  it("toggles a sport and stores the result", () => {
    const { result } = renderHook(() => useFavoriteSports(available));

    act(() => result.current.toggle("golf"));
    act(() => result.current.toggle("football"));
    expect(result.current.favorites).toEqual(["golf", "football"]);
    expect(loadFavorites()).toEqual(["golf", "football"]);

    act(() => result.current.toggle("golf"));
    expect(result.current.favorites).toEqual(["football"]);
    expect(loadFavorites()).toEqual(["football"]);
  });

  it("says whether one more can be added", () => {
    const { result } = renderHook(() => useFavoriteSports(available));
    expect(result.current.canAdd).toBe(true);

    act(() => result.current.toggle("football"));
    act(() => result.current.toggle("tennis"));
    act(() => result.current.toggle("golf"));

    expect(result.current.canAdd).toBe(false);
  });

  it("judges the room against the sports there are when it is asked, not when it was rendered", () => {
    saveFavorites(["biathlon", "football", "tennis"]);
    const { result, rerender } = renderHook(({ sports }) => useFavoriteSports(sports), {
      initialProps: { sports: [] as string[] },
    });
    // Nothing is shown yet: all three are "absent", so there is room.
    expect(result.current.canAdd).toBe(true);

    rerender({ sports: ["football", "tennis", "golf"] });
    // Biathlon is the one that has no odds: it makes room for golf.
    expect(result.current.canAdd).toBe(true);
    act(() => result.current.toggle("golf"));

    expect(result.current.favorites).toEqual(["football", "tennis", "golf"]);
  });
});

describe("useFavoriteSports with the account's favorites", () => {
  const available = ["football", "tennis", "golf", "rugby"];

  afterEach(() => localStorage.clear());

  it("starts from them rather than from this browser's, which keeps a copy", () => {
    saveFavorites(["golf"]);

    const { result } = renderHook(() => useFavoriteSports(available, ["tennis"]));

    expect(result.current.favorites).toEqual(["tennis"]);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(["tennis"]);
  });

  it("starts from the account's even when it has none: that was the choice", () => {
    saveFavorites(["golf"]);

    const { result } = renderHook(() => useFavoriteSports(available, []));

    expect(result.current.favorites).toEqual([]);
  });

  it("starts from this browser's when the account has nothing saved", () => {
    saveFavorites(["golf"]);

    const { result } = renderHook(() => useFavoriteSports(available, undefined));

    expect(result.current.favorites).toEqual(["golf"]);
  });
});
