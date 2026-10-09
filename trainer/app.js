// The trainer's screens. Everything about the game is in engine.mjs and strategy.mjs; this file only draws and listens.
import { RULES, Shoe, Round, handTotal, hiLo, trueCount, points, cryptoRandom, RANKS, SUITS } from "./engine.mjs";
import { evaluate, chart } from "./strategy.mjs";

const $ = (id) => document.getElementById(id);
const store = { get(k, d) { try { const v = localStorage.getItem("shoecounter." + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem("shoecounter." + k, JSON.stringify(v)); } catch {} } };
const SUIT = { S: "♠", H: "♥", D: "♦", C: "♣" }, NAME = { hit: "Hit", stand: "Stand", double: "Double", split: "Split", surrender: "Surrender" };
const money = (x) => (x < 0 ? "-" : "") + Math.abs(x).toLocaleString("en-US", { maximumFractionDigits: 2 });

let settings = { ...RULES, tcRound: "floor", quizEvery: 5, ...store.get("settings", {}) };
let stats = { bankroll: 1000, hands: 0, decisions: 0, correct: 0, quizzes: 0, quizRight: 0, drills: 0, drillRight: 0, tcs: 0, tcRight: 0, ...store.get("stats", {}) };
let shoe = newShoe(), round = null, bet = store.get("bet", 10), showCount = false;
function newShoe() { return new Shoe({ decks: settings.decks, penetration: settings.penetration }); }
const save = () => { store.set("settings", settings); store.set("stats", stats); store.set("bet", bet); };

// ------------------------------------------------------------------ cards
function cardEl(c, hidden = false) {
  const el = document.createElement("div");
  if (hidden) { el.className = "card back"; el.setAttribute("aria-label", "face-down card"); return el; }
  el.className = "card" + (c.suit === "H" || c.suit === "D" ? " red" : "");
  el.innerHTML = `<span>${c.rank}</span><span class="pip">${SUIT[c.suit]}</span>`;
  el.setAttribute("aria-label", `${c.rank} of ${{ S: "spades", H: "hearts", D: "diamonds", C: "clubs" }[c.suit]}`);
  return el;
}
const totalText = (cards) => { const { total, soft } = handTotal(cards); return total > 21 ? `${total} bust` : soft && total < 21 ? `soft ${total}` : String(total); };

// ------------------------------------------------------------------ the table
function arc() {
  const r = settings;
  $("arc").innerHTML = `Blackjack pays <b>${r.blackjackPays === 1.5 ? "3 to 2" : "6 to 5"}</b> · Dealer ${r.hitSoft17 ? "hits" : "stands on"} soft 17 · Insurance pays 2 to 1 · ${r.decks} deck${r.decks > 1 ? "s" : ""}`;
}
function drawTable() {
  const d = $("dealer"), h = $("hands"); d.replaceChildren(); h.replaceChildren();
  if (!round) { $("dealer-total").textContent = ""; return; }
  round.dealer.forEach((c, i) => d.append(cardEl(c, i === 1 && !round.holeShown)));
  $("dealer-total").textContent = round.holeShown ? totalText(round.dealer) : `shows ${points(round.upcard.rank) === 11 ? "A" : points(round.upcard.rank)}`;
  round.hands.forEach((hand, i) => {
    const wrap = document.createElement("div"); wrap.className = "hand" + (round.phase === "player" && i === round.active && round.hands.length > 1 ? " active" : "");
    const cards = document.createElement("div"); cards.className = "cards"; hand.cards.forEach((c) => cards.append(cardEl(c)));
    const res = round.results?.hands[i], meta = document.createElement("div"); meta.className = "meta";
    meta.textContent = `${totalText(hand.cards)} · bet ${money(hand.bet)}${res ? ` · ${res.result} ${res.net > 0 ? "+" : ""}${money(res.net)}` : ""}`;
    wrap.append(cards, meta); h.append(wrap);
  });
}
function drawCount() {
  const rc = shoe.runningCount, tc = trueCount(rc, shoe.left, settings.tcRound);
  $("rc").textContent = (rc > 0 ? "+" : "") + rc; $("tc").textContent = (tc > 0 ? "+" : "") + tc; $("decks").textContent = shoe.decksLeft.toFixed(1);
  for (const id of ["s-rc", "s-tc"]) $(id).classList.toggle("blur", !showCount);
  $("tray").style.width = `${(100 * shoe.next) / shoe.size}%`; $("cut").style.left = `${100 * shoe.penetration}%`;
  $("acc").textContent = stats.decisions ? `${Math.round((100 * stats.correct) / stats.decisions)}%` : "–";
  $("bankroll").textContent = money(stats.bankroll);
}
function drawControls() {
  const opts = round?.options() ?? [], ins = round?.phase === "insurance";
  for (const b of document.querySelectorAll("#actions [data-move]")) { b.disabled = !opts.includes(b.dataset.move); b.hidden = ins; }
  $("a-ins-yes").hidden = $("a-ins-no").hidden = !ins;
  $("deal").disabled = !!round && round.phase !== "done" || !$("quiz").hidden;
  $("bet").textContent = money(bet);
}
function render() { drawTable(); drawCount(); drawControls(); }

// ------------------------------------------------------------------ playing
function deal() {
  if (round && round.phase !== "done") return;
  let note = "";
  if (shoe.pastCut) { shoe.shuffle(); note = "The cut card came out: new shoe, the count starts again at 0. "; }
  round = new Round(shoe, settings, bet); $("coach").textContent = "";
  $("msg").textContent = note + (round.phase === "insurance" ? "Dealer shows an ace. Insurance?" : "");
  if (round.phase === "done") finish(); else render();
}
function act(move) {
  if (!round || !round.options().includes(move)) return;
  const hand = round.hand, ranked = evaluate(hand.cards, round.upcard.rank, round.options(), settings), best = ranked[0], mine = ranked.find(([m]) => m === move);
  stats.decisions++; const right = move === best[0] || Math.abs(mine[1] - best[1]) < 1e-9; if (right) stats.correct++;
  const gap = best[1] - mine[1], close = ranked.length > 1 && ranked[0][1] - ranked[1][1] < 0.01;
  const label = `${totalText(hand.cards)} against ${round.upcard.rank}`;
  $("coach").innerHTML = right
    ? `<span class="hit">${NAME[move]}</span> on ${label} is the book play${close ? " (a close call)" : ""}.`
    : `<span class="miss">The book says ${NAME[best[0]]}</span> on ${label}: ${ranked.map(([m, ev]) => `${m} <b>${ev >= 0 ? "+" : ""}${ev.toFixed(3)}</b>`).join(", ")} per unit bet. ${NAME[move]} gives up ${gap.toFixed(3)}.`;
  round.act(move);
  if (round.phase === "done") finish(); else render();
}
function insure(yes) {
  if (round?.phase !== "insurance") return;
  // insurance pays 2 to 1, so it is worth taking only when more than a third of the unseen cards are tens
  const unseen = shoe.cards.slice(shoe.next).concat([round.dealer[1]]), tens = unseen.filter((c) => points(c.rank) === 10).length, share = tens / unseen.length;
  round.takeInsurance(yes);
  $("coach").innerHTML = `Insurance wins when more than 1 in 3 unseen cards are tens. Right now it was <b>${(100 * share).toFixed(1)}%</b> (${tens} of ${unseen.length}), so ${share > 1 / 3 ? "<b>taking it</b>" : "<b>declining</b>"} was right.`;
  $("msg").textContent = "";
  if (round.phase === "done") finish(); else render();
}
function finish() {
  const r = round.results; stats.bankroll += r.net; stats.hands++;
  const lines = { blackjack: "Blackjack!", win: "You win", lose: "Dealer wins", bust: "Bust", push: "Push", surrender: "Surrendered" };
  const each = r.hands.map((h) => lines[h.result]).join(" / ");
  $("msg").innerHTML = `${r.dealerBlackjack ? "Dealer blackjack. " : ""}${each}. <span class="${r.net > 0 ? "good" : r.net < 0 ? "bad" : "warn"}">${r.net > 0 ? "+" : ""}${money(r.net)}</span>${r.insurance ? ` (insurance ${r.insurance > 0 ? "+" : ""}${money(r.insurance)})` : ""}`;
  save(); render();
  if (settings.quizEvery > 0 && stats.hands % settings.quizEvery === 0) askCount();
}
function askCount() {
  const q = $("quiz"); q.hidden = false;
  q.innerHTML = `<b>Count check.</b> What is the running count now?<div class="row"><input id="q-rc" type="number" inputmode="numeric" aria-label="Running count"><button class="btn primary" id="q-go">Check</button><button class="btn" id="q-skip">Skip</button></div><div id="q-out"></div>`;
  $("q-rc").focus(); drawControls();
  const done = () => { q.hidden = true; q.replaceChildren(); drawControls(); };
  $("q-skip").onclick = done;
  $("q-go").onclick = () => {
    const v = Number($("q-rc").value), rc = shoe.runningCount, ok = v === rc, tc = trueCount(rc, shoe.left, settings.tcRound);
    stats.quizzes++; if (ok) stats.quizRight++; save();
    $("q-out").innerHTML = `${ok ? '<span class="good" style="color:var(--good)">Right.</span>' : `<span style="color:var(--bad)">It was ${rc > 0 ? "+" : ""}${rc}.</span>`} With ${shoe.decksLeft.toFixed(1)} decks left that is a true count of ${tc > 0 ? "+" : ""}${tc}.`;
    $("q-go").remove(); $("q-skip").textContent = "Back to the table"; $("q-skip").focus();
  };
  $("q-rc").addEventListener("keydown", (e) => { if (e.key === "Enter") $("q-go")?.click(); });
}

// ------------------------------------------------------------------ bets
const CHIPS = [[1, "#6b7a8f"], [5, "#b8322c"], [25, "#1f7a4d"], [100, "#1d1d22"]];
for (const [v, col] of CHIPS) { const b = document.createElement("button"); b.className = "chip"; b.style.background = col; b.textContent = v; b.title = `Add ${v} (tap and hold to remove)`; b.onclick = () => { bet = Math.min(bet + v, 1000); save(); drawControls(); }; b.oncontextmenu = (e) => { e.preventDefault(); bet = Math.max(1, bet - v); save(); drawControls(); }; $("chips").append(b); }
const clear = document.createElement("button"); clear.className = "btn"; clear.textContent = "Clear"; clear.onclick = () => { bet = 1; save(); drawControls(); }; $("chips").append(clear);

// ------------------------------------------------------------------ count drill
let drillTimer = null;
function startDrill() {
  clearInterval(drillTimer); $("d-quiz").hidden = true; $("d-seq").replaceChildren();
  const n = Number($("d-n").value), rng = cryptoRandom(), deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  const cards = deck.slice(0, n); let i = 0;
  const show = () => { $("d-card").replaceChildren(cardEl(cards[i])); i++; if (i >= cards.length) { clearInterval(drillTimer); setTimeout(() => askDrill(cards), Number($("d-speed").value)); } };
  show(); drillTimer = setInterval(show, Number($("d-speed").value));
}
function askDrill(cards) {
  $("d-card").replaceChildren(); const q = $("d-quiz"); q.hidden = false;
  q.innerHTML = `<b>${cards.length} cards.</b> Running count?<div class="row"><input id="d-ans" type="number" inputmode="numeric" aria-label="Running count"><button class="btn primary" id="d-go">Check</button></div><div id="d-out"></div>`;
  $("d-ans").focus();
  const go = () => {
    const rc = cards.reduce((s, c) => s + hiLo(c.rank), 0), ok = Number($("d-ans").value) === rc; stats.drills++; if (ok) stats.drillRight++; save();
    $("d-out").innerHTML = ok ? '<span style="color:var(--good)">Right.</span>' : `<span style="color:var(--bad)">It was ${rc > 0 ? "+" : ""}${rc}.</span> Here is how it ran:`;
    let run = 0; $("d-seq").replaceChildren(...cards.map((c) => { run += hiLo(c.rank); const s = document.createElement("span"); const t = hiLo(c.rank); s.className = t > 0 ? "p" : t < 0 ? "m" : ""; s.textContent = `${c.rank}${SUIT[c.suit]} ${run > 0 ? "+" : ""}${run}`; return s; }));
    $("d-go").remove();
  };
  $("d-go").onclick = go; $("d-ans").addEventListener("keydown", (e) => { if (e.key === "Enter") $("d-go") && go(); });
}

// ------------------------------------------------------------------ true count drill
let tcq = null;
function nextTc() {
  const rng = cryptoRandom(), half = 1 + Math.floor(rng() * (2 * settings.decks - 1)), decks = half / 2, rc = Math.round((rng() * 2 - 1) * 4 * Math.max(decks, 2));
  tcq = { rc, decks }; $("t-rc").textContent = (rc > 0 ? "+" : "") + rc; $("t-decks").textContent = decks.toFixed(1);
  $("t-tray").style.width = `${100 * (1 - decks / settings.decks)}%`; $("t-answer").value = ""; $("t-msg").textContent = ""; $("t-answer").focus();
}
function checkTc() {
  if (!tcq) return; const want = trueCount(tcq.rc, tcq.decks * 52, settings.tcRound), ok = Number($("t-answer").value) === want; stats.tcs++; if (ok) stats.tcRight++; save();
  $("t-msg").innerHTML = ok ? `<span class="good" style="color:var(--good)">Right: ${want > 0 ? "+" : ""}${want}.</span>` : `<span style="color:var(--bad)">${tcq.rc} / ${tcq.decks.toFixed(1)} = ${(tcq.rc / tcq.decks).toFixed(2)}, ${settings.tcRound === "floor" ? "rounded down" : "toward zero"} is ${want > 0 ? "+" : ""}${want}.</span>`;
}

// ------------------------------------------------------------------ chart
function drawChart() {
  const c = chart(settings), up = (u) => (u === 11 ? "A" : u);
  $("chart-note").textContent = `For ${settings.decks} deck${settings.decks > 1 ? "s" : ""}, dealer ${settings.hitSoft17 ? "hits" : "stands on"} soft 17, ${settings.das ? "" : "no "}double after split, ${settings.lateSurrender ? "" : "no "}late surrender. Worked out from the rules with an infinite deck, so a close call can go the other way in a real shoe.`;
  let html = "";
  for (const [name, rows] of [["Hard", c.rows.hard], ["Soft", c.rows.soft], ["Pairs", c.rows.pairs]]) {
    html += `<table class="chart"><thead><tr><th>${name}</th>${c.ups.map((u) => `<th>${up(u)}</th>`).join("")}</tr></thead><tbody>`;
    for (const r of rows) html += `<tr><th>${r.label}</th>${r.cells.map((x, i) => `<td class="c-${x.code}${x.gap < 0.01 ? " close" : ""}" data-row="${r.label}" data-up="${up(c.ups[i])}" data-ev='${JSON.stringify(Object.fromEntries(Object.entries(x.ev).map(([k, v]) => [k, +v.toFixed(4)])))}'>${x.code}</td>`).join("")}</tr>`;
    html += "</tbody></table>";
  }
  $("chart").innerHTML = html;
}
$("chart").addEventListener("click", (e) => { const td = e.target.closest("td"); if (!td) return; const ev = JSON.parse(td.dataset.ev); $("chart-ev").textContent = `${td.dataset.row} against ${td.dataset.up}: ` + Object.entries(ev).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v >= 0 ? "+" : ""}${v.toFixed(3)}`).join(", ") + " per unit bet"; });

// ------------------------------------------------------------------ rules and stats
const R = { "r-decks": ["decks", Number], "r-h17": ["hitSoft17", (v) => v === "true"], "r-bj": ["blackjackPays", Number], "r-das": ["das", (v) => v === "true"], "r-sur": ["lateSurrender", (v) => v === "true"], "r-pen": ["penetration", Number], "r-round": ["tcRound", String], "r-quiz": ["quizEvery", Number] };
for (const [id, [key, parse]] of Object.entries(R)) {
  $(id).value = String(settings[key]);
  $(id).onchange = () => { settings[key] = parse($(id).value); if (!["tcRound", "quizEvery"].includes(key)) { shoe = newShoe(); round = null; $("msg").textContent = "New rules, new shoe."; } save(); arc(); drawChart(); render(); drawStats(); };
}
function drawStats() {
  const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "–");
  $("stats").innerHTML = [["Hands", stats.hands], ["Book plays", `${pct(stats.correct, stats.decisions)} of ${stats.decisions}`], ["Count checks", `${pct(stats.quizRight, stats.quizzes)} of ${stats.quizzes}`], ["Drills", `${pct(stats.drillRight, stats.drills)} of ${stats.drills}`], ["True counts", `${pct(stats.tcRight, stats.tcs)} of ${stats.tcs}`], ["Bankroll", money(stats.bankroll)]].map(([k, v]) => `<div class="stat"><small>${k}</small><b>${v}</b></div>`).join("");
}
let armed = false;
$("reset").onclick = () => {
  if (!armed) { armed = true; $("reset").textContent = "Tap again to reset"; $("reset-msg").textContent = ""; setTimeout(() => { armed = false; $("reset").textContent = "Reset bankroll and stats"; }, 4000); return; }
  armed = false; stats = { bankroll: 1000, hands: 0, decisions: 0, correct: 0, quizzes: 0, quizRight: 0, drills: 0, drillRight: 0, tcs: 0, tcRight: 0 }; save();
  $("reset").textContent = "Reset bankroll and stats"; $("reset-msg").textContent = "Bankroll back to 1,000, stats cleared."; drawStats(); render();
};

// ------------------------------------------------------------------ wiring
function tab(name) {
  for (const b of document.querySelectorAll("nav button")) b.setAttribute("aria-selected", String(b.dataset.tab === name));
  for (const v of ["play", "drill", "tc", "chart", "rules"]) $("view-" + v).hidden = v !== name;
  if (name === "tc" && !tcq) nextTc(); if (name === "rules") drawStats(); if (name !== "drill") clearInterval(drillTimer);
  store.set("tab", name);
}
for (const b of document.querySelectorAll("nav button")) b.onclick = () => tab(b.dataset.tab);
for (const b of document.querySelectorAll("#actions [data-move]")) b.onclick = () => act(b.dataset.move);
$("a-ins-yes").onclick = () => insure(true); $("a-ins-no").onclick = () => insure(false);
$("deal").onclick = deal; $("d-start").onclick = startDrill; $("t-check").onclick = checkTc; $("t-next").onclick = nextTc;
$("t-answer").addEventListener("keydown", (e) => { if (e.key === "Enter") checkTc(); });
$("show-count").onchange = () => { showCount = $("show-count").checked; drawCount(); };
for (const id of ["s-rc", "s-tc"]) $(id).onclick = () => { $(id).classList.toggle("blur"); };
document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, select") || $("view-play").hidden) return;
  const k = e.key.toLowerCase(), m = { h: "hit", s: "stand", d: "double", p: "split", r: "surrender" }[k];
  if (m) act(m); else if (k === " " || k === "enter") { e.preventDefault(); if (round?.phase === "insurance") insure(false); else if (!$("deal").disabled) deal(); }
  else if (k === "i" && round?.phase === "insurance") insure(true);
});
arc(); drawChart(); tab(store.get("tab", "play")); deal();
