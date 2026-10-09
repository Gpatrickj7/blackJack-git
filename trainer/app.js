// The game's screens. Everything about blackjack is in engine.mjs and strategy.mjs, the other players in bots.mjs, the
// simulator in sim.mjs and the career's tables in career.mjs; this file draws, listens and keeps the score.
import { RULES, Shoe, Round, handTotal, hiLo, trueCount, points, cryptoRandom, RANKS, SUITS } from "./engine.mjs";
import { evaluate, chart, houseEdge } from "./strategy.mjs";
import { STYLES, botMove, botInsures, betFor, SPREAD } from "./bots.mjs";
import { Sim, TC_MIN } from "./sim.mjs";
import { TABLES, START, BACKOFF, COOLDOWN, heatAfter } from "./career.mjs";

const $ = (id) => document.getElementById(id);
const store = { get(k, d) { try { const v = localStorage.getItem("shoecounter." + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem("shoecounter." + k, JSON.stringify(v)); } catch {} } };
const SUIT = { S: "♠", H: "♥", D: "♦", C: "♣" }, NAME = { hit: "Hit", stand: "Stand", double: "Double", split: "Split", surrender: "Surrender" };
const money = (x) => (x < 0 ? "-" : "") + Math.abs(x).toLocaleString("en-US", { maximumFractionDigits: 2 });
const signed = (x, d = 0) => (x > 0 ? "+" : x < 0 ? "-" : "") + Math.abs(x).toFixed(d);
const houseText = (ret) => (ret <= 0 ? `House edge ${(-100 * ret).toFixed(2)}%` : `Player edge ${(100 * ret).toFixed(2)}%`);
const pct = (x, d = 2) => `${x >= 0 ? "+" : "-"}${Math.abs(100 * x).toFixed(d)}%`;
const wait = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
const RULE_KEYS = Object.keys(RULES);

// ------------------------------------------------------------------ state
const DEFAULTS = { ...RULES, tcRound: "floor", quizEvery: 5, mode: "career", speed: "normal", sound: true, coach: true, countView: "blur", seats: 3, mySeat: 1, styles: ["book", "hunch", "counter", "mimic", "wild", "book"], table: "downtown" };
let settings = { ...DEFAULTS, ...store.get("settings", {}) };
const freshStats = () => ({ bankroll: START, best: START, careers: 1, freeBank: 1000, hands: 0, decisions: 0, correct: 0, quizzes: 0, quizRight: 0, drills: 0, drillRight: 0, tcs: 0, tcRight: 0, won: 0, lost: 0, blackjacks: 0, backoffs: 0 });
let stats = { ...freshStats(), ...store.get("stats", {}) };
const freshCareer = () => ({ unlocked: TABLES.filter((t) => t.unlock === 0).map((t) => t.id), heat: {}, cooldown: {}, prevBet: 0 });
let career = { ...freshCareer(), ...store.get("career", {}) };
let bet = store.get("bet", 10);
const save = () => { store.set("settings", settings); store.set("stats", stats); store.set("career", career); store.set("bet", bet); };

const careerMode = () => settings.mode === "career";
const tableOf = () => TABLES.find((t) => t.id === settings.table) ?? TABLES[1];
const rules = () => (careerMode() ? { ...RULES, ...tableOf().rules } : Object.fromEntries(RULE_KEYS.map((k) => [k, settings[k]])));
const limits = () => (careerMode() ? { min: tableOf().min, max: tableOf().max } : { min: 1, max: 10000 });
const bank = () => (careerMode() ? stats.bankroll : stats.freeBank);
const addBank = (x) => { if (careerMode()) { stats.bankroll += x; stats.best = Math.max(stats.best, stats.bankroll); } else stats.freeBank += x; };
const speedMs = () => ({ slow: [480, 750], normal: [260, 420], fast: [110, 160], instant: [0, 0] })[settings.speed] ?? [260, 420];

let shoe = newShoe(), round = null, shown = 0, flipped = false, busy = false, quizDue = false;
function newShoe() { const r = rules(); return new Shoe({ decks: r.decks, penetration: r.penetration }); }
const tcNow = () => trueCount(shoe.runningCount, shoe.left, settings.tcRound);

// ------------------------------------------------------------------ sound: made on the spot, nothing downloaded
const sfx = (() => {
  let ctx = null;
  const ac = () => { if (!ctx) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; ctx = new A(); } return ctx; };
  const tone = (f, t0, dur, gain = 0.06, type = "sine") => { const c = ac(); if (!c) return; const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = f; g.gain.setValueAtTime(gain, c.currentTime + t0); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + t0 + dur); o.connect(g).connect(c.destination); o.start(c.currentTime + t0); o.stop(c.currentTime + t0 + dur + 0.02); };
  const flick = () => { const c = ac(); if (!c) return; const n = Math.floor(c.sampleRate * 0.05), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2; const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); f.type = "bandpass"; f.frequency.value = 2400; f.Q.value = 0.8; g.gain.value = 0.35; s.buffer = b; s.connect(f).connect(g).connect(c.destination); s.start(); };
  const go = (fn) => { if (!settings.sound) return; try { fn(); } catch {} };
  return { card: () => go(flick), chip: () => go(() => { tone(2300, 0, 0.06, 0.05); tone(3100, 0.03, 0.06, 0.04); }), win: () => go(() => [523, 659, 784].forEach((f, i) => tone(f, i * 0.08, 0.22, 0.05, "triangle"))), lose: () => go(() => tone(196, 0, 0.3, 0.05, "triangle")), bj: () => go(() => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.07, 0.3, 0.05, "triangle"))) };
})();

