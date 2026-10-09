# Shoe Counter

A blackjack table for practising card counting, rebuilt from the Java game in `blackJack/` (left as it was).

**To play:** open `blackjack-trainer.html` in any browser, on a computer or a phone. It is one file with nothing to
install. Your bankroll, stats and table rules are kept in that browser.

## What is in it

- **Play.** A full table of one to seven seats. The other seats are players with their own styles (the book, a
  counter who bets up with the count, a regular who slips one decision in twelve, a novice who slips one in three, a
  never-bust player, a copycat who plays like the dealer, a gut-feel player), and their cards count like anyone's. Each
  style's note says what it gives up a hand, measured by the tests over 100,000 paired rounds: the book about 1%, the
  regular 4%, the copycat 7%, never-bust 8%, gut feel 12% and the novice 13%. Cards fly from the shoe; the shoe and the discard tray show how deep the deal
  is. The **coach** checks every move against basic strategy and shows the numbers behind the call. The running
  count, true count and decks left sit under the table, shown, blurred until you peek, or hidden; every few rounds
  it asks you for the running count. Sound and speed are settings.
- **Career.** Start with 1,000 at the cheap tables; more tables open as the bankroll grows (one, two and six decks,
  a European no-hole-card room, a shuffle machine, a high-limit room), each with its own rules, limits and house
  edge. Raise your bet with the count and the heat goes up: at full heat the pit asks you to leave that table for a
  while. The tables and heat are a game made up for this app, not any real casino.
- **Free play.** Every rule is a toggle: decks, the dealer on soft 17, 3:2, 6:5 or even-money blackjacks, a hole card
  or not, doubling on any two cards or only 9 to 11 or 10 to 11, double after split, late surrender, splitting to 2,
  3 or 4 hands, resplitting and hitting split aces, the cut card, a continuous shuffler. The house edge for the rules
  you set updates as you change them.
- **Sim.** Thousands of rounds a second with the rules in play: your seat plays the book and bets by a ramp on the
  true count (presets, or your own steps), with optional sitting out and insurance, alone or with the table's
  players. It reports the win per round with its error, the edge per unit bet, the swing, the biggest drop, a risk
  of ruin, a bankroll trace, and what a flat bet earns at each true count.
- **Count drill**, **true count** practice, the **strategy** chart for the rules in play, and your numbers.

Keys on a computer: H hit, S stand, D double, P split, R surrender, I insure, N no insurance, Space to deal.

## How the strategy is worked out

Basic strategy is not typed in from a chart. `strategy.mjs` computes it from the rules: the dealer's chances of
finishing on 17 to 21 or busting from each upcard, given that the dealer peeked and has no blackjack, and from that the
value of standing, hitting, doubling, splitting and surrendering every hand, with cards drawn from an infinite deck.
The tests check that two ways: 200,000 dealer hands drawn at random per upcard land on the computed odds within 2.5
standard errors, and hitting 16 against a 10 played out 300,000 times lands on the computed value within 0.5 standard
errors. A real shoe is finite, so the closest calls (outlined on the chart) can go the other way in practice.

**The house edge** for any set of rules is the same recursion summed over every first two cards and every upcard,
with an exact count of resplits (with every card independent, the hands waiting for a card are all alike, so the
value of k waiting hands with h hands in all closes on itself). Each rule's effect is checked against rounds played
twice with the same cards, once under each rule, which takes most of the luck out of the comparison: every rule
lands within 2.5 standard errors. The default rules (six decks, S17, 3:2, double after split, late surrender, split to
four hands) give a house edge of 0.426% off an infinite deck. A real shoe gives a little back: flat bets by the book
over 1.5 million rounds returned 0.14% more than that from six decks, 0.29% from two and 0.46% from one (each
+/- 0.09%).

The insurance coach uses the real shoe: insurance pays 2 to 1, so it is worth taking exactly when more than a third
of the unseen cards are tens, and after you decide it tells you what that share was.

## Files

- `engine.mjs`: the shoe (or an infinite one), the rules, the Hi-Lo count, the true count and one round at a table of
  any number of seats.
- `strategy.mjs`: basic strategy and the house edge from the rules.
- `bots.mjs`: the other players' styles and the bet ramp.
- `sim.mjs`: many rounds without a picture, for the Sim tab and the tests.
- `career.mjs`: the career's tables and heat.
- `app.js`, `page.html`: the screens.
- `test.mjs`: the checks (`node trainer/test.mjs`).
- `build.mjs`: puts the engine, strategy and screens into `blackjack-trainer.html` (`node trainer/build.mjs`).
