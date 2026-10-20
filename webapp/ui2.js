/* ui2.js — Nova Bet app shell v2: theme, top bar, home, play hub, match screen,
 * result popup, wallet history, profile. Loaded AFTER app.js and overrides its screens. */

/* ---------------- setup: theme, fullscreen, haptics ---------------- */

function applyTheme() {
  const r = document.documentElement.style;
  r.setProperty("--tg-theme-bg-color", "#090f0c");
  r.setProperty("--tg-theme-secondary-bg-color", "#121b16");
  r.setProperty("--tg-theme-text-color", "#eef5f0");
  r.setProperty("--tg-theme-hint-color", "#86998d");
  try { tg.setHeaderColor("#090f0c"); tg.setBackgroundColor("#090f0c"); tg.setBottomBarColor && tg.setBottomBarColor("#0e1612"); } catch (e) {}
}
applyTheme();
tg.onEvent && tg.onEvent("themeChanged", applyTheme);
try { tg.disableVerticalSwipes && tg.disableVerticalSwipes(); } catch (e) {}
try { if (tg.requestFullscreen && tg.isVersionAtLeast && tg.isVersionAtLeast("8.0")) tg.requestFullscreen(); } catch (e) {}

function hap(kind) {
  try {
    const h = tg.HapticFeedback;
    if (kind === "success" || kind === "error" || kind === "warning") h.notificationOccurred(kind);
    else h.impactOccurred(kind || "light");
  } catch (e) {}
}
document.addEventListener("click", (e) => {
  if (e.target.closest("button, .game-card, .chip, .fr-pick, .ttt-cell.selectable")) hap("light");
}, true);

const GAME_ICON = { tictactoe: "✕⭕", rps: "✊", mines: "💣", chicken: "🐔", dice: "🎲", checkers: "🔴" };
const GAME_NAME = { tictactoe: "Tic-Tac-Toe", rps: "Rock Paper Scissors", mines: "Mines", chicken: "Chicken Road", dice: "Dice", checkers: "Checkers" };
const feeFor = (s) => (s <= 50 ? 1 : s <= 100 ? 2 : 3);
const esc = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const initial = (n) => esc((n || "?").trim().charAt(0).toUpperCase());
const SKEL = `<div class="spinner"></div><div class="spinner" style="height:80px"></div><div class="spinner" style="height:160px"></div>`;

function timeAgo(iso) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

/* ---------------- safety net: never leave a skeleton on screen forever ---------------- */

