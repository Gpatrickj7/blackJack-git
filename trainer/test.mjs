// Checks on the engine and the strategy. Run with: node trainer/test.mjs
import { RULES, RANKS, hiLo, handTotal, isBlackjack, Shoe, trueCount, Round, mulberry32, points } from "./engine.mjs";
import { DRAWS, add, dealerOutcomes, table, evaluate, chart, houseEdge } from "./strategy.mjs";
import { Sim, TC_MIN } from "./sim.mjs";
import { betFor, botMove, STYLES } from "./bots.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, got = "") => { if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}  ${got}`); } };
const C = (...ranks) => ranks.map((rank) => ({ rank, suit: "S" }));

console.log("\nCARDS AND COUNT");
ok("Hi-Lo is balanced: one deck's tags add to 0", RANKS.reduce((s, r) => s + 4 * hiLo(r), 0) === 0);
{ const shoe = new Shoe({ decks: 6, rng: mulberry32(1) }); let rc = 0; for (let i = 0; i < shoe.size; i++) rc += hiLo(shoe.draw().rank); ok(`a whole six-deck shoe dealt out counts back to 0 (${rc})`, rc === 0); }
ok("A,6 is soft 17; A,6,10 is hard 17; A,A,9 is soft 21", handTotal(C("A", "6")).total === 17 && handTotal(C("A", "6")).soft && handTotal(C("A", "6", "10")).total === 17 && !handTotal(C("A", "6", "10")).soft && handTotal(C("A", "A", "9")).total === 21);
ok("A,K is blackjack; the same two cards after a split are not", isBlackjack(C("A", "K")) && !isBlackjack(C("A", "K"), true));
ok("true count: running +6 with three decks left is +2; -5 with two decks left floors to -3 and truncates to -2", trueCount(6, 156) === 2 && trueCount(-5, 104, "floor") === -3 && trueCount(-5, 104, "trunc") === -2);

console.log("\nTHE DEALER, TWO WAYS");
const rng = mulberry32(7), drawValue = () => { let u = rng(); for (const [v, q] of DRAWS) { if ((u -= q) < 0) return v; } return 11; };
for (const h17 of [false, true]) {
  const rules = { ...RULES, hitSoft17: h17 }; let worst = 0;
  for (const up of [2, 6, 10, 11]) {
    const exact = dealerOutcomes(up, rules), N = 200000, count = { 17: 0, 18: 0, 19: 0, 20: 0, 21: 0, bust: 0 };
    for (let i = 0; i < N; i++) {
      let [t, s] = add(0, false, up), hole; do { hole = drawValue(); } while ((up === 11 && hole === 10) || (up === 10 && hole === 11)); // the dealer peeked: no blackjack
      [t, s] = add(t, s, hole);
      while (t < 17 || (t === 17 && s && h17)) [t, s] = add(t, s, drawValue());
      count[t > 21 ? "bust" : t]++;
    }
    for (const k of Object.keys(count)) { const p = exact[k], se = Math.sqrt((p * (1 - p)) / N); worst = Math.max(worst, Math.abs(count[k] / N - p) / se); }
    ok(`${h17 ? "H17" : "S17"}, upcard ${up === 11 ? "A" : up}: outcomes add to 1 (${Object.values(exact).reduce((a, b) => a + b, 0).toFixed(12)})`, Math.abs(Object.values(exact).reduce((a, b) => a + b, 0) - 1) < 1e-12);
  }
  ok(`${h17 ? "H17" : "S17"}: 200,000 dealer hands drawn at random per upcard agree with the exact odds within ${worst.toFixed(2)} standard errors`, worst < 4.5);
}