// ------------------------------------------------------------------ cards and seats
function cardHtml(c, { back = false, anim = "" } = {}) {
  if (back) return `<div class="card back ${anim}" aria-label="face-down card"></div>`;
  const red = c.suit === "H" || c.suit === "D";
  return `<div class="card${red ? " red" : ""} ${anim}" aria-label="${c.rank} of ${{ S: "spades", H: "hearts", D: "diamonds", C: "clubs" }[c.suit]}"><span class="corner">${c.rank}<i>${SUIT[c.suit]}</i></span><span class="pip">${SUIT[c.suit]}</span></div>`;
}
const totalText = (cards) => { if (!cards.length) return ""; const { total, soft } = handTotal(cards); return total > 21 ? `${total} bust` : soft && total < 21 ? `soft ${total}` : String(total); };
let animated = new Set();
const anim = (c) => { if (animated.has(c.seq)) return ""; animated.add(c.seq); return "new"; };
const visible = (cards) => cards.filter((c) => c.seq < shown);
function seatPlan() { const n = Number(settings.seats), me = Math.min(Number(settings.mySeat), n - 1), out = []; let k = 0; for (let i = 0; i < n; i++) out.push(i === me ? "me" : settings.styles[k++ % settings.styles.length]); return { styles: out, me }; }

function drawTable() {
  const r = rules(), R = round, d = $("dealer");
  if (!R) { d.innerHTML = cardHtml(null, { back: true }); $("dealer-total").textContent = ""; }
  else {
    const vis = visible(R.dealer);
    d.innerHTML = vis.map((c, i) => (i === 1 && r.holeCard && !flipped ? cardHtml(c, { back: true, anim: anim(c) }) : cardHtml(c, { anim: i === 1 && r.holeCard && flipped && !animated.has("flip") ? (animated.add("flip"), "flip") : anim(c) }))).join("");
    const all = flipped || !r.holeCard, up = vis.length ? (points(vis[0].rank) === 11 ? "A" : points(vis[0].rank)) : "";
    $("dealer-total").textContent = !vis.length ? "" : all && vis.length > 1 ? totalText(vis) : `shows ${up}`;
  }
  const plan = R ? { styles: R.styles, me: R.me } : seatPlan(), showRes = R && R.phase === "done" && !busy;
  $("seats").innerHTML = plan.styles.map((style, seat) => {
    const me = style === "me", label = me ? "You" : STYLES[style].label, turn = R && !busy && R.phase !== "done" && R.turn === seat;
    let body = "";
    if (R) {
      const hands = R.hands.filter((h) => h.seat === seat), res = showRes ? R.results.seats[seat].hands : null;
      body = `<div class="hands">${hands.map((h, i) => {
        const vis = visible(h.cards), active = R.phase === "player" && R.hand === h && hands.length > 1 && !busy;
        const rr = res?.[i], betTxt = `<span class="chipstack"><i></i>${money(h.bet)}</span>`;
        return `<div class="hand${active ? " active" : ""}"><div class="cards">${vis.map((c) => cardHtml(c, { anim: anim(c) })).join("")}</div><div class="meta">${totalText(vis)}</div>${betTxt}${rr ? `<div class="res ${rr.result}">${rr.result} ${rr.net ? signed(rr.net, rr.net % 1 ? 2 : 0) : ""}</div>` : ""}</div>`;
      }).join("")}</div>`;
      if (showRes && R.results.seats[seat].insurance) body += `<div class="meta">insurance ${signed(R.results.seats[seat].insurance, 0)}</div>`;
    } else body = `<div class="hands"><div class="cards"></div></div>${me ? `<span class="chipstack"><i></i>${money(bet)}</span>` : ""}`;
    return `<div class="seat${me ? " me" : ""}${turn ? " turn" : ""}" title="${me ? "Your seat" : STYLES[style].note}"><div class="who">${label}</div>${body}</div>`;
  }).join("");
}
function drawShoe() {
  const dealt = shoe.next / shoe.size;
  $("disc").style.height = `${Math.min(58, 58 * dealt)}px`; $("disc-n").textContent = `${(shoe.next / 52).toFixed(1)} dealt`;
  $("shoe-fill").style.height = `${58 * (1 - dealt)}px`; $("shoe-cut").style.bottom = `${4 + 54 * (1 - shoe.penetration)}px`;
  $("shoe-cut").hidden = rules().csm || shoe.next >= shoe.cut;
  $("shoe-n").textContent = rules().csm ? "shuffler" : `${shoe.decksLeft.toFixed(1)} left`;
}
function drawCount() {
  const rc = shoe.runningCount, tc = tcNow(), v = settings.countView;
  $("rc").textContent = signed(rc); $("tc").textContent = signed(tc); $("decks").textContent = shoe.decksLeft.toFixed(1);
  for (const id of ["s-rc", "s-tc"]) { $(id).classList.toggle("blur", v === "blur"); $(id).classList.toggle("off", v === "hidden"); }
  $("acc").textContent = stats.decisions ? `${Math.round((100 * stats.correct) / stats.decisions)}%` : "–";
  $("bankroll").textContent = money(bank()); $("best").textContent = money(stats.best);
  $("mode-pill").textContent = careerMode() ? "Career" : "Free play"; $("best-wrap").hidden = !careerMode();
}
function drawBar() {
  const t = tableOf(), L = limits(), r = rules();
  $("table-pick").hidden = !careerMode();
  if (careerMode()) $("table-pick").innerHTML = TABLES.map((x) => { const open = career.unlocked.includes(x.id), cd = career.cooldown[x.id] ?? 0; return `<option value="${x.id}"${x.id === t.id ? " selected" : ""}${open && !cd ? "" : " disabled"}>${x.name}${open ? (cd ? ` (closed to you: ${cd} rounds)` : "") : ` (opens at ${money(x.unlock)})`}</option>`; }).join("");
  $("limits").textContent = `${money(L.min)} to ${money(L.max)}`;
  $("table-edge").innerHTML = houseText(houseEdge(r)).replace(/ ([\d.]+%)$/, " <b>$1</b>");
  $("heat-wrap").hidden = !careerMode(); $("heat").style.width = `${career.heat[t.id] ?? 0}%`;
  const bj = r.blackjackPays === 1.5 ? "3 to 2" : r.blackjackPays === 1.2 ? "6 to 5" : "1 to 1";
  $("arc").innerHTML = `Blackjack pays <b>${bj}</b> · Dealer ${r.hitSoft17 ? "hits" : "stands on"} soft 17 · ${r.holeCard ? "Insurance pays 2 to 1" : "<b>No hole card</b>"} · ${r.csm ? "<b>Continuous shuffler</b>" : `${r.decks} deck${r.decks > 1 ? "s" : ""}`}`;
}
function drawControls() {
  const mine = round && !busy && round.phase !== "done" && round.styles[round.turn] === "me";
  const opts = mine && round.phase === "player" ? round.options() : [], ins = mine && round.phase === "insurance";
  for (const b of document.querySelectorAll("#actions [data-move]")) { b.disabled = !opts.includes(b.dataset.move); b.hidden = ins; }
  $("a-ins-yes").hidden = $("a-ins-no").hidden = !ins;
  const idle = !round || round.phase === "done";
  $("deal").disabled = busy || !idle || !$("quiz").hidden || !$("banner").hidden;
  for (const id of ["bet-x2", "bet-min"]) $(id).disabled = busy || !idle;
  $("bet").textContent = money(bet);
}
function render() { drawBar(); drawTable(); drawShoe(); drawCount(); drawControls(); }

