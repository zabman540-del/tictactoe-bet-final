/* app.js — the full Nova Bet Mini App. One page, hash-based router,
 * screens for everything the bot used to do in chat (wallet, deposit,
 * withdraw, play, friends, history, profile) plus both game boards. */

const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

const API_BASE = window.location.origin;
const screenEl = document.getElementById("screen");
const navButtons = document.querySelectorAll(".nav-btn");

const STAKE_TIERS = ["10", "20", "50", "100"];

let me = null;          // cached /webapp/me response
let pollTimer = null;   // generic poller, cleared between screens

function authHeaders(json = true) {
  const h = { "X-Telegram-Init-Data": tg.initData || "" };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders(false), cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || `Error ${res.status}`);
  return body;
}

async function apiPostJson(path, data) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST", headers: authHeaders(true), body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body.detail || `Error ${res.status}`) + (res.status === 405 || res.status === 404 ? ` [POST ${path} ${res.status}]` : ""));
  return body;
}

async function apiPostForm(path, formData) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST", headers: authHeaders(false), body: formData,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || `Error ${res.status}`);
  return body;
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function fmt(n) {
  return Number(n).toFixed(2);
}

/* ---------------- Router ---------------- */

function currentRoute() {
  let hash = window.location.hash.replace("#/", "") || "home";
  // Telegram appends launch data (?tgWebAppData=..., &tgWebApp...) to links opened from a bot
  // button. Strip it, or the id in the link becomes "abc-123?tgWebAppData=..." and every API call breaks.
  hash = hash.split("?")[0].split("&")[0].split("#")[0];
  const parts = hash.split("/"); // e.g. ["board", "abc-123"]
  if (parts[1]) parts[1] = parts[1].replace(/[^A-Za-z0-9_-]/g, "");
  return parts;
}

async function router() {
  stopPolling();
  const [route, param] = currentRoute();

  navButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.route === route));

  if (!me || !me.registered) {
    const fresh = await apiGet("/webapp/me").catch(() => ({ registered: false }));
    me = fresh;
  }

  if (!me.registered && route !== "register") {
    window.location.hash = "#/register";
    return;
  }

  switch (route) {
    case "home": return renderHome();
    case "play": return renderPlayChooseGame();
    case "friends": return renderFriends();
    case "wallet": return renderWallet();
    case "profile": return renderProfile();
    case "register": return renderRegister();
    case "board": return renderBoard(param);
    case "rps": return param ? renderRpsGame(param) : renderRps();
    case "flight": return renderFlight();
    default: return renderHome();
  }
}

window.addEventListener("hashchange", router);
navButtons.forEach((btn) => {
  btn.addEventListener("click", () => { window.location.hash = `#/${btn.dataset.route}`; });
});

/* ---------------- Registration ---------------- */

