// Basic strategy, worked out from the rules instead of copied from a chart: the expected value of every move for every
// hand against every dealer upcard, with cards drawn from an infinite deck (every rank always 1 in 13, tens 4 in 13).
// Where the dealer peeks for blackjack, every number here is for a round where the dealer turned out not to have one;
// in the no-hole-card game the dealer's blackjack is one of the dealer's outcomes and takes doubles and splits too.
//
// A finite shoe changes the odds a little as cards come out, so the calls that are close here can flip in a real shoe;
// the app shows how close each call is (the gap in expected value between the best move and the next) for that reason.
import { RULES, points, handTotal, canDoubleTotal } from "./engine.mjs";

/** The card values 2 to 11 (an ace as 11) and how likely each is off an infinite deck. */
export const DRAWS = [[2, 1 / 13], [3, 1 / 13], [4, 1 / 13], [5, 1 / 13], [6, 1 / 13], [7, 1 / 13], [8, 1 / 13], [9, 1 / 13], [10, 4 / 13], [11, 1 / 13]];
const P = (v) => (v === 10 ? 4 / 13 : 1 / 13);
/** Add a card to a total; `soft` is whether an ace in the hand still counts 11. */
export function add(total, soft, v) {
  if (v === 11) return total + 11 <= 21 ? [total + 11, true] : [total + 1, soft];
  const t = total + v; return t > 21 && soft ? [t - 10, false] : [t, soft];
}
/** The chance the dealer has blackjack under an upcard of this value. */
export const dealerBlackjackChance = (up) => (up === 11 ? P(10) : up === 10 ? P(11) : 0);

/**
 * Where the dealer ends up from an upcard (2 to 11): a map from 17 to 21 and "bust" to probability. With a hole card the
 * dealer has peeked, so the second card is drawn from the deck less the card that would have made blackjack; without
 * one, blackjack is an outcome of its own ("bj").
 */
export function dealerOutcomes(up, rules = RULES) {
  const out = { 17: 0, 18: 0, 19: 0, 20: 0, 21: 0, bust: 0 }, peeked = rules.holeCard !== false;
  if (!peeked) out.bj = 0;
  const play = (t, s, p) => {
    if (t > 21) { out.bust += p; return; }
    if (t >= 17 && !(t === 17 && s && rules.hitSoft17)) { out[t] += p; return; }
    for (const [v, q] of DRAWS) { const [t2, s2] = add(t, s, v); play(t2, s2, p * q); }
  };
  const [t0, s0] = add(0, false, up), banned = up === 11 ? 10 : up === 10 ? 11 : null, rest = peeked && banned ? 1 - P(banned) : 1;
  for (const [v, q] of DRAWS) {
    if (v === banned && peeked) continue;
    const [t, s] = add(t0, s0, v);
    if (v === banned) out.bj += q; else play(t, s, q / rest);
  }
  return out;
}

/** Everything about one dealer upcard under one set of rules: stand, hit, double and split values, memoised. */
export class Table {
  constructor(up, rules = RULES) {
    this.up = up; this.rules = { ...RULES, ...rules }; this.dealer = dealerOutcomes(up, this.rules); this.hitMemo = new Map(); this.splitMemo = new Map();
  }
  stand(t) {
    if (t > 21) return -1;
    const d = this.dealer; let ev = d.bust - (d.bj ?? 0);
    for (const o of [17, 18, 19, 20, 21]) ev += d[o] * (t > o ? 1 : t === o ? 0 : -1);
    return ev;
  }
  /** Hitting, then playing on as well as possible (hit or stand only). */
  hit(t, s) {
    const key = t * 2 + (s ? 1 : 0); if (this.hitMemo.has(key)) return this.hitMemo.get(key);
    let ev = 0; for (const [v, q] of DRAWS) { const [t2, s2] = add(t, s, v); ev += q * (t2 > 21 ? -1 : Math.max(this.stand(t2), this.hit(t2, s2))); }
    this.hitMemo.set(key, ev); return ev;
  }
  /** Doubling: twice the bet, one card, then stand. */
  double(t, s) { let ev = 0; for (const [v, q] of DRAWS) { const [t2] = add(t, s, v); ev += q * this.stand(t2); } return 2 * ev; }
  /** The best of the moves a two-card hand has, without splitting. */
  bestTwoCard(t, s, { canDouble = true, canSurrender = false } = {}) {
    const ev = { stand: this.stand(t), hit: this.hit(t, s) };
    if (canDouble) ev.double = this.double(t, s);
    if (canSurrender) ev.surrender = -0.5;
    return ev;
  }
  /**
   * Splitting a pair of value v when the seat will then have `handsAfter` hands. Each new hand takes a card: a card that
   * is not v makes a hand played on as well as possible (doubling only if the rules allow it after a split; split aces
   * get one card each unless they may be hit); another v may be split again while the seat has fewer than `maxHands`
   * hands (aces only if `resplitAces`), and is when that is worth more. With every card independent (an infinite deck)
   * the hands waiting for a card are all alike, so f(h, k), the value of k waiting hands with h hands in all, is exact:
   *   f(h, k) = p max(f(h + 1, k + 1), Evv + f(h, k - 1)) + (1 - p) (Enot + f(h, k - 1)), the max only while h < maxHands.
   */
  split(v, handsAfter = 2) {
    const key = v * 16 + handsAfter; if (this.splitMemo.has(key)) return this.splitMemo.get(key);
    const r = this.rules, aces = v === 11, M = aces && !r.resplitAces ? Math.min(2, r.maxHands) : r.maxHands, p = P(v), [t0, s0] = add(0, false, v);
    const after = (c) => {
      const [t, s] = add(t0, s0, c);
      if (aces && !r.hitSplitAces) return this.stand(t);
      return Math.max(...Object.values(this.bestTwoCard(t, s, { canDouble: r.das && canDoubleTotal(t, r) })));
    };
    let Enot = 0; for (const [c, q] of DRAWS) if (c !== v) Enot += q * after(c); Enot /= 1 - p;
    const Evv = after(v), memo = new Map();
    const f = (h, k) => {
      if (k === 0) return 0;
      const id = h * 64 + k; if (memo.has(id)) return memo.get(id);
      const keep = Evv + f(h, k - 1), x = p * (h < M ? Math.max(f(h + 1, k + 1), keep) : keep) + (1 - p) * (Enot + f(h, k - 1));
      memo.set(id, x); return x;
    };
    const ev = f(handsAfter, 2); this.splitMemo.set(key, ev); return ev;
  }
}

