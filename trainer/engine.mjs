// Blackjack engine: the shoe, the rules, the Hi-Lo count and one round at a time. Plain ES modules, no dependencies, so
// the same file runs in the browser and under node for the tests.

/** The table's rules. Every one is a setting in the app; these are the defaults. */
export const RULES = Object.freeze({
  decks: 6,            // decks in the shoe
  hitSoft17: false,    // false: the dealer stands on soft 17 (S17); true: hits it (H17)
  blackjackPays: 1.5,  // 3:2; 6:5 is 1.2
  das: true,           // double after split
  lateSurrender: true, // give up half the bet on the first two cards, after the dealer checks for blackjack
  maxHands: 4,         // splitting up to four hands
  hitSplitAces: false, // split aces get one card each
  penetration: 0.75,   // the cut card: the share of the shoe dealt before a reshuffle
});

export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
export const SUITS = ["S", "H", "D", "C"];

/** A card's points, an ace as 11 (handTotal brings it down to 1 when it has to). */
export const points = (rank) => (rank === "A" ? 11 : "JQK".includes(rank) || rank === "10" ? 10 : Number(rank));
/** The Hi-Lo tag: 2 to 6 count +1, 7 to 9 count 0, tens and aces count -1. */
export const hiLo = (rank) => { const p = points(rank); return p >= 2 && p <= 6 ? 1 : p >= 7 && p <= 9 ? 0 : -1; };

/** A hand's best total, and whether an ace in it still counts 11 (soft). */
export function handTotal(cards) {
  let total = 0, aces = 0;
  for (const c of cards) { total += points(c.rank); if (c.rank === "A") aces++; }
  while (total > 21 && aces) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}
/** Two cards making 21. A split hand's 21 is not a blackjack. */
export const isBlackjack = (cards, fromSplit = false) => !fromSplit && cards.length === 2 && handTotal(cards).total === 21;

/** A small seeded random number generator, for repeatable shoes in tests and drills. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** A random number from the browser's or node's crypto when there is one: real shuffles for play. */
export function cryptoRandom() {
  const c = globalThis.crypto;
  if (c?.getRandomValues) { const u = new Uint32Array(1); return () => (c.getRandomValues(u), u[0] / 4294967296); }
  return Math.random;
}

/**
 * The shoe: `decks` decks shuffled together (Fisher-Yates), dealt from the top, reshuffled once the cut card comes out.
 * `stack` deals a fixed order instead (tests and drills), then carries on from a shuffled shoe.
 */
export class Shoe {
  constructor({ decks = RULES.decks, penetration = RULES.penetration, rng = cryptoRandom(), stack = null } = {}) {
    this.decks = decks; this.penetration = penetration; this.rng = rng; this.stack = stack ? stack.map((r) => (typeof r === "string" ? { rank: r, suit: "S" } : r)) : null;
    this.shuffle();
  }
  shuffle() {
    const cards = []; for (let d = 0; d < this.decks; d++) for (const suit of SUITS) for (const rank of RANKS) cards.push({ rank, suit });
    for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; }
    if (this.stack) { cards.splice(0, this.stack.length, ...this.stack); this.stack = null; } // a stacked top, the rest shuffled (counts no longer balance to zero)
    this.cards = cards; this.next = 0; this.cut = Math.round(cards.length * this.penetration); this.runningCount = 0; this.shuffles = (this.shuffles ?? -1) + 1;
  }
  get size() { return this.cards.length; }
  get left() { return this.cards.length - this.next; }
  /** Decks still in the shoe, as a dealer's discard tray would show it. */
  get decksLeft() { return this.left / 52; }
  /** True once the cut card has come out: shuffle before the next round. */
  get pastCut() { return this.next >= this.cut; }
  draw() { if (this.next >= this.cards.length) this.shuffle(); return this.cards[this.next++]; }
}

/** The true count: the running count per deck still to be dealt. `round` "none", "floor" (toward minus infinity) or "trunc" (toward zero). */
export function trueCount(running, cardsLeft, round = "none") {
  const tc = running / Math.max(cardsLeft / 52, 0.25);
  return round === "floor" ? Math.floor(tc) : round === "trunc" ? Math.trunc(tc) : tc;
}

/** Whether the dealer draws to this hand under the rules. */
export function dealerHits(cards, rules = RULES) { const { total, soft } = handTotal(cards); return total < 17 || (total === 17 && soft && rules.hitSoft17); }

/**
 * One round at a table: place a bet, deal, offer insurance on an ace, the dealer peeks for blackjack on an ace or a ten,
 * then the player's hands in turn, then the dealer, then settlement. The running count follows every card a player at
 * the table can see: the hole card counts only once it is turned over.
 */