function renderRegister() {
  screenEl.innerHTML = `
    <div class="card">
      <h2>👋 Welcome to Nova Bet</h2>
      <p class="center-note" style="text-align:left">Let's set up your account.</p>
      <div class="field">
        <label>Full name</label>
        <input id="reg-name" placeholder="e.g. Yafet Alemu" />
      </div>
      <div class="field">
        <label>Phone number</label>
        <input id="reg-phone" placeholder="09xxxxxxxx" />
      </div>
      <div class="error-text" id="reg-error"></div>
      <button class="btn" id="reg-submit">Create account</button>
    </div>
  `;
  document.getElementById("reg-submit").addEventListener("click", async () => {
    const full_name = document.getElementById("reg-name").value.trim();
    const phone_number = document.getElementById("reg-phone").value.trim();
    const errorEl = document.getElementById("reg-error");
    errorEl.textContent = "";
    if (!full_name || !phone_number) {
      errorEl.textContent = "Please fill in both fields.";
      return;
    }
    try {
      const fd = new FormData();
      fd.append("full_name", full_name);
      fd.append("phone_number", phone_number);
      await apiPostForm("/webapp/register", fd);
      me = await apiGet("/webapp/me");
      tg.HapticFeedback.notificationOccurred("success");
      window.location.hash = "#/home";
      router();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

/* ---------------- Home ---------------- */

async function renderHome() {
  screenEl.innerHTML = `<div class="spinner"></div>`;
  const wallet = await apiGet("/webapp/wallet").catch(() => null);

  screenEl.innerHTML = `
    <div class="card balance-hero">
      <div class="amount">${wallet ? fmt(wallet.available_balance) : "—"} ETB</div>
      <div class="label">Available balance</div>
    </div>

    <div class="grid-2">
      <div class="tile" id="home-play"><span class="tile-icon">🎮</span>Play</div>
      <div class="tile" id="home-friends"><span class="tile-icon">🎯</span>Play vs Friend</div>
      <div class="tile" id="home-deposit"><span class="tile-icon">➕</span>Deposit</div>
      <div class="tile" id="home-withdraw"><span class="tile-icon">💸</span>Withdraw</div>
    </div>

    <div class="card" style="margin-top:14px">
      <h2>📊 Stats</h2>
      <div class="stat-row"><span class="stat-label">Locked (in match/pending)</span><span class="stat-value">${wallet ? fmt(wallet.locked_balance) : "—"} ETB</span></div>
      <div class="stat-row"><span class="stat-label">Total winnings</span><span class="stat-value">${wallet ? fmt(wallet.total_winnings) : "—"} ETB</span></div>
      <div class="stat-row"><span class="stat-label">Total games</span><span class="stat-value">${wallet ? wallet.total_games : "—"}</span></div>
    </div>
  `;

  document.getElementById("home-play").addEventListener("click", () => { window.location.hash = "#/play"; });
  document.getElementById("home-friends").addEventListener("click", () => { window.location.hash = "#/friends"; });
  document.getElementById("home-deposit").addEventListener("click", () => { window.location.hash = "#/wallet"; setTimeout(() => selectWalletTab("deposit"), 0); });
  document.getElementById("home-withdraw").addEventListener("click", () => { window.location.hash = "#/wallet"; setTimeout(() => selectWalletTab("withdraw"), 0); });
}

/* ---------------- Play ---------------- */

async function renderPlayChooseGame() {
  screenEl.innerHTML = `<div class="spinner"></div>`;
  const data = await apiGet("/webapp/matchmaking/open").catch(() => ({ open_matches: [] }));
  const open = data.open_matches.filter((m) => m.game_type !== "checkers");

  screenEl.innerHTML = `
    ${open.length ? `
    <div class="card">
      <h2>⏳ Waiting players — join one</h2>
      ${open.map((m) => `
        <div class="list-row">
          <div>
            <div class="friend-name">${m.display_name}</div>
            <div class="friend-username">${m.game_type === "checkers" ? "🔴 Checkers" : "✕⭕ Tic-Tac-Toe"} · ${m.stake_amount} ETB</div>
          </div>
          <button class="btn" style="margin:0;width:auto;padding:8px 14px" data-join-open="${m.user_id}" data-stake="${m.stake_amount}" data-game="${m.game_type}">Join</button>
        </div>
      `).join("")}
    </div>` : ""}

    <div class="card">
      <h2>🎮 Or start a new game</h2>
      <button class="btn" id="play-ttt">✕⭕ Tic-Tac-Toe</button>
      <button class="btn secondary" id="play-chicken">🐔 Chicken Road</button>
      <button class="btn secondary" id="play-rps">✊✋✌️ Rock Paper Scissors</button>
      <button class="btn secondary" id="play-mines">💣 Mines</button>
      <button class="btn secondary" id="play-dice" disabled style="opacity:.55">🎲 Dice — coming soon</button>
    </div>
  `;
  document.getElementById("play-mines").addEventListener("click", renderMines);
  document.getElementById("play-rps").addEventListener("click", renderRps);
  document.getElementById("play-chicken").addEventListener("click", renderChicken);
  
  document.getElementById("play-ttt").addEventListener("click", () => renderPlayChooseStake("tictactoe"));

  screenEl.querySelectorAll("[data-join-open]").forEach((btn) => {
    btn.addEventListener("click", () => joinOpenMatch(btn.dataset.joinOpen, btn.dataset.stake, btn.dataset.game));
  });
}

async function joinOpenMatch(opponentId, stake, gameType) {
  screenEl.innerHTML = `<div class="spinner"></div><div class="center-note">Joining match…</div>`;
  try {
    const fd = new FormData();
    fd.append("opponent_id", opponentId);
    fd.append("stake_amount", stake);
    fd.append("game_type", gameType);
    const result = await apiPostForm("/webapp/matchmaking/join-open", fd);
    window.location.hash = `#/board/${result.match_id}`;
  } catch (err) {
    tg.showAlert(err.message || "That player is no longer available.");
    renderPlayChooseGame();
  }
}

function renderPlayChooseStake(gameType) {
  screenEl.innerHTML = `
    <div class="card">
      <h2>${gameType === "checkers" ? "🔴 Checkers" : "✕⭕ Tic-Tac-Toe"} — choose your stake</h2>
      <div class="stake-grid">
        ${STAKE_TIERS.map((s) => `<button class="stake-btn" data-stake="${s}">${s} ETB</button>`).join("")}
      </div>
      <button class="btn secondary" id="play-back">⬅️ Back</button>
    </div>
  `;
  screenEl.querySelectorAll(".stake-btn").forEach((btn) => {
    btn.addEventListener("click", () => joinQueue(gameType, btn.dataset.stake));
  });
  document.getElementById("play-back").addEventListener("click", renderPlayChooseGame);
}

async function joinQueue(gameType, stake) {
  screenEl.innerHTML = `<div class="spinner"></div><div class="center-note">Finding opponent…</div>`;
  try {
    const fd = new FormData();
    fd.append("stake_amount", stake);
    fd.append("game_type", gameType);
    const result = await apiPostForm("/webapp/matchmaking/join", fd);
    if (result.status === "matched") {
      window.location.hash = `#/board/${result.match_id}`;
      return;
    }
    renderSearching(gameType, stake);
  } catch (err) {
    screenEl.innerHTML = `
      <div class="card"><p class="error-text">${err.message}</p>
      <button class="btn secondary" id="play-back2">⬅️ Back</button></div>`;
    document.getElementById("play-back2").addEventListener("click", renderPlayChooseGame);
  }
}

function renderSearching(gameType, stake) {
  screenEl.innerHTML = `
    <div class="card" style="text-align:center">
      <div class="spinner"></div>
      <p class="center-note">🔎 Finding opponent at ${stake} ETB…</p>
      <button class="btn danger" id="cancel-search">✖️ Cancel</button>
    </div>
  `;
  let cancelled = false;
  document.getElementById("cancel-search").addEventListener("click", async () => {
    cancelled = true;
    stopPolling();
    const fd = new FormData();
    fd.append("stake_amount", stake);
    fd.append("game_type", gameType);
    await apiPostForm("/webapp/matchmaking/leave", fd).catch(() => {});
    renderPlayChooseGame();
  });

  pollTimer = setInterval(async () => {
    if (cancelled) return;
    try {
      const status = await apiGet("/webapp/matchmaking/status");
      if (status.status === "matched") {
        stopPolling();
        window.location.hash = `#/board/${status.match_id}`;
      }
    } catch (err) {
      // ignore transient errors while polling
    }
  }, 3000);
}

/* ---------------- Board (Tic-Tac-Toe + Checkers) ---------------- */

async function renderBoard(matchId) {
  screenEl.innerHTML = `<div class="spinner"></div>`;
  let state;
  try {
    state = await apiGet(`/matches/${matchId}/my-state`);
  } catch (err) {
    screenEl.innerHTML = `<div class="card"><p class="error-text">${err.message}</p></div>`;
    return;
  }

  const isCheckers = state.game_type === "checkers";

  screenEl.innerHTML = `
    <div id="board-status-bar">
      <span>${state.stake_amount} ETB</span>
      <span id="board-turn-label">Loading…</span>
    </div>
    <div id="board-debug-line" class="center-note" style="font-size:11px;opacity:.6;margin:-6px 0 8px;word-break:break-all"></div>
    <div id="${isCheckers ? "checkers-board" : "tictactoe-board"}"></div>
    <div id="board-result-banner" class="hidden">
      <div id="board-result-text"></div>
      <button class="btn" id="board-close">Back to Home</button>
    </div>
  `;

  document.getElementById("board-close").addEventListener("click", () => { window.location.hash = "#/home"; });

  let lastBoard = null;
  let selected = null;
  let moving = false;

  async function submitMove(payload, endpoint) {
    const body = await apiPostJson(`/matches/${matchId}/${endpoint}`, payload);
    return body;
  }

  function renderState(s) {
    const turnLabel = document.getElementById("board-turn-label");
    const myTurn = typeof s.is_your_turn === "boolean"
      ? s.is_your_turn
      : (s.status === "active" && s.current_turn === s.you_are);
    const dbg = document.getElementById("board-debug-line");
    if (dbg) {
      const t = (v) => String(v || "").slice(-4);
      const extra = s.you_are === undefined ? ` | KEYS: ${Object.keys(s).join(",")}` : "";
      dbg.textContent = `you=${s.you_are} turn=${s.current_turn} status=${s.status} | me …${t(s.you_id)} X …${t(s.player_x_id)} O …${t(s.player_o_id)}${extra}`;
    }
    turnLabel.textContent = s.status !== "active" ? "Game over" : myTurn ? "Your turn" : "Opponent's turn";
    turnLabel.classList.toggle("your-turn", myTurn);

    if (s.status !== "active") {
      stopPolling();
      showResult(s);
    }

    if (s.board === lastBoard && selected === null) return;
    lastBoard = s.board;

    if (isCheckers) renderCheckers(s, myTurn);
    else renderTicTacToe(s, myTurn);
  }

  function renderTicTacToe(s, myTurn) {
    const boardEl = document.getElementById("tictactoe-board");
    boardEl.innerHTML = "";
    for (let i = 0; i < 9; i++) {
      const ch = s.board[i];
      const cell = document.createElement("div");
      cell.className = "ttt-cell";
      if (ch === "X") {
        cell.innerHTML = `<span class="ttt-mark x">✕</span>`;
      } else if (ch === "O") {
        cell.innerHTML = `<span class="ttt-mark o">○</span>`;
      } else if (myTurn) {
        cell.classList.add("selectable");
        cell.addEventListener("click", () => onTttCellTapped(i, s));
      }
      boardEl.appendChild(cell);
    }
  }

  async function onTttCellTapped(pos, s) {
    if (moving) return;
    moving = true;
    try {
      const newState = await submitMove({ cell_position: pos, idempotency_key: crypto.randomUUID() }, "move-webapp");
      tg.HapticFeedback.notificationOccurred("success");
      lastBoard = null;
      renderState(newState);
    } catch (err) {
      tg.HapticFeedback.notificationOccurred("error");
      tg.showAlert(err.message || "That move isn't allowed.");
    } finally {
      moving = false;
    }
  }

  function pieceClass(ch) {
    if (ch === "x") return "ck-piece x-man";
    if (ch === "X") return "ck-piece x-king";
    if (ch === "o") return "ck-piece o-man";
    if (ch === "O") return "ck-piece o-king";
    return null;
  }

  function renderCheckers(s, myTurn) {
    const boardEl = document.getElementById("checkers-board");
    boardEl.innerHTML = "";
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const pos = row * 8 + col;
        const ch = s.board[pos];
        const isDark = (row + col) % 2 === 1;
        const sq = document.createElement("div");
        sq.className = `ck-square ${isDark ? "dark" : "light"}`;

        if (isDark && ch !== ".") {
          const pClass = pieceClass(ch);
          if (pClass) {
            const p = document.createElement("div");
            p.className = pClass;
            sq.appendChild(p);
          }
        }
        if (selected === pos) sq.classList.add("selected");
        if (isDark && myTurn) {
          sq.classList.add("selectable");
          sq.addEventListener("click", () => onCheckersSquareTapped(pos, ch, s, myTurn));
        }
        boardEl.appendChild(sq);
      }
    }
  }

  async function onCheckersSquareTapped(pos, ch, s, myTurn) {
    const isMine = s.you_are === "X" ? (ch === "x" || ch === "X") : (ch === "o" || ch === "O");

    if (selected === null) {
      if (!isMine) { tg.HapticFeedback.notificationOccurred("error"); return; }
      selected = pos; lastBoard = null; renderState(s); return;
    }
    if (pos === selected) { selected = null; lastBoard = null; renderState(s); return; }
    if (isMine) { selected = pos; lastBoard = null; renderState(s); return; }

    const fromPos = selected;
    selected = null;
    if (moving) return;
    moving = true;
    try {
      const newState = await submitMove(
        { from_position: fromPos, to_position: pos, idempotency_key: crypto.randomUUID() },
        "checkers-move-webapp",
      );
      tg.HapticFeedback.notificationOccurred("success");
      lastBoard = null;
      renderState(newState);
    } catch (err) {
      tg.HapticFeedback.notificationOccurred("error");
      tg.showAlert(err.message || "That move isn't allowed.");
      lastBoard = null;
      renderState(s);
    } finally {
      moving = false;
    }
  }

  function showResult(s) {
    const banner = document.getElementById("board-result-banner");
    const text = document.getElementById("board-result-text");
    banner.classList.remove("hidden");
    if (s.status === "completed_draw") {
      text.textContent = "🤝 It's a draw! Stakes refunded.";
    } else if (s.you_won) {
      text.textContent = `🏆 You won! Payout: ${s.payout_amount} ETB`;
      tg.HapticFeedback.notificationOccurred("success");
    } else {
      const timedOut = s.result_reason === "timeout_forfeit";
      text.textContent = timedOut
        ? "⏱️ Your opponent ran out of time — you lost this one."
        : "❌ You lost this one. Better luck next time!";
    }
  }

  renderState(state);
  pollTimer = setInterval(async () => {
    try {
      const s = await apiGet(`/matches/${matchId}/my-state`);
      renderState(s);
    } catch (err) {
      // transient network hiccup — next tick will retry
    }
  }, 2000);
}

/* ---------------- Friends ---------------- */

async function renderFriends() {
  screenEl.innerHTML = `<div class="spinner"></div>`;
  const data = await apiGet("/webapp/friends").catch(() => ({ friends: [], pending_requests: [] }));

  screenEl.innerHTML = `
    <div class="card">
      <h2>➕ Add a friend</h2>
      <div class="field">
        <input id="add-friend-username" placeholder="@username or their ID" />
      </div>
      <div class="error-text" id="add-friend-error"></div>
      <button class="btn" id="add-friend-btn">Send request</button>
    </div>

    ${data.pending_requests.length ? `
    <div class="card">
      <h2>📨 Pending requests</h2>
      ${data.pending_requests.map((r) => `
        <div class="list-row">
          <span>New friend request</span>
          <span class="btn-row" style="width:auto">
            <button class="btn" style="margin:0;padding:8px 14px" data-accept="${r.request_id}">Accept</button>
            <button class="btn secondary" style="margin:0;padding:8px 14px" data-decline="${r.request_id}">Decline</button>
          </span>
        </div>
      `).join("")}
    </div>` : ""}

    <div class="card">
      <h2>👥 Your friends</h2>
      ${data.friends.length ? data.friends.map((f) => `
        <div class="list-row">
          <div>
            <div class="friend-name">${f.full_name || f.telegram_username}</div>
            <div class="friend-username">@${f.telegram_username}</div>
          </div>
          <button class="btn" style="margin:0;width:auto;padding:8px 14px" data-invite="${f.internal_id}">Invite</button>
        </div>
      `).join("") : `<p class="center-note">No friends yet — add one above.</p>`}
    </div>
  `;

  document.getElementById("add-friend-btn").addEventListener("click", async () => {
    const username = document.getElementById("add-friend-username").value.trim().replace(/^@/, "");
    const errorEl = document.getElementById("add-friend-error");
    errorEl.textContent = "";
    if (!username) { errorEl.textContent = "Enter a username."; return; }
    try {
      await apiPostForm("/webapp/friends/request", (() => { const fd = new FormData(); fd.append("friend_username", username); return fd; })());
      tg.HapticFeedback.notificationOccurred("success");
      renderFriends();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  screenEl.querySelectorAll("[data-accept]").forEach((btn) => {
    btn.addEventListener("click", () => respondFriendRequest(btn.dataset.accept, true));
  });
  screenEl.querySelectorAll("[data-decline]").forEach((btn) => {
    btn.addEventListener("click", () => respondFriendRequest(btn.dataset.decline, false));
  });
  screenEl.querySelectorAll("[data-invite]").forEach((btn) => {
    btn.addEventListener("click", () => renderInviteStakePicker(btn.dataset.invite));
  });
}

async function respondFriendRequest(requestId, accept) {
  try {
    const fd = new FormData();
    fd.append("request_id", requestId);
    fd.append("accept", accept);
    await apiPostForm("/webapp/friends/respond", fd);
    tg.HapticFeedback.notificationOccurred("success");
    renderFriends();
  } catch (err) {
    tg.showAlert(err.message);
  }
}

function renderInviteStakePicker(friendId) {
  screenEl.innerHTML = `
    <div class="card">
      <h2>🎯 Invite to play — choose game & stake</h2>
      <div class="tabs">
        <button class="tab-btn active" data-game="tictactoe">✕⭕ Tic-Tac-Toe</button>
      </div>
      <div class="stake-grid">
        ${STAKE_TIERS.map((s) => `<button class="stake-btn" data-stake="${s}">${s} ETB</button>`).join("")}
      </div>
      <button class="btn secondary" id="invite-back">⬅️ Back</button>
    </div>
  `;
  let selectedGame = "tictactoe";
  screenEl.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      screenEl.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedGame = btn.dataset.game;
    });
  });
  screenEl.querySelectorAll(".stake-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const fd = new FormData();
        fd.append("friend_id", friendId);
        fd.append("stake_amount", btn.dataset.stake);
        fd.append("game_type", selectedGame);
        const inv = await apiPostForm("/webapp/friends/invite", fd);
        tg.HapticFeedback.notificationOccurred("success");
        tg.showAlert(inv && inv.notified === false
          ? "Invite saved, but Telegram could not deliver it. Ask your friend to open the bot and send /start, then invite again."
          : "Invite sent to their Telegram chat with the bot! Waiting for them to accept.");
        window.location.hash = "#/home";
      } catch (err) {
        tg.showAlert(err.message);
      }
    });
  });
  document.getElementById("invite-back").addEventListener("click", renderFriends);
}