function showFatal(msg) {
  screenEl.innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="error-text" style="word-break:break-word">${esc(msg)}</p>
    <button class="btn" id="fatal-reload">Reload</button><button class="btn secondary" id="fatal-home">Home</button></div>`;
  document.getElementById("fatal-reload").addEventListener("click", () => location.reload());
  document.getElementById("fatal-home").addEventListener("click", () => { window.location.hash = "#/home"; router(); });
}
const _stuck = () => !!screenEl.querySelector(".spinner");
window.addEventListener("unhandledrejection", (e) => { if (_stuck()) showFatal(String((e.reason && e.reason.message) || e.reason)); });
window.addEventListener("error", (e) => { if (_stuck()) showFatal(String(e.message)); });
setInterval(() => {
  if (!_stuck()) { window._stuckSince = 0; return; }
  window._stuckSince = window._stuckSince || Date.now();
  if (Date.now() - window._stuckSince > 12000) { window._stuckSince = 0; showFatal("This is taking too long. Check your connection and reload."); }
}, 2000);

/* ---------------- top bar ---------------- */

async function refreshTopbar() {
  try {
    const w = await apiGet("/webapp/wallet");
    document.getElementById("top-balance-amt").textContent = `${fmt(w.available_balance)} ETB`;
  } catch (e) {}
}
document.getElementById("top-balance").addEventListener("click", () => { window.location.hash = "#/wallet"; });
window.addEventListener("hashchange", () => { refreshTopbar(); window.scrollTo(0, 0); });
setInterval(refreshTopbar, 20000);

/* ---------------- result popup ---------------- */

function showResultModal({ outcome, title, amount, sub, primary, onPrimary, secondary, onSecondary }) {
  const old = document.getElementById("result-modal"); if (old) old.remove();
  const m = document.createElement("div");
  m.id = "result-modal"; m.className = `modal ${outcome}`;
  m.innerHTML = `<div class="box">
      <div class="big">${outcome === "win" ? "🏆" : outcome === "draw" ? "🤝" : "💔"}</div>
      <h2>${esc(title)}</h2>
      ${amount ? `<div class="amt">${esc(amount)}</div>` : ""}
      <p class="center-note">${esc(sub || "")}</p>
      ${primary ? `<button class="btn" id="rm-primary">${esc(primary)}</button>` : ""}
      <button class="btn secondary" id="rm-secondary">${esc(secondary || "Back to Home")}</button>
    </div>`;
  document.body.appendChild(m);
  hap(outcome === "win" ? "success" : outcome === "loss" ? "error" : "warning");
  const close = () => m.remove();
  const p = document.getElementById("rm-primary");
  if (p) p.addEventListener("click", () => { close(); onPrimary && onPrimary(); });
  document.getElementById("rm-secondary").addEventListener("click", () => { close(); onSecondary ? onSecondary() : (window.location.hash = "#/home"); });
  refreshTopbar();
}

window.onRpsFinished = (s) => {
  const net = (Number(s.payout || 0) - Number(s.stake)).toFixed(2);
  if (s.status === "draw") showResultModal({ outcome: "draw", title: "Draw", sub: s.reason === "no_picks" ? "Nobody picked — both stakes refunded." : "Same move — your stake is refunded, no fee.", secondary: "Close", onSecondary: () => {} });
  else if (s.you_won) showResultModal({ outcome: "win", title: "You won!", amount: `+${net} ETB`, sub: `Payout ${s.payout} ETB (fee ${s.fee} ETB).`, secondary: "Close", onSecondary: () => {} });
  else showResultModal({ outcome: "loss", title: "You lost", amount: `−${s.stake} ETB`, sub: s.reason === "forfeit" ? "You didn't pick in time." : "Better luck next round.", secondary: "Close", onSecondary: () => {} });
};

/* ---------------- Home ---------------- */

renderHome = async function () {
  screenEl.innerHTML = SKEL;
  const [w, on, act] = await Promise.all([
    apiGet("/webapp/wallet").catch(() => null),
    apiGet("/webapp/online").catch(() => null),
    apiGet("/webapp/activity").catch(() => ({ results: [] })),
  ]);
  const rows = act.results.slice(0, 6);
  screenEl.innerHTML = `
    <div class="hero">
      ${on ? `<div class="online"><i></i>${on.online} player${on.online === 1 ? "" : "s"} online</div>` : ""}
      <div class="lbl">Your balance</div>
      <div class="amt">${w ? fmt(w.available_balance) : "—"}<small>ETB</small></div>
      <div class="row">
        <button class="btn" id="h-dep">＋ Deposit</button>
        <button class="btn secondary" id="h-wd">Withdraw</button>
      </div>
    </div>
    <div class="sec-title">Play now</div>
    <div class="game-grid">
      ${gameCard("chicken", "g-chicken", "CASINO", "Chicken Road", "Cross the road, cash out")}
      ${gameCard("mines", "g-mines", "CASINO", "Mines", "10 mines, 15 safe")}
      ${gameCard("flight", "g-flight", "CASINO", "Nova Flight", "3D crash game · cash out in time")}
      ${gameCard("tictactoe", "g-ttt", "1 vs 1", "Tic-Tac-Toe", "Challenge a friend")}
      ${gameCard("rps", "g-rps", "1 vs 1", "Rock Paper Scissors", "Quick duel")}
    </div>
    <div class="sec-title">Recent results</div>
    <div class="card" style="padding:6px 16px">
      ${rows.length ? rows.map(resultRow).join("") : `<p class="center-note" style="padding:16px 0;text-align:center">No games yet — pick one above 👆</p>`}
    </div>`;
  document.getElementById("h-dep").addEventListener("click", () => { window.location.hash = "#/wallet"; setTimeout(() => selectWalletTab("deposit"), 0); });
  document.getElementById("h-wd").addEventListener("click", () => { window.location.hash = "#/wallet"; setTimeout(() => selectWalletTab("withdraw"), 0); });
  bindGameCards();
};

function gameCard(id, cls, tag, name, sub) {
  const art = { chicken: "🐔", mines: "💣", tictactoe: "⭕", rps: "✌️", flight: "✈️" }[id];
  return `<button class="game-card ${cls}" data-game="${id}"><span class="tag">${tag}</span><span class="art">${art}</span><b>${name}</b><small>${sub}</small></button>`;
}
function bindGameCards() {
  screenEl.querySelectorAll("[data-game]").forEach((b) => b.addEventListener("click", () => {
    const g = b.dataset.game;
    if (g === "flight") { window.location.hash = "#/flight"; }
    else if (g === "chicken") renderChicken();
    else if (g === "mines") renderMines();
    else renderFriendGame(g);
  }));
}
function resultRow(r) {
  const n = Number(r.net);
  const cls = r.result === "win" ? "win" : r.result === "loss" ? "loss" : "draw";
  const amt = r.result === "draw" ? "±0" : (n > 0 ? "+" : "−") + Math.abs(n).toFixed(2);
  return `<div class="res-row"><div class="res-ico">${GAME_ICON[r.game] || "🎮"}</div>
    <div class="res-main"><b>${GAME_NAME[r.game] || r.game}</b><span>${r.result === "win" ? "Won" : r.result === "loss" ? "Lost" : "Draw"} · ${timeAgo(r.at)}</span></div>
    <div class="res-amt ${cls}">${amt}</div></div>`;
}

/* ---------------- Play hub ---------------- */

renderPlayChooseGame = async function () {
  stopPolling();
  screenEl.innerHTML = SKEL;
  const lobby = await apiGet("/webapp/rps/lobby").catch(() => ({ open: [], mine: null }));
  screenEl.innerHTML = `
    ${lobby.mine ? `<div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:10px"><b>⚡ You have a game in progress</b><button class="btn" id="resume" style="width:auto;margin:0;padding:9px 16px">Resume</button></div>` : ""}
    <div class="sec-title" style="margin-top:4px">👥 Play with friends</div>
    <div class="game-grid">
      ${gameCard("tictactoe", "g-ttt", "1 vs 1", "Tic-Tac-Toe", "Pick a friend, set the stake")}
      ${gameCard("rps", "g-rps", "1 vs 1", "Rock Paper Scissors", "Invite a friend or share a link")}
    </div>
    <div class="sec-title">🎰 Casino · solo vs the house</div>
    <div class="game-grid">
      ${gameCard("chicken", "g-chicken", "CASINO", "Chicken Road", "Cross lanes, cash out any time")}
      ${gameCard("mines", "g-mines", "CASINO", "Mines", "10 mines, cash out any time")}
      ${gameCard("flight", "g-flight", "CASINO", "Nova Flight", "3D crash game · cash out in time")}
    </div>
    <p class="center-note" style="text-align:center;margin-top:16px">Casino outcomes are decided by the server, never by the app.</p>`;
  const rs = document.getElementById("resume");
  if (rs) rs.addEventListener("click", () => { window.location.hash = `#/rps/${lobby.mine}`; });
  screenEl.querySelectorAll("[data-game]").forEach((b) => b.addEventListener("click", () => {
    const g = b.dataset.game;
    if (g === "flight") window.location.hash = "#/flight"; else if (g === "chicken") renderChicken(); else if (g === "mines") renderMines(); else renderFriendGame(g);
  }));
};

