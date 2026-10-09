// Many rounds played without a picture: the player's seat plays the computed basic strategy and bets by a ramp on the
// true count; the other seats play their styles. Run it a chunk at a time (step) so a page stays responsive.
import { RULES, Shoe, Round, trueCount, mulberry32 } from "./engine.mjs";
import { evaluate } from "./strategy.mjs";
import { botMove, botInsures, betFor } from "./bots.mjs";

export const TC_MIN = -6, TC_MAX = 8;

export class Sim {
  /**
   * `rounds` is how many the run is meant to have (it sizes the bankroll trace); `spread` the bet ramp in units;
   * `insureAt` the true count from which the player insures; `wongOut` a true count below which the player sits out
   * (the seat is still dealt, as another player would be, but nothing is bet); `others` the styles of the other seats,
   * seated before the player when `seat` says so.
   */
  constructor({ rules = RULES, rounds = 100000, seed = 1, spread = [[-99, 1]], insureAt = Infinity, wongOut = null, others = [], seat = 0, tcRound = "floor", infinite = false } = {}) {
    this.rules = { ...RULES, ...rules }; this.rounds = rounds; this.spread = spread; this.insureAt = insureAt; this.wongOut = wongOut; this.tcRound = tcRound;
    this.seat = Math.min(seat, others.length); this.styles = others.slice(); this.styles.splice(this.seat, 0, "me");
    this.shoe = new Shoe({ decks: this.rules.decks, penetration: this.rules.penetration, rng: mulberry32(seed), infinite });
    this.n = 0; this.played = 0; this.net = 0; this.net2 = 0; this.wagered = 0; this.flat = 0; this.flat2 = 0;
    this.byTc = Array.from({ length: TC_MAX - TC_MIN + 1 }, () => ({ n: 0, net: 0, net2: 0 }));
    this.every = Math.max(1, Math.ceil(rounds / 400)); this.trace = [0]; this.peak = 0; this.drawdown = 0; this.results = { blackjack: 0, win: 0, push: 0, lose: 0, bust: 0, surrender: 0 };
  }
  step(count) {
    const r = this.rules, shoe = this.shoe;
    for (let i = 0; i < count; i++) {
      if (r.csm || shoe.pastCut) shoe.shuffle();
      const tc = trueCount(shoe.runningCount, shoe.left, this.tcRound), out = this.wongOut != null && tc < this.wongOut, units = out ? 0 : betFor(this.spread, tc);
      const round = new Round(shoe, r, this.styles.map((s) => (s === "me" ? units : 1)), { me: this.seat });
      while (round.phase === "insurance") { const s = this.styles[round.turn]; round.takeInsurance(s === "me" ? !out && tc >= this.insureAt : botInsures(s, tc)); }
      while (round.phase === "player") {
        const s = this.styles[round.turn], h = round.hand;
        round.act(s === "me" ? evaluate(h.cards, round.upcard.rank, round.options(), r, round.handsOf(h.seat).length)[0][0] : botMove(s, round));
      }
      this.played++;
      if (out) continue;
      const net = round.results.net, perUnit = net / units, b = this.byTc[Math.max(TC_MIN, Math.min(TC_MAX, Math.floor(tc))) - TC_MIN];
      this.n++; this.net += net; this.net2 += net * net; this.wagered += units; this.flat += perUnit; this.flat2 += perUnit * perUnit;
      b.n++; b.net += perUnit; b.net2 += perUnit * perUnit;
      for (const h of round.results.hands) this.results[h.result]++;
      if (this.net > this.peak) this.peak = this.net; this.drawdown = Math.max(this.drawdown, this.peak - this.net);
      if (this.n % this.every === 0) this.trace.push(this.net);
    }
    return this;
  }
  get done() { return this.played >= this.rounds; }
  /** The run so far: units won per round bet, its spread, per unit of the bets made, and the long-run risk of ruin. */
  summary(bankrollUnits = 1000) {
    const n = this.n || 1, ev = this.net / n, sd = Math.sqrt(Math.max(0, this.net2 / n - ev * ev)), se = sd / Math.sqrt(n);
    const ror = ev <= 0 ? 1 : Math.exp((-2 * ev * bankrollUnits) / (sd * sd));
    return { rounds: this.n, played: this.played, ev, se, sd, edge: this.net / (this.wagered || 1), avgBet: this.wagered / n, per100: 100 * ev, n0: ev > 0 ? (sd * sd) / (ev * ev) : Infinity, ror, drawdown: this.drawdown, net: this.net };
  }
}
