import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePreferencesSync, SAVE_DELAY_MS } from "./usePreferencesSync";
import type { Preferences } from "./preferences";

const save = vi.fn();
vi.mock("./preferences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./preferences")>()),
  savePreferences: (preferences: Preferences) => save(preferences),
}));

const BASE: Preferences = { sport: "football", sort: "trj", bookmakers: ["leovegas"], players: false, favoriteSports: [] };

beforeEach(() => {
  vi.useFakeTimers();
  save.mockReset().mockResolvedValue(true);
});
afterEach(() => vi.useRealTimers());

const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe("usePreferencesSync", () => {
  it("saves nothing on mount: opening a link must not rewrite the saved filters", async () => {
    renderHook(() => usePreferencesSync(BASE, true));
    await wait(SAVE_DELAY_MS * 3);
    expect(save).not.toHaveBeenCalled();
  });

  it("saves once the filters settle, with all of them", async () => {
    const { rerender } = renderHook(({ current }) => usePreferencesSync(current, true), { initialProps: { current: BASE } });

    rerender({ current: { ...BASE, sport: "tennis" } });
    await wait(SAVE_DELAY_MS - 1);
    expect(save).not.toHaveBeenCalled();
    rerender({ current: { ...BASE, sport: "tennis", players: true } });
    await wait(SAVE_DELAY_MS - 1);
    expect(save).not.toHaveBeenCalled();
    await wait(1);

    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith({ ...BASE, sport: "tennis", players: true });
  });

  it("saves nothing when the filters come back to where they were before the delay", async () => {
    const { rerender } = renderHook(({ current }) => usePreferencesSync(current, true), { initialProps: { current: BASE } });
    rerender({ current: { ...BASE, sport: "tennis" } });
    await wait(SAVE_DELAY_MS / 2);
    rerender({ current: BASE });
    await wait(SAVE_DELAY_MS * 2);
    expect(save).not.toHaveBeenCalled();
  });

  it("doesn't save the same filters twice", async () => {
    const { rerender } = renderHook(({ current }) => usePreferencesSync(current, true), { initialProps: { current: BASE } });
    rerender({ current: { ...BASE, sort: "start" } });
    await wait(SAVE_DELAY_MS);
    rerender({ current: { ...BASE, sort: "start" } });
    await wait(SAVE_DELAY_MS);
    expect(save).toHaveBeenCalledOnce();
  });

  it("waits to be enabled, and takes the filters then as the ones to compare to", async () => {
    // The sport list isn't in yet: App will correct a sport that has no matches
    // once it is, which is not a choice of the visitor.
    const { rerender } = renderHook(({ current, enabled }) => usePreferencesSync(current, enabled), {
      initialProps: { current: { ...BASE, sport: "golf" }, enabled: false },
    });
    rerender({ current: { ...BASE, sport: "football" }, enabled: false });
    rerender({ current: { ...BASE, sport: "football" }, enabled: true });
    await wait(SAVE_DELAY_MS * 2);
    expect(save).not.toHaveBeenCalled();

    rerender({ current: { ...BASE, sport: "football", sort: "start" }, enabled: true });
    await wait(SAVE_DELAY_MS);
    expect(save).toHaveBeenCalledOnce();
  });

  it("drops a save still waiting when the page goes away", async () => {
    const { rerender, unmount } = renderHook(({ current }) => usePreferencesSync(current, true), { initialProps: { current: BASE } });
    rerender({ current: { ...BASE, sport: "tennis" } });
    unmount();
    await wait(SAVE_DELAY_MS * 2);
    expect(save).not.toHaveBeenCalled();
  });
});