/* ---------------- Wallet (overview / deposit / withdraw / history) ---------------- */

let walletTab = "overview";

function selectWalletTab(tab) {
  walletTab = tab;
  renderWallet();
}

async function renderWallet() {
  screenEl.innerHTML = `
    <div class="tabs">
      <button class="tab-btn ${walletTab === "overview" ? "active" : ""}" data-tab="overview">Overview</button>
      <button class="tab-btn ${walletTab === "deposit" ? "active" : ""}" data-tab="deposit">Deposit</button>
      <button class="tab-btn ${walletTab === "withdraw" ? "active" : ""}" data-tab="withdraw">Withdraw</button>
      <button class="tab-btn ${walletTab === "history" ? "active" : ""}" data-tab="history">History</button>
    </div>
    <div id="wallet-tab-content"><div class="spinner"></div></div>
  `;
  screenEl.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => selectWalletTab(btn.dataset.tab));
  });

  const content = document.getElementById("wallet-tab-content");
  if (walletTab === "overview") return renderWalletOverview(content);
  if (walletTab === "deposit") return renderDepositForm(content);
  if (walletTab === "withdraw") return renderWithdrawForm(content);
  if (walletTab === "history") return renderHistory(content);
}

async function renderWalletOverview(content) {
  const wallet = await apiGet("/webapp/wallet").catch(() => null);
  content.innerHTML = `
    <div class="card balance-hero">
      <div class="amount">${wallet ? fmt(wallet.available_balance) : "—"} ETB</div>
      <div class="label">Available balance</div>
    </div>
    <div class="card">
      <div class="stat-row"><span class="stat-label">Locked (in match/pending)</span><span class="stat-value">${wallet ? fmt(wallet.locked_balance) : "—"} ETB</span></div>
      <div class="stat-row"><span class="stat-label">Total winnings</span><span class="stat-value">${wallet ? fmt(wallet.total_winnings) : "—"} ETB</span></div>
      <div class="stat-row"><span class="stat-label">Total games</span><span class="stat-value">${wallet ? wallet.total_games : "—"}</span></div>
      <div class="stat-row"><span class="stat-label">Total deposits</span><span class="stat-value">${wallet ? fmt(wallet.total_deposits) : "—"} ETB</span></div>
      <div class="stat-row"><span class="stat-label">Total withdrawals</span><span class="stat-value">${wallet ? fmt(wallet.total_withdrawals) : "—"} ETB</span></div>
    </div>
  `;
}

