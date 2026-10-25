/* duels.js — 1v1 lobby + game screen shell + Chess + Archery.
 * (Car Race and Pool live in duels2.js.) The server decides everything;
 * this file only draws what the server says and sends the player's input. */

const DUEL_META = {
  chess: { icon: "♟️", name: "Chess", blurb: "Full chess. 90 seconds per move. Checkmate wins; stalemate or repetition is a draw." },
  archery: { icon: "🏹", name: "Archery", blurb: "5 arrows each. Time your tap when the crosshair is on the bullseye — wind pushes the arrow. Highest score wins." },
  race: { icon: "🏎️", name: "Car Race", blurb: "Both race the same track. Steer between 3 lanes and dodge the obstacles. Each crash adds 1.2 s. Fastest time wins." },
  pool: { icon: "🎱", name: "Pool", blurb: "8-ball. Pot your group (solids or stripes), then the black 8. Foul = your opponent places the cue ball anywhere." },
};

const DUEL_REASON = {
  checkmate: "Checkmate", resign: "Resignation", timeout: "Time ran out", score: "Higher score", time: "Faster time", forfeit: "Opponent didn't finish",
  black_win: "Potted the 8-ball", black_early: "Potted the 8-ball too early", stalemate: "Stalemate", draw_50: "50-move rule",
  draw_rep: "Repetition", draw_material: "Not enough pieces", tie: "Scores tied", same_time: "Same time", no_show: "Nobody played",
};

/* ------------------------------------------------------------- lobby */
async function renderDuelLobby(game) {
  stopPolling();
  const meta = DUEL_META[game];
  screenEl.innerHTML = SKEL;
  const [fr, lobby, cfg] = await Promise.all([
    apiGet("/webapp/friends").catch(() => ({ friends: [] })),
    apiGet(`/webapp/duels/lobby?game=${game}`).catch(() => ({ open: [], mine: null })),
    apiGet("/webapp/config").catch(() => ({ bot_username: "Ticarena_bot" })),
  ]);
  let friendId = null;
  screenEl.innerHTML = `
    <div class="card">
      <h2>${meta.icon} ${meta.name} • 1 vs 1</h2>
      <p class="center-note" style="text-align:left">${meta.blurb}<br>Both stake the same amount. Winner gets 2× stake minus a small fee. Draw = both refunded.</p>
    </div>
    ${lobby.mine ? `<div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:10px"><b>⚡ You have a game in progress</b><button class="btn" id="dl-resume" style="width:auto;margin:0;padding:9px 16px">Resume</button></div>` : ""}
    <div class="card">
      <div class="sec-title" style="margin-top:0">1 · Choose your stake</div>
      <div id="stake-slot"></div>
      <div class="sec-title">2 · Choose your opponent</div>
      <div>${fr.friends.length ? fr.friends.map((f) => `<div class="fr-pick" data-f="${f.internal_id}"><div class="avatar">${initial(f.full_name || f.telegram_username)}</div>
        <div><div class="friend-name">${esc(f.full_name || f.telegram_username)}</div><div class="friend-username">@${esc(f.telegram_username || "—")}</div></div></div>`).join("")
        : `<p class="center-note">No friends yet — add some in the Friends tab, or share an invite link below.</p>`}</div>
      <div class="error-text" id="dl-err"></div>
      <button class="btn" id="dl-send">⚔️ Challenge friend</button>
      <button class="btn secondary" id="dl-share">🔗 Share invite link</button>
      <button class="btn secondary" id="dl-open">🌍 Open challenge (anyone can join)</button>
    </div>
    ${lobby.open.length ? `<div class="card"><h2>⏳ Open challenges</h2>${lobby.open.map((g) => `<div class="list-row">
      <div><div class="friend-name">${esc(g.creator_name || "Player")}${g.private ? " (for you)" : ""}</div><div class="friend-username">${g.stake} ETB</div></div>
      <button class="btn" style="margin:0;width:auto;padding:8px 14px" data-join="${g.game_id}">Join</button></div>`).join("")}</div>` : ""}
    <div class="card"><button class="btn secondary" id="g-back">⬅️ Back</button></div>`;
  bindBack();
  const stake = stakeUI(document.getElementById("stake-slot"), { min: 5, max: 500, def: 10 });
  const err = document.getElementById("dl-err");
  screenEl.querySelectorAll("[data-f]").forEach((el) => el.addEventListener("click", () => {
    friendId = friendId === el.dataset.f ? null : el.dataset.f;
    screenEl.querySelectorAll("[data-f]").forEach((x) => x.classList.toggle("sel", x.dataset.f === friendId));
  }));
  const create = async (invite, ev) => {
    err.textContent = "";
    if (!stake.valid()) { err.textContent = "Enter a stake between 5 and 500 ETB."; return null; }
    ev.target.disabled = true;
    try {
      return await apiPostJson("/webapp/duels/create", { game, stake: String(stake.get()), invite_user_id: invite });
    } catch (e) { err.textContent = e.message; ev.target.disabled = false; return null; }
  };
  document.getElementById("dl-send").addEventListener("click", async (ev) => {
    if (!friendId) { err.textContent = "Pick a friend first."; return; }
    const r = await create(friendId, ev); if (!r) return;
    if (r.notified === false) tg.showAlert("Challenge created, but Telegram couldn't deliver it. Ask your friend to open Nova Bet and join from Open challenges.");
    window.location.hash = `#/duel/${r.game_id}`;
  });
  document.getElementById("dl-open").addEventListener("click", async (ev) => {
    const r = await create(null, ev); if (r) window.location.hash = `#/duel/${r.game_id}`;
  });
  document.getElementById("dl-share").addEventListener("click", async (ev) => {
    const r = await create(null, ev); if (!r) return;
    const link = `https://t.me/${cfg.bot_username}?start=duel_${r.game_id}`;
    const text = `${meta.icon} I challenge you to ${meta.name} on Nova Bet for ${stake.get()} ETB! Tap to accept:`;
    tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
    window.location.hash = `#/duel/${r.game_id}`;
  });
  screenEl.querySelectorAll("[data-join]").forEach((b) => b.addEventListener("click", async () => {
    try { await apiPostJson(`/webapp/duels/${b.dataset.join}/join`, {}); window.location.hash = `#/duel/${b.dataset.join}`; }
    catch (e) { err.textContent = e.message; }
  }));
  const rs = document.getElementById("dl-resume");
  if (rs) rs.addEventListener("click", () => { window.location.hash = `#/duel/${lobby.mine}`; });
}