export class Round {
  constructor(shoe, rules, bet) {
    this.shoe = shoe; this.rules = { ...RULES, ...rules }; this.bet = bet; this.log = [];
    this.hands = [{ cards: [], bet, done: false, doubled: false, fromSplit: false, surrendered: false }];
    this.dealer = []; this.holeShown = false; this.insurance = 0; this.active = 0; this.phase = "deal";
    const p = this.hands[0];
    p.cards.push(this.seen(shoe.draw())); this.dealer.push(this.seen(shoe.draw())); p.cards.push(this.seen(shoe.draw())); this.dealer.push(shoe.draw());
    this.phase = this.upcard.rank === "A" ? "insurance" : "peek";
    if (this.phase === "peek") this.peek();
  }
  /** Count a card as it is shown, and hand it back. */
  seen(card) { this.shoe.runningCount += hiLo(card.rank); return card; }
  get upcard() { return this.dealer[0]; }
  get hand() { return this.hands[this.active]; }
  /** Take insurance (half the bet) or not, when the dealer shows an ace. */
  takeInsurance(yes) {
    if (this.phase !== "insurance") throw new Error("insurance is only offered with an ace up, before anything else");
    this.insurance = yes ? this.bet / 2 : 0; this.phase = "peek"; this.peek();
  }
  peek() { // the dealer checks under an ace or a ten for blackjack; a blackjack either side ends the round
    const dealerBJ = points(this.upcard.rank) >= 10 && isBlackjack(this.dealer), playerBJ = isBlackjack(this.hands[0].cards);
    if (dealerBJ || playerBJ) { this.hands[0].done = true; this.finish(); } else this.phase = "player";
  }
  /** What the current hand may do now. */
  options() {
    if (this.phase !== "player") return [];
    const h = this.hand, two = h.cards.length === 2, r = this.rules, out = ["hit", "stand"];
    if (h.splitAces && !r.hitSplitAces) return ["stand"];
    if (two && (!h.fromSplit || r.das)) out.push("double");
    if (two && points(h.cards[0].rank) === points(h.cards[1].rank) && this.hands.length < r.maxHands) out.push("split");
    if (two && !h.fromSplit && this.hands.length === 1 && r.lateSurrender) out.push("surrender");
    return out;
  }
  act(move) {
    if (!this.options().includes(move)) throw new Error(`${move} is not allowed now`);
    const h = this.hand;
    if (move === "hit") { h.cards.push(this.seen(this.shoe.draw())); if (handTotal(h.cards).total >= 21) this.advance(); }
    else if (move === "stand") this.advance();
    else if (move === "double") { h.bet *= 2; h.doubled = true; h.cards.push(this.seen(this.shoe.draw())); this.advance(); }
    else if (move === "surrender") { h.surrendered = true; this.advance(); }
    else if (move === "split") {
      const aces = h.cards[0].rank === "A", second = h.cards.pop();
      const twin = { cards: [second], bet: h.bet, done: false, doubled: false, fromSplit: true, surrendered: false, splitAces: aces };
      h.fromSplit = true; h.splitAces = aces; this.hands.splice(this.active + 1, 0, twin);
      h.cards.push(this.seen(this.shoe.draw())); twin.cards.push(this.seen(this.shoe.draw()));
      if (aces && !this.rules.hitSplitAces) { h.done = twin.done = true; this.active = this.hands.length - 1; this.advance(); }
      else if (handTotal(h.cards).total === 21) this.advance();
    }
    this.log.push(move);
  }
  advance() { // the next hand that still has a decision, or on to the dealer
    this.hand.done = true;
    while (this.active < this.hands.length && this.hands[this.active].done) this.active++;
    if (this.active >= this.hands.length) { this.active = this.hands.length - 1; this.finish(); }
    else if (handTotal(this.hand.cards).total === 21) this.advance(); // a split hand dealt to 21 stands by itself
  }
  finish() { // turn the hole card, the dealer draws if any hand is still live, then pay
    this.seen(this.dealer[1]); this.holeShown = true;
    const live = this.hands.some((h) => !h.surrendered && handTotal(h.cards).total <= 21) && !isBlackjack(this.hands[0].cards, this.hands[0].fromSplit);
    if (live && !isBlackjack(this.dealer)) while (dealerHits(this.dealer, this.rules)) this.dealer.push(this.seen(this.shoe.draw()));
    this.phase = "done"; this.results = this.settle();
  }
  /** Each hand's result and net win in units of money, and the insurance's. */
  settle() {
    const d = handTotal(this.dealer).total, dealerBJ = isBlackjack(this.dealer), out = [];
    for (const h of this.hands) {
      const p = handTotal(h.cards).total, bj = isBlackjack(h.cards, h.fromSplit);
      let net, result;
      if (h.surrendered) { net = -h.bet / 2; result = "surrender"; }
      else if (bj && dealerBJ) { net = 0; result = "push"; }
      else if (bj) { net = h.bet * this.rules.blackjackPays; result = "blackjack"; }
      else if (dealerBJ) { net = -h.bet; result = "lose"; }
      else if (p > 21) { net = -h.bet; result = "bust"; }
      else if (d > 21 || p > d) { net = h.bet; result = "win"; }
      else if (p === d) { net = 0; result = "push"; }
      else { net = -h.bet; result = "lose"; }
      out.push({ result, net, total: p });
    }
    const insurance = this.insurance ? (dealerBJ ? 2 * this.insurance : -this.insurance) : 0;
    return { hands: out, insurance, net: out.reduce((s, h) => s + h.net, 0) + insurance, dealer: d, dealerBlackjack: dealerBJ };
  }
}
