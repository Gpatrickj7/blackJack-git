// The other players at the table, and how a player bets with the count. Each style is a plain rule; "book" and "counter"
// play the computed basic strategy, "regular" and "novice" play it but slip. What each loses a hand is measured in
// test.mjs (the same 100,000 rounds for every style, the rules' defaults, flat bets, no count).
import { handTotal } from "./engine.mjs";
import { evaluate } from "./strategy.mjs";

export const STYLES = {
  book: { label: "Book", note: "basic strategy, flat bets; loses about 1% of each bet", slip: 0 },
  regular: { label: "Regular", note: "plays the book but takes the second-best move one decision in twelve; loses about 4%", slip: 1 / 12 },
  novice: { label: "Novice", note: "knows the basics, takes the second-best move one decision in three; loses about 13%", slip: 1 / 3 },
  counter: { label: "Counter", note: "basic strategy, bets up with the true count, insures at +3" },
  hunch: { label: "Never-bust", note: "stands on 12 or more, never doubles or splits; loses about 8%" },
  mimic: { label: "Copycat", note: "hits to 17 like the dealer, never doubles or splits; loses about 7%" },
  wild: { label: "Gut feel", note: "splits every pair, doubles 9 to 11, hits to 16, always insures; loses about 12%" },
};

/** What a player of this style does with the hand in play. `rnd` is the player's own dice (for the styles that slip). */
export function botMove(style, round, rnd = Math.random) {
  const opts = round.options(), h = round.hand, { total, soft } = handTotal(h.cards), can = (m) => opts.includes(m);
  if (style === "hunch") return can("hit") && total < 12 ? "hit" : "stand";
  if (style === "mimic") return can("hit") && (total < 17 || (total === 17 && soft && round.rules.hitSoft17)) ? "hit" : "stand";
  if (style === "wild") { if (can("split")) return "split"; if (can("double") && total >= 9 && total <= 11) return "double"; return can("hit") && total < 16 ? "hit" : "stand"; }
  const ranked = evaluate(h.cards, round.upcard.rank, opts, round.rules, round.handsOf(h.seat).length);
  return ranked.length > 1 && rnd() < (STYLES[style]?.slip ?? 0) ? ranked[1][0] : ranked[0][0];
}
/** Whether a player of this style takes insurance at this true count. */
export const botInsures = (style, tc) => style === "wild" || (style === "counter" && tc >= 3);

/** A bet ramp: [true count from, units] pairs in rising order. The default is chosen, not a recommendation. */
export const SPREAD = [[-99, 1], [2, 2], [3, 4], [4, 6], [5, 8]];
/** The units a ramp bets at a true count. */
export function betFor(spread, tc) { let u = spread[0]?.[1] ?? 1; for (const [t, units] of spread) if (tc >= t) u = units; return u; }