// ------------------------------------------------------------------ a round
async function reveal() {
  const [card] = speedMs();
  for (;;) {
    if (round.holeShown && !flipped && shown >= round.flipSeq) { flipped = true; if (round.rules.holeCard) { render(); sfx.card(); await wait(card); } continue; }
    if (shown >= round.seq) break;
    shown++; render(); sfx.card(); await wait(card);
  }
}
async function drive() {
  busy = true; render();
  await reveal();
  const [, think] = speedMs();
  while (round.phase !== "done" && round.styles[round.turn] !== "me") {
    await wait(think);
    const style = round.styles[round.turn];
    if (round.phase === "insurance") round.takeInsurance(botInsures(style, tcNow())); else round.act(botMove(style, round));
    await reveal();
  }
  busy = false;
  if (round.phase === "done") finish();
  else { if (round.phase === "insurance") $("msg").textContent = "Dealer shows an ace. Insurance?"; render(); }
}
function deal() {
  if (busy || (round && round.phase !== "done") || !$("quiz").hidden || !$("banner").hidden) return;
  const L = limits(), t = tableOf();
  if (careerMode() && (career.cooldown[t.id] ?? 0) > 0) { $("msg").innerHTML = `<span class="bad">The pit has asked you to leave ${t.name} for now.</span> Pick another table.`; return; }
  bet = Math.max(L.min, Math.min(bet, L.max));
  if (bet > bank()) { if (bank() >= L.min) bet = Math.floor(bank()); else { broke(); return; } }
  let note = "";
  if (rules().csm) { shoe.shuffle(); } else if (shoe.pastCut) { shoe.shuffle(); note = "The cut card came out: a new shoe, the count starts again at 0. "; }
  const tc = tcNow(), { styles, me } = seatPlan();
  round = new Round(shoe, rules(), styles.map((s) => (s === "me" ? bet : s === "counter" ? L.min * betFor(SPREAD, tc) : L.min)), { me });
  round.styles = styles; round.tcAtDeal = tc; shown = 0; flipped = false; animated = new Set();
  $("msg").textContent = note; $("coach").textContent = ""; sfx.chip();
  drive();
}
function coachLine(move) {
  const R = round, h = R.hand, opts = R.options(), ranked = evaluate(h.cards, R.upcard.rank, opts, R.rules, R.handsOf(h.seat).length), best = ranked[0], mine = ranked.find(([m]) => m === move);
  stats.decisions++; const right = move === best[0] || Math.abs(mine[1] - best[1]) < 1e-9; if (right) stats.correct++;
  if (!settings.coach) return;
  const gap = best[1] - mine[1], close = ranked.length > 1 && ranked[0][1] - ranked[1][1] < 0.01, label = `${totalText(h.cards)} against ${R.upcard.rank}`;
  $("coach").innerHTML = right
    ? `<span class="hit">${NAME[move]}</span> on ${label} is the book play${close ? " (a close call)" : ""}.`
    : `<span class="miss">The book says ${NAME[best[0]]}</span> on ${label}: ${ranked.map(([m, ev]) => `${m} <b>${ev >= 0 ? "+" : ""}${ev.toFixed(3)}</b>`).join(", ")} per unit bet. ${NAME[move]} gives up ${gap.toFixed(3)}.`;
}
function act(move) {
  if (busy || !round || round.phase !== "player" || round.styles[round.turn] !== "me" || !round.options().includes(move)) return;
  coachLine(move); if (move === "double" || move === "split") sfx.chip();
  round.act(move); drive();
}
function insure(yes) {
  if (busy || round?.phase !== "insurance" || round.styles[round.turn] !== "me") return;
  // insurance pays 2 to 1, so it is worth taking only when more than a third of the unseen cards are tens
  const unseen = shoe.unseen().concat(round.rules.holeCard ? [round.dealer[1]] : []), tens = unseen.filter((c) => points(c.rank) === 10).length, share = unseen.length ? tens / unseen.length : 4 / 13;
  round.takeInsurance(yes);
  if (settings.coach) $("coach").innerHTML = `Insurance wins when more than 1 in 3 unseen cards are tens. Right now it was <b>${(100 * share).toFixed(1)}%</b>${unseen.length ? ` (${tens} of ${unseen.length})` : ""}, so ${share > 1 / 3 ? "<b>taking it</b>" : "<b>declining</b>"} was right.`;
  $("msg").textContent = ""; drive();
}
function finish() {
  const R = round, r = R.results; addBank(r.net); stats.hands++;
  for (const h of r.hands) { if (h.net > 0) stats.won++; if (h.net < 0) stats.lost++; if (h.result === "blackjack") stats.blackjacks++; }
  const lines = { blackjack: "Blackjack!", win: "You win", lose: "Dealer wins", bust: "Bust", push: "Push", surrender: "Surrendered" };
  let extra = "";
  if (careerMode()) {
    const t = tableOf(), L = limits();
    for (const x of TABLES) if (x.id !== t.id) { career.heat[x.id] = Math.max(0, (career.heat[x.id] ?? 0) - 1); if (career.cooldown[x.id]) career.cooldown[x.id]--; }
    career.heat[t.id] = heatAfter(career.heat[t.id] ?? 0, { bet: R.bet, prevBet: career.prevBet, min: L.min, tc: R.tcAtDeal }); career.prevBet = R.bet;
    if (career.heat[t.id] >= BACKOFF) { career.cooldown[t.id] = COOLDOWN; career.heat[t.id] = 40; stats.backoffs++; extra = ` <span class="bad">The pit boss has seen your bets jump with the count: you are asked to leave ${t.name} for ${COOLDOWN} rounds.</span>`; }
    for (const x of TABLES) if (!career.unlocked.includes(x.id) && stats.bankroll >= x.unlock) { career.unlocked.push(x.id); extra += ` <span class="good">${x.name} is open to you now.</span>`; }
  }
  $("msg").innerHTML = `${r.dealerBlackjack ? "Dealer blackjack. " : ""}${r.hands.map((h) => lines[h.result]).join(" / ")}. <span class="${r.net > 0 ? "good" : r.net < 0 ? "bad" : "warn"}">${r.net > 0 ? "+" : ""}${money(r.net)}</span>${r.insurance ? ` (insurance ${r.insurance > 0 ? "+" : ""}${money(r.insurance)})` : ""}${extra}`;
  if (r.hands.some((h) => h.result === "blackjack")) sfx.bj(); else if (r.net > 0) sfx.win(); else if (r.net < 0) sfx.lose();
  save(); render();
  if (settings.quizEvery > 0 && stats.hands % settings.quizEvery === 0 && !rules().csm) askCount();
  if (bank() < limits().min) broke();
}
function broke() {
  const open = careerMode() && TABLES.some((x) => career.unlocked.includes(x.id) && !(career.cooldown[x.id] > 0) && x.min <= stats.bankroll);
  const b = $("banner"); b.hidden = false;
  b.innerHTML = careerMode()
    ? `<b>${money(stats.bankroll)} will not cover the ${money(limits().min)} minimum here.</b> ${open ? "Try a cheaper table, or start over." : `The career ends with a best bankroll of ${money(stats.best)}.`}<div class="row">${open ? '<button class="btn" id="b-ok">Pick another table</button>' : ""}<button class="btn primary" id="b-new">Start a new career</button></div>`
    : `<b>The free-play bankroll is spent.</b><div class="row"><button class="btn primary" id="b-new">Refill to 1,000</button></div>`;
  $("b-new").onclick = () => { if (careerMode()) newCareer(); else { stats.freeBank = 1000; save(); } b.hidden = true; render(); };
  if ($("b-ok")) $("b-ok").onclick = () => { b.hidden = true; render(); $("table-pick").focus(); };
  drawControls();
}
function newCareer() {
  stats.bankroll = START; stats.best = Math.max(stats.best, START); stats.careers++; career = freshCareer(); settings.table = "downtown"; bet = 10;
  shoe = newShoe(); round = null; save(); render(); $("msg").textContent = `Career ${stats.careers}: ${money(START)} to start.`;
}
function askCount() {
  const q = $("quiz"); q.hidden = false;
  q.innerHTML = `<b>Count check.</b> What is the running count now?<div class="row"><input id="q-rc" type="number" inputmode="numeric" aria-label="Running count"><button class="btn primary" id="q-go">Check</button><button class="btn" id="q-skip">Skip</button></div><div id="q-out"></div>`;
  $("q-rc").focus(); drawControls();
  const done = () => { q.hidden = true; q.replaceChildren(); drawControls(); };
  $("q-skip").onclick = done;
  $("q-go").onclick = () => {
    const v = Number($("q-rc").value), rc = shoe.runningCount, good = v === rc, tc = tcNow();
    stats.quizzes++; if (good) stats.quizRight++; save();
    $("q-out").innerHTML = `${good ? '<span style="color:var(--good)">Right.</span>' : `<span style="color:var(--bad)">It was ${signed(rc)}.</span>`} With ${shoe.decksLeft.toFixed(1)} decks left that is a true count of ${signed(tc)}.`;
    $("q-go").remove(); $("q-skip").textContent = "Back to the table"; $("q-skip").focus();
  };
  $("q-rc").addEventListener("keydown", (e) => { if (e.key === "Enter") $("q-go")?.click(); });
}

