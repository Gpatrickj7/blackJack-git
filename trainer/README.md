# Shoe Counter

A blackjack table for practising card counting, rebuilt from the Java game in `blackJack/` (left as it was).

**To play:** open `blackjack-trainer.html` in any browser, on a computer or a phone. It is one file with nothing to
install. Your bankroll, stats and table rules are kept in that browser.

## What is in it

- **Play.** A full table: a shoe of 1 to 8 decks with a cut card, insurance, splitting (up to four hands), doubling
  (after a split too, if the rules allow), late surrender, 3:2 or 6:5 blackjacks, the dealer standing on or hitting
  soft 17. The **coach** checks every move against basic strategy and shows the numbers behind the call. The running
  count, true count and decks left sit under the table, blurred until you peek. Every few hands it asks you for the
  running count before showing it.
- **Count drill.** Cards flip one at a time at the speed you pick; give the Hi-Lo count at the end and see how it ran.
- **True count.** A running count and a discard tray: divide by the decks left and round the way your rules say.
- **Strategy.** The basic strategy chart for the rules you set. Tap a square for the value of every move.
- **Rules and stats.** The table rules, and how often you made the book play, got the count, and so on.

Keys on a computer: H hit, S stand, D double, P split, R surrender, I insure, Space to deal.

## How the strategy is worked out

Basic strategy is not typed in from a chart. `strategy.mjs` computes it from the rules: the dealer's chances of
finishing on 17 to 21 or busting from each upcard, given that the dealer peeked and has no blackjack, and from that the
value of standing, hitting, doubling, splitting and surrendering every hand, with cards drawn from an infinite deck.
The tests check that two ways: 200,000 dealer hands drawn at random per upcard land on the computed odds within 2.5
standard errors, and hitting 16 against a 10 played out 300,000 times lands on the computed value within 0.5 standard
errors. A real shoe is finite, so the closest calls (outlined on the chart) can go the other way in practice.

The insurance coach uses the real shoe: insurance pays 2 to 1, so it is worth taking exactly when more than a third
of the unseen cards are tens, and after you decide it tells you what that share was.

## Files

- `engine.mjs`: the shoe, the rules, the Hi-Lo count, the true count and one round at a time.
- `strategy.mjs`: basic strategy from the rules.
- `app.js`, `page.html`: the screens.
- `test.mjs`: the checks (`node trainer/test.mjs`).
- `build.mjs`: puts the engine, strategy and screens into `blackjack-trainer.html` (`node trainer/build.mjs`).