/* stake picker with pot / fee preview */
function stakeUI(el, { min = 5, max = 500, def = 10 } = {}) {
  let val = def, custom = false;
  el.innerHTML = `
    <div class="chips">${[10, 50, 100].map((x) => `<button class="chip" data-v="${x}">${x}</button>`).join("")}<button class="chip" data-v="custom">Custom</button></div>
    <div class="field" id="st-custom" style="display:none"><input id="st-in" type="number" inputmode="decimal" placeholder="${min}–${max} ETB" /></div>
    <div class="pot-box" id="st-pot"></div>`;
  const pot = el.querySelector("#st-pot");
  const draw = () => {
    el.querySelectorAll(".chip").forEach((c) => c.classList.toggle("sel", custom ? c.dataset.v === "custom" : Number(c.dataset.v) === val));
    el.querySelector("#st-custom").style.display = custom ? "block" : "none";
    const ok = val >= min && val <= max;
    const fee = feeFor(val);
    pot.innerHTML = ok ? `<div class="r"><span>Your stake</span><b>${val.toFixed(2)} ETB</b></div>
      <div class="r"><span>Total pot (both stakes)</span><b>${(val * 2).toFixed(2)} ETB</b></div>
      <div class="r"><span>Platform fee</span><b>${fee.toFixed(2)} ETB</b></div>
      <div class="r win"><span>Winner gets</span><b>${(val * 2 - fee).toFixed(2)} ETB</b></div>
      <div class="r"><span>Draw</span><b>both refunded, no fee</b></div>`
      : `<div class="r"><span>Enter a stake between ${min} and ${max} ETB</span></div>`;
  };
  el.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => {
    if (c.dataset.v === "custom") { custom = true; el.querySelector("#st-in").focus(); }
    else { custom = false; val = Number(c.dataset.v); }
    draw();
  }));
  el.querySelector("#st-in").addEventListener("input", (e) => { val = Number(e.target.value) || 0; draw(); });
  draw();
  return { get: () => val, valid: () => val >= min && val <= max };
}

