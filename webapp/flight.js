/* ---------------- Nova Flight (virtual points demo) ----------------
 * Server owns the clock and the crash point. This file only draws the flight and
 * sends "join" / "cash out". Points are virtual: they can never become money.
 */
const FL = { st: null, offset: 0, ended: false, crashT: 0, parts: [], shake: 0, lastRound: null, msg: "", busy: false, histOpen: false };

function flNow() { return Date.now() + FL.offset; }
function flMult(t, g) { return t <= 0 ? 1 : Math.floor(Math.exp(g * t) * 100) / 100; }
function flFmt(n) { return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function flColor(x) { x = Number(x); return x < 2 ? "#ff6b7a" : x < 10 ? "#35b9ff" : "#35d07f"; }

function flApply(s) {
  const prevId = FL.st && FL.st.round.id, prevBet = FL.st && FL.st.bet;
  FL.offset = s.server_ms - Date.now();
  if (prevId && prevId !== s.round.id) { FL.ended = false; FL.parts = []; FL.msg = ""; }
  FL.st = s;
  if (s.round.phase === "ended") {
    if (!FL.ended) {
      FL.ended = true;
      FL.crashT = Math.log(Number(s.round.crash)) / s.growth;
      FL.crashPoint = Number(s.round.crash);
      FL.boomAt = performance.now();
      flBoom();
      if (s.bet && s.bet.cashout_multiplier == null) { FL.msg = `Flight ended at ${s.round.crash}x — entry lost.`; try { tg.HapticFeedback.notificationOccurred("error"); } catch (e) {} }
    }
  } else FL.ended = false;
}

function flBoom() {
  CRSound.crash();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  FL.shake = 14;
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2, v = 1 + Math.random() * 5;
    FL.parts.push({ x: null, y: null, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1, life: 1, c: ["#ff3d4f", "#ffb020", "#fff"][i % 3] });
  }
}