const tables = new Map();
const ruleKey = (r) => [r.hitSoft17, r.das, r.hitSplitAces, r.resplitAces, r.maxHands, r.doubleOn, r.holeCard].join("|");
/** A cached Table for an upcard value and rules. */
export function table(up, rules = RULES) {
  const r = { ...RULES, ...rules }, key = `${up}|${ruleKey(r)}`;
  if (!tables.has(key)) tables.set(key, new Table(up, r));
  return tables.get(key);
}

/**
 * The expected value of each move open to a hand right now (moves as Round.options() names them), best first.
 * `handsNow` is how many hands the seat has, which limits splitting again.
 */
export function evaluate(cards, upRank, options, rules = RULES, handsNow = 1) {
  const T = table(points(upRank), rules), { total, soft } = handTotal(cards), ev = {};
  if (options.includes("stand")) ev.stand = T.stand(total);
  if (options.includes("hit")) ev.hit = T.hit(total, soft);
  if (options.includes("double")) ev.double = T.double(total, soft);
  if (options.includes("surrender")) ev.surrender = -0.5;
  if (options.includes("split")) ev.split = T.split(points(cards[0].rank), handsNow + 1);
  return Object.entries(ev).sort((a, b) => b[1] - a[1]);
}

/**
 * The player's expected return per unit bet over a whole round played by this strategy, insurance never taken, with
 * every card off an infinite deck: every first two cards against every upcard, a blackjack paid unless the dealer has
 * one too. Negative is the house's edge. A real shoe of a few decks returns a little more than this.
 */
export function houseEdge(rules = RULES) {
  const r = { ...RULES, ...rules }; let ev = 0;
  for (const [u, qu] of DRAWS) {
    const T = table(u, r), bj = dealerBlackjackChance(u);
    for (const [a, qa] of DRAWS) for (const [b, qb] of DRAWS) {
      const p = qu * qa * qb, [t1, s1] = add(0, false, a), [t, s] = add(t1, s1, b);
      if (t === 21) { ev += p * (1 - bj) * r.blackjackPays; continue; }
      const moves = T.bestTwoCard(t, s, { canDouble: canDoubleTotal(t, r), canSurrender: r.lateSurrender && r.holeCard });
      if (a === b) moves.split = T.split(a);
      const best = Math.max(...Object.values(moves));
      ev += r.holeCard ? p * (-bj + (1 - bj) * best) : p * best;
    }
  }
  return ev;
}

const UPS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
/** One chart cell: the code a strategy card prints (H, S, D, Ds, P, Rh, Rs, Rp) and the gap to the next best move. */
function cell(ev) {
  const sorted = Object.entries(ev).sort((a, b) => b[1] - a[1]), [best] = sorted[0], gap = sorted[0][1] - sorted[1][1];
  const fallback = (keys) => { const f = sorted.find(([k]) => keys.includes(k)); return f ? f[0] : "hit"; };
  const letter = { hit: "H", stand: "S", split: "P" };
  if (best === "double") return { code: fallback(["hit", "stand"]) === "stand" ? "Ds" : "D", gap, ev };
  if (best === "surrender") { const f = fallback(["hit", "stand", "split"]); return { code: "R" + letter[f].toLowerCase(), gap, ev }; }
  return { code: letter[best], gap, ev };
}
/** The whole chart for a set of rules: hard 5 to 20, soft 13 to 20, and every pair, against 2 to ace. */
export function chart(rules = RULES) {
  const r = { ...RULES, ...rules }, rows = { hard: [], soft: [], pairs: [] }, sur = r.lateSurrender && r.holeCard;
  const two = (u, t, s) => table(u, r).bestTwoCard(t, s, { canSurrender: sur, canDouble: canDoubleTotal(t, r) });
  for (let t = 5; t <= 20; t++) rows.hard.push({ label: String(t), cells: UPS.map((u) => cell(two(u, t, false))) });
  for (let t = 13; t <= 20; t++) rows.soft.push({ label: `A,${t - 11}`, cells: UPS.map((u) => cell(two(u, t, true))) });
  for (const v of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
    const [t, s] = add(...add(0, false, v), v);
    rows.pairs.push({ label: v === 11 ? "A,A" : v === 10 ? "10,10" : `${v},${v}`, cells: UPS.map((u) => cell({ ...two(u, t, s), split: table(u, r).split(v) })) });
  }
  return { ups: UPS, rows };
}