/* friends game flow (Tic-Tac-Toe / Rock Paper Scissors) */
async function renderFriendGame(game) {
  stopPolling();
  screenEl.innerHTML = SKEL;
  const [fr, lobby, cfg] = await Promise.all([
    apiGet("/webapp/friends").catch(() => ({ friends: [] })),
    game === "rps" ? apiGet("/webapp/rps/lobby").catch(() => ({ open: [] })) : Promise.resolve({ open: [] }),
    apiGet("/webapp/config").catch(() => ({ bot_username: "Ticarena_bot" })),
  ]);
  let friendId = null;
  const isRps = game === "rps";
  screenEl.innerHTML = `
    <div class="card">
      <h2>${GAME_ICON[game]} ${GAME_NAME[game]}</h2>
      <div class="sec-title" style="margin-top:0">1 · Choose your stake</div>
      <div id="stake-slot"></div>
      <div class="sec-title">2 · Choose your opponent</div>
      <div id="friend-list">${fr.friends.length ? fr.friends.map((f) => `<div class="fr-pick" data-f="${f.internal_id}"><div class="avatar">${initial(f.full_name || f.telegram_username)}</div>
        <div><div class="friend-name">${esc(f.full_name || f.telegram_username)}</div><div class="friend-username">@${esc(f.telegram_username || "—")}</div></div></div>`).join("")
        : `<p class="center-note">No friends yet. Add some in the Friends tab${isRps ? ", or share an invite link below" : ""}.</p>`}</div>
      <div class="error-text" id="ff-err"></div>
      <button class="btn" id="ff-send">⚔️ Challenge friend</button>
      ${isRps ? `<button class="btn secondary" id="ff-share">🔗 Share invite link</button>` : `<button class="btn secondary" id="ff-random">🔎 Find a random opponent</button>`}
    </div>
    ${isRps && lobby.open.length ? `<div class="card"><h2>⏳ Open challenges</h2>${lobby.open.map((g) => `<div class="list-row">
      <div><div class="friend-name">${esc(g.creator_name || "Player")}${g.private ? " (for you)" : ""}</div><div class="friend-username">${g.stake} ETB</div></div>
      <button class="btn" style="margin:0;width:auto;padding:8px 14px" data-join="${g.game_id}">Join</button></div>`).join("")}</div>` : ""}
    <div class="card"><button class="btn secondary" id="g-back">⬅️ Back</button></div>`;
  bindBack();
  const stake = stakeUI(document.getElementById("stake-slot"), { min: 5, max: 500, def: 10 });
  const err = document.getElementById("ff-err");
  screenEl.querySelectorAll("[data-f]").forEach((el) => el.addEventListener("click", () => {
    friendId = friendId === el.dataset.f ? null : el.dataset.f;
    screenEl.querySelectorAll("[data-f]").forEach((x) => x.classList.toggle("sel", x.dataset.f === friendId));
  }));
  const need = () => {
    err.textContent = "";
    if (!stake.valid()) { err.textContent = "Enter a stake between 5 and 500 ETB."; return false; }
    return true;
  };
  document.getElementById("ff-send").addEventListener("click", async (ev) => {
    if (!need()) return;
    if (!friendId) { err.textContent = "Pick a friend first."; return; }
    ev.target.disabled = true;
    try {
      if (isRps) {
        const r = await apiPostJson("/webapp/rps/create", { stake: String(stake.get()), invite_user_id: friendId });
        if (r.notified === false) tg.showAlert("Challenge created, but Telegram couldn't deliver it. Ask your friend to open Nova Bet and join from Open challenges.");
        window.location.hash = `#/rps/${r.game_id}`;
      } else {
        const fd = new FormData();
        fd.append("friend_id", friendId); fd.append("stake_amount", String(stake.get())); fd.append("game_type", "tictactoe");
        const r = await apiPostForm("/webapp/friends/invite", fd);
        if (r.notified === false) tg.showAlert("Challenge created, but Telegram couldn't reach your friend.");
        renderSearching("tictactoe", stake.get(), "Waiting for your friend to accept…", false);
      }
    } catch (e) { err.textContent = e.message; ev.target.disabled = false; }
  });
  const share = document.getElementById("ff-share");
  if (share) share.addEventListener("click", async (ev) => {
    if (!need()) return;
    ev.target.disabled = true;
    try {
      const r = await apiPostJson("/webapp/rps/create", { stake: String(stake.get()), invite_user_id: null });
      const link = `https://t.me/${cfg.bot_username}?start=rps_${r.game_id}`;
      const text = `✊✋✌️ I challenge you to Rock Paper Scissors on Nova Bet for ${stake.get()} ETB! Tap to accept:`;
      tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
      window.location.hash = `#/rps/${r.game_id}`;
    } catch (e) { err.textContent = e.message; ev.target.disabled = false; }
  });
  const rnd = document.getElementById("ff-random");
  if (rnd) rnd.addEventListener("click", () => {
    if (!need()) return;
    if (![10, 20, 50, 100].includes(stake.get())) { err.textContent = "Random matches use 10, 20, 50 or 100 ETB."; return; }
    joinQueue("tictactoe", String(stake.get()));
  });
  screenEl.querySelectorAll("[data-join]").forEach((b) => b.addEventListener("click", async () => {
    try { await apiPostJson(`/webapp/rps/${b.dataset.join}/join`, {}); window.location.hash = `#/rps/${b.dataset.join}`; }
    catch (e) { err.textContent = e.message; }
  }));
}
renderRps = () => renderFriendGame("rps");