function flPlane(ctx, x, y, ang, s) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.scale(s, s);
  // flame
  const fl = 6 + Math.random() * 6;
  ctx.fillStyle = "#ffb020"; ctx.beginPath(); ctx.moveTo(-26, 0); ctx.lineTo(-26 - fl, -3); ctx.lineTo(-26 - fl * .6, 0); ctx.lineTo(-26 - fl, 3); ctx.closePath(); ctx.fill();
  // far wing
  ctx.fillStyle = "#b8202f"; ctx.beginPath(); ctx.moveTo(-4, -4); ctx.lineTo(-16, -20); ctx.lineTo(-8, -20); ctx.lineTo(8, -4); ctx.closePath(); ctx.fill();
  // fuselage
  ctx.fillStyle = "#ff3d4f"; ctx.beginPath(); ctx.moveTo(30, 0); ctx.quadraticCurveTo(22, -8, 4, -8); ctx.lineTo(-24, -5); ctx.lineTo(-26, 0); ctx.lineTo(-24, 5); ctx.lineTo(4, 8); ctx.quadraticCurveTo(22, 8, 30, 0); ctx.fill();
  // stripe
  ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.fillRect(-18, -1.5, 36, 3);
  // tail fin
  ctx.fillStyle = "#d62a3b"; ctx.beginPath(); ctx.moveTo(-20, -4); ctx.lineTo(-30, -16); ctx.lineTo(-24, -16); ctx.lineTo(-14, -4); ctx.closePath(); ctx.fill();
  // cockpit
  ctx.fillStyle = "#35b9ff"; ctx.beginPath(); ctx.ellipse(12, -3, 7, 3.5, -0.1, 0, Math.PI * 2); ctx.fill();
  // near wing
  ctx.fillStyle = "#ff6b7a"; ctx.beginPath(); ctx.moveTo(-2, 3); ctx.lineTo(-16, 21); ctx.lineTo(-7, 21); ctx.lineTo(10, 3); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function flDraw(cv) {
  const ctx = cv.getContext("2d"), dpr = cv.width / cv.clientWidth, W = cv.clientWidth, H = cv.clientHeight;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const st = FL.st; if (!st) return;
  const g = st.growth, now = flNow(), startMs = st.round.start_ms;
  const flying = !FL.ended && now >= startMs;
  const t = FL.ended ? FL.crashT : Math.max(0, (now - startMs) / 1000);
  let shx = 0, shy = 0;
  if (FL.shake > 0) { shx = (Math.random() - .5) * FL.shake; shy = (Math.random() - .5) * FL.shake; FL.shake *= .88; if (FL.shake < .5) FL.shake = 0; }
  ctx.save(); ctx.translate(shx, shy);
  // background
  const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, "#0B0D12"); bg.addColorStop(1, "#171B24");
  ctx.fillStyle = bg; ctx.fillRect(-10, -10, W + 20, H + 20);
  // moving grid
  const drift = (flying || FL.ended ? t : 0) * 22;
  ctx.strokeStyle = "rgba(255,255,255,.05)"; ctx.lineWidth = 1;
  for (let x = -((drift) % 40); x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = H - 26 + ((drift * .4) % 40); y > 0; y -= 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  const padL = 26, baseY = H - 26, topY = 52, rightX = W - 54;
  const pos = (tt) => { const u = 1 - Math.exp(-0.16 * tt); return [padL + u * (rightX - padL), baseY - Math.pow(u, 1.7) * (baseY - topY)]; };
  let px = padL, py = baseY, ang = 0;
  if (flying || FL.ended) {
    const n = 70, pts = [];
    for (let i = 0; i <= n; i++) pts.push(pos(t * i / n));
    [px, py] = pts[n]; const [qx, qy] = pts[n - 1]; ang = Math.atan2(py - qy, px - qx);
    ctx.beginPath(); ctx.moveTo(pts[0][0], baseY); pts.forEach((p) => ctx.lineTo(p[0], p[1])); ctx.lineTo(px, baseY); ctx.closePath();
    const fg = ctx.createLinearGradient(0, topY, 0, baseY); fg.addColorStop(0, "rgba(255,61,79,.38)"); fg.addColorStop(1, "rgba(255,61,79,0)");
    ctx.fillStyle = fg; ctx.fill();
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.strokeStyle = "#ff3d4f"; ctx.lineWidth = 3.5; ctx.lineJoin = "round"; ctx.stroke();
  }
  // axes
  ctx.strokeStyle = "rgba(255,255,255,.18)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(padL, 12); ctx.lineTo(padL, baseY); ctx.lineTo(W - 12, baseY); ctx.stroke();
  // plane / explosion
  if (!FL.ended) flPlane(ctx, px, py - (flying ? 0 : 0), ang, 0.9 + (flying ? 0 : 0));
  else {
    for (const p of FL.parts) {
      if (p.x == null) { p.x = px; p.y = py; }
      p.x += p.vx; p.y += p.vy; p.vy += .12; p.life -= .018;
      if (p.life > 0) { ctx.globalAlpha = p.life; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, 3 * p.life + 1, 0, 7); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  // centre text
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  if (!flying && !FL.ended) {
    const left = Math.max(0, Math.ceil((startMs - now) / 1000));
    ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.font = "700 14px -apple-system,Segoe UI,Roboto,sans-serif"; ctx.fillText(`ROUND #${st.round.id} · TAKE-OFF IN`, W / 2, H / 2 - 40);
    ctx.fillStyle = "#fff"; ctx.font = "900 72px -apple-system,Segoe UI,Roboto,sans-serif"; ctx.fillText(String(left), W / 2, H / 2 + 8);
  } else if (FL.ended) {
    ctx.fillStyle = "#ff3d4f"; ctx.font = "900 58px -apple-system,Segoe UI,Roboto,sans-serif"; ctx.fillText(flFmt(FL.crashPoint) + "x", W / 2, H / 2 - 6);
    ctx.fillStyle = "rgba(255,255,255,.75)"; ctx.font = "800 15px -apple-system,Segoe UI,Roboto,sans-serif"; ctx.fillText("FLEW AWAY", W / 2, H / 2 + 34);
  } else {
    const m = flMult(t, g);
    ctx.fillStyle = "#fff"; ctx.font = "900 64px -apple-system,Segoe UI,Roboto,sans-serif"; ctx.fillText(flFmt(m) + "x", W / 2, H / 2 - 6);
  }
  FL.curMult = flying ? flMult(t, g) : (FL.ended ? FL.crashPoint : 1);
}

function flPanel() {
  const el = document.getElementById("fl-ctl"); if (!el) return;
  const st = FL.st, ph = FL.ended ? "ended" : (flNow() >= st.round.start_ms ? "flying" : "countdown");
  const bet = st.bet, bal = Number(st.balance);
  const key = [ph, bet && bet.amount, bet && bet.cashout_multiplier, FL.busy, FL.msg, bal >= 10].join("|");
  if (el.dataset.key === key) {
    if (ph === "flying" && bet && bet.cashout_multiplier == null) {
      const b = document.getElementById("fl-cash"); if (b) b.innerHTML = `COLLECT<br><small>${flFmt(Number(bet.amount) * (FL.curMult || 1))} pts</small>`;
    }
    return;
  }
  el.dataset.key = key;
  let h = "";
  if (ph === "countdown" && !bet) {
    h = `<div class="field" style="margin-bottom:6px"><label>Virtual entry (points)</label><input id="fl-amt" type="number" inputmode="decimal" value="${window._flAmt || 50}" /></div>
      <div class="stake-grid" style="margin-bottom:8px">${[10, 50, 100, 500].map((x) => `<button class="stake-btn" data-q="${x}">${x}</button>`).join("")}</div>
      <button class="btn" id="fl-play" style="background:#ff3d4f;font-weight:900;font-size:18px" ${FL.busy ? "disabled" : ""}>DEMO PLAY</button>`;
  } else if (bet && bet.cashout_multiplier != null) {
    h = `<div class="card" style="text-align:center;margin:0;background:rgba(53,208,127,.1);border:1px solid #35d07f"><b style="color:#35d07f">Collected at ${flFmt(bet.cashout_multiplier)}x</b><br>Score returned: <b>${flFmt(bet.payout)} pts</b> · net +${flFmt(Number(bet.payout) - Number(bet.amount))}</div>`;
  } else if (bet && ph === "countdown") {
    h = `<div class="card" style="text-align:center;margin:0">Entry <b>${flFmt(bet.amount)} pts</b> locked in. Take-off soon…</div>`;
  } else if (bet && ph === "flying") {
    h = `<button class="btn" id="fl-cash" style="background:#35d07f;color:#04210f;font-weight:900;font-size:20px;line-height:1.2" ${FL.busy ? "disabled" : ""}>COLLECT<br><small>${flFmt(Number(bet.amount) * (FL.curMult || 1))} pts</small></button>`;
  } else if (bet && ph === "ended") {
    h = `<div class="card" style="text-align:center;margin:0;background:rgba(255,61,79,.1);border:1px solid #ff3d4f"><b style="color:#ff6b7a">Entry lost</b> — the flight ended before you collected.</div>`;
  } else {
    h = `<div class="card" style="text-align:center;margin:0">${ph === "flying" ? "Flight in progress — you can join the next round." : "Next round starts shortly…"}</div>`;
  }
  if (bal < 10 && !(bet && ph !== "ended")) h += `<button class="btn secondary" id="fl-refill" style="margin-top:8px">↻ Get 1,000 free demo points</button>`;
  if (FL.msg) h += `<div class="error-text" style="margin-top:6px">${FL.msg}</div>`;
  el.innerHTML = h;
  el.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => { document.getElementById("fl-amt").value = b.dataset.q; }));
  const play = document.getElementById("fl-play"), cash = document.getElementById("fl-cash"), rf = document.getElementById("fl-refill");
  if (play) play.addEventListener("click", flBet);
  if (cash) cash.addEventListener("click", flCash);
  if (rf) rf.addEventListener("click", () => flCall("/webapp/flight/refill"));
}