/* ------------------------------------------------------------- game shell */
const DUEL_VIEWS = {};   // game -> { mount(root, s, ctx), update(s, ctx), destroy() }
let _dl = null;          // current duel context

function duelNow() { return Date.now() + ((_dl && _dl.offset) || 0); }
function duelSecs(iso) { return Math.max(0, Math.round((new Date(iso).getTime() - duelNow()) / 1000)); }

async function renderDuelGame(id) {
  stopPolling();
  if (_dl && _dl.view) { try { _dl.view.destroy(); } catch (e) {} }
  const ctx = _dl = { id, view: null, game: null, offset: 0, busy: false, shown: false, last: null };
  screenEl.innerHTML = `<div class="spinner"></div>`;
  ctx.post = async (path, data) => {
    if (ctx.busy) return null;
    ctx.busy = true;
    try { const s = await apiPostJson(`/webapp/duels/${id}/${path}`, data || {}); duelDraw(ctx, s); return s; }
    catch (e) { const x = document.getElementById("dl-err"); if (x) x.textContent = e.message; else tg.showAlert(e.message); return null; }
    finally { ctx.busy = false; }
  };
  const load = async () => {
    const s = await apiGet(`/webapp/duels/${id}`);
    duelDraw(ctx, s);
    return s;
  };
  try { await load(); } catch (e) { tg.showAlert(e.message); return renderPlayChooseGame(); }
  const every = { chess: 1500, pool: 1200, archery: 700, race: 1000 }[ctx.game] || 1500;
  pollTimer = setInterval(async () => {
    if (ctx.busy || _dl !== ctx) return;
    try {
      const s = await apiGet(`/webapp/duels/${id}`);
      duelDraw(ctx, s);
      if (["cancelled", "expired"].includes(s.status) || (["completed", "draw"].includes(s.status) && ctx.shown)) stopPolling();
    } catch (e) {}
  }, every);
}

