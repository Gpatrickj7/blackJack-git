// The other players at the table, and how a player bets with the count. Each style is a plain rule; only "book" and
// "counter" play the computed basic strategy.
import { handTotal } from "./engine.mjs";
import { evaluate } from "./strategy.mjs";

export const STYLES = {
  book: { label: "Book", note: "basic strategy, flat bets" },
  counter: { label: "Counter", note: "basic strategy, bets up with the true count, insures at +3" },
  hunch: { label: "Never-bust", note: "stands on 12 or more, never doubles or splits" },
  mimic: { label: "Copycat", note: "hits to 17 like the dealer, never doubles or splits" },
  wild: { label: "Gut feel", note: "splits every pair, doubles 9 to 11, hits to 16, always insures" },
};

/** What a player of this style does with the hand in play. */
export function botMove(style, round) {
  const opts = round.options(), h = round.hand, { total, soft } = handTotal(h.cards), can = (m) => opts.includes(m);
  if (style === "hunch") return can("hit") && total < 12 ? "hit" : "stand";
  if (style === "mimic") return can("hit") && (total < 17 || (total === 17 && soft && round.rules.hitSoft17)) ? "hit" : "stand";
  if (style === "wild") { if (can("split")) return "split"; if (can("double") && total >= 9 && total <= 11) return "double"; return can("hit") && total < 16 ? "hit" : "stand"; }
  return evaluate(h.cards, round.upcard.rank, opts, round.rules, round.handsOf(h.seat).length)[0][0];
}
/** Whether a player of this style takes insurance at this true count. */
export const botInsures = (style, tc) => style === "wild" || (style === "counter" && tc >= 3);

/** A bet ramp: [true count from, units] pairs in rising order. The default is chosen, not a recommendation. */
export const SPREAD = [[-99, 1], [2, 2], [3, 4], [4, 6], [5, 8]];
/** The units a ramp bets at a true count. */
export function betFor(spread, tc) { let u = spread[0]?.[1] ?? 1; for (const [t, units] of spread) if (tc >= t) u = units; return u; }