async function flCall(path, body) {
  if (FL.busy) return; FL.busy = true; FL.msg = "";
  try {
    const s = body ? await apiPostJson(path, body) : await apiPostJson(path, {});
    flApply(s);
  } catch (e) { FL.msg = e.message; }
  FL.busy = false; flPanel(); flTop();
}
function flBet() {
  CRSound.unlock();
  const v = document.getElementById("fl-amt").value.trim(); window._flAmt = v;
  flCall("/webapp/flight/bet", { amount: v }).then(() => { if (FL.st.bet) CRSound.start(); });
}
function flCash() {
  CRSound.unlock();
  flCall("/webapp/flight/cashout").then(() => {
    if (FL.st.bet && FL.st.bet.cashout_multiplier != null) { CRSound.cash(); try { tg.HapticFeedback.notificationOccurred("success"); } catch (e) {} }
  });
}

function flTop() {
  const b = document.getElementById("fl-bal"); if (b && FL.st) b.textContent = flFmt(FL.st.balance);
  const h = document.getElementById("fl-hist"); if (!h || !FL.st) return;
  const list = FL.st.history.slice(0, FL.histOpen ? 30 : 10);
  h.innerHTML = list.map((x) => `<span style="background:${flColor(x.crash)}22;color:${flColor(x.crash)};border:1px solid ${flColor(x.crash)}55;border-radius:20px;padding:3px 9px;font-weight:800;font-size:12px;white-space:nowrap">${flFmt(x.crash)}x</span>`).join("") || `<span class="center-note">No rounds yet</span>`;
}

