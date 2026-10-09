// Basic strategy, worked out from the rules instead of copied from a chart: the expected value of every move for every
// hand against every dealer upcard, with cards drawn from an infinite deck (every rank always 1 in 13, tens 4 in 13).
// The dealer peeks for blackjack, so every number here is for a round where the dealer turned out not to have one.
//
// A finite shoe changes the odds a little as cards come out, so the calls that are close here can flip in a real shoe;
// the app shows how close each call is (the gap in expected value between the best move and the next) for that reason.
import { RULES, points, handTotal } from "./engine.mjs";

/** The card values 2 to 11 (an ace as 11) and how likely each is off an infinite deck. */
export const DRAWS = [[2, 1 / 13], [3, 1 / 13], [4, 1 / 13], [5, 1 / 13], [6, 1 / 13], [7, 1 / 13], [8, 1 / 13], [9, 1 / 13], [10, 4 / 13], [11, 1 / 13]];
/** Add a card to a total; `soft` is whether an ace in the hand still counts 11. */
export function add(total, soft, v) {
  if (v === 11) return total + 11 <= 21 ? [total + 11, true] : [total + 1, soft];
  const t = total + v; return t > 21 && soft ? [t - 10, false] : [t, soft];
}

/**
 * Where the dealer ends up from an upcard (2 to 11), given no blackjack: a map from 17 to 21 and "bust" to probability.
 * The hole card is drawn from the deck less the card that would have made blackjack.
 */
export function dealerOutcomes(up, rules = RULES) {
  const out = { 17: 0, 18: 0, 19: 0, 20: 0, 21: 0, bust: 0 };
  const play = (t, s, p) => {
    if (t > 21) { out.bust += p; return; }
    if (t >= 17 && !(t === 17 && s && rules.hitSoft17)) { out[t] += p; return; }
    for (const [v, q] of DRAWS) { const [t2, s2] = add(t, s, v); play(t2, s2, p * q); }
  };
  const [t0, s0] = add(0, false, up), banned = up === 11 ? 10 : up === 10 ? 11 : null, rest = 1 - (banned ? DRAWS.find(([v]) => v === banned)[1] : 0);
  for (const [v, q] of DRAWS) { if (v === banned) continue; const [t, s] = add(t0, s0, v); play(t, s, q / rest); }
  return out;
}

/** Everything about one dealer upcard under one set of rules: stand, hit, double and split values, memoised. */
export class Table {
  constructor(up, rules = RULES) {
    this.up = up; this.rules = { ...RULES, ...rules }; this.dealer = dealerOutcomes(up, this.rules); this.hitMemo = new Map();
  }
  stand(t) {
    if (t > 21) return -1;
    const d = this.dealer; let ev = d.bust;
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
   * Splitting a pair of value v: two hands, each starting from one card and played on as well as possible (doubling only
   * if the rules allow it after a split; split aces get one card each). A second split is not counted, which makes this
   * a slight underestimate where resplitting is allowed.
   */
  split(v) {
    const [t0, s0] = add(0, false, v); let one = 0;
    for (const [c, q] of DRAWS) {
      const [t, s] = add(t0, s0, c);
      if (v === 11 && !this.rules.hitSplitAces) { one += q * this.stand(t); continue; }
      const e = this.bestTwoCard(t, s, { canDouble: this.rules.das });
      one += q * Math.max(...Object.values(e));
    }
    return 2 * one;
  }
}

const tables = new Map();
/** A cached Table for an upcard value and rules. */
export function table(up, rules = RULES) {
  const r = { ...RULES, ...rules }, key = `${up}|${r.hitSoft17}|${r.das}|${r.hitSplitAces}`;
  if (!tables.has(key)) tables.set(key, new Table(up, r));
  return tables.get(key);
}

/**
 * The expected value of each move open to a hand right now (moves as Round.options() names them), best first.
 * `hand` is the cards; `fromSplit` stops surrender.
 */
export function evaluate(cards, upRank, options, rules = RULES) {
  const T = table(points(upRank), rules), { total, soft } = handTotal(cards), ev = {};
  if (options.includes("stand")) ev.stand = T.stand(total);
  if (options.includes("hit")) ev.hit = T.hit(total, soft);
  if (options.includes("double")) ev.double = T.double(total, soft);
  if (options.includes("surrender")) ev.surrender = -0.5;
  if (options.includes("split")) ev.split = T.split(points(cards[0].rank));
  return Object.entries(ev).sort((a, b) => b[1] - a[1]);
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
  const r = { ...RULES, ...rules }, rows = { hard: [], soft: [], pairs: [] };
  for (let t = 5; t <= 20; t++) rows.hard.push({ label: String(t), cells: UPS.map((u) => cell(table(u, r).bestTwoCard(t, false, { canSurrender: r.lateSurrender }))) });
  for (let t = 13; t <= 20; t++) rows.soft.push({ label: `A,${t - 11}`, cells: UPS.map((u) => cell(table(u, r).bestTwoCard(t, true, { canSurrender: r.lateSurrender }))) });
  for (const v of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
    const [t, s] = add(...add(0, false, v), v);
    rows.pairs.push({ label: v === 11 ? "A,A" : v === 10 ? "10,10" : `${v},${v}`, cells: UPS.map((u) => { const T = table(u, r); return cell({ ...T.bestTwoCard(t, s, { canSurrender: r.lateSurrender }), split: T.split(v) }); }) });
  }
  return { ups: UPS, rows };
}