/* searching / waiting radar */
renderSearching = function (gameType, stake, text, cancellable = true) {
  stopPolling();
  screenEl.innerHTML = `
    <div class="card" style="text-align:center">
      <div class="radar"><i></i><i></i><i></i><div class="core">${GAME_ICON[gameType] || "🎮"}</div></div>
      <h2 style="margin-bottom:4px">${esc(text || "Finding opponent…")}</h2>
      <p class="center-note">${stake} ETB stake · winner gets ${(stake * 2 - feeFor(Number(stake))).toFixed(2)} ETB</p>
      <button class="btn danger" id="cancel-search">${cancellable ? "Cancel" : "Back"}</button>
    </div>`;
  document.getElementById("cancel-search").addEventListener("click", async () => {
    stopPolling();
    if (cancellable) {
      const fd = new FormData(); fd.append("stake_amount", stake); fd.append("game_type", gameType);
      await apiPostForm("/webapp/matchmaking/leave", fd).catch(() => {});
    }
    renderPlayChooseGame();
  });
  pollTimer = setInterval(async () => {
    try {
      const s = await apiGet("/webapp/matchmaking/status");
      if (s.status === "matched") { stopPolling(); hap("success"); window.location.hash = `#/board/${s.match_id}`; }
    } catch (e) {}
  }, 2500);
};