function renderDepositForm(content) {
  content.innerHTML = `
    <div class="card">
      <h2>➕ Deposit</h2>
      <div class="card" style="background:rgba(255,200,40,.08);border:1px solid rgba(255,200,40,.35);margin:0 0 12px">
        <div class="center-note" style="text-align:left">Send money by <b>Telebirr</b> to:</div>
        <div style="font-size:22px;font-weight:900;letter-spacing:1px;margin:4px 0" id="tb-num">…</div>
        <div style="margin-bottom:8px">Name: <b id="tb-name">…</b></div>
        <button class="btn secondary" id="tb-copy" type="button">📋 Copy number</button>
        <div class="center-note" style="text-align:left;margin-top:8px">Then enter the amount, the Telebirr transaction number and a screenshot below.</div>
      </div>
      <div class="field">
        <label>Payment method</label>
        <select id="dep-method">
          <option value="telebirr">📱 Telebirr</option>
        </select>
      </div>
      <div class="field">
        <label>Amount (ETB)</label>
        <input id="dep-amount" type="number" min="25" placeholder="Minimum 25 ETB" />
      </div>
      <div class="field">
        <label>Reference number</label>
        <input id="dep-reference" placeholder="Transaction reference" />
      </div>
      <div class="field">
        <label>Payment screenshot</label>
        <label class="file-upload" id="dep-file-label" for="dep-file">Tap to choose a screenshot</label>
        <input id="dep-file" type="file" accept="image/*" capture="environment" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;" />
      </div>
      <div class="error-text" id="dep-error"></div>
      <button class="btn" id="dep-submit">Submit deposit</button>
    </div>
  `;
  apiGet("/webapp/config").then((c) => {
    document.getElementById("tb-num").textContent = c.telebirr_number || "—";
    document.getElementById("tb-name").textContent = c.telebirr_name || "—";
    document.getElementById("tb-copy").addEventListener("click", () => {
      try { navigator.clipboard.writeText(c.telebirr_number); tg.showAlert("Number copied"); } catch (e) { tg.showAlert(c.telebirr_number); }
    });
  }).catch(() => {});
  const fileLabel = document.getElementById("dep-file-label");
  const fileInput = document.getElementById("dep-file");
  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) {
      fileLabel.textContent = `✅ ${fileInput.files[0].name}`;
      fileLabel.classList.add("has-file");
    }
  });

  document.getElementById("dep-submit").addEventListener("click", async () => {
    const errorEl = document.getElementById("dep-error");
    errorEl.textContent = "";
    const amount = document.getElementById("dep-amount").value.trim();
    const reference = document.getElementById("dep-reference").value.trim();
    const method = document.getElementById("dep-method").value;
    const file = fileInput.files[0];
    if (!amount || !reference || !file) {
      errorEl.textContent = "Please fill in every field and attach a screenshot.";
      return;
    }
    try {
      const fd = new FormData();
      fd.append("amount", amount);
      fd.append("payment_method", method);
      fd.append("reference_number", reference);
      fd.append("screenshot", file);
      await apiPostForm("/webapp/deposits", fd);
      tg.HapticFeedback.notificationOccurred("success");
      tg.showAlert("Deposit submitted! An admin will review it shortly.");
      selectWalletTab("overview");
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

function renderWithdrawForm(content) {
  content.innerHTML = `
    <div class="card">
      <h2>💸 Withdraw</h2>
      <div class="field">
        <label>Payment method</label>
        <select id="wd-method">
          <option value="telebirr">📱 Telebirr</option>
        </select>
      </div>
      <div class="field">
        <label>Amount (ETB)</label>
        <input id="wd-amount" type="number" min="25" placeholder="Minimum 25 ETB" />
      </div>
      <div class="field">
        <label>Payment details</label>
        <input id="wd-details" placeholder="Your Telebirr number (09…)" />
      </div>
      <div class="error-text" id="wd-error"></div>
      <button class="btn" id="wd-submit">Request withdrawal</button>
    </div>
  `;
  document.getElementById("wd-submit").addEventListener("click", async () => {
    const errorEl = document.getElementById("wd-error");
    errorEl.textContent = "";
    const amount = document.getElementById("wd-amount").value.trim();
    const details = document.getElementById("wd-details").value.trim();
    const method = document.getElementById("wd-method").value;
    if (!amount || !details) {
      errorEl.textContent = "Please fill in every field.";
      return;
    }
    try {
      const fd = new FormData();
      fd.append("amount", amount);
      fd.append("payment_method", method);
      fd.append("payment_details", details);
      await apiPostForm("/webapp/withdrawals", fd);
      tg.HapticFeedback.notificationOccurred("success");
      tg.showAlert("Withdrawal requested! An admin will process it shortly.");
      selectWalletTab("overview");
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

async function renderHistory(content) {
  const data = await apiGet("/webapp/history").catch(() => ({ matches: [] }));
  content.innerHTML = `
    <div class="card">
      <h2>📜 Match history</h2>
      ${data.matches.length ? data.matches.map((m) => {
        let pillClass = "draw", pillText = "Draw";
        if (m.status === "completed_win") { pillClass = m.you_won ? "win" : "loss"; pillText = m.you_won ? "Won" : "Lost"; }
        else if (m.status === "completed_forfeit") { pillClass = m.you_won ? "win" : "loss"; pillText = m.you_won ? "Won (forfeit)" : "Lost (forfeit)"; }
        else if (m.status === "voided") { pillClass = "pending"; pillText = "Voided"; }
        return `
          <div class="list-row">
            <div>
              <div class="friend-name">${m.game_type === "checkers" ? "🔴 Checkers" : "✕⭕ Tic-Tac-Toe"} — ${m.stake_amount} ETB</div>
              <div class="friend-username">${m.settled_at ? new Date(m.settled_at).toLocaleDateString() : ""}</div>
            </div>
            <span class="pill ${pillClass}">${pillText}</span>
          </div>
        `;
      }).join("") : `<p class="center-note">No completed matches yet.</p>`}
    </div>
  `;
}

/* ---------------- Profile ---------------- */

async function renderProfile() {
  screenEl.innerHTML = `<div class="spinner"></div>`;
  const info = await apiGet("/webapp/me").catch(() => null);
  screenEl.innerHTML = `
    <div class="card" style="text-align:center">
      <div style="font-size:44px;margin-bottom:8px">👤</div>
      <h2 style="margin-bottom:2px">${info?.full_name || "—"}</h2>
      <p class="friend-username">@${info?.telegram_username || "—"}</p>
    </div>
    <div class="card">
      <h2>🪪 Your ID</h2>
      <p class="center-note" style="text-align:left;margin-bottom:10px">
        Share this with friends so they can add you — works even if
        you don't have a Telegram username set.
      </p>
      <div class="stat-row">
        <span class="stat-value" id="profile-id-value" style="font-size:20px">${info?.telegram_user_id || "—"}</span>
        <button class="btn secondary" id="profile-id-copy" style="margin:0;width:auto;padding:8px 14px">Copy</button>
      </div>
    </div>
    <div class="card">
      <h2>❓ Need help?</h2>
      <p class="center-note" style="text-align:left">Contact support from the Telegram chat with this bot for deposit/withdrawal issues or anything else.</p>
    </div>
  `;
  const copyBtn = document.getElementById("profile-id-copy");
  if (copyBtn && info?.telegram_user_id) {
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(String(info.telegram_user_id)).catch(() => {});
      tg.HapticFeedback.notificationOccurred("success");
      copyBtn.textContent = "Copied!";
      setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
    });
  }
}

/* ---------------- Boot ---------------- */
/* router() is started from ui2.js (loaded after this file) */


/* ---------------- House games: Mines & Dice ---------------- */

let houseRules = null;
async function getHouseRules() {
  if (!houseRules) houseRules = await apiGet("/webapp/games/rules");
  return houseRules;
}
const gameBack = `<button class="btn secondary" id="g-back">⬅️ Back</button>`;
function bindBack() {
  const b = document.getElementById("g-back");
  if (b) b.addEventListener("click", renderPlayChooseGame);
}

async function renderMines() {
  screenEl.innerHTML = `<div class="spinner"></div>`;
  try {
    const rules = await getHouseRules();
    const act = await apiGet("/webapp/games/mines/active");
    if (act.round) return drawMines(act.round, rules);
    drawMinesSetup(rules);
  } catch (e) { tg.showAlert(e.message); renderPlayChooseGame(); }
}

function drawMinesSetup(rules) {
  const r = rules.mines;
  let mines = 10;
  screenEl.innerHTML = `
    <div class="card">
      <h2>💣 Mines</h2>
      <p class="center-note" style="text-align:left">
        5×5 board, hidden mines. Each safe tile raises your payout multiplier. Hit a mine and you lose your bet.
        Cash out any time after your first pick. Mines are placed randomly and the odds are the same for everyone.
        Fixed payouts, auto cash-out after ${r.max_picks} safe picks. Bet ${r.min_bet}–${r.max_bet} ETB. Max payout per round: ${r.max_payout} ETB.
      </p>
      <div class="field"><label>Bet (ETB)</label><input id="m-bet" type="number" inputmode="decimal" value="10" /></div>
      <div class="field"><label>Mode</label>
        <div class="stake-grid">${r.options.map((o) => `<button class="stake-btn" data-m="${o.mines}">${o.mines} 💣 · ${o.safe} safe</button>`).join("")}</div>
      </div>
      <div id="m-table" class="friend-username" style="margin:8px 0"></div>
      <div class="error-text" id="m-err"></div>
      <button class="btn" id="m-start">Start round</button>
      ${gameBack}
    </div>`;
  const showTable = () => {
    const o = r.options.find((x) => x.mines === mines);
    document.getElementById("m-table").innerHTML = "<b>Payouts</b> (chance to reach · average return)<br>" + o.table.map((t) => `${t.picks} safe → ×${t.multiplier} · ${t.win_chance}% · ${t.return_percent}%`).join("<br>");
    screenEl.querySelectorAll("[data-m]").forEach((b) => { b.style.outline = Number(b.dataset.m) === mines ? "2px solid #4f7cff" : "none"; });
  };
  screenEl.querySelectorAll("[data-m]").forEach((b) => b.addEventListener("click", () => { mines = Number(b.dataset.m); showTable(); }));
  showTable();
  bindBack();
  document.getElementById("m-start").addEventListener("click", async (ev) => {
    ev.target.disabled = true;
    try {
      const rd = await apiPostJson("/webapp/games/mines/start", { bet: document.getElementById("m-bet").value.trim(), mines });
      drawMines(rd, rules);
    } catch (e) { document.getElementById("m-err").textContent = e.message; ev.target.disabled = false; }
  });
}

function drawMines(rd, rules) {
  const active = rd.status === "active";
  const pos = rd.mine_positions || [];
  let cells = "";
  for (let i = 0; i < 25; i++) {
    let face = "", bg = "#2a3350";
    if (rd.revealed.includes(i)) { face = "💎"; bg = "#1f6f4a"; }
    else if (!active && pos.includes(i)) { face = "💣"; bg = (rd.hit === i) ? "#b3262b" : "#5a2a35"; }
    cells += `<button data-t="${i}" ${active && !rd.revealed.includes(i) ? "" : "disabled"} style="aspect-ratio:1;font-size:24px;border:0;border-radius:10px;background:${bg};color:#fff">${face}</button>`;
  }
  let msg = "";
  if (active) msg = `Mines: ${rd.mines} · Bet ${rd.bet} ETB · Now ×${rd.multiplier} = ${rd.potential_payout} ETB` + (rd.next_multiplier ? `<br>Next safe pick: ×${rd.next_multiplier}` : "");
  else if (rd.status === "lost") msg = `💥 Mine! You lost ${rd.bet} ETB.`;
  else msg = `✅ Cashed out ${rd.payout} ETB (×${rd.multiplier})`;
  screenEl.innerHTML = `
    <div class="card">
      <h2>💣 Mines</h2>
      <p class="center-note" id="m-msg">${msg}</p>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin:10px 0">${cells}</div>
      <div class="error-text" id="m-err"></div>
      ${active ? `<button class="btn" id="m-cash" ${rd.revealed.length ? "" : "disabled"}>💰 Cash out ${rd.potential_payout} ETB</button>`
               : `<button class="btn" id="m-again">Play again</button>`}
      ${active ? "" : gameBack}
    </div>`;
  bindBack();
  let busy = false;
  const act = async (fn) => {
    if (busy) return; busy = true;
    try { drawMines(await fn(), rules); }
    catch (e) { document.getElementById("m-err").textContent = e.message; busy = false; }
  };
  screenEl.querySelectorAll("[data-t]").forEach((b) => b.addEventListener("click", () =>
    act(() => apiPostJson("/webapp/games/mines/reveal", { round_id: rd.round_id, tile: Number(b.dataset.t) }))));
  const c = document.getElementById("m-cash");
  if (c) c.addEventListener("click", () => act(() => apiPostJson("/webapp/games/mines/cashout", { round_id: rd.round_id })));
  const a = document.getElementById("m-again");
  if (a) a.addEventListener("click", () => drawMinesSetup(rules));
}

async function renderDice() {
  screenEl.innerHTML = `<div class="spinner"></div>`;
  let rules;
  try { rules = (await getHouseRules()).dice; } catch (e) { tg.showAlert(e.message); return renderPlayChooseGame(); }
  let dir = "over", target = 50, result = "";
  const draw = async () => {
    let q = null, qerr = "";
    try { q = await apiPostJson("/webapp/games/dice/quote", { direction: dir, target }); } catch (e) { qerr = e.message; }
    screenEl.innerHTML = `
      <div class="card">
        <h2>🎲 Dice</h2>
        <p class="center-note" style="text-align:left">
          Pick Over or Under a target. The bot rolls a random number 1–100. Payout = bet × (100 ÷ win chance) less a ${rules.house_edge_percent}% house edge,
          the same for every player. Win chance ${rules.min_chance}%–${rules.max_chance}%. Bet ${rules.min_bet}–${rules.max_bet} ETB. Max payout ${rules.max_payout} ETB.
        </p>
        ${result}
        <div class="btn-row">
          <button class="btn ${dir === "over" ? "" : "secondary"}" id="d-over">Over</button>
          <button class="btn ${dir === "under" ? "" : "secondary"}" id="d-under">Under</button>
        </div>
        <div class="field"><label>Target: <b id="d-tv">${target}</b></label>
          <input id="d-target" type="range" min="2" max="99" value="${target}" style="width:100%" /></div>
        <p class="center-note" id="d-quote">${q ? `Wins on ${q.wins_on} · chance ${q.win_chance}% · payout ×${q.multiplier}` : `⚠️ ${qerr}`}</p>
        <div class="field"><label>Bet (ETB)</label><input id="d-bet" type="number" inputmode="decimal" value="${window._diceBet || 10}" /></div>
        <div class="error-text" id="d-err"></div>
        <button class="btn" id="d-roll" ${q ? "" : "disabled"}>Roll 🎲</button>
        ${gameBack}
      </div>`;
    bindBack();
    document.getElementById("d-over").addEventListener("click", () => { dir = "over"; result = ""; draw(); });
    document.getElementById("d-under").addEventListener("click", () => { dir = "under"; result = ""; draw(); });
    document.getElementById("d-target").addEventListener("input", (e) => { document.getElementById("d-tv").textContent = e.target.value; });
    document.getElementById("d-target").addEventListener("change", (e) => { target = Number(e.target.value); window._diceBet = document.getElementById("d-bet").value; result = ""; draw(); });
    document.getElementById("d-roll").addEventListener("click", async (ev) => {
      ev.target.disabled = true;
      try {
        window._diceBet = document.getElementById("d-bet").value.trim();
        const r = await apiPostJson("/webapp/games/dice/roll", { bet: window._diceBet, direction: dir, target });
        result = `<div class="card" style="text-align:center"><div style="font-size:48px">🎲 ${r.roll}</div>
          <div>${r.won ? `✅ You won ${r.payout} ETB (×${r.multiplier})` : `❌ You lost ${r.bet} ETB`}</div>
          <div class="friend-username">${r.direction === "over" ? "Over" : "Under"} ${r.target} · chance ${r.win_chance}%</div></div>`;
        draw();
      } catch (e) { document.getElementById("d-err").textContent = e.message; ev.target.disabled = false; }
    });
  };
  draw();
}


/* ---------------- Rock Paper Scissors ---------------- */

const RPS_ICON = { rock: "✊", paper: "✋", scissors: "✌️" };
const RPS_NAME = { rock: "Rock", paper: "Paper", scissors: "Scissors" };

async function renderRps() {
  stopPolling();
  screenEl.innerHTML = `<div class="spinner"></div>`;
  let rules, lobby, friends;
  try {
    [rules, lobby, friends] = await Promise.all([
      apiGet("/webapp/rps/rules"), apiGet("/webapp/rps/lobby"),
      apiGet("/webapp/friends").catch(() => ({ friends: [] })),
    ]);
  } catch (e) { tg.showAlert(e.message); return renderPlayChooseGame(); }
  let stake = "10";
  screenEl.innerHTML = `
    <div class="card">
      <h2>✊✋✌️ Rock Paper Scissors • 1v1</h2>
      <p class="center-note" style="text-align:left">
        Both players stake the same amount and secretly pick ✊ Rock, ✋ Paper or ✌️ Scissors.
        Moves stay hidden until both have locked in, and a locked move can't be changed.
        Rock beats Scissors, Scissors beats Paper, Paper beats Rock.<br>
        <b>Winner</b> gets 2× stake minus the fee (${rules.fees.up_to_50} ETB up to 50, ${rules.fees.up_to_100} up to 100, ${rules.fees.above_100} above).
        <b>Same move = draw</b>: both refunded, no fee.<br>
        You have ${rules.pick_seconds}s to pick after the opponent joins. If only one player picks, they win. If nobody picks, both are refunded.
        Unjoined challenges expire after ${rules.open_minutes} min and your stake is returned.
      </p>
    </div>
    ${lobby.mine ? `<div class="card"><h2>Your active game</h2><button class="btn" id="rps-resume">Resume</button></div>` : ""}
    <div class="card">
      <h2>⚔️ Challenge a player</h2>
      <div class="field"><label>Your stake (${rules.min_stake}–${rules.max_stake} ETB)</label>
        <input id="rps-stake" type="number" inputmode="decimal" value="10" /></div>
      <div class="stake-grid">${["10", "20", "50", "100", "500"].map((x) => `<button class="stake-btn" data-rs="${x}">${x}</button>`).join("")}</div>
      <div class="error-text" id="rps-err"></div>
      <button class="btn" id="rps-open">Open challenge (anyone can join)</button>
      ${friends.friends.length ? `<p class="center-note" style="text-align:left;margin-top:10px">Or challenge a friend directly:</p>
        ${friends.friends.map((f) => `<div class="list-row"><div class="friend-name">${f.full_name || f.telegram_username || "Friend"}</div>
          <button class="btn" style="margin:0;width:auto;padding:8px 14px" data-rf="${f.internal_id}">Challenge</button></div>`).join("")}` : ""}
    </div>
    ${lobby.open.length ? `<div class="card"><h2>⏳ Open challenges</h2>
      ${lobby.open.map((g) => `<div class="list-row"><div><div class="friend-name">${g.creator_name || "Player"}${g.private ? " (for you)" : ""}</div>
        <div class="friend-username">${g.stake} ETB</div></div>
        <button class="btn" style="margin:0;width:auto;padding:8px 14px" data-rj="${g.game_id}">Join</button></div>`).join("")}</div>` : ""}
    <div class="card"><button class="btn secondary" id="g-back">⬅️ Back</button></div>`;
  bindBack();
  const stakeInput = document.getElementById("rps-stake");
  screenEl.querySelectorAll("[data-rs]").forEach((b) => b.addEventListener("click", () => { stakeInput.value = b.dataset.rs; }));
  const errEl = document.getElementById("rps-err");
  const create = async (invite) => {
    try {
      stake = stakeInput.value.trim();
      const r = await apiPostJson("/webapp/rps/create", { stake, invite_user_id: invite || null });
      if (invite && r.notified === false) tg.showAlert("Challenge created, but Telegram couldn't deliver it. Ask your friend to open Nova Bet and join from the list.");
      window.location.hash = `#/rps/${r.game_id}`;
    } catch (e) { errEl.textContent = e.message; }
  };
  document.getElementById("rps-open").addEventListener("click", () => create(null));
  screenEl.querySelectorAll("[data-rf]").forEach((b) => b.addEventListener("click", () => create(b.dataset.rf)));
  screenEl.querySelectorAll("[data-rj]").forEach((b) => b.addEventListener("click", async () => {
    try { await apiPostJson(`/webapp/rps/${b.dataset.rj}/join`, {}); window.location.hash = `#/rps/${b.dataset.rj}`; }
    catch (e) { errEl.textContent = e.message; }
  }));
  const rs = document.getElementById("rps-resume");
  if (rs) rs.addEventListener("click", () => { window.location.hash = `#/rps/${lobby.mine}`; });
}

async function renderRpsGame(gameId) {
  screenEl.innerHTML = `<div class="spinner"></div>`;
  let busy = false;
  const draw = (s) => {
    const secs = (iso) => Math.max(0, Math.round((new Date(iso) - Date.now()) / 1000));
    let body = "";
    const head = `<h2>✊✋✌️ Rock Paper Scissors • ${s.stake} ETB</h2>
      <p class="friend-username">${s.creator_name || "Player"} vs ${s.opponent_name || "…"} · fee ${s.fee} ETB · winner takes ${(Number(s.stake) * 2 - Number(s.fee)).toFixed(2)} ETB</p>`;
    if (s.status === "open") {
      if (s.you_are === "creator") {
        body = `<p class="center-note">Waiting for an opponent… (expires in ${Math.ceil(secs(s.expires_at) / 60)} min)</p>
          <button class="btn secondary" id="r-cancel">Cancel &amp; refund</button>`;
      } else {
        body = `<p class="center-note">${s.creator_name || "A player"} challenges you for ${s.stake} ETB.<br>Winner gets ${(Number(s.stake) * 2 - Number(s.fee)).toFixed(2)} ETB. Draw = refund.</p>
          <button class="btn" id="r-join">Accept &amp; stake ${s.stake} ETB</button>`;
      }
    } else if (s.status === "picking") {
      if (!s.my_move) {
        body = `<p class="center-note">Choose your move. Your opponent won't see it until both of you have chosen. ⏱ ${secs(s.pick_deadline)}s left</p>
          <div class="btn-row">${["rock", "paper", "scissors"].map((m) => `<button class="btn" data-m="${m}" style="font-size:28px">${RPS_ICON[m]}<br><span style="font-size:12px">${RPS_NAME[m]}</span></button>`).join("")}</div>`;
      } else {
        body = `<p class="center-note">🔒 You locked ${RPS_ICON[s.my_move]} ${RPS_NAME[s.my_move]}.<br>${s.opponent_locked ? "Revealing…" : "Waiting for your opponent… ⏱ " + secs(s.pick_deadline) + "s"}</p>`;
      }
    } else if (s.status === "completed" || s.status === "draw") {
      const mine = s.you_are === "creator" ? s.creator_move : s.opponent_move;
      const theirs = s.you_are === "creator" ? s.opponent_move : s.creator_move;
      const mi = mine ? `${RPS_ICON[mine]} ${RPS_NAME[mine]}` : "— no pick";
      const ti = theirs ? `${RPS_ICON[theirs]} ${RPS_NAME[theirs]}` : "— no pick";
      let res;
      if (s.status === "draw") res = s.reason === "no_picks" ? "⏱ Nobody picked. Stakes refunded." : "🤝 Draw! Your stake is refunded.";
      else if (s.you_won) res = `🎉 You won ${s.payout} ETB!${s.reason === "forfeit" ? " (opponent didn't pick in time)" : ""}`;
      else res = `❌ You lost ${s.stake} ETB.${s.reason === "forfeit" ? " (you didn't pick in time)" : ""}`;
      body = `<div style="text-align:center;font-size:20px;margin:12px 0">You: ${mi}<br>Opponent: ${ti}</div>
        <p class="center-note" style="font-size:16px">${res}</p>
        ${s.opponent_id ? `<button class="btn" id="r-rematch">🔁 Rematch (${s.stake} ETB)</button>` : ""}
        <button class="btn secondary" id="r-again">Back</button>`;
      if (window.onRpsFinished && !window._rpsShown?.[s.game_id]) {
        (window._rpsShown = window._rpsShown || {})[s.game_id] = true;
        setTimeout(() => window.onRpsFinished(s), 50);
      }
    } else {
      body = `<p class="center-note">${s.status === "cancelled" ? "Challenge cancelled. Stake refunded." : "Challenge expired. Stake refunded."}</p>
        <button class="btn" id="r-again">Back</button>`;
    }
    screenEl.innerHTML = `<div class="card">${head}${body}<div class="error-text" id="r-err"></div></div>`;
    const err = (e) => { const x = document.getElementById("r-err"); if (x) x.textContent = e.message; };
    const post = async (path, data) => {
      if (busy) return; busy = true;
      try { draw(await apiPostJson(`/webapp/rps/${gameId}/${path}`, data || {})); }
      catch (e) { err(e); }
      busy = false;
    };
    screenEl.querySelectorAll("[data-m]").forEach((b) => b.addEventListener("click", () => post("pick", { move: b.dataset.m })));
    const j = document.getElementById("r-join"); if (j) j.addEventListener("click", () => post("join"));
    const c = document.getElementById("r-cancel"); if (c) c.addEventListener("click", () => post("cancel"));
    const a = document.getElementById("r-again"); if (a) a.addEventListener("click", () => { window.location.hash = "#/play"; });
    const rm = document.getElementById("r-rematch");
    if (rm) rm.addEventListener("click", async () => {
      try {
        const r = await apiPostJson("/webapp/rps/create", { stake: s.stake, invite_user_id: s.opponent_id });
        window.location.hash = `#/rps/${r.game_id}`;
      } catch (e) { err(e); }
    });
  };
  try { draw(await apiGet(`/webapp/rps/${gameId}`)); } catch (e) { tg.showAlert(e.message); return renderRps(); }
  pollTimer = setInterval(async () => {
    if (busy) return;
    try {
      const s = await apiGet(`/webapp/rps/${gameId}`);
      draw(s);
      if (["completed", "draw", "cancelled", "expired"].includes(s.status)) stopPolling();
    } catch (e) {}
  }, 2000);
}


/* ---------------- Chicken Road ---------------- */
/* Side-scrolling road: the chicken crosses lanes left to right. Each lane
 * ahead shows its multiplier coin. A trap = a car sweeping down that lane. */

const CR = { W: 360, H: 300, LW: 90, N: 10, GROUND: 262 };
const crLaneX = (i) => i * CR.LW;                 // left edge of lane i
const crCenterX = (i) => i * CR.LW + CR.LW / 2;   // centre of lane i
const crCam = (step) => Math.max(0, crCenterX(step) - 105);

/* ---------- sound (WebAudio, no files needed) ---------- */
const CRSound = (() => {
  const SR = 22050;
  let muted = false, ready = false;
  try { muted = localStorage.getItem("nb_mute") === "1"; } catch (e) {}
  const els = {};
  const wv = (ph, type) => type === "square" ? (Math.sin(ph) >= 0 ? .55 : -.55)
    : type === "saw" ? ((ph / (2 * Math.PI)) % 1) * 2 - 1
    : type === "tri" ? 2 * Math.abs(((ph / (2 * Math.PI)) % 1) * 2 - 1) - 1 : Math.sin(ph);
  const T = (f, t0, dur, type, vol, f2) => ({ f, t0, dur, type: type || "sine", vol: vol || .5, f2 });
  const N = (t0, dur, vol, lp) => ({ noise: true, t0, dur, vol: vol || .6, lp: lp || .12 });
  const DEFS = {
    start: [T(330, 0, .1, "square", .5), T(494, .1, .14, "square", .5)],
    hop: [T(240, 0, .18, "sine", .8, 640)],
    coin: [T(988, 0, .09, "square", .5), T(1319, .08, .26, "square", .5)],
    horn: [T(392, 0, .4, "saw", .45), T(466, 0, .4, "saw", .45)],
    crash: [N(0, .5, .9, .1), T(150, 0, .45, "saw", .7, 40), T(90, .05, .5, "square", .5, 30)],
    cash: [523, 659, 784, 1047, 1319].map((f, i) => T(f, i * .09, .24, "tri", .7)),
  };
  function build(evs) {
    let total = 0; evs.forEach((e) => { total = Math.max(total, e.t0 + e.dur); });
    const n = Math.ceil((total + .05) * SR), buf = new Float32Array(n);
    evs.forEach((e) => {
      const s0 = Math.floor(e.t0 * SR), m = Math.floor(e.dur * SR); let ph = 0, lp = 0;
      for (let i = 0; i < m && s0 + i < n; i++) {
        const k = i / m, env = Math.min(1, i / (SR * .01)) * Math.pow(1 - k, 1.6);
        let v;
        if (e.noise) { lp += (Math.random() * 2 - 1 - lp) * e.lp; v = lp * 4; }
        else { const f = e.f2 ? e.f * Math.pow(e.f2 / e.f, k) : e.f; ph += 2 * Math.PI * f / SR; v = wv(ph, e.type); }
        buf[s0 + i] += v * env * e.vol;
      }
    });
    const dv = new DataView(new ArrayBuffer(44 + n * 2));
    const w = (o, str) => { for (let i = 0; i < str.length; i++) dv.setUint8(o + i, str.charCodeAt(i)); };
    w(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, SR, true); dv.setUint32(28, SR * 2, true);
    dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, "data"); dv.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, buf[i])) * 32000, true);
    return URL.createObjectURL(new Blob([dv], { type: "audio/wav" }));
  }
  function unlock() {
    if (ready) return; ready = true;
    Object.keys(DEFS).forEach((k) => {
      try {
        const a = new Audio(build(DEFS[k])); a.preload = "auto"; a.volume = 1; els[k] = a;
        a.muted = true;
        const pr = a.play();
        const done = () => { try { a.pause(); a.currentTime = 0; } catch (e) {} a.muted = false; };
        if (pr && pr.then) pr.then(done).catch(() => { a.muted = false; ready = false; }); else done();
      } catch (e) { ready = false; }
    });
  }
  const play = (k) => {
    if (muted) return;
    if (!ready) unlock();
    const a = els[k]; if (!a) return;
    try { a.muted = false; a.currentTime = 0; const pr = a.play(); if (pr && pr.catch) pr.catch(() => {}); } catch (e) {}
  };
  try { document.addEventListener("pointerdown", unlock, { once: true }); document.addEventListener("touchstart", unlock, { once: true }); } catch (e) {}
  return {
    unlock,
    get muted() { return muted; },
    toggle() { muted = !muted; try { localStorage.setItem("nb_mute", muted ? "1" : "0"); } catch (e) {} unlock(); if (!muted) setTimeout(() => play("coin"), 80); return muted; },
    start: () => play("start"), hop: () => play("hop"), coin: () => play("coin"),
    horn: () => play("horn"), crash: () => play("crash"), cash: () => play("cash"),
  };
})();

function crChicken() {
  return `<g class="cr-hop">
    <path d="M-12 -24 L-12 -4 M10 -24 L10 -4" stroke="url(#crLeg)" stroke-width="6" stroke-linecap="round"/>
    <path d="M-22 -2 L-14 -9 M-14 -2 L-12 -9 M-6 -2 L-12 -9 M2 -2 L10 -9 M10 -2 L10 -9 M18 -2 L10 -9" stroke="#d98414" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M-30 -62 Q-62 -78 -56 -46 Q-52 -62 -38 -52Z" fill="#e9e9ee" stroke="#cfcfd8" stroke-width="2"/>
    <path d="M-30 -52 Q-58 -60 -50 -34 Q-46 -48 -34 -44Z" fill="#dcdce4" stroke="#c4c4ce" stroke-width="2"/>
    <ellipse cx="0" cy="-48" rx="34" ry="31" fill="url(#crFeather)" stroke="#cdcdd6" stroke-width="2.5"/>
    <path d="M-24 -38 Q-4 -22 22 -36" fill="none" stroke="#e3e3ea" stroke-width="3" stroke-linecap="round"/>
    <path d="M-20 -52 Q-8 -40 8 -50 M-22 -44 Q-8 -32 12 -42" fill="none" stroke="#dcdce4" stroke-width="2.4" stroke-linecap="round"/>
    <ellipse cx="-6" cy="-46" rx="17" ry="12" fill="#f4f4f8" stroke="#d3d3dc" stroke-width="2"/>
    <circle cx="14" cy="-86" r="22" fill="url(#crFeather)" stroke="#cdcdd6" stroke-width="2.5"/>
    <path d="M3 -104 q-3 -12 5 -10 q1 -11 9 -6 q8 -6 10 6 q9 -1 4 11 q-12 -3 -28 -1z" fill="#d9231e" stroke="#a31410" stroke-width="1.5"/>
    <path d="M35 -88 L56 -82 L35 -74Z" fill="#ffae1f" stroke="#d98400" stroke-width="1.5"/>
    <path d="M34 -73 q6 16 -2 18 q-8 -8 2 -18z" fill="#d9231e" stroke="#a31410" stroke-width="1.2"/>
    <circle cx="24" cy="-92" r="9" fill="#fff" stroke="#8d8d99" stroke-width="1.6"/><circle cx="26" cy="-92" r="4.6" fill="#111"/><circle cx="27.6" cy="-93.6" r="1.7" fill="#fff"/>
  </g>`;
}

function crCar(color) {
  // original cartoon car from above, with glossy body, glass, lights and a headlight beam
  return `<g>
    <ellipse cx="4" cy="6" rx="34" ry="56" fill="rgba(0,0,0,.35)"/>
    <path d="M-16 52 L-30 150 L30 150 L16 52Z" fill="url(#crBeamCar)"/>
    <rect x="-27" y="-36" width="7" height="18" rx="3" fill="#0e0e12"/><rect x="20" y="-36" width="7" height="18" rx="3" fill="#0e0e12"/>
    <rect x="-27" y="16" width="7" height="18" rx="3" fill="#0e0e12"/><rect x="20" y="16" width="7" height="18" rx="3" fill="#0e0e12"/>
    <rect x="-25" y="-50" width="50" height="104" rx="18" fill="${color}" stroke="rgba(0,0,0,.55)" stroke-width="2.5"/>
    <rect x="-25" y="-50" width="50" height="104" rx="18" fill="url(#crShine)"/>
    <path d="M-17 -8 Q0 -16 17 -8 L15 14 Q0 20 -15 14Z" fill="#9ed2f5" stroke="rgba(0,0,0,.35)" stroke-width="1.5"/>
    <path d="M-14 -4 Q-2 -9 6 -6 L-4 10Z" fill="rgba(255,255,255,.55)"/>
    <path d="M-15 24 Q0 30 15 24 L13 38 Q0 42 -13 38Z" fill="#7fb4d8" stroke="rgba(0,0,0,.3)"/>
    <rect x="-17" y="-44" width="34" height="14" rx="6" fill="rgba(255,255,255,.14)"/>
    <rect x="-30" y="-14" width="7" height="9" rx="3" fill="${color}" stroke="rgba(0,0,0,.4)"/><rect x="23" y="-14" width="7" height="9" rx="3" fill="${color}" stroke="rgba(0,0,0,.4)"/>
    <ellipse cx="-14" cy="50" rx="7" ry="4.5" fill="#fff8c2"/><ellipse cx="14" cy="50" rx="7" ry="4.5" fill="#fff8c2"/>
    <rect x="-18" y="-52" width="10" height="4" rx="2" fill="#ff3b30"/><rect x="8" y="-52" width="10" height="4" rx="2" fill="#ff3b30"/>
  </g>`;
}

function crSceneSVG(rules) {
  const N = CR.N, LW = CR.LW, G = CR.GROUND;
  let lanes = "";
  for (let i = 0; i <= N + 1; i++) {
    const x = crLaneX(i);
    if (i === 0) {
      lanes += `<rect x="${x - 200}" y="60" width="${LW + 200}" height="240" fill="#2b2f58"/>
        <rect x="${x - 200}" y="268" width="${LW + 200}" height="32" fill="#1d2040"/>
        <text x="${x + 45}" y="150" text-anchor="middle" font-size="13" font-weight="900" fill="#aab3ff" letter-spacing="2">START</text>`;
      continue;
    }
    if (i === N + 1) {
      lanes += `<rect x="${x}" y="60" width="${LW + 400}" height="240" fill="#2b2f58"/>
        <rect x="${x + LW - 4}" y="60" width="400" height="240" fill="#4a4f80"/>
        <path d="M${x + 12} 268 L${x + 12} 140 Q${x + 45} 66 ${x + 78} 140 L${x + 78} 268Z" fill="#1b1e3d" stroke="#9aa3ee" stroke-width="3"/>
        <path d="M${x + 12} 268 L${x + 12} 140 Q${x + 45} 66 ${x + 78} 140 L${x + 78} 268Z" fill="url(#crBeam)"/>
        <ellipse cx="${x + 45}" cy="198" rx="24" ry="31" fill="url(#crGold)" stroke="#a87100" stroke-width="3"/>
        <ellipse cx="${x + 38}" cy="186" rx="6" ry="10" fill="rgba(255,255,255,.55)"/>
        <path d="M${x + 28} 268 L${x + 34} 252 L${x + 56} 252 L${x + 62} 268Z" fill="#d9ddff"/>`;
      continue;
    }
    lanes += `<rect id="cr-lane-${i}" x="${x}" y="60" width="${LW}" height="240" fill="url(#crAsph)"/><rect x="${x}" y="60" width="${LW}" height="240" filter="url(#crNoise)"/><rect x="${x}" y="60" width="${LW}" height="120" fill="url(#crLamp)"/>
      <line x1="${x + LW}" y1="64" x2="${x + LW}" y2="298" stroke="#c9cdf2" stroke-width="3" stroke-dasharray="14 12" opacity=".5"/>
      <g id="cr-grate-${i}"><ellipse cx="${x + 45}" cy="284" rx="26" ry="8" fill="url(#crManhole)" stroke="#232749" stroke-width="2"/><path d="M${x + 28} 284 H${x + 62} M${x + 34} 280 H${x + 56} M${x + 34} 288 H${x + 56}" stroke="#262b52" stroke-width="1.5"/><path d="M${x + 20} 268 Q${x + 20} 222 ${x + 45} 222 Q${x + 70} 222 ${x + 70} 268Z" fill="#171a36" stroke="#5d6498" stroke-width="2.5"/>
        <path d="M${x + 31} 268 V236 M${x + 40} 268 V230 M${x + 50} 268 V230 M${x + 59} 268 V236" stroke="#5d6498" stroke-width="2.5"/></g>
      <g id="cr-coin-${i}" transform="translate(${x + 45},130)">
        <circle r="35" fill="rgba(0,0,0,.28)" cy="4"/>
        <circle id="cr-coinc-${i}" r="32" fill="url(#crBlue)" stroke="#c9d0ff" stroke-width="4"/>
        <text id="cr-coint-${i}" y="6" text-anchor="middle" font-size="16" font-weight="900" fill="#fff">${Number(rules.steps[i - 1].multiplier).toFixed(2)}x</text></g>`;
  }
  let bricks = "";
  for (let r = 0; r < 4; r++) for (let c = -2; c < (N + 4) * 2; c++) {
    bricks += `<rect x="${c * 45 + (r % 2 ? 22 : 0)}" y="${r * 15}" width="43" height="13" rx="2" fill="${(r + c) % 3 ? "#232748" : "#2a2f55"}"/>`;
  }
  return `<svg id="cr-svg" viewBox="0 0 ${CR.W} ${CR.H}" width="100%" style="display:block;border-radius:14px;background:#1a1d38;overflow:hidden">
    <defs>
      <radialGradient id="crGold" cx="35%" cy="30%"><stop offset="0" stop-color="#fff3a0"/><stop offset=".55" stop-color="#ffc928"/><stop offset="1" stop-color="#d98f00"/></radialGradient>
      <radialGradient id="crGreen" cx="35%" cy="30%"><stop offset="0" stop-color="#6ff08e"/><stop offset="1" stop-color="#16963a"/></radialGradient>
      <radialGradient id="crBlue" cx="35%" cy="30%"><stop offset="0" stop-color="#7f8cff"/><stop offset="1" stop-color="#3b479e"/></radialGradient>
      <linearGradient id="crFeather" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dfe0ea"/></linearGradient>
      <linearGradient id="crLeg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb62e"/><stop offset="1" stop-color="#d98414"/></linearGradient>
      <linearGradient id="crShine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".45" stop-color="#fff" stop-opacity=".02"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient>
      <linearGradient id="crBeamCar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6b0" stop-opacity=".55"/><stop offset="1" stop-color="#fff6b0" stop-opacity="0"/></linearGradient>
      <linearGradient id="crAsph" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c3160"/><stop offset=".6" stop-color="#383e72"/><stop offset="1" stop-color="#2a2f5a"/></linearGradient>
      <radialGradient id="crLamp" cx="50%" cy="0%" r="80%"><stop offset="0" stop-color="#fff2b0" stop-opacity=".35"/><stop offset="1" stop-color="#fff2b0" stop-opacity="0"/></radialGradient>
      <radialGradient id="crManhole" cx="40%" cy="35%"><stop offset="0" stop-color="#8c93c4"/><stop offset="1" stop-color="#3a3f6e"/></radialGradient>
      <filter id="crNoise" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .22 0"/></filter>
      <linearGradient id="crBeam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".0"/><stop offset="1" stop-color="#fff" stop-opacity=".22"/></linearGradient>
    </defs>
    <g id="cr-world" style="transition:transform .55s ease-in-out">
      ${bricks}<rect y="58" x="-200" width="${(N + 3) * LW + 400}" height="4" fill="#12142a"/>
      ${lanes}
      <rect id="cr-hl" x="0" y="60" width="${LW}" height="240" fill="rgba(255,255,255,.07)" style="transition:transform .55s ease-in-out"/>
      <rect x="-200" y="268" width="${(N + 3) * LW + 400}" height="32" fill="#14172f" opacity=".75"/>
      <g id="cr-carl"></g><g id="cr-coins"></g>
      <g id="cr-ck" style="transition:transform .55s cubic-bezier(.3,1.3,.5,1)"><ellipse cx="0" cy="2" rx="26" ry="6" fill="rgba(0,0,0,.4)"/><g transform="scale(.8)">${crChicken()}</g></g>
    </g></svg>`;
}

function crPlace(step, animate) {
  const ck = document.getElementById("cr-ck"), w = document.getElementById("cr-world"), hl = document.getElementById("cr-hl");
  if (!ck || !w) return;
  if (!animate) { ck.style.transition = "none"; w.style.transition = "none"; if (hl) hl.style.transition = "none"; }
  ck.style.transform = `translate(${crCenterX(step)}px,${CR.GROUND}px)`;
  w.style.transform = `translateX(${-crCam(step)}px)`;
  if (hl) hl.style.transform = `translateX(${crLaneX(step)}px)`;
  if (!animate) { void ck.getBoundingClientRect(); ck.style.transition = ""; w.style.transition = "transform .55s ease-in-out"; if (hl) hl.style.transition = "transform .55s ease-in-out"; }
  const inner = ck.querySelector(".cr-hop");
  if (animate && inner) { inner.classList.remove("hopping", "dead", "dance"); void inner.getBoundingClientRect(); inner.classList.add("hopping"); }
  if (!animate && inner) inner.classList.remove("hopping", "dead", "dance");
}

function crPaint(d, rules) {
  for (let i = 1; i <= CR.N; i++) {
    const c = document.getElementById(`cr-coinc-${i}`), t = document.getElementById(`cr-coint-${i}`);
    if (!c) continue;
    if (i <= d.step) { c.setAttribute("fill", "url(#crGold)"); c.setAttribute("stroke", "#fff0a8"); t.textContent = "🍗"; t.setAttribute("font-size", "28"); t.setAttribute("y", "10"); }
    else {
      const next = i === d.step + 1 && d.status !== "lost" && d.status !== "cashed_out";
      c.setAttribute("fill", next ? "url(#crGreen)" : (i === CR.N ? "url(#crGold)" : "url(#crBlue)"));
      c.setAttribute("stroke", next ? "#b9ffc8" : "#c9d0ff");
      t.textContent = Number(rules.steps[i - 1].multiplier).toFixed(2) + "x"; t.setAttribute("font-size", "16"); t.setAttribute("y", "6");
    }
  }
}

function crCrash(lane) {
  const colors = ["#e5322d", "#ffb020", "#2f9bff"];
  const car = document.getElementById("cr-carl");
  car.innerHTML = `<g transform="translate(${crCenterX(lane)},0)"><g class="cr-car">${crCar(colors[lane % 3])}</g></g>`;
  CRSound.horn();
  setTimeout(() => {
    CRSound.crash();
    try { tg.HapticFeedback && tg.HapticFeedback.notificationOccurred("error"); } catch (e) {}
    const inner = document.querySelector("#cr-ck .cr-hop"); if (inner) inner.classList.add("dead");
    const g = document.getElementById("cr-grate-" + lane); if (g) g.style.opacity = ".3";
  }, 380);
}

function crCoins(step) {
  const g = document.getElementById("cr-coins");
  const cx = crCenterX(step);
  let h = "";
  for (let k = 0; k < 16; k++) {
    const dx = (Math.random() - 0.5) * 160, dy = -50 - Math.random() * 80, d = (Math.random() * 0.25).toFixed(2);
    h += `<g style="--dx:${dx}px;--dy:${dy}px;animation:cr-coin .9s ${d}s ease-out forwards;transform:translate(${cx}px,200px)"><circle r="8" fill="#ffd23f" stroke="#c48a00" stroke-width="2"/><text y="4" text-anchor="middle" font-size="10" font-weight="800" fill="#8a5a00">$</text></g>`;
  }
  g.innerHTML = h;
  CRSound.cash();
  const inner = document.querySelector("#cr-ck .cr-hop"); if (inner) { inner.classList.remove("hopping"); inner.classList.add("dance"); }
}

function crInjectStyles() {
  if (document.getElementById("cr-style")) return;
  const st = document.createElement("style"); st.id = "cr-style";
  st.textContent = `
    .cr-hop{transform-box:fill-box;transform-origin:50% 100%}
    .cr-hop.hopping{animation:cr-hop .5s ease-out}
    .cr-hop.dead{animation:cr-dead .9s ease-in forwards}
    .cr-hop.dance{animation:cr-dance .5s ease-in-out 4}
    .cr-car{animation:cr-car .75s cubic-bezier(.5,0,.8,.6) forwards}
    @keyframes cr-hop{0%{transform:translateY(0) scale(1,1)}25%{transform:translateY(4px) scale(1.1,.88)}60%{transform:translateY(-30px) scale(.95,1.06)}100%{transform:translateY(0) scale(1,1)}}
    @keyframes cr-dead{0%{transform:translate(0,0) rotate(0)}25%{transform:translate(30px,-60px) rotate(140deg)}100%{transform:translate(120px,40px) rotate(640deg) scale(.4);opacity:0}}
    @keyframes cr-dance{0%,100%{transform:rotate(-8deg) translateY(0)}50%{transform:rotate(8deg) translateY(-14px)}}
    @keyframes cr-car{from{transform:translateY(-70px)}to{transform:translateY(340px)}}
    @keyframes cr-coin{from{opacity:1}to{opacity:0;transform:translate(calc(var(--dx) + 0px),calc(var(--dy) + 120px))}}
  `;
  document.head.appendChild(st);
}

async function renderChicken() {
  crInjectStyles();
  screenEl.innerHTML = `<div class="spinner"></div>`;
  try {
    const rules = (await getHouseRules()).chicken;
    const act = await apiGet("/webapp/games/chicken/active");
    crScreen(act.round, rules);
  } catch (e) { tg.showAlert(e.message); renderPlayChooseGame(); }
}

function crScreen(rd, rules) {
  const state = rd || { step: 0, status: "idle", bet: "0", multiplier: "1", potential_payout: "0", next_multiplier: rules.steps[0].multiplier };
  screenEl.innerHTML = `
    <div class="card" style="padding:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin:2px 6px 8px">
        <h2 style="margin:0;font-weight:900;letter-spacing:.5px">CHICKEN <span style="color:#ffd23f">ROAD</span></h2>
        <span style="display:flex;gap:8px;align-items:center"><button id="cr-mute" class="friend-username" style="border:0;cursor:pointer;color:#fff;background:rgba(255,255,255,.12);font-size:15px">${CRSound.muted ? "🔇" : "🔊"}</button><span class="friend-username" id="cr-bal"></span></span></div>
      ${crSceneSVG(rules)}
      <div id="cr-info" class="center-note" style="margin:8px 0 4px"></div>
      <div class="error-text" id="cr-err"></div>
      <div id="cr-controls"></div>
    </div>
    <div class="card"><div class="center-note" style="text-align:left">
      <b>How it works</b> — one difficulty. Every lane is an independent <b>${rules.safe_chance}% safe / ${100 - rules.safe_chance}% car</b>,
      decided by the server's secure random generator before you start and never adjusted for any player.
      Chance to cross <i>k</i> lanes = ${rules.safe_chance}%<sup><i>k</i></sup>. Payout = 2<sup><i>k</i></sup> × ${(1 - Number(rules.house_edge_percent) / 100).toFixed(2)} Expected return to the player at <i>k</i> lanes = ${(1 - Number(rules.house_edge_percent) / 100).toFixed(2)} × ${(2 * rules.safe_chance / 100).toFixed(2)}<sup><i>k</i></sup> (about ${(100 * (1 - Number(rules.house_edge_percent) / 100) * (2 * rules.safe_chance / 100)).toFixed(0)}% on lane 1, less each further lane).
      Bet ${rules.min_bet}–${rules.max_bet} ETB. Max win ${rules.max_payout} ETB per round, up to ${rules.max_steps} lanes. Cash out any time after your first lane; a car loses your bet.
      <div style="margin-top:6px">${rules.steps.map((t) => `${t.step}: ×${Number(t.multiplier).toFixed(2)} (${t.survive_chance}%)`).join(" · ")}</div>
    </div></div>
    <div class="card"><button class="btn secondary" id="g-back">⬅️ Back</button></div>`;
  bindBack();
  document.getElementById("cr-mute").addEventListener("click", (ev) => { ev.currentTarget.textContent = CRSound.toggle() ? "🔇" : "🔊"; });
  apiGet("/webapp/wallet").then((w) => { const b = document.getElementById("cr-bal"); if (b) b.textContent = `${fmt(w.available_balance)} ETB`; }).catch(() => {});
  crPaint(state, rules);
  crPlace(state.step, false);
  const info = document.getElementById("cr-info"), ctr = document.getElementById("cr-controls"), err = document.getElementById("cr-err");
  let busy = false;
  let crId = rd ? rd.round_id : null;
  const refreshBal = () => apiGet("/webapp/wallet").then((w) => { const b = document.getElementById("cr-bal"); if (b) b.textContent = `${fmt(w.available_balance)} ETB`; }).catch(() => {});
  const bar = (inner) => `<div style="display:flex;gap:8px;align-items:stretch;margin-top:6px">${inner}</div>`;
  const setUI = (d) => {
    if (d.status === "active") {
      info.innerHTML = `Bet ${d.bet} ETB · <b>×${Number(d.multiplier).toFixed(2)}</b> = <b>${d.potential_payout} ETB</b>` + (d.next_multiplier ? ` · Next ×${Number(d.next_multiplier).toFixed(2)} (${rules.safe_chance}%)` : "");
      ctr.innerHTML = bar(`<button class="btn" id="cr-cash" style="flex:1;margin:0;background:#ffc21a;color:#2a1c00;font-weight:800" ${d.step < 1 ? "disabled" : ""}>CASH OUT<br>${d.potential_payout} ETB</button>
        <button class="btn" id="cr-go" style="flex:1;margin:0;background:#2fc057;font-weight:900;font-size:20px">GO</button>`);
      document.getElementById("cr-go").addEventListener("click", doStep);
      document.getElementById("cr-cash").addEventListener("click", doCash);
    } else if (d.status === "idle") {
      info.textContent = "Pick your bet, press GO, then keep crossing lanes. Every lane is risky — ${rules.safe_chance}% safe.";
      ctr.innerHTML = `<div class="field" style="margin-bottom:6px"><label>Bet (ETB ${rules.min_bet}–${rules.max_bet})</label><input id="cr-bet" type="number" inputmode="decimal" value="${window._crBet || 10}" /></div>
        <div class="stake-grid" style="margin-bottom:6px">${["5", "10", "50", "100", "500"].map((x) => `<button class="stake-btn" data-q="${x}">${x}</button>`).join("")}</div>
        ${bar(`<button class="btn" id="cr-start" style="flex:1;margin:0;background:#2fc057;font-weight:900;font-size:20px">GO</button>`)}`;
      ctr.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => { document.getElementById("cr-bet").value = b.dataset.q; }));
      document.getElementById("cr-start").addEventListener("click", doStart);
    } else {
      const lost = d.status === "lost";
      info.innerHTML = lost ? `🚗💥 Hit by a car! You lost ${d.bet} ETB.` : `✅ Cashed out <b>${d.payout} ETB</b> (×${Number(d.multiplier).toFixed(2)})`;
      ctr.innerHTML = bar(`<button class="btn" id="cr-again" style="flex:1;margin:0;background:#2fc057;font-weight:900">PLAY AGAIN</button>`);
      document.getElementById("cr-again").addEventListener("click", () => crScreen(null, rules));
      refreshBal();
    }
  };
  const doStart = async () => {
    if (busy) return; busy = true; err.textContent = ""; CRSound.unlock();
    try {
      window._crBet = document.getElementById("cr-bet").value.trim();
      const d = await apiPostJson("/webapp/games/chicken/start", { bet: window._crBet });
      CRSound.start(); crId = d.round_id; document.getElementById("cr-carl").innerHTML = ""; crPaint(d, rules); crPlace(0, false); setUI(d); refreshBal();
    } catch (e) { err.textContent = e.message; }
    busy = false;
  };
  const doStep = async () => {
    if (busy) return; busy = true; err.textContent = ""; CRSound.unlock();
    try {
      const d = await apiPostJson("/webapp/games/chicken/step", { round_id: crId });
      CRSound.hop();
      if (d.status === "lost") {
        crPlace(d.lost_at - 1 + 1 > CR.N ? CR.N : d.lost_at, true);   // chicken steps into the lane
        crPaint({ ...d, step: d.lost_at - 1 }, rules);
        setTimeout(() => { crCrash(d.lost_at); setTimeout(() => setUI(d), 1000); }, 550);
      } else {
        crPlace(d.step, true); crPaint(d, rules);
        setTimeout(() => CRSound.coin(), 420);
        if (d.status === "cashed_out") setTimeout(() => { crCoins(d.step); setUI(d); }, 550);
        else setUI(d);
      }
    } catch (e) { err.textContent = e.message; }
    busy = false;
  };
  const doCash = async () => {
    if (busy) return; busy = true; err.textContent = "";
    try {
      const d = await apiPostJson("/webapp/games/chicken/cashout", { round_id: crId });
      crCoins(d.step); setUI(d);
    } catch (e) { err.textContent = e.message; }
    busy = false;
  };
  setUI(state);
}