console.log("\nTHE MOVES, TWO WAYS");
{
  const T = table(10), N = 300000; let sum = 0, sum2 = 0;
  for (let i = 0; i < N; i++) { // hit 16 against a 10 and then play on by the computed values, against a dealer drawn at random
    let [t, s] = add(16, false, drawValue());
    while (t <= 21 && T.hit(t, s) > T.stand(t)) [t, s] = add(t, s, drawValue());
    let d = 10, ds = false, hole; do { hole = drawValue(); } while (hole === 11); [d, ds] = add(d, ds, hole);
    while (d < 17) [d, ds] = add(d, ds, drawValue());
    const r = t > 21 ? -1 : d > 21 || t > d ? 1 : t === d ? 0 : -1; sum += r; sum2 += r * r;
  }
  const mean = sum / N, se = Math.sqrt((sum2 / N - mean * mean) / N), exact = T.hit(16, false);
  ok(`hitting 16 against a 10: the recursion's ${exact.toFixed(4)} against ${mean.toFixed(4)} played out 300,000 times (${(Math.abs(mean - exact) / se).toFixed(2)} standard errors)`, Math.abs(mean - exact) < 4 * se);
  ok(`standing on 16 against a 10 is worth ${T.stand(16).toFixed(4)}, hitting ${exact.toFixed(4)}, surrendering -0.5000`, T.stand(16) < exact && exact < -0.5);
}
const cells = chart();
ok("the chart doubles 11 against 2 through 10 and splits 8s and aces against everything (S17, DAS, late surrender)", cells.rows.hard.find((r) => r.label === "11").cells.slice(0, 9).every((c) => c.code === "D") && ["8,8", "A,A"].every((l) => cells.rows.pairs.find((r) => r.label === l).cells.every((c) => c.code === "P")));
ok("evaluate ranks the moves a hand actually has: 10,6 against a 10 with surrender open picks surrender", evaluate(C("10", "6"), "10", ["hit", "stand", "double", "surrender"])[0][0] === "surrender");

console.log("\nROUNDS, WITH STACKED SHOES (player, dealer up, player, dealer hole, then the draws)");
const play = (stack, bet, moves, rules = {}) => { const r = new Round(new Shoe({ decks: 6, rng: mulberry32(3), stack }), rules, bet); for (const m of moves) m === "insure" ? r.takeInsurance(true) : m === "decline" ? r.takeInsurance(false) : r.act(m); return r; };
ok("blackjack pays 3:2", play(["A", "9", "K", "7"], 10, []).results.net === 15);
ok("at a 6:5 table it pays 6:5", play(["A", "9", "K", "7"], 10, [], { blackjackPays: 1.2 }).results.net === 12);
ok("insurance against a dealer blackjack: the hand loses 10, the insurance wins 10", play(["9", "A", "9", "K"], 10, ["insure"]).results.net === 0);
ok("insurance with no dealer blackjack costs the 5 and the round plays on", (() => { const r = play(["10", "A", "10", "7"], 10, ["insure", "stand"]); return r.results.insurance === -5 && r.results.net === 5; })());
ok("late surrender gives back half", play(["10", "10", "6", "7"], 10, ["surrender"]).results.net === -5);
ok("double down on 11 and win: +20", play(["6", "6", "5", "10", "10", "10"], 10, ["double"]).results.net === 20);
{
  const r = play(["8", "6", "8", "10", "3", "10", "9"], 10, ["split", "stand", "stand"]); // 8,3 = 11 and 8,10 = 18, dealer 16 draws 9: bust
  ok(`splitting 8s against a 6: two hands of 10, the dealer busts, +20 (${r.results.net})`, r.hands.length === 2 && r.results.net === 20);
}
{
  const r = play(["A", "6", "A", "10", "K", "5", "10"], 10, ["split"]);
  ok("split aces get one card each and stand: A,K is 21 not blackjack, paid 1:1", r.phase === "done" && r.hands.every((h) => h.cards.length === 2) && r.results.hands[0].result === "win" && r.results.hands[0].net === 10);
}
{
  const r = play(["10", "5", "6", "9", "5"], 10, ["hit"]), seen = [...r.hands.flatMap((h) => h.cards), ...r.dealer].reduce((s, c) => s + hiLo(c.rank), 0);
  ok(`the running count follows every card shown, the hole card once it is turned (${r.shoe.runningCount} = ${seen})`, r.shoe.runningCount === seen);
}