// ------------------------------------------------------------------ bets
const CHIPS = [[1, "#6b7a8f"], [5, "#b8322c"], [25, "#1f7a4d"], [100, "#1d1d22"], [500, "#6b3fa0"]];
for (const [v, col] of CHIPS) {
  const b = document.createElement("button"); b.className = "chip"; b.style.background = col; b.textContent = v; b.title = `Add ${v} (right-click to take off)`;
  b.onclick = () => { if (busy || (round && round.phase !== "done")) return; bet = Math.min(bet + v, limits().max); sfx.chip(); save(); drawControls(); drawTable(); };
  b.oncontextmenu = (e) => { e.preventDefault(); bet = Math.max(limits().min, bet - v); save(); drawControls(); drawTable(); };
  $("chips").append(b);
}
$("bet-x2").onclick = () => { bet = Math.min(bet * 2, limits().max); sfx.chip(); save(); drawControls(); drawTable(); };
$("bet-min").onclick = () => { bet = limits().min; save(); drawControls(); drawTable(); };

// ------------------------------------------------------------------ the simulator
let ramp = store.get("ramp", SPREAD.map((r) => r.slice())), simJob = null;
const PRESETS = { flat: [[-99, 1]], r8: [[-99, 1], [2, 2], [3, 4], [4, 6], [5, 8]], r12: [[-99, 1], [1, 2], [2, 4], [3, 8], [4, 12]], r16: [[-99, 1], [1, 2], [2, 6], [3, 10], [4, 16]] };
function drawRamp() {
  $("ramp").innerHTML = ramp.map(([t, u], i) => `<div class="r">${i === 0 ? "Below the next step" : `From true count <input type="number" data-i="${i}" data-k="0" value="${t}" aria-label="true count">`} bet <input type="number" min="0" data-i="${i}" data-k="1" value="${u}" aria-label="units"> unit${u === 1 ? "" : "s"}${i ? ` <button class="btn small" data-del="${i}">Remove</button>` : ""}</div>`).join("") + `<div class="r"><button class="btn small" id="ramp-add">Add a step</button></div>`;
  $("ramp-add").onclick = () => { const last = ramp[ramp.length - 1]; ramp.push([Math.max(1, (last[0] > -99 ? last[0] : 0) + 1), last[1] * 2]); store.set("ramp", ramp); drawRamp(); };
}
$("ramp").addEventListener("change", (e) => { const i = e.target.dataset.i; if (i == null) return; ramp[i][e.target.dataset.k] = Number(e.target.value); ramp = [ramp[0], ...ramp.slice(1).sort((a, b) => a[0] - b[0])]; store.set("ramp", ramp); drawRamp(); });
$("ramp").addEventListener("click", (e) => { const i = e.target.dataset.del; if (i == null) return; ramp.splice(Number(i), 1); store.set("ramp", ramp); drawRamp(); });
for (const b of document.querySelectorAll("[data-preset]")) b.onclick = () => { ramp = PRESETS[b.dataset.preset].map((r) => r.slice()); store.set("ramp", ramp); drawRamp(); };
function ruleSummary(r) { return `${r.csm ? "continuous shuffler" : `${r.decks} deck${r.decks > 1 ? "s" : ""} cut at ${Math.round(100 * r.penetration)}%`}, ${r.hitSoft17 ? "H17" : "S17"}, blackjack ${r.blackjackPays === 1.5 ? "3:2" : r.blackjackPays === 1.2 ? "6:5" : "1:1"}${r.das ? ", double after split" : ""}${r.lateSurrender && r.holeCard ? ", late surrender" : ""}${r.holeCard ? "" : ", no hole card"}${r.doubleOn !== "any" ? `, double ${r.doubleOn}` : ""}${r.resplitAces ? ", resplit aces" : ""}${careerMode() ? ` (${tableOf().name})` : ""}`; }
function runSim() {
  if (simJob) return;
  const r = rules(), n = Number($("sim-n").value), seed = (Math.random() * 2 ** 31) | 0, { styles, me } = seatPlan();
  const others = $("sim-others").value === "table" ? styles.filter((s) => s !== "me") : [], wong = $("sim-wong").value, ins = $("sim-ins").value;
  const sim = new Sim({ rules: r, rounds: n, seed, spread: ramp.map(([t, u]) => [t, Math.max(0, u)]), insureAt: ins === "" ? Infinity : Number(ins), wongOut: wong === "" ? null : Number(wong), others, seat: $("sim-others").value === "table" ? me : 0, tcRound: settings.tcRound });
  simJob = { sim, stop: false, seed, rules: r, t0: performance.now() }; $("sim-run").disabled = true; $("sim-stop").disabled = false; $("sim-out").innerHTML = "";
  const tick = () => {
    if (simJob.stop || sim.done) { simJob = null; $("sim-run").disabled = false; $("sim-stop").disabled = true; drawSimResults(sim, r, seed); return; }
    const t = performance.now(); while (!sim.done && performance.now() - t < 40) sim.step(Math.min(2000, sim.rounds - sim.played));
    $("sim-bar").style.width = `${(100 * sim.played) / sim.rounds}%`; $("sim-status").textContent = `${sim.played.toLocaleString("en-US")} rounds`;
    setTimeout(tick, 0);
  };
  tick();
}
function svgLine(points, w = 560, h = 200) {
  const pad = { l: 52, r: 10, t: 10, b: 26 }, xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const x0 = 0, x1 = Math.max(...xs, 1), y0 = Math.min(0, ...ys), y1 = Math.max(0, ...ys, 1);
  const X = (x) => pad.l + ((x - x0) / (x1 - x0)) * (w - pad.l - pad.r), Y = (y) => pad.t + (1 - (y - y0) / (y1 - y0 || 1)) * (h - pad.t - pad.b);
  const ticks = niceTicks(y0, y1, 4), xt = niceTicks(0, x1, 4);
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Units won or lost against rounds bet">
    ${ticks.map((v) => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(241,234,216,${v === 0 ? 0.45 : 0.1})"/><text x="${pad.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v.toLocaleString("en-US")}</text>`).join("")}
    ${xt.map((v) => `<text x="${X(v)}" y="${h - 8}" text-anchor="middle">${v >= 1000 ? `${v / 1000}k` : v}</text>`).join("")}
    <polyline fill="none" stroke="var(--gold)" stroke-width="2" points="${points.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(" ")}"/></svg>`;
}
function niceTicks(a, b, n) { const span = b - a || 1, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0)), step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= step0 * 0.999), out = []; for (let k = Math.ceil(a / step - 1e-9); k <= Math.floor(b / step + 1e-9); k++) out.push(Math.round(k * step * 1e9) / 1e9 || 0); return out; }
function svgBars(rows, w = 560, h = 220) {
  const pad = { l: 46, r: 10, t: 14, b: 40 }, vals = rows.map((r) => r.e), lo = Math.min(-0.02, ...vals), hi = Math.max(0.02, ...vals);
  const bw = (w - pad.l - pad.r) / rows.length, Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b), ticks = niceTicks(lo, hi, 5);
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Edge per unit bet at each true count">
    ${ticks.map((v) => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(241,234,216,${Math.abs(v) < 1e-9 ? 0.45 : 0.1})"/><text x="${pad.l - 6}" y="${Y(v) + 4}" text-anchor="end">${(100 * v).toFixed(0)}%</text>`).join("")}
    ${rows.map((r, i) => { const x = pad.l + i * bw + 2, y = Math.min(Y(r.e), Y(0)), hh = Math.max(1, Math.abs(Y(r.e) - Y(0))); return `<g><title>True count ${r.label}: ${pct(r.e)} per unit over ${r.n.toLocaleString("en-US")} rounds (${(100 * r.share).toFixed(1)}% of rounds)</title><rect x="${x}" y="${y}" width="${bw - 4}" height="${hh}" rx="3" fill="${r.e >= 0 ? "var(--good)" : "var(--bad)"}"/><text x="${x + (bw - 4) / 2}" y="${h - 24}" text-anchor="middle">${r.label}</text><text x="${x + (bw - 4) / 2}" y="${h - 8}" text-anchor="middle">${(100 * r.share).toFixed(0)}%</text></g>`; }).join("")}</svg>`;
}
function drawSimResults(sim, r, seed) {
  const s = sim.summary(Number($("sim-bank").value)), edge0 = houseEdge(r), total = sim.byTc.reduce((a, b) => a + b.n, 0);
  const rows = sim.byTc.map((b, i) => ({ tc: i + TC_MIN, label: i === 0 ? `${i + TC_MIN}-` : i === sim.byTc.length - 1 ? `+${i + TC_MIN}+` : signed(i + TC_MIN), n: b.n, e: b.n ? b.net / b.n : 0, share: b.n / (total || 1) })).filter((x) => x.n >= 200);
  const tile = (k, v, note = "") => `<div class="stat"><small>${k}</small><b>${v}</b>${note ? `<em>${note}</em>` : ""}</div>`;
  $("sim-out").innerHTML = `<div class="tiles">
    ${tile("Rounds bet", s.rounds.toLocaleString("en-US"), s.played > s.rounds ? `of ${s.played.toLocaleString("en-US")} dealt` : `seed ${seed}`)}
    ${tile("Per unit bet", pct(s.edge), `flat bets by the book: ${houseText(edge0).toLowerCase()} (infinite deck)`)}
    ${tile("Units a round", `${signed(s.ev, 4)}`, `+/- ${s.se.toFixed(4)} (one standard error)`)}
    ${tile("Per 100 rounds", `${signed(100 * s.ev, 2)} units`)}
    ${tile("Average bet", `${s.avgBet.toFixed(2)} units`)}
    ${tile("Swing per round", `${s.sd.toFixed(2)} units`, "standard deviation")}
    ${tile("Biggest drop", `${s.drawdown.toFixed(0)} units`, "peak to trough")}
    ${tile("Risk of ruin", s.ev > 0 ? `${(100 * s.ror).toFixed(s.ror < 0.01 ? 2 : 1)}%` : "certain", s.ev > 0 ? `with ${Number($("sim-bank").value).toLocaleString("en-US")} units, playing on forever (an approximation)` : "a losing game loses any bankroll in the long run")}
  </div>
  <div class="fig"><h4>Units won or lost, round by round</h4>${svgLine(sim.trace.map((y, i) => [i * sim.every, y]))}</div>
  <div class="fig"><h4>What a flat bet earns at each true count</h4><p>Edge per unit bet, from these rounds; the second row of numbers is how often each count came up. Counts with fewer than 200 rounds are left out. Tap or hover a bar for its numbers.</p>${rows.length ? svgBars(rows) : "<p>Not enough rounds yet.</p>"}</div>
  <p>Seed ${seed}, ${ruleSummary(r)}. The rounds are random, so two runs differ by about the standard error; a run of 2,000,000 rounds pins the edge to about a twentieth of a percent.</p>`;
}
$("sim-run").onclick = runSim; $("sim-stop").onclick = () => { if (simJob) simJob.stop = true; };

// ------------------------------------------------------------------ count drill
let drillTimer = null;
function startDrill() {
  clearInterval(drillTimer); $("d-quiz").hidden = true; $("d-seq").replaceChildren();
  const n = Number($("d-n").value), rng = cryptoRandom(), deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  const cards = deck.slice(0, n); let i = 0;
  const show = () => { $("d-card").innerHTML = cardHtml(cards[i]); sfx.card(); i++; if (i >= cards.length) { clearInterval(drillTimer); setTimeout(() => askDrill(cards), Number($("d-speed").value)); } };
  show(); drillTimer = setInterval(show, Number($("d-speed").value));
}
function askDrill(cards) {
  $("d-card").replaceChildren(); const q = $("d-quiz"); q.hidden = false;
  q.innerHTML = `<b>${cards.length} cards.</b> Running count?<div class="row"><input id="d-ans" type="number" inputmode="numeric" aria-label="Running count"><button class="btn primary" id="d-go">Check</button></div><div id="d-out"></div>`;
  $("d-ans").focus();
  const go = () => {
    const rc = cards.reduce((s, c) => s + hiLo(c.rank), 0), good = Number($("d-ans").value) === rc; stats.drills++; if (good) stats.drillRight++; save();
    $("d-out").innerHTML = good ? '<span style="color:var(--good)">Right.</span>' : `<span style="color:var(--bad)">It was ${signed(rc)}.</span> Here is how it ran:`;
    let run = 0; $("d-seq").replaceChildren(...cards.map((c) => { run += hiLo(c.rank); const s = document.createElement("span"), t = hiLo(c.rank); s.className = t > 0 ? "p" : t < 0 ? "m" : ""; s.textContent = `${c.rank}${SUIT[c.suit]} ${signed(run)}`; return s; }));
    $("d-go").remove();
  };
  $("d-go").onclick = go; $("d-ans").addEventListener("keydown", (e) => { if (e.key === "Enter" && $("d-go")) go(); });
}

// ------------------------------------------------------------------ true count drill
let tcq = null;
function nextTc() {
  const rng = cryptoRandom(), decks0 = rules().decks, half = 1 + Math.floor(rng() * (2 * decks0 - 1)), decks = half / 2, rc = Math.round((rng() * 2 - 1) * 4 * Math.max(decks, 2));
  tcq = { rc, decks }; $("t-rc").textContent = signed(rc); $("t-decks").textContent = decks.toFixed(1);
  $("t-tray").style.width = `${100 * (1 - decks / decks0)}%`; $("t-answer").value = ""; $("t-msg").textContent = ""; $("t-answer").focus();
}
function checkTc() {
  if (!tcq) return; const want = trueCount(tcq.rc, tcq.decks * 52, settings.tcRound), good = Number($("t-answer").value) === want; stats.tcs++; if (good) stats.tcRight++; save();
  $("t-msg").innerHTML = good ? `<span style="color:var(--good)">Right: ${signed(want)}.</span>` : `<span style="color:var(--bad)">${tcq.rc} / ${tcq.decks.toFixed(1)} = ${(tcq.rc / tcq.decks).toFixed(2)}, ${settings.tcRound === "floor" ? "rounded down" : "toward zero"} is ${signed(want)}.</span>`;
}

// ------------------------------------------------------------------ strategy chart
function drawChart() {
  const r = rules(), c = chart(r), up = (u) => (u === 11 ? "A" : u);
  $("chart-note").textContent = `For ${ruleSummary(r)}. Worked out from the rules with an infinite deck, so a close call can go the other way in a real shoe. ${houseText(houseEdge(r))} played this way.`;
  let html = "";
  for (const [name, rows] of [["Hard", c.rows.hard], ["Soft", c.rows.soft], ["Pairs", c.rows.pairs]]) {
    html += `<table class="chart"><thead><tr><th>${name}</th>${c.ups.map((u) => `<th>${up(u)}</th>`).join("")}</tr></thead><tbody>`;
    for (const row of rows) html += `<tr><th>${row.label}</th>${row.cells.map((x, i) => `<td class="c-${x.code}${x.gap < 0.01 ? " close" : ""}" data-row="${row.label}" data-up="${up(c.ups[i])}" data-ev='${JSON.stringify(Object.fromEntries(Object.entries(x.ev).map(([k, v]) => [k, +v.toFixed(4)])))}'>${x.code}</td>`).join("")}</tr>`;
    html += "</tbody></table>";
  }
  $("chart").innerHTML = html;
}
$("chart").addEventListener("click", (e) => { const td = e.target.closest("td"); if (!td) return; const ev = JSON.parse(td.dataset.ev); $("chart-ev").textContent = `${td.dataset.row} against ${td.dataset.up}: ` + Object.entries(ev).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v >= 0 ? "+" : ""}${v.toFixed(3)}`).join(", ") + " per unit bet"; });