function duelDraw(ctx, s) {
  ctx.game = s.game;
  ctx.offset = new Date(s.server_now).getTime() - Date.now();
  ctx.s = s;
  const meta = DUEL_META[s.game];
  const pot = (Number(s.stake) * 2 - Number(s.fee)).toFixed(2);
  const names = `${esc(s.creator_name || "Player")} vs ${esc(s.opponent_name || "…")}`;
  const head = `<h2>${meta.icon} ${meta.name} • ${s.stake} ETB</h2>
    <p class="friend-username">${names} · winner takes ${pot} ETB</p>`;
  const bindCommon = () => {
    const el = (i) => document.getElementById(i);
    if (el("dl-join")) el("dl-join").addEventListener("click", () => ctx.post("join"));
    if (el("dl-cancel")) el("dl-cancel").addEventListener("click", () => ctx.post("cancel"));
    if (el("dl-back")) el("dl-back").addEventListener("click", () => { window.location.hash = "#/play"; });
    if (el("dl-rematch")) el("dl-rematch").addEventListener("click", async () => {
      try {
        const r = await apiPostJson("/webapp/duels/create", { game: s.game, stake: s.stake, invite_user_id: s.opponent_id });
        window.location.hash = `#/duel/${r.game_id}`;
      } catch (e) { const x = document.getElementById("dl-err"); if (x) x.textContent = e.message; }
    });
  };
  // -------- not playing: waiting room / ended without a game board
  if (s.status === "open") {
    if (ctx.view) { try { ctx.view.destroy(); } catch (e) {} ctx.view = null; }
    const mine = s.you_are === "creator" || s.you_are === "c";
    screenEl.innerHTML = `<div class="card" id="dl-root">${head}${s.you_are === "c"
      ? `<p class="center-note">Waiting for an opponent… (expires in ${Math.ceil(duelSecs(s.expires_at) / 60)} min)</p><button class="btn secondary" id="dl-cancel">Cancel &amp; refund</button>`
      : `<p class="center-note">${esc(s.creator_name || "A player")} challenges you for ${s.stake} ETB.<br>Winner gets ${pot} ETB. Draw = refund.</p><button class="btn" id="dl-join">Accept &amp; stake ${s.stake} ETB</button>`}
      <div class="error-text" id="dl-err"></div></div>`;
    bindCommon();
    return;
  }
  if (s.status === "cancelled" || s.status === "expired") {
    if (ctx.view) { try { ctx.view.destroy(); } catch (e) {} ctx.view = null; }
    screenEl.innerHTML = `<div class="card" id="dl-root">${head}<p class="center-note">${s.status === "cancelled" ? "Challenge cancelled." : "Challenge expired."} Stake refunded.</p><button class="btn" id="dl-back">Back</button></div>`;
    bindCommon();
    return;
  }
  // -------- playing / finished: mount the game view once, then just update it
  const finished = s.status === "completed" || s.status === "draw";
  if (!ctx.view) {
    screenEl.innerHTML = `<div class="card" id="dl-root"><div id="dl-head">${head}</div><div id="dl-body"></div>
      <div id="dl-foot"></div><div class="error-text" id="dl-err"></div></div>`;
    ctx.view = DUEL_VIEWS[s.game];
    ctx.view.mount(document.getElementById("dl-body"), s, ctx);
  }
  ctx.view.update(s, ctx);
  const foot = document.getElementById("dl-foot");
  if (finished) {
    let res;
    if (s.status === "draw") res = `🤝 Draw — both stakes refunded${s.reason ? " (" + (DUEL_REASON[s.reason] || s.reason) + ")" : ""}.`;
    else if (s.you_won) res = `🎉 You won ${s.payout} ETB! (${DUEL_REASON[s.reason] || s.reason})`;
    else res = `❌ You lost ${s.stake} ETB. (${DUEL_REASON[s.reason] || s.reason})`;
    foot.innerHTML = `<p class="center-note" style="font-size:16px">${res}</p>
      ${s.opponent_id ? `<button class="btn" id="dl-rematch">🔁 Rematch (${s.stake} ETB)</button>` : ""}
      <button class="btn secondary" id="dl-back">Back</button>`;
    bindCommon();
    if (!ctx.shown) {
      ctx.shown = true;
      setTimeout(() => {
        if (_dl !== ctx) return;
        const net = (Number(s.payout || 0) - Number(s.stake)).toFixed(2);
        const why = DUEL_REASON[s.reason] || "";
        if (s.status === "draw") showResultModal({ outcome: "draw", title: "Draw", sub: `${why} — your stake is refunded, no fee.`, secondary: "Close", onSecondary: () => {} });
        else if (s.you_won) showResultModal({ outcome: "win", title: "You won!", amount: `+${net} ETB`, sub: `${why}. Payout ${s.payout} ETB (fee ${s.fee} ETB).`, secondary: "Close", onSecondary: () => {} });
        else showResultModal({ outcome: "loss", title: "You lost", amount: `−${s.stake} ETB`, sub: `${why}. Better luck next round.`, secondary: "Close", onSecondary: () => {} });
      }, 2200);
    }
  }
}