console.log("\nA TABLE OF SEVERAL SEATS (seat 1, seat 2, dealer up, seat 1, seat 2, dealer hole, then the draws)");
{
  const r = new Round(new Shoe({ decks: 6, rng: mulberry32(3), stack: ["10", "9", "6", "7", "8", "10", "5"] }), RULES, [10, 20], { me: 1 });
  ok("cards go round the table in order: 10,7 to the first seat, 9,8 to the second, 6 up and 10 in the hole", r.hands[0].cards.map((c) => c.rank).join() === "10,7" && r.hands[1].cards.map((c) => c.rank).join() === "9,8" && r.dealer.map((c) => c.rank).join() === "6,10" && r.turn === 0);
  r.act("stand"); ok("the second seat plays after the first", r.turn === 1); r.act("stand");
  ok(`both stand on 17; the dealer's 16 draws 5 to 21: the first seat loses 10, the second 20, and the round reports seat 2 (${r.results.net})`, r.results.seats[0].net === -10 && r.results.seats[1].net === -20 && r.results.net === -20);
  ok("every card carries the order it was dealt in", [...r.hands.flatMap((h) => h.cards), ...r.dealer].map((c) => c.seq).sort((a, b) => a - b).join() === "0,1,2,3,4,5,6");
}
{
  const r = new Round(new Shoe({ decks: 6, rng: mulberry32(3), stack: ["9", "9", "A", "8", "8", "K"] }), RULES, [10, 10]);
  r.takeInsurance(true); ok("insurance goes round every seat in turn", r.phase === "insurance" && r.turn === 1); r.takeInsurance(false);
  ok(`the dealer has blackjack: the insured seat breaks even, the other loses 10 (${r.results.seats.map((s) => s.net)})`, r.results.seats[0].net === 0 && r.results.seats[1].net === -10);
}
ok("a player's blackjack at a full table is paid at the end and the others still play", (() => { const r = new Round(new Shoe({ decks: 6, rng: mulberry32(3), stack: ["A", "10", "7", "K", "6", "10", "10"] }), RULES, [10, 10]); const ok1 = r.phase === "player" && r.turn === 1; r.act("stand"); return ok1 && r.results.seats[0].net === 15 && r.results.seats[1].net === -10; })());

console.log("\nRULE TOGGLES IN THE ENGINE");
ok("double on 10 and 11 only: 5,4 (9) cannot double", !play(["5", "6", "4", "10"], 10, [], { doubleOn: "10-11" }).options().includes("double"));
ok("no-hole-card game: no surrender, and the dealer has one card until the players are done", (() => { const r = play(["10", "9", "6"], 10, [], { holeCard: false }); return !r.options().includes("surrender") && r.dealer.length === 1; })());
ok("no-hole-card game: the dealer's blackjack after a double takes both bets, 20", play(["6", "A", "5", "9", "K"], 10, ["decline", "double"], { holeCard: false }).results.net === -20);
{
  const r = play(["A", "6", "A", "10", "A", "5", "9", "K", "10"], 10, ["split", "split"], { resplitAces: true });
  ok(`resplit aces: A,A split, an ace again split again, three hands of 20, 16 and 21 (not a blackjack) against a dealer who busts: +30 (${r.results.net})`, r.hands.length === 3 && r.results.net === 30 && r.results.hands.every((h) => h.result === "win"));
}
ok("without resplitting aces, a split ace dealt an ace just stands", (() => { const r = play(["A", "6", "A", "10", "A", "5", "10"], 10, ["split"]); return r.phase === "done" && r.hands.length === 2; })());
{
  const shoe = new Shoe({ infinite: true, rng: mulberry32(9) }), seen = { A: 0, 10: 0 }, N = 130000;
  for (let i = 0; i < N; i++) { const p = points(shoe.draw().rank); if (p === 11) seen.A++; if (p === 10) seen[10]++; }
  ok(`an infinite shoe deals aces 1 in 13 and tens 4 in 13 (${(13 * seen.A / N).toFixed(3)}, ${(13 * seen[10] / N).toFixed(3)}) and never runs out or reaches the cut`, Math.abs(13 * seen.A / N - 1) < 0.03 && Math.abs(13 * seen[10] / N - 4) < 0.05 && !shoe.pastCut && trueCount(5, shoe.left) === 0);
}
ok("bot styles: the never-bust player stands on 12, the copycat hits 16", (() => { const r = play(["10", "6", "2", "10"], 10, []); return botMove("hunch", r) === "stand" && botMove("mimic", r) === "hit" && Object.keys(STYLES).length === 7; })());
ok("a bet ramp: 1 unit below +2, 2 at +2, 4 at +3, 8 from +5", betFor([[-99, 1], [2, 2], [3, 4], [4, 6], [5, 8]], 1) === 1 && betFor([[-99, 1], [2, 2], [3, 4], [4, 6], [5, 8]], 2) === 2 && betFor([[-99, 1], [2, 2], [3, 4], [4, 6], [5, 8]], 3.9) === 4 && betFor([[-99, 1], [2, 2], [3, 4], [4, 6], [5, 8]], 9) === 8);

