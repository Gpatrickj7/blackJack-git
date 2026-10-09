// Checks on the engine and the strategy. Run with: node trainer/test.mjs
import { RULES, RANKS, hiLo, handTotal, isBlackjack, Shoe, trueCount, Round, mulberry32 } from "./engine.mjs";
import { DRAWS, add, dealerOutcomes, table, evaluate, chart } from "./strategy.mjs";

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