/* ---------------- Match screen (Tic-Tac-Toe) ---------------- */

const _oldBoard = renderBoard;
const TTT_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

renderBoard = async function (matchId) {
  stopPolling();
  screenEl.innerHTML = SKEL;
  let s;
  try { s = await apiGet(`/matches/${matchId}/my-state`); }
  catch (e) { screenEl.innerHTML = `<div class="card"><p class="error-text">${esc(e.message)}</p><button class="btn secondary" onclick="location.hash='#/home'">Back</button></div>`; return; }
  if (s.game_type === "checkers") return _oldBoard(matchId);

  if (!s.you_are || !s.you_name) { showFatal("The server is running an old version (match data is missing). Redeploy the API with the latest files."); return; }
  const mineMark = s.you_are, oppMark = s.you_are === "X" ? "O" : "X";
  const pot = Number(s.stake_amount) * 2;
  const tgPhoto = tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.photo_url;
  screenEl.innerHTML = `
    <div class="match-head"><span class="pot">POT ${pot.toFixed(2)} ETB</span><small>Winner gets ${(pot - Number(s.fee || 0)).toFixed(2)} ETB · fee ${s.fee || "—"} ETB</small></div>
    <div class="players">
      <div class="pl" id="pl-me"><span class="timer" id="tm-me" style="display:none"></span>
        <div class="avatar">${tgPhoto ? `<img src="${esc(tgPhoto)}">` : initial(s.you_name)}</div><div class="nm">${esc(s.you_name)} (you)</div><div class="mk ${mineMark.toLowerCase()}">${mineMark === "X" ? "✕" : "○"}</div></div>
      <div class="vs">VS</div>
      <div class="pl" id="pl-opp"><span class="timer" id="tm-opp" style="display:none"></span>
        <div class="avatar">${initial(s.opponent_name)}</div><div class="nm">${esc(s.opponent_name)}</div><div class="mk ${oppMark.toLowerCase()}">${oppMark === "X" ? "✕" : "○"}</div></div>
    </div>
    <div id="tictactoe-board"></div>
    <div class="turn-label" id="turn-label"></div>`;

  let last = null, moving = false, deadline = 0, finished = false;
  const boardEl = document.getElementById("tictactoe-board");

  function paint(st) {
    const myTurn = st.is_your_turn === true;
    const active = st.status === "active";
    document.getElementById("pl-me").classList.toggle("turn", active && myTurn);
    document.getElementById("pl-opp").classList.toggle("turn", active && !myTurn);
    const tl = document.getElementById("turn-label");
    tl.textContent = !active ? "Game over" : myTurn ? "Your turn — tap a square" : `${st.opponent_name}'s turn…`;
    tl.classList.toggle("mine", active && myTurn);
    if (typeof st.seconds_left === "number") deadline = Date.now() + st.seconds_left * 1000;
    if (st.board !== last) {
      const prev = last || "_________";
      last = st.board;
      boardEl.innerHTML = "";
      const winLine = !active ? TTT_LINES.find((l) => st.board[l[0]] !== "_" && st.board[l[0]] === st.board[l[1]] && st.board[l[1]] === st.board[l[2]]) : null;
      for (let i = 0; i < 9; i++) {
        const ch = st.board[i];
        const cell = document.createElement("div");
        cell.className = "ttt-cell" + (winLine && winLine.includes(i) ? " win" : "");
        if (ch === "X" || ch === "O") {
          const m = document.createElement("span");
          m.className = `ttt-mark ${ch.toLowerCase()}`; m.textContent = ch === "X" ? "✕" : "○";
          if (prev[i] === ch) m.style.animation = "none";   // only new marks animate
          cell.appendChild(m);
        } else if (active && myTurn) {
          cell.classList.add("selectable");
          cell.addEventListener("click", () => tap(i));
        }
        boardEl.appendChild(cell);
      }
    }
    if (!active && !finished) { finished = true; stopPolling(); finish(st); }
  }

  async function tap(pos) {
    if (moving) return; moving = true; hap("medium");
    try {
      await apiPostJson(`/matches/${matchId}/move-webapp`, { cell_position: pos, idempotency_key: crypto.randomUUID() });
      last = null; paint(await apiGet(`/matches/${matchId}/my-state`));
    } catch (e) { hap("error"); tg.showAlert(e.message || "That move isn't allowed."); }
    moving = false;
  }

  function finish(st) {
    const stake = Number(st.stake_amount), payout = Number(st.payout_amount || 0);
    const rematch = async () => {
      try { await apiPostJson(`/webapp/rematch/${matchId}`, {}); tg.showAlert("Rematch sent! Waiting for your opponent to accept."); renderSearching("tictactoe", stake, "Waiting for rematch…", false); }
      catch (e) { tg.showAlert(e.message); }
    };
    if (st.status === "completed_draw") showResultModal({ outcome: "draw", title: "Draw", sub: "Your stake is refunded, no fee.", primary: "🔁 Rematch", onPrimary: rematch });
    else if (st.you_won) showResultModal({ outcome: "win", title: "You won!", amount: `+${(payout - stake).toFixed(2)} ETB`, sub: st.result_reason === "timeout_forfeit" ? "Your opponent ran out of time." : `Payout ${payout.toFixed(2)} ETB`, primary: "🔁 Rematch", onPrimary: rematch });
    else showResultModal({ outcome: "loss", title: "You lost", amount: `−${stake.toFixed(2)} ETB`, sub: st.result_reason === "timeout_forfeit" ? "You ran out of time." : "Better luck next time.", primary: "🔁 Rematch", onPrimary: rematch });
  }

  paint(s);
  const tick = setInterval(() => {
    if (!document.getElementById("turn-label")) { clearInterval(tick); return; }
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const myTurn = document.getElementById("pl-me").classList.contains("turn");
    const oppTurn = document.getElementById("pl-opp").classList.contains("turn");
    for (const [id, on] of [["tm-me", myTurn], ["tm-opp", oppTurn]]) {
      const el = document.getElementById(id); el.style.display = on ? "inline-block" : "none";
      el.textContent = left + "s"; el.classList.toggle("low", left <= 10);
    }
  }, 300);
  pollTimer = setInterval(async () => {
    if (moving) return;
    try { paint(await apiGet(`/matches/${matchId}/my-state`)); } catch (e) {}
  }, 1500);
};