console.log("\nTHE OTHER PLAYERS' SKILL");
{
  const N = 100000, cost = {};
  for (const style of Object.keys(STYLES)) {
    let s = 0; const rnd = mulberry32(77);
    for (let i = 0; i < N; i++) { const r = new Round(new Shoe({ infinite: true, rng: mulberry32(7919 * i + 1) }), RULES, 1); while (r.phase === "insurance") r.takeInsurance(style === "wild"); while (r.phase === "player") r.act(botMove(style, r, rnd)); s += r.results.net; }
    cost[style] = -100 * s / N;
  }
  const said = (style) => Number(STYLES[style].note.match(/about (\d+)%/)[1]);
  ok(`the same 100,000 rounds for every style: book ${cost.book.toFixed(2)}%, regular ${cost.regular.toFixed(2)}, copycat ${cost.mimic.toFixed(2)}, never-bust ${cost.hunch.toFixed(2)}, gut feel ${cost.wild.toFixed(2)}, novice ${cost.novice.toFixed(2)} lost a hand`, cost.book < cost.regular && cost.regular < cost.mimic && cost.mimic < cost.hunch && cost.hunch < cost.wild && cost.wild < cost.novice);
  ok("each style's note says what it loses, to the nearest point but one", Object.keys(STYLES).filter((k) => k !== "counter").every((k) => Math.abs(said(k) - cost[k]) <= 1.5));
}

console.log("\nTHE HOUSE EDGE, TWO WAYS");
// The same cards under two sets of rules, round by round (each round's infinite shoe seeded alike), so the difference
// between the rules is measured with the rest of the luck taken out.
const playOne = (rules, seed) => { const r = new Round(new Shoe({ infinite: true, rng: mulberry32(seed) }), rules, 1);
  if (r.phase === "insurance") r.takeInsurance(false);
  while (r.phase === "player") r.act(evaluate(r.hand.cards, r.upcard.rank, r.options(), r.rules, r.handsOf(r.hand.seat).length)[0][0]);
  return r.results.net; };