// ------------------------------------------------------------------ settings
const RULE_UI = [
  ["decks", "Decks", [[1, "1"], [2, "2"], [4, "4"], [6, "6"], [8, "8"]], Number],
  ["hitSoft17", "Dealer soft 17", [[false, "stands"], [true, "hits"]], (v) => v === "true"],
  ["blackjackPays", "Blackjack pays", [[1.5, "3 to 2"], [1.2, "6 to 5"], [1, "1 to 1"]], Number],
  ["holeCard", "Hole card", [[true, "yes: the dealer peeks"], [false, "no (European)"]], (v) => v === "true"],
  ["doubleOn", "Double on", [["any", "any two cards"], ["9-11", "9, 10 or 11"], ["10-11", "10 or 11"]], String],
  ["das", "Double after split", [[true, "yes"], [false, "no"]], (v) => v === "true"],
  ["lateSurrender", "Late surrender", [[true, "yes"], [false, "no"]], (v) => v === "true"],
  ["maxHands", "Split up to", [[2, "2 hands"], [3, "3 hands"], [4, "4 hands"]], Number],
  ["resplitAces", "Resplit aces", [[false, "no"], [true, "yes"]], (v) => v === "true"],
  ["hitSplitAces", "Hit split aces", [[false, "no"], [true, "yes"]], (v) => v === "true"],
  ["penetration", "Cut card at", [[0.6, "60%"], [0.65, "65%"], [0.75, "75%"], [0.83, "83%"], [0.9, "90%"]], Number],
  ["csm", "Continuous shuffler", [[false, "no"], [true, "yes"]], (v) => v === "true"],
];
function drawSettings() {
  const r = rules(), cm = careerMode();
  $("rules").innerHTML = RULE_UI.map(([k, label, opts]) => `<label>${label}<select data-rule="${k}"${cm ? " disabled" : ""}>${opts.map(([v, t]) => `<option value="${v}"${String(r[k]) === String(v) ? " selected" : ""}>${t}</option>`).join("")}</select></label>`).join("");
  $("rules-note").textContent = cm ? `In a career the table sets the rules (${tableOf().name}). Switch to free play to set your own.` : "Changing a rule starts a fresh shoe. The return below updates as you go.";
  const e = houseEdge(r);
  $("edge-now").textContent = houseText(e); $("edge-said").textContent = `${e <= 0 ? `the house keeps ${(-100 * e).toFixed(2)}` : `you win ${(100 * e).toFixed(2)}`} of every 100 bet, played by the book with no count. That is worked out for an infinite deck; a real shoe gives back a little more (measured over 1.5 million rounds: about 0.1% more from six decks, 0.3% from two, 0.5% from one)${r.csm ? "" : ", and counting moves it round to round"}.`;
  $("tables-note").textContent = cm ? "Tables open as your bankroll grows. Each shows what its rules return a round, by the book." : "In free play the rules below are yours; the career tables are here to copy.";
  $("tables").innerHTML = TABLES.map((t) => { const open = career.unlocked.includes(t.id) || !cm; return `<button class="tcard${cm && t.id === settings.table ? " on" : ""}" data-table="${t.id}"${open ? "" : " disabled"}><strong>${t.name}</strong><small>${money(t.min)} to ${money(t.max)} · ${t.note}</small><small>${houseText(houseEdge({ ...RULES, ...t.rules }))}${open ? "" : ` · opens at ${money(t.unlock)}`}</small></button>`; }).join("");
  const set = (id, v) => { $(id).value = String(v); };
  set("g-mode", settings.mode); set("g-speed", settings.speed); set("g-sound", settings.sound); set("g-coach", settings.coach); set("g-count", settings.countView); set("g-quiz", settings.quizEvery); set("g-round", settings.tcRound); set("p-seats", settings.seats);
  const n = Number(settings.seats); $("p-me").innerHTML = Array.from({ length: n }, (_, i) => `<option value="${i}"${i === Math.min(settings.mySeat, n - 1) ? " selected" : ""}>${i === 0 ? "first (dealt first)" : i === n - 1 ? "last (third base)" : `seat ${i + 1}`}</option>`).join("");
  $("styles").innerHTML = Array.from({ length: n - 1 }, (_, i) => `<label>Player ${i + 1}<select data-style="${i}">${Object.entries(STYLES).map(([k, s]) => `<option value="${k}"${settings.styles[i] === k ? " selected" : ""}>${s.label}: ${s.note}</option>`).join("")}</select></label>`).join("");
  const pc = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "–");
  $("stats").innerHTML = [["Rounds", stats.hands], ["Book plays", `${pc(stats.correct, stats.decisions)} of ${stats.decisions}`], ["Hands won", `${pc(stats.won, stats.won + stats.lost)}`], ["Blackjacks", stats.blackjacks], ["Count checks", `${pc(stats.quizRight, stats.quizzes)} of ${stats.quizzes}`], ["Drills", `${pc(stats.drillRight, stats.drills)} of ${stats.drills}`], ["True counts", `${pc(stats.tcRight, stats.tcs)} of ${stats.tcs}`], ["Best bankroll", money(stats.best)], ["Careers", stats.careers], ["Asked to leave", stats.backoffs]].map(([k, v]) => `<div class="stat"><small>${k}</small><b>${v}</b></div>`).join("");
}
function rulesChanged() { shoe = newShoe(); round = null; bet = Math.max(limits().min, Math.min(bet, limits().max)); save(); render(); drawChart(); drawSettings(); $("sim-rules").textContent = ruleSummary(rules()); }
$("rules").addEventListener("change", (e) => { const k = e.target.dataset.rule; if (!k) return; const spec = RULE_UI.find(([x]) => x === k); settings[k] = spec[3](e.target.value); rulesChanged(); $("msg").textContent = "New rules, new shoe."; });
$("tables").addEventListener("click", (e) => {
  const b = e.target.closest("[data-table]"); if (!b || b.disabled) return;
  if (careerMode()) { if ((career.cooldown[b.dataset.table] ?? 0) > 0 || (round && round.phase !== "done") || busy) return; settings.table = b.dataset.table; career.prevBet = 0; }
  else Object.assign(settings, RULES, TABLES.find((t) => t.id === b.dataset.table).rules);
  rulesChanged(); $("msg").textContent = careerMode() ? `You sit down at ${tableOf().name}.` : "Rules copied from the table.";
});
$("table-pick").onchange = () => { if (busy || (round && round.phase !== "done")) { drawBar(); return; } settings.table = $("table-pick").value; career.prevBet = 0; $("banner").hidden = true; rulesChanged(); $("msg").textContent = `You sit down at ${tableOf().name}: ${tableOf().note}.`; };
const G = { "g-mode": ["mode", String], "g-speed": ["speed", String], "g-sound": ["sound", (v) => v === "true"], "g-coach": ["coach", (v) => v === "true"], "g-count": ["countView", String], "g-quiz": ["quizEvery", Number], "g-round": ["tcRound", String], "p-seats": ["seats", Number], "p-me": ["mySeat", Number] };
for (const [id, [k, parse]] of Object.entries(G)) $(id).onchange = () => { if (busy || (round && round.phase !== "done")) { drawSettings(); return; } settings[k] = parse($(id).value); if (k === "mode") { $("banner").hidden = true; rulesChanged(); } else { round = null; save(); render(); drawSettings(); } };
$("styles").addEventListener("change", (e) => { const i = e.target.dataset.style; if (i == null) return; settings.styles[i] = e.target.value; round = null; save(); render(); });
$("refill").onclick = () => { stats.freeBank = 1000; save(); render(); drawSettings(); $("reset-msg").textContent = "Free-play bankroll back to 1,000."; };
let armed = false;
$("reset").onclick = () => {
  if (!armed) { armed = true; $("reset").textContent = "Tap again to start over"; setTimeout(() => { armed = false; $("reset").textContent = "Start a new career"; }, 4000); return; }
  armed = false; $("reset").textContent = "Start a new career"; settings.mode = "career"; newCareer(); drawSettings(); $("reset-msg").textContent = `Career ${stats.careers}: ${money(START)} and the two cheap tables.`;
};