/* ---------------- Wallet ---------------- */

renderWalletOverview = async function (content) {
  const w = await apiGet("/webapp/wallet").catch(() => null);
  content.innerHTML = `
    <div class="hero"><div class="lbl">Available balance</div><div class="amt">${w ? fmt(w.available_balance) : "—"}<small>ETB</small></div>
      <div class="row"><button class="btn" id="wo-dep">＋ Deposit</button><button class="btn secondary" id="wo-wd">Withdraw</button></div></div>
    <div class="card">
      <div class="stat-row"><span class="stat-label">In play / pending</span><span class="stat-value">${w ? fmt(w.locked_balance) : "—"} ETB</span></div>
      <div class="stat-row"><span class="stat-label">Total deposits</span><span class="stat-value">${w ? fmt(w.total_deposits) : "—"} ETB</span></div>
      <div class="stat-row"><span class="stat-label">Total withdrawals</span><span class="stat-value">${w ? fmt(w.total_withdrawals) : "—"} ETB</span></div>
    </div>`;
  document.getElementById("wo-dep").addEventListener("click", () => selectWalletTab("deposit"));
  document.getElementById("wo-wd").addEventListener("click", () => selectWalletTab("withdraw"));
};

const TXN_LABEL = { deposit: "Deposit", withdrawal: "Withdrawal", stake_lock: "Stake locked", stake_release: "Stake released", payout: "Match payout",
  draw_refund: "Draw refund", admin_adjustment: "Adjustment", house_bet: "Casino bet", house_payout: "Casino win", fee: "Fee" };

