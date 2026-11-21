/** The one fee ladder: the pricing page cards and the product-page fee calculator both read this. */
export const LADDER = [
  { name: 'Free', monthly: 0, feePct: 1.0 },
  { name: 'Pro', monthly: 9.99, feePct: 0.5 },
  { name: 'Premium', monthly: 29.99, feePct: 0.3 },
  { name: 'Enterprise', monthly: null, feePct: 0.1 }, // quoted, not self-serve
] as const;
export type LadderName = (typeof LADDER)[number]['name'];
const row = (n: LadderName) => LADDER.find((t) => t.name === n)!;
export const tierPrice = (n: LadderName) => { const m = row(n).monthly; return m === null ? 'Custom' : m === 0 ? '$0' : `$${m.toFixed(2)}`; };
export const tierFee = (n: LadderName) => `${row(n).feePct.toFixed(1)}%`;
