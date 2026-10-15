export type PageItem = number | "gap";

// The pages to offer: the first, the last, and the current one with its
// neighbours; "…" stands for the others. A gap that would hide a single page
// shows that page instead.
export function pageWindow(page: number, lastPage: number): PageItem[] {
  const pages = [...new Set([1, page - 1, page, page + 1, lastPage])]
    .filter((p) => p >= 1 && p <= lastPage)
    .sort((a, b) => a - b);
  const items: PageItem[] = [];
  for (const p of pages) {
    const previous = items.at(-1);
    if (typeof previous === "number" && p - previous === 2) items.push(previous + 1);
    else if (typeof previous === "number" && p - previous > 2) items.push("gap");
    items.push(p);
  }
  return items;
}