const base = houseEdge(RULES);
ok(`the default rules (S17, 3:2, DAS, late surrender, split to 4, infinite deck) return ${(100 * base).toFixed(3)}% a round`, base < 0 && base > -0.01);
for (const [name, ch, N] of [["6:5 blackjacks", { blackjackPays: 1.2 }, 60000], ["the dealer hitting soft 17", { hitSoft17: true }, 120000], ["no double after split", { das: false }, 120000], ["resplitting aces", { resplitAces: true }, 60000], ["doubling 10 and 11 only", { doubleOn: "10-11" }, 120000], ["splitting to 2 hands only", { maxHands: 2 }, 120000], ["no surrender", { lateSurrender: false }, 120000], ["hitting split aces", { hitSplitAces: true }, 60000]]) {
  const B = { ...RULES, ...ch }; let s = 0, s2 = 0;
  for (let i = 0; i < N; i++) { const d = playOne(B, 7919 * i + 1) - playOne(RULES, 7919 * i + 1); s += d; s2 += d * d; }
  const m = s / N, se = Math.sqrt((s2 / N - m * m) / N), ex = houseEdge(B) - base;
  ok(`${name}: computed ${(100 * ex >= 0 ? "+" : "")}${(100 * ex).toFixed(3)}%, ${N.toLocaleString("en-US")} paired rounds ${(100 * m >= 0 ? "+" : "")}${(100 * m).toFixed(3)}% (${((m - ex) / se).toFixed(2)} standard errors)`, Math.abs(m - ex) < 4 * se);
}
for (const [name, rules] of [["default rules", RULES], ["no-hole-card game", { ...RULES, holeCard: false }]]) {
  const N = 300000; let s = 0, s2 = 0;
  for (let i = 0; i < N; i++) { const x = playOne(rules, 104729 * i + 3); s += x; s2 += x * x; }
  const m = s / N, se = Math.sqrt((s2 / N - m * m) / N), ex = houseEdge(rules);
  ok(`${name}: computed ${(100 * ex).toFixed(3)}%, ${N.toLocaleString("en-US")} rounds ${(100 * m).toFixed(3)}% +/- ${(100 * se).toFixed(3)} (${((m - ex) / se).toFixed(2)} standard errors)`, Math.abs(m - ex) < 4 * se);
}

console.log("\nTHE SIMULATOR");
{
  const sim = new Sim({ rules: RULES, rounds: 300000, seed: 21, spread: [[-99, 1], [2, 2], [3, 4], [4, 6], [5, 8]], insureAt: 3 }).step(300000), s = sim.summary();
  const edge = (lo, hi) => { let n = 0, net = 0; sim.byTc.forEach((b, i) => { const tc = i + TC_MIN; if (tc >= lo && tc <= hi) { n += b.n; net += b.net; } }); return { n, e: net / n }; };
  const low = edge(-99, -1), high = edge(3, 99);
  ok(`six decks, cut at 75%: flat bets earn ${(100 * low.e).toFixed(2)}% at a true count of -1 or less (${low.n.toLocaleString("en-US")} rounds) and ${(100 * high.e).toFixed(2)}% at +3 or more (${high.n.toLocaleString("en-US")})`, high.e > low.e + 0.01);
  ok(`a 1 to 8 ramp over 300,000 rounds: ${(100 * s.edge).toFixed(2)}% of the money bet, ${s.ev.toFixed(4)} units a round +/- ${s.se.toFixed(4)}, average bet ${s.avgBet.toFixed(2)} units`, Number.isFinite(s.edge) && s.rounds === 300000);
}

console.log("\nA WHOLE SHOE GAME");
{
  const rng2 = mulberry32(11); let shoe = new Shoe({ decks: 6, rng: rng2 }), net = 0, net2 = 0, rounds = 60000;
  for (let i = 0; i < rounds; i++) {
    if (shoe.pastCut) shoe.shuffle();
    const r = new Round(shoe, RULES, 1);
    if (r.phase === "insurance") r.takeInsurance(false);
    while (r.phase === "player") r.act(evaluate(r.hand.cards, r.upcard.rank, r.options())[0][0]);
    net += r.results.net; net2 += r.results.net ** 2;
  }
  const mean = net / rounds, se = Math.sqrt((net2 / rounds - mean * mean) / rounds);
  ok(`60,000 rounds of a six-deck shoe played by the computed strategy, flat bets, no count: ${(100 * mean).toFixed(2)}% +/- ${(100 * se).toFixed(2)}% a round`, mean < 0.02 && mean > -0.03);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