/* ------------------------------------------------------------- CHESS */
const CH_GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const CH_START = { p: 8, n: 2, b: 2, r: 2, q: 1 };

DUEL_VIEWS.chess = {
  sel: null, promo: null, flip: false, root: null,
  mount(root, s, ctx) {
    this.root = root; this.sel = null; this.promo = null; this.ctx = ctx;
    this.flip = s.g.color === "b";
    root.innerHTML = `<style>
      .ch-wrap{margin:10px auto;max-width:360px}
      .ch-bar{display:flex;justify-content:space-between;align-items:center;font-size:13px;min-height:22px;padding:2px 4px}
      .ch-grid{display:grid;grid-template-columns:repeat(8,1fr);border-radius:8px;overflow:hidden;border:2px solid #3b2a14;touch-action:manipulation}
      .ch-sq{aspect-ratio:1;display:flex;align-items:center;justify-content:center;position:relative;font-size:min(8.6vw,34px);user-select:none;line-height:1}
      .ch-sq.l{background:#eed9b0}.ch-sq.d{background:#a97f55}
      .ch-sq.last{box-shadow:inset 0 0 0 100px rgba(255,214,0,.35)}
      .ch-sq.sel{box-shadow:inset 0 0 0 100px rgba(52,209,122,.55)}
      .ch-sq.chk{box-shadow:inset 0 0 0 100px rgba(255,61,79,.6)}
      .ch-sq .dot{position:absolute;width:30%;height:30%;border-radius:50%;background:rgba(20,20,20,.35)}
      .ch-sq .ring{position:absolute;inset:6%;border-radius:50%;border:3px solid rgba(20,20,20,.35)}
      .ch-w{color:#fff;text-shadow:0 0 2px #000,0 0 2px #000,0 1px 3px #000}
      .ch-b{color:#151515;text-shadow:0 0 1px #fff8}
      .ch-cap{font-size:15px;letter-spacing:1px;min-height:20px}
      .ch-promo{display:flex;gap:8px;justify-content:center;margin:8px 0}
      .ch-promo button{font-size:28px;padding:6px 14px;border-radius:10px;border:0;background:#243029;color:#fff}
    </style><div class="ch-wrap"><div class="ch-bar" id="ch-top"></div><div class="ch-cap" id="ch-capt"></div>
      <div class="ch-grid" id="ch-grid"></div><div class="ch-cap" id="ch-capb"></div><div class="ch-bar" id="ch-bot"></div>
      <div class="ch-promo" id="ch-promo"></div></div>`;
    document.getElementById("ch-grid").addEventListener("click", (e) => {
      const sq = e.target.closest("[data-sq]"); if (sq) this.tap(Number(sq.dataset.sq));
    });
    this.tick = setInterval(() => { if (!root.isConnected) return clearInterval(this.tick); if (this.ctx.s) this.timer(this.ctx.s); }, 500);
  },
  destroy() { clearInterval(this.tick); },
  timer(s) {
    const el = document.getElementById("ch-time");
    if (el && s.status === "playing") el.textContent = "⏱ " + duelSecs(s.deadline) + "s";
  },
  tap(sq) {
    const s = this.ctx.s, g = s.g;
    if (s.status !== "playing" || g.turn !== s.you_are) return;
    if (this.promo) return;
    const legal = g.legal || {};
    if (this.sel !== null && (legal[this.sel] || []).includes(sq)) {
      const piece = g.board[this.sel];
      const lastRank = g.color === "w" ? 0 : 7;
      if (piece.toLowerCase() === "p" && Math.floor(sq / 8) === lastRank) { this.promo = { from: this.sel, to: sq }; this.draw(s); return; }
      return this.send(this.sel, sq, "");
    }
    this.sel = legal[sq] ? sq : null;
    this.draw(s);
  },
  async send(from, to, promo) {
    this.sel = null; this.promo = null;
    await this.ctx.post("move", { from, to, promo });
  },
  update(s) { this.draw(s); },
  draw(s) {
    const g = s.g, b = g.board, mine = s.status === "playing" && g.turn === s.you_are;
    const legal = g.legal || {};
    if (this.sel !== null && !legal[this.sel]) this.sel = null;
    const targets = this.sel !== null ? (legal[this.sel] || []) : [];
    let kingSq = -1;
    if (g.check) kingSq = b.indexOf(g.turn === "c" ? "K" : "k");
    let html = "";
    for (let vi = 0; vi < 64; vi++) {
      const i = this.flip ? 63 - vi : vi;
      const r = Math.floor(i / 8), c = i % 8, p = b[i];
      const cls = ["ch-sq", (r + c) % 2 ? "d" : "l"];
      if (g.last && (g.last[0] === i || g.last[1] === i)) cls.push("last");
      if (i === this.sel) cls.push("sel");
      if (i === kingSq) cls.push("chk");
      let inner = "";
      if (p !== ".") inner += `<span class="${p === p.toUpperCase() ? "ch-w" : "ch-b"}">${CH_GLYPH[p.toLowerCase()]}︎</span>`;
      if (targets.includes(i)) inner += p !== "." ? `<i class="ring"></i>` : `<i class="dot"></i>`;
      html += `<div class="${cls.join(" ")}" data-sq="${i}">${inner}</div>`;
    }
    document.getElementById("ch-grid").innerHTML = html;
    // captured pieces / names
    const cnt = {};
    for (const p of b) if (p !== ".") cnt[p] = (cnt[p] || 0) + 1;
    const lost = (white) => Object.keys(CH_START).map((t) => {
      const k = white ? t.toUpperCase() : t, miss = CH_START[t] - (cnt[k] || 0);
      return miss > 0 ? CH_GLYPH[t].repeat(miss) + "︎" : "";
    }).join("");
    const meW = g.color === "w";
    const oppName = esc(s.you_are === "c" ? s.opponent_name : s.creator_name), myName = "You";
    const turnTxt = s.status !== "playing" ? "" : mine ? (g.check ? "⚠️ Check! Your move" : "Your move") : "Opponent's move…";
    document.getElementById("ch-top").innerHTML = `<b>${meW ? "⚫" : "⚪"} ${oppName || "Opponent"}</b><span style="color:#8b95ad">${lost(!meW) ? "took: " + lost(!meW) : ""}</span>`;
    document.getElementById("ch-bot").innerHTML = `<b>${meW ? "⚪" : "⚫"} ${myName}</b><span><b>${turnTxt}</b> <span id="ch-time" style="color:#ffd23f"></span></span>`;
    document.getElementById("ch-capb").innerHTML = `<span style="color:#8b95ad;font-size:12px">${lost(meW) ? "lost: " + lost(meW) : ""}</span>`;
    const pr = document.getElementById("ch-promo");
    pr.innerHTML = this.promo ? ["q", "r", "b", "n"].map((t) => `<button data-pr="${t}">${CH_GLYPH[t]}︎</button>`).join("") : "";
    pr.querySelectorAll("[data-pr]").forEach((x) => x.addEventListener("click", () => this.send(this.promo.from, this.promo.to, x.dataset.pr)));
    this.timer(s);
    const foot = document.getElementById("dl-foot");
    if (foot && s.status === "playing" && !document.getElementById("ch-resign")) {
      foot.innerHTML = `<button class="btn secondary" id="ch-resign">🏳️ Resign</button>`;
      document.getElementById("ch-resign").addEventListener("click", () => {
        const go = () => this.ctx.post("resign");
        tg.showConfirm ? tg.showConfirm("Resign and lose your stake?", (ok) => ok && go()) : go();
      });
    }
  },
};

