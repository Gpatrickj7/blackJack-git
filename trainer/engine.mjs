// Blackjack engine: the shoe, the rules, the Hi-Lo count and one round at a table of one or more seats. Plain ES
// modules, no dependencies, so the same file runs in the browser and under node for the tests.

/** The table's rules. Every one is a setting in the app; these are the defaults. */
export const RULES = Object.freeze({
  decks: 6,            // decks in the shoe
  hitSoft17: false,    // false: the dealer stands on soft 17 (S17); true: hits it (H17)
  blackjackPays: 1.5,  // 3:2; 6:5 is 1.2, even money 1
  das: true,           // double after split
  doubleOn: "any",     // which first two cards may double: "any", "9-11" or "10-11"
  lateSurrender: true, // give up half the bet on the first two cards, after the dealer checks for blackjack
  maxHands: 4,         // splitting up to this many hands
  hitSplitAces: false, // split aces get one card each
  resplitAces: false,  // a split ace dealt another ace may be split again
  holeCard: true,      // the dealer takes a second card face down and peeks for blackjack; false is the European
                       // no-hole-card game, where a dealer blackjack takes every bet on the table, doubles and splits too
  penetration: 0.75,   // the cut card: the share of the shoe dealt before a reshuffle
  csm: false,          // a continuous shuffler: every card goes back in after each round
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
/** Whether the rules let a first-two-card total double. */
export const canDoubleTotal = (total, rules = RULES) => rules.doubleOn === "9-11" ? total >= 9 && total <= 11 : rules.doubleOn === "10-11" ? total >= 10 && total <= 11 : true;

/** A small seeded random number generator, for repeatable shoes in tests, drills and simulations. */
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
 * `stack` deals a fixed order instead (tests and drills), then carries on from a shuffled shoe. `infinite` draws every
 * card from a fresh deck, so every rank is always 1 in 13: the deck the strategy is worked out for.
 */
export class Shoe {
  constructor({ decks = RULES.decks, penetration = RULES.penetration, rng = cryptoRandom(), stack = null, infinite = false } = {}) {
    this.decks = decks; this.penetration = penetration; this.rng = rng; this.infinite = infinite;
    this.stack = stack ? stack.map((r) => (typeof r === "string" ? { rank: r, suit: "S" } : r)) : null;
    this.shuffle();
  }
  shuffle() {
    const cards = []; for (let d = 0; d < this.decks; d++) for (const suit of SUITS) for (const rank of RANKS) cards.push({ rank, suit });
    for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; }
    if (this.stack) { cards.splice(0, this.stack.length, ...this.stack); if (this.infinite) this.stacked = this.stack.length; this.stack = null; } // a stacked top, the rest shuffled (counts no longer balance to zero)
    this.cards = cards; this.next = 0; this.cut = Math.round(cards.length * this.penetration); this.runningCount = 0; this.shuffles = (this.shuffles ?? -1) + 1;
  }
  get size() { return this.cards.length; }
  get left() { return this.infinite ? Infinity : this.cards.length - this.next; }
  /** Decks still in the shoe, as a dealer's discard tray would show it. */
  get decksLeft() { return this.left / 52; }
  /** True once the cut card has come out: shuffle before the next round. */
  get pastCut() { return !this.infinite && this.next >= this.cut; }
  draw() {
    if (this.infinite) { if (this.stacked) { this.stacked--; return this.cards[this.next++]; } const i = Math.floor(this.rng() * 52); return { rank: RANKS[i % 13], suit: SUITS[(i / 13) | 0] }; }
    if (this.next >= this.cards.length) this.shuffle(); return this.cards[this.next++];
  }
  /** The cards not yet dealt (an infinite shoe has none to list). */
  unseen() { return this.infinite ? [] : this.cards.slice(this.next); }
}

/** The true count: the running count per deck still to be dealt. `round` "none", "floor" (toward minus infinity) or "trunc" (toward zero). */
export function trueCount(running, cardsLeft, round = "none") {
  if (!Number.isFinite(cardsLeft)) return 0;
  const tc = running / Math.max(cardsLeft / 52, 0.25);
  return round === "floor" ? Math.floor(tc) : round === "trunc" ? Math.trunc(tc) : tc;
}

/** Whether the dealer draws to this hand under the rules. */
export function dealerHits(cards, rules = RULES) { const { total, soft } = handTotal(cards); return total < 17 || (total === 17 && soft && rules.hitSoft17); }

/**
 * One round at a table. `bets` is one bet or one per seat, left to right as the dealer deals; a seat with a bet of 0
 * still gets cards (another player whose money is not counted). Each seat gets a card, the dealer an upcard, each seat
 * a second card, and the dealer a hole card face down (in the no-hole-card game the dealer's second card comes after
 * the players). An ace up offers every seat insurance in turn; the dealer peeks under an ace or a ten. Then the hands
 * in seat order, then the dealer, then settlement. The running count follows every card a player at the table can see:
 * the hole card counts only once it is turned over. Every card carries `seq`, the order it was dealt in, for drawing.
 */
export class Round {
  constructor(shoe, rules, bets, { me = 0 } = {}) {
    this.shoe = shoe; this.rules = { ...RULES, ...rules }; this.me = me; this.log = []; this.seq = 0;
    this.bets = Array.isArray(bets) ? bets.slice() : [bets]; this.bet = this.bets[me];
    this.hands = this.bets.map((bet, seat) => ({ seat, cards: [], bet, done: false, doubled: false, fromSplit: false, surrendered: false, splitAces: false }));
    this.dealer = []; this.holeShown = false; this.insurance = this.bets.map(() => 0); this.active = 0; this.phase = "deal";
    for (const h of this.hands) h.cards.push(this.seen(this.draw()));
    this.dealer.push(this.seen(this.draw()));
    for (const h of this.hands) h.cards.push(this.seen(this.draw()));
    if (this.rules.holeCard) this.dealer.push(this.draw());
    this.insuranceSeat = 0;
    this.phase = this.upcard.rank === "A" ? "insurance" : "peek";
    if (this.phase === "peek") this.peek();
  }
  draw() { return { ...this.shoe.draw(), seq: this.seq++ }; }
  /** Count a card as it is shown, and hand it back. */
  seen(card) { this.shoe.runningCount += hiLo(card.rank); return card; }
  get upcard() { return this.dealer[0]; }
  get hand() { return this.hands[this.active]; }
  /** The seat that decides next: whose insurance it is, or whose hand is in play. */
  get turn() { return this.phase === "insurance" ? this.insuranceSeat : this.phase === "player" ? this.hand.seat : null; }
  handsOf(seat) { return this.hands.filter((h) => h.seat === seat); }
  /** Take insurance (half the bet) or not, for the seat whose turn it is, when the dealer shows an ace. */
  takeInsurance(yes) {
    if (this.phase !== "insurance") throw new Error("insurance is only offered with an ace up, before anything else");
    this.insurance[this.insuranceSeat] = yes ? this.bets[this.insuranceSeat] / 2 : 0;
    if (++this.insuranceSeat >= this.bets.length) { this.phase = "peek"; this.peek(); }
  }
  peek() { // with a hole card the dealer checks under an ace or a ten, and a blackjack ends the round; a player's blackjack stands
    const dealerBJ = this.rules.holeCard && points(this.upcard.rank) >= 10 && isBlackjack(this.dealer);
    if (dealerBJ) { for (const h of this.hands) h.done = true; this.finish(); return; }
    for (const h of this.hands) if (isBlackjack(h.cards)) h.done = true;
    this.phase = "player"; this.active = 0;
    while (this.active < this.hands.length && this.hands[this.active].done) this.active++;
    if (this.active >= this.hands.length) { this.active = this.hands.length - 1; this.finish(); }
  }
  /** What the current hand may do now. */
  options() {
    if (this.phase !== "player") return [];
    const h = this.hand, two = h.cards.length === 2, r = this.rules, mine = this.handsOf(h.seat).length;
    const pair = two && points(h.cards[0].rank) === points(h.cards[1].rank) && mine < r.maxHands && (!h.splitAces || r.resplitAces);
    if (h.splitAces && !r.hitSplitAces) return pair ? ["stand", "split"] : ["stand"];
    const out = ["hit", "stand"];
    if (two && (!h.fromSplit || r.das) && canDoubleTotal(handTotal(h.cards).total, r)) out.push("double");
    if (pair) out.push("split");
    if (two && !h.fromSplit && mine === 1 && r.lateSurrender && r.holeCard) out.push("surrender");
    return out;
  }
  act(move) {
    if (!this.options().includes(move)) throw new Error(`${move} is not allowed now`);
    const h = this.hand;
    if (move === "hit") { h.cards.push(this.seen(this.draw())); if (handTotal(h.cards).total >= 21) this.advance(); }
    else if (move === "stand") this.advance();
    else if (move === "double") { h.bet *= 2; h.doubled = true; h.cards.push(this.seen(this.draw())); this.advance(); }
    else if (move === "surrender") { h.surrendered = true; this.advance(); }
    else if (move === "split") {
      const aces = h.cards[0].rank === "A", second = h.cards.pop();
      const twin = { seat: h.seat, cards: [second], bet: h.bet, done: false, doubled: false, fromSplit: true, surrendered: false, splitAces: aces };
      h.fromSplit = true; h.splitAces = aces; this.hands.splice(this.active + 1, 0, twin);
      h.cards.push(this.seen(this.draw())); twin.cards.push(this.seen(this.draw()));
      if (aces && !this.rules.hitSplitAces) { // each ace has its one card; only one dealt another ace, with room, waits to be split again
        for (const x of [h, twin]) x.done = !(this.rules.resplitAces && x.cards[1].rank === "A" && this.handsOf(h.seat).length < this.rules.maxHands);
        if (h.done) this.advance();
      } else if (handTotal(h.cards).total === 21) this.advance();
    }
    this.log.push(move);
  }
  advance() { // the next hand that still has a decision, or on to the dealer
    this.hand.done = true;
    while (this.active < this.hands.length && this.hands[this.active].done) this.active++;
    if (this.active >= this.hands.length) { this.active = this.hands.length - 1; this.finish(); }
    else if (handTotal(this.hand.cards).total === 21) this.advance(); // a split hand dealt to 21 stands by itself
  }
  finish() { // turn the hole card (or deal the dealer's second), the dealer draws if any hand is still live, then pay
    this.flipSeq = this.seq; // the cards dealt from here on came after the hole card was turned
    if (this.rules.holeCard) this.seen(this.dealer[1]); else this.dealer.push(this.seen(this.draw()));
    this.holeShown = true;
    const live = this.hands.some((h) => !h.surrendered && handTotal(h.cards).total <= 21 && !isBlackjack(h.cards, h.fromSplit));
    if (live && !isBlackjack(this.dealer)) while (dealerHits(this.dealer, this.rules)) this.dealer.push(this.seen(this.draw()));
    this.phase = "done"; this.results = this.settle();
  }
  /** Each hand's result and net win in units of money, and each seat's insurance; the top level is seat `me`'s. */
  settle() {
    const d = handTotal(this.dealer).total, dealerBJ = isBlackjack(this.dealer);
    const seats = this.bets.map(() => ({ hands: [], insurance: 0, net: 0 }));
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
      seats[h.seat].hands.push({ result, net, total: p }); seats[h.seat].net += net;
    }
    this.insurance.forEach((ins, s) => { if (ins) { seats[s].insurance = dealerBJ ? 2 * ins : -ins; seats[s].net += seats[s].insurance; } });
    return { ...seats[this.me], seats, dealer: d, dealerBlackjack: dealerBJ };
  }
}
