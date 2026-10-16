// The German betting tax (5% of the stake at LeoVegas.de and Merkur Bets,
// 15/10/2026) taken off the stake: a price pays price × (1 - tax) for the stake
// bet. The scrapers store their prices net of it, the ones every comparison is
// about. To the thousandth: 2.00 is 1.90 at 5%. A missing price stays missing.
export const netOfStakeTax = (price: number, tax: number): number =>
  Number.isFinite(price) ? Math.round(price * (1 - tax) * 1000) / 1000 : price;