renderHistory = async function (content) {
  content.innerHTML = SKEL;
  const [t, a] = await Promise.all([
    apiGet("/webapp/transactions").catch(() => ({ transactions: [] })),
    apiGet("/webapp/activity").catch(() => ({ results: [] })),
  ]);
  const tx = t.transactions.filter((x) => !(x.type === "payout" && Number(x.amount) === 0));
  content.innerHTML = `
    <div class="sec-title" style="margin-top:4px">Results</div>
    <div class="card" style="padding:6px 16px">${a.results.length ? a.results.map(resultRow).join("") : `<p class="center-note" style="padding:14px 0;text-align:center">No results yet.</p>`}</div>
    <div class="sec-title">Transactions</div>
    <div class="card" style="padding:6px 16px">${tx.length ? tx.map((x) => {
      const n = Number(x.amount), cls = n > 0 ? "win" : n < 0 ? "loss" : "draw";
      return `<div class="res-row"><div class="res-ico">${n > 0 ? "⬇️" : "⬆️"}</div><div class="res-main"><b>${TXN_LABEL[x.type] || x.type}</b><span>${timeAgo(x.at)}</span></div>
        <div class="res-amt ${cls}">${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}</div></div>`;
    }).join("") : `<p class="center-note" style="padding:14px 0;text-align:center">No transactions yet.</p>`}</div>`;
};

/* ---------------- Profile ---------------- */

renderProfile = async function () {
  screenEl.innerHTML = SKEL;
  const [info, st] = await Promise.all([apiGet("/webapp/me").catch(() => null), apiGet("/webapp/profile-stats").catch(() => null)]);
  const photo = tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.photo_url;
  const tot = st ? st.wins + st.losses + st.draws : 0;
  const pct = (n) => (tot ? (100 * n / tot).toFixed(1) : 0);
  screenEl.innerHTML = `
    <div class="card" style="text-align:center">
      <div class="avatar big-avatar">${photo ? `<img src="${esc(photo)}">` : initial(info && info.full_name)}</div>
      <h2 style="margin:0">${esc((info && info.full_name) || "—")}</h2>
      <p class="friend-username">@${esc((info && info.telegram_username) || "—")}</p>
    </div>
    <div class="card"><h2>📊 Your stats</h2>
      <div class="stat-grid">
        <div class="stat-box"><b>${st ? st.win_rate : 0}%</b><span>Win rate</span></div>
        <div class="stat-box"><b>${st ? st.games : 0}</b><span>Games played</span></div>
        <div class="stat-box"><b style="color:var(--green)">${st ? fmt(st.total_won) : "0.00"}</b><span>Total won (ETB)</span></div>
        <div class="stat-box"><b style="color:var(--gold)">${st ? fmt(st.best_win) : "0.00"}</b><span>Best win (ETB)</span></div>
      </div>
      <div class="wl-bar"><i class="w" style="width:${pct(st ? st.wins : 0)}%"></i><i class="d" style="width:${pct(st ? st.draws : 0)}%"></i><i class="l" style="width:${pct(st ? st.losses : 0)}%"></i></div>
      <div class="friend-username">${st ? st.wins : 0} W · ${st ? st.draws : 0} D · ${st ? st.losses : 0} L</div>
    </div>
    <div class="card"><h2>🪪 Your ID</h2>
      <p class="center-note" style="text-align:left;margin-bottom:10px">Share this with friends so they can add you.</p>
      <div class="stat-row"><span class="stat-value" style="font-size:20px">${(info && info.telegram_user_id) || "—"}</span>
        <button class="btn secondary" id="pid-copy" style="margin:0;width:auto;padding:8px 14px">Copy</button></div>
    </div>`;
  const cb = document.getElementById("pid-copy");
  if (cb && info) cb.addEventListener("click", () => {
    navigator.clipboard.writeText(String(info.telegram_user_id)).catch(() => {});
    hap("success"); cb.textContent = "Copied!"; setTimeout(() => (cb.textContent = "Copy"), 1500);
  });
};

/* ---------------- boot ---------------- */
router();
refreshTopbar();