// ------------------------------------------------------------------ wiring
const VIEWS = ["play", "sim", "drill", "tc", "chart", "settings"];
function tab(name) {
  if (!VIEWS.includes(name)) name = "play";
  for (const b of document.querySelectorAll("nav button")) b.setAttribute("aria-selected", String(b.dataset.tab === name));
  for (const v of VIEWS) $("view-" + v).hidden = v !== name;
  if (name === "tc" && !tcq) nextTc(); if (name === "settings") drawSettings(); if (name === "chart") drawChart(); if (name === "sim") $("sim-rules").textContent = ruleSummary(rules());
  if (name !== "drill") clearInterval(drillTimer);
  store.set("tab", name);
}
for (const b of document.querySelectorAll("nav button")) b.onclick = () => tab(b.dataset.tab);
for (const b of document.querySelectorAll("#actions [data-move]")) b.onclick = () => act(b.dataset.move);
$("a-ins-yes").onclick = () => insure(true); $("a-ins-no").onclick = () => insure(false);
$("deal").onclick = deal; $("d-start").onclick = startDrill; $("t-check").onclick = checkTc; $("t-next").onclick = nextTc;
$("t-answer").addEventListener("keydown", (e) => { if (e.key === "Enter") checkTc(); });
for (const id of ["s-rc", "s-tc"]) $(id).onclick = () => { if (settings.countView === "blur") $(id).classList.toggle("blur"); };
document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, select") || $("view-play").hidden || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase(), m = { h: "hit", s: "stand", d: "double", p: "split", r: "surrender" }[k];
  if (m) act(m);
  else if (k === "i") insure(true); else if (k === "n") insure(false);
  else if (k === " " || k === "enter") { e.preventDefault(); if (round?.phase === "insurance") insure(false); else deal(); }
});
if (careerMode() && !career.unlocked.includes(settings.table)) settings.table = "downtown";
bet = Math.max(limits().min, Math.min(bet, limits().max));
drawRamp(); render(); tab(store.get("tab", "play"));
$("msg").textContent = careerMode() ? `${tableOf().name}: ${tableOf().note}. Place a bet and deal.` : "Free play. Place a bet and deal.";