/* ------------------------------------------------------------- ARCHERY */
const AR_COL = [[0.1, "#ffd23f"], [0.2, "#ffd23f"], [0.4, "#e8433f"], [0.6, "#3a8bd8"], [0.8, "#222"], [1.0, "#f4f4f4"]];

DUEL_VIEWS.archery = {
  mount(root, s, ctx) {
    this.ctx = ctx; this.pop = null; this.seenArrows = s.g.arrows.length; this.shotKey = null;
    root.innerHTML = `<style>
      .ar-score{display:flex;justify-content:space-around;margin:6px 0;text-align:center}
      .ar-score b{font-size:26px;display:block}.ar-score span{font-size:12px;color:#8b95ad}
      .ar-score .on{color:#ffd23f}
      .ar-cv{display:block;margin:6px auto;width:100%;max-width:340px;border-radius:12px;background:#10321f}
      .ar-chips{display:flex;flex-wrap:wrap;gap:4px;justify-content:center;margin:6px 0;font-size:12px}
      .ar-chips i{font-style:normal;padding:2px 7px;border-radius:12px;background:#243029}
      .ar-chips i.c{border:1px solid #ffd23f}.ar-chips i.o{border:1px solid #39d0d8}
      #ar-shoot{font-size:22px;padding:16px}
    </style>
    <div class="ar-score" id="ar-sc"></div>
    <canvas class="ar-cv" id="ar-cv" width="340" height="340"></canvas>
    <p class="center-note" id="ar-msg"></p>
    <div class="ar-chips" id="ar-chips"></div>
    <button class="btn" id="ar-shoot">🏹 SHOOT</button>`;
    document.getElementById("ar-shoot").addEventListener("click", () => this.shoot());
    this.cv = document.getElementById("ar-cv");
    this.raf = () => {
      if (!root.isConnected) return;
      this.paint();
      requestAnimationFrame(this.raf);
    };
    requestAnimationFrame(this.raf);
  },
  destroy() {},
  async shoot() {
    const s = this.ctx.s;
    if (s.status !== "playing" || s.g.turn !== s.you_are) return;
    const before = s.g.arrows.length;
    const r = await this.ctx.post("move", {});
    if (r && r.g.arrows.length > before) {
      const a = r.g.arrows[r.g.arrows.length - 1];
      this.pop = { score: a.score, at: Date.now() };
      try { tg.HapticFeedback.impactOccurred(a.score >= 9 ? "heavy" : "light"); } catch (e) {}
    }
  },
  update(s) {
    const g = s.g;
    const myTurn = s.status === "playing" && g.turn === s.you_are;
    const side = s.you_are;
    document.getElementById("ar-sc").innerHTML = ["c", "o"].map((k) =>
      `<div class="${g.turn === k && s.status === "playing" ? "on" : ""}"><b>${g.totals[k]}</b><span>${esc(k === "c" ? s.creator_name : s.opponent_name)}${k === side ? " (you)" : ""}</span></div>`).join("");
    const n = g.arrows.length;
    const per = (k) => g.arrows.filter((a) => a.p === k);
    document.getElementById("ar-chips").innerHTML = ["c", "o"].map((k) =>
      per(k).map((a) => `<i class="${k}">${a.timeout ? "⏱0" : a.score}</i>`).join("")).join('<span style="width:10px"></span>');
    if (n > this.seenArrows && !this.pop) {   // opponent's arrow landed
      const a = g.arrows[n - 1];
      this.pop = { score: a.score, at: Date.now() };
    }
    this.seenArrows = n;
    const btn = document.getElementById("ar-shoot");
    btn.disabled = !myTurn;
    btn.textContent = myTurn ? "🏹 SHOOT" : s.status === "playing" ? "Opponent is aiming…" : "Finished";
    const total = g.arrows_each * 2;
    document.getElementById("ar-msg").innerHTML = s.status === "playing"
      ? `Arrow ${Math.min(n + 1, total)}${n >= total ? " (sudden death)" : " of " + total} · ${myTurn ? "<b>your shot</b> — tap when the crosshair is on the center" : "opponent's shot"}`
      : "Final score";
  },
  paint() {
    const s = this.ctx.s; if (!s || !s.g) return;
    const g = s.g, cv = this.cv, c = cv.getContext("2d"), S = 340, cx = S / 2, R = S / 2 - 14;
    c.clearRect(0, 0, S, S);
    for (let i = AR_COL.length - 1; i >= 0; i--) { c.beginPath(); c.fillStyle = AR_COL[i][1]; c.arc(cx, cx, R * AR_COL[i][0] * (i === 0 ? 1 : 1), 0, 6.3); c.fill(); }
    // ring borders & numbers
    c.strokeStyle = "rgba(0,0,0,.35)"; c.lineWidth = 1;
    for (let k = 1; k <= 10; k++) { c.beginPath(); c.arc(cx, cx, R * k / 10, 0, 6.3); c.stroke(); }
    // previous arrows
    g.arrows.forEach((a) => {
      if (a.x == null) return;
      c.beginPath(); c.fillStyle = a.p === "c" ? "#ffd23f" : "#39d0d8"; c.strokeStyle = "#000"; c.lineWidth = 1.5;
      c.arc(cx + a.x * R, cx + a.y * R, 5, 0, 6.3); c.fill(); c.stroke();
    });
    const cur = g.cur;
    if (cur && s.status === "playing") {
      const t = (duelNow() - new Date(cur.start_at).getTime()) / 1000;
      // wind
      c.save(); c.translate(36, 36); c.fillStyle = "rgba(0,0,0,.45)"; c.beginPath(); c.arc(0, 0, 26, 0, 6.3); c.fill();
      c.strokeStyle = "#fff"; c.fillStyle = "#fff"; c.lineWidth = 3;
      const wl = Math.hypot(cur.wx, cur.wy), ang = Math.atan2(cur.wy, cur.wx), len = 8 + wl * 70;
      c.rotate(ang); c.beginPath(); c.moveTo(-len / 2, 0); c.lineTo(len / 2 - 4, 0); c.stroke();
      c.beginPath(); c.moveTo(len / 2, 0); c.lineTo(len / 2 - 8, -5); c.lineTo(len / 2 - 8, 5); c.fill(); c.restore();
      c.fillStyle = "#fff"; c.font = "bold 9px sans-serif"; c.textAlign = "center"; c.fillText("WIND " + Math.round(wl * 100), 36, 58);
      if (t >= 0) {
        const px = cur.ax * Math.sin(2 * Math.PI * cur.fx * t + cur.px), py = cur.ay * Math.sin(2 * Math.PI * cur.fy * t + cur.py);
        const X = cx + px * R, Y = cy(cx, py, R);
        c.strokeStyle = "#ff2d2d"; c.lineWidth = 2;
        c.beginPath(); c.arc(X, Y, 14, 0, 6.3); c.stroke();
        c.beginPath(); c.moveTo(X - 22, Y); c.lineTo(X + 22, Y); c.moveTo(X, Y - 22); c.lineTo(X, Y + 22); c.stroke();
        // wind ghost: where the arrow would land (without shake)
        c.strokeStyle = "rgba(255,255,255,.55)"; c.setLineDash([3, 3]); c.beginPath();
        c.arc(X + cur.wx * R, Y + cur.wy * R, 5, 0, 6.3); c.stroke(); c.setLineDash([]);
      } else {
        c.fillStyle = "#fff"; c.font = "bold 22px sans-serif"; c.textAlign = "center"; c.fillText("Get ready… " + Math.ceil(-t), cx, 40);
      }
    }
    if (this.pop && Date.now() - this.pop.at < 1400) {
      const k = (Date.now() - this.pop.at) / 1400;
      c.globalAlpha = 1 - k; c.fillStyle = "#fff"; c.strokeStyle = "#000"; c.lineWidth = 4;
      c.font = `bold ${48 + 20 * (1 - k)}px sans-serif`; c.textAlign = "center";
      const txt = this.pop.score === 0 ? "MISS" : "+" + this.pop.score;
      c.strokeText(txt, cx, cx - 30 - 30 * k); c.fillText(txt, cx, cx - 30 - 30 * k); c.globalAlpha = 1;
    } else this.pop = null;
  },
};
function cy(cx, py, R) { return cx + py * R; }