async function renderFlight() {
  stopPolling();
  FL.st = null; FL.ended = false; FL.parts = []; FL.msg = ""; FL.busy = false;
  screenEl.innerHTML = `
    <div class="card" style="padding:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin:2px 4px 8px;gap:8px">
        <div><div style="font-weight:900;letter-spacing:.5px;font-size:17px">NOVA <span style="color:#ff3d4f">FLIGHT</span></div>
          <div style="font-size:11px;color:#9aa3b5">Nova Bet · demo mode</div></div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="friend-username" style="white-space:nowrap">✈ <b id="fl-bal">…</b> pts</span>
          <button id="fl-mute" class="friend-username" style="border:0;cursor:pointer;color:#fff;background:rgba(255,255,255,.12)">${CRSound.muted ? "🔇" : "🔊"}</button>
          <button id="fl-info" class="friend-username" style="border:0;cursor:pointer;color:#fff;background:rgba(255,255,255,.12)">ⓘ</button>
        </div></div>
      <div id="fl-hist" style="display:flex;gap:6px;overflow-x:auto;padding:2px 2px 8px"></div>
      <canvas id="fl-canvas" style="width:100%;height:290px;display:block;border-radius:14px"></canvas>
      <div style="display:flex;justify-content:space-between;margin:6px 4px 0;font-size:11px;color:#9aa3b5">
        <span>⚠ Virtual points only — no money, no cash-out.</span><a href="#" id="fl-more" style="color:#35b9ff;text-decoration:none">History</a></div>
      <div id="fl-ctl" style="margin-top:10px"></div>
    </div>
    <div class="card"><button class="btn secondary" id="g-back">⬅️ Back</button></div>`;
  bindBack();
  document.getElementById("fl-mute").addEventListener("click", (e) => { e.currentTarget.textContent = CRSound.toggle() ? "🔇" : "🔊"; });
  document.getElementById("fl-more").addEventListener("click", (e) => { e.preventDefault(); FL.histOpen = !FL.histOpen; flTop(); });
  document.getElementById("fl-info").addEventListener("click", () => tg.showAlert(
    "Nova Flight is a DEMO game played with virtual points only.\n\nJoin during the countdown. The plane takes off and the multiplier rises. Press COLLECT before the flight ends: score = entry × multiplier. If the flight ends first, the entry is lost.\n\nThe server decides when every flight ends, before take-off. Odds: chance a flight reaches x is about " + ((FL.st ? 100 - FL.st.edge_percent : 92)) + "% ÷ x. Points can never be converted to money or withdrawn."));
  const cv = document.getElementById("fl-canvas");
  const fit = () => { const d = Math.min(2, window.devicePixelRatio || 1); cv.width = cv.clientWidth * d; cv.height = cv.clientHeight * d; };
  fit(); window.addEventListener("resize", fit);

  let alive = true;
  const stillHere = () => alive && document.getElementById("fl-canvas") === cv;
  const poll = async () => {
    if (!stillHere()) { window.removeEventListener("resize", fit); return; }
    try { flApply(await apiGet("/webapp/flight/state")); flTop(); flPanel(); } catch (e) { FL.msg = e.message; }
    const fast = FL.st && !FL.ended && flNow() >= FL.st.round.start_ms;
    setTimeout(poll, fast ? 450 : 900);
  };
  const loop = () => { if (!stillHere()) { alive = false; return; } flDraw(cv); if (FL.st) flPanel(); requestAnimationFrame(loop); };
  await poll(); loop();
}
