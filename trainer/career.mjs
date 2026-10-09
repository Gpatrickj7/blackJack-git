// Career mode: a bankroll, tables with their own rules and limits that open as the bankroll grows, and heat. All of it
// is a game made up for this app: the tables are not any real casino's, and heat is a game rule, not a model of how a
// real casino watches its players.
export const START = 1000;

/** The tables, cheapest first. `unlock` is the bankroll that opens one; once open it stays open. */
export const TABLES = [
  { id: "shuffler", name: "Shuffle machine", min: 5, max: 500, unlock: 0, note: "6:5 blackjacks and a continuous shuffler: the count never builds",
    rules: { decks: 6, hitSoft17: true, blackjackPays: 1.2, das: true, lateSurrender: false, csm: true } },
  { id: "downtown", name: "Downtown", min: 5, max: 500, unlock: 0, note: "six decks, the dealer hits soft 17",
    rules: { decks: 6, hitSoft17: true, blackjackPays: 1.5, das: true, lateSurrender: false, penetration: 0.75 } },
  { id: "main", name: "Main floor", min: 10, max: 1000, unlock: 1500, note: "six decks, stands on soft 17, late surrender",
    rules: { decks: 6, hitSoft17: false, blackjackPays: 1.5, das: true, lateSurrender: true, penetration: 0.75 } },
  { id: "euro", name: "European room", min: 10, max: 1000, unlock: 1500, note: "no hole card: a dealer blackjack takes doubles and splits; double on 9 to 11",
    rules: { decks: 6, hitSoft17: false, blackjackPays: 1.5, das: true, lateSurrender: false, holeCard: false, doubleOn: "9-11", penetration: 0.75 } },
  { id: "double", name: "Double deck", min: 25, max: 2500, unlock: 3000, note: "two decks dealt to 65%",
    rules: { decks: 2, hitSoft17: true, blackjackPays: 1.5, das: true, lateSurrender: false, penetration: 0.65 } },
  { id: "single", name: "Single deck", min: 50, max: 2500, unlock: 6000, note: "one deck to 60%, no double after split, one split",
    rules: { decks: 1, hitSoft17: true, blackjackPays: 1.5, das: false, lateSurrender: false, maxHands: 2, penetration: 0.6 } },
  { id: "high", name: "High limit", min: 100, max: 10000, unlock: 20000, note: "six decks to 83%, surrender, resplit aces",
    rules: { decks: 6, hitSoft17: false, blackjackPays: 1.5, das: true, lateSurrender: true, resplitAces: true, penetration: 0.83 } },
];

/** Heat at full: the pit asks you to leave that table for COOLDOWN rounds played elsewhere. */
export const BACKOFF = 100, COOLDOWN = 60;
/**
 * Heat after a round: it cools by 2 a round, and warms when the bet goes up while the true count is +2 or more (12 for
 * every doubling of the bet), and by 4 more for a bet of eight table minimums or more at such a count.
 */
export function heatAfter(heat, { bet, prevBet, min, tc }) {
  let h = Math.max(0, heat - 2);
  if (tc >= 2 && prevBet > 0 && bet > prevBet) h += 12 * Math.log2(bet / prevBet);
  if (tc >= 2 && bet >= 8 * min) h += 4;
  return Math.min(BACKOFF, h);
}
