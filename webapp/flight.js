/* ---------------- Nova Flight (real ETB, provably fair) ----------------
 * The server owns the clock and the crash point. This file draws the flight (flight3d.js)
 * and sends "bet" / "cash out". The crash point is never sent before the flight ends.
 */
const FL = { st: null, offset: 0, ended: false, crashT: 0, crashPoint: 1, msg: "", busy: false, boom: false, fairOpen: false, lastBal: null, lastSettled: "", curMult: 1 };

function flNow() { return Date.now() + FL.offset; }
function flFmt(n) { return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function flColor(x) { x = Number(x); return x < 2 ? "#ff6b7a" : x < 10 ? "#35b9ff" : "#35d07f"; }
function flShort(h) { return h ? h.slice(0, 8) + "…" + h.slice(-4) : "—"; }

function flApply(s) {
  const prevId = FL.st && FL.st.round.id;
  FL.offset = s.server_ms - Date.now();
  if (prevId && prevId !== s.round.id) { FL.ended = false; FL.boom = false; FL.msg = ""; }
  FL.st = s;
  if (s.round.phase === "ended") {
    if (!FL.ended) {
      FL.ended = true; FL.boom = true;
      FL.crashPoint = Number(s.round.crash); FL.crashT = Math.log(FL.crashPoint) / s.growth;
      CRSound.crash();
      if (s.bet && s.bet.cashout_multiplier == null) { FL.msg = `Crashed at ${s.round.crash}x — your bet is lost.`; try { tg.HapticFeedback.notificationOccurred("error"); } catch (e) {} }
    }
  } else FL.ended = false;
  // auto cash-out settled by the server -> sound + haptics once
  const key = s.bet ? `${s.round.id}:${s.bet.cashout_multiplier}` : "";
  if (key !== FL.lastSettled) {
    if (s.bet && s.bet.cashout_multiplier != null && FL.lastSettled.split(":")[0] === String(s.round.id)) { CRSound.cash(); try { tg.HapticFeedback.notificationOccurred("success"); } catch (e) {} }
    FL.lastSettled = key;
  }
  if (FL.lastBal !== s.balance) { FL.lastBal = s.balance; if (typeof refreshTopbar === "function") { try { refreshTopbar(); } catch (e) {} } }
}

function flPhase() { return FL.ended ? "ended" : (flNow() >= FL.st.round.start_ms ? "flying" : "countdown"); }

function flDraw(cv) {
  const st = FL.st; if (!st) return;
  const ph = flPhase(), g = st.growth, t = ph === "countdown" ? -1 : Math.max(0, (flNow() - st.round.start_ms) / 1000);
  const mult = ph === "flying" ? Math.floor(Math.exp(g * t) * 100) / 100 : 1;
  FL.curMult = mult;
  F3.draw(cv, { phase: ph, t, left: Math.max(0, Math.ceil((st.round.start_ms - flNow()) / 1000)), mult, crash: FL.crashPoint, crashT: FL.crashT, boom: FL.boom, roundId: st.round.id });
  FL.boom = false;
}

function flPanel() {
  const el = document.getElementById("fl-ctl"); if (!el || !FL.st) return;
  const st = FL.st, ph = flPhase(), bet = st.bet;
  const key = [ph, bet && bet.amount, bet && bet.cashout_multiplier, FL.busy, FL.msg].join("|");
  if (el.dataset.key === key) {
    if (ph === "flying" && bet && bet.cashout_multiplier == null) {
      const b = document.getElementById("fl-cash"); if (b) b.innerHTML = `COLLECT<br><small>${flFmt(Number(bet.amount) * (FL.curMult || 1))} ETB</small>`;
    }
    return;
  }
  el.dataset.key = key;
  let h = "";
  if (ph === "countdown" && !bet) {
    h = `<div style="display:flex;gap:8px"><div class="field" style="flex:1;margin-bottom:6px"><label>Bet (ETB ${st.min_bet}–${st.max_bet})</label><input id="fl-amt" type="number" inputmode="decimal" value="${window._flAmt || 10}" /></div>
      <div class="field" style="flex:1;margin-bottom:6px"><label>Auto collect at (optional)</label><input id="fl-auto" type="number" inputmode="decimal" step="0.01" placeholder="e.g. 2.00" value="${window._flAuto || ""}" /></div></div>
      <div class="stake-grid" style="margin-bottom:8px">${[10, 50, 100, 500].map((x) => `<button class="stake-btn" data-q="${x}">${x}</button>`).join("")}</div>
      <button class="btn" id="fl-play" style="background:#ff3d4f;font-weight:900;font-size:18px" ${FL.busy ? "disabled" : ""}>PLACE BET</button>`;
  } else if (bet && bet.cashout_multiplier != null) {
    const net = Number(bet.payout) - Number(bet.amount);
    h = `<div class="card" style="text-align:center;margin:0;background:rgba(53,208,127,.1);border:1px solid #35d07f"><b style="color:#35d07f">Collected at ${flFmt(bet.cashout_multiplier)}x</b><br>Paid <b>${flFmt(bet.payout)} ETB</b> · net ${net >= 0 ? "+" : "−"}${flFmt(Math.abs(net))} ETB</div>`;
  } else if (bet && ph === "countdown") {
    h = `<div class="card" style="text-align:center;margin:0">Bet <b>${flFmt(bet.amount)} ETB</b> locked in${bet.auto_cashout ? ` · auto collect at <b>${flFmt(bet.auto_cashout)}x</b>` : ""}. Take-off soon…</div>`;
  } else if (bet && ph === "flying") {
    h = `<button class="btn" id="fl-cash" style="background:#35d07f;color:#04210f;font-weight:900;font-size:20px;line-height:1.2" ${FL.busy ? "disabled" : ""}>COLLECT<br><small>${flFmt(Number(bet.amount) * (FL.curMult || 1))} ETB</small></button>${bet.auto_cashout ? `<div class="center-note" style="text-align:center;margin-top:4px">Auto collect at ${flFmt(bet.auto_cashout)}x</div>` : ""}`;
  } else if (bet && ph === "ended") {
    h = `<div class="card" style="text-align:center;margin:0;background:rgba(255,61,79,.1);border:1px solid #ff3d4f"><b style="color:#ff6b7a">Bet lost</b> — the flight crashed before you collected.</div>`;
  } else {
    h = `<div class="card" style="text-align:center;margin:0">${ph === "flying" ? "Flight in progress — bet on the next round." : "Next round starts shortly…"}</div>`;
  }
  if (FL.msg) h += `<div class="error-text" style="margin-top:6px">${FL.msg}</div>`;
  el.innerHTML = h;
  el.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => { document.getElementById("fl-amt").value = b.dataset.q; }));
  const play = document.getElementById("fl-play"), cash = document.getElementById("fl-cash");
  if (play) play.addEventListener("click", flBet);
  if (cash) cash.addEventListener("click", flCash);
}

async function flCall(path, body) {
  if (FL.busy) return; FL.busy = true; FL.msg = "";
  try { flApply(await apiPostJson(path, body || {})); } catch (e) { FL.msg = e.message; }
  FL.busy = false; flPanel(); flTop();
}
function flBet() {
  CRSound.unlock();
  const a = document.getElementById("fl-amt").value.trim(), au = document.getElementById("fl-auto").value.trim();
  window._flAmt = a; window._flAuto = au;
  flCall("/webapp/flight/bet", { amount: a, auto_cashout: au || null }).then(() => { if (FL.st && FL.st.bet) CRSound.start(); });
}
function flCash() {
  CRSound.unlock();
  flCall("/webapp/flight/cashout").then(() => { if (FL.st && FL.st.bet && FL.st.bet.cashout_multiplier != null) { CRSound.cash(); try { tg.HapticFeedback.notificationOccurred("success"); } catch (e) {} } });
}

function flTop() {
  const b = document.getElementById("fl-bal"); if (b && FL.st) b.textContent = flFmt(FL.st.balance);
  const h = document.getElementById("fl-hist"); if (h && FL.st) {
    h.innerHTML = FL.st.history.slice(0, 14).map((x) => `<span style="background:${flColor(x.crash)}22;color:${flColor(x.crash)};border:1px solid ${flColor(x.crash)}55;border-radius:20px;padding:3px 9px;font-weight:800;font-size:12px;white-space:nowrap">${flFmt(x.crash)}x</span>`).join("") || `<span class="center-note">No rounds yet</span>`;
  }
  const c = document.getElementById("fl-commit"); if (c && FL.st) c.textContent = `Round #${FL.st.round.id} commit ${flShort(FL.st.round.seed_hash)}`;
  const fr = document.getElementById("fl-fair");
  if (fr && FL.st && FL.fairOpen) { const k = String(FL.st.history[0] && FL.st.history[0].id); if (fr.dataset.k !== k) { fr.dataset.k = k; flFairRender(fr); } }
}

/* ---- provably fair: recompute a finished round in the browser ---- */
const flHex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));
const flToHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function flVerify(seed, crash, hash) {
  const sh = flToHex(await crypto.subtle.digest("SHA-256", flHex(seed)));
  const key = await crypto.subtle.importKey("raw", flHex(seed), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = flToHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("nova-flight")));
  const e = BigInt("0x" + mac.slice(0, 13)), E = 2n ** 52n;
  let cents = (96n * E) / (E - e); if (cents < 100n) cents = 100n; if (cents > 10000n) cents = 10000n;
  const calc = Number(cents) / 100;
  return { hashOk: !hash || sh === hash, crashOk: Math.abs(calc - Number(crash)) < 0.005, calc };
}
function flFairRender(el) {
  const rows = FL.st.history.filter((x) => x.seed).slice(0, 6);
  el.innerHTML = `<div class="center-note" style="text-align:left;line-height:1.5">
    Before take-off the server publishes a <b>commit</b> = SHA-256 of a secret seed. After the crash it reveals the seed. Crash = floor(96·2<sup>52</sup> ÷ (2<sup>52</sup> − e)) ÷ 100, where <i>e</i> = first 52 bits of HMAC-SHA256(seed, "nova-flight"). Chance a flight reaches <i>x</i> = 96% ÷ <i>x</i> (house edge ${FL.st.edge_percent}%).</div>
    ${rows.map((x, i) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-top:1px solid rgba(255,255,255,.08);font-size:12px">
      <span><b style="color:${flColor(x.crash)}">#${x.id} · ${flFmt(x.crash)}x</b><br><span style="color:#9aa3b5">seed ${flShort(x.seed)}</span></span>
      <button class="btn secondary" data-v="${i}" style="width:auto;margin:0;padding:6px 12px;font-size:12px">Verify</button></div>`).join("") || `<div class="center-note">Finished rounds appear here.</div>`}`;
  el.querySelectorAll("[data-v]").forEach((b) => b.addEventListener("click", async () => {
    const x = rows[Number(b.dataset.v)];
    try { const r = await flVerify(x.seed, x.crash, x.seed_hash); b.textContent = r.hashOk && r.crashOk ? "✓ Fair" : "✗ Mismatch"; b.style.color = r.hashOk && r.crashOk ? "#35d07f" : "#ff6b7a"; }
    catch (e) { b.textContent = "Can't verify here"; }
  }));
}

async function renderFlight() {
  stopPolling();
  FL.st = null; FL.ended = false; FL.msg = ""; FL.busy = false; FL.boom = false; FL.lastSettled = ""; FL.lastBal = null;
  screenEl.innerHTML = `
    <div class="card" style="padding:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin:2px 4px 8px;gap:8px">
        <div><div style="font-weight:900;letter-spacing:.5px;font-size:17px">NOVA <span style="color:#ff3d4f">FLIGHT</span></div>
          <div style="font-size:11px;color:#9aa3b5" id="fl-commit">Provably fair</div></div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="friend-username" style="white-space:nowrap"><b id="fl-bal">…</b> ETB</span>
          <button id="fl-mute" class="friend-username" style="border:0;cursor:pointer;color:#fff;background:rgba(255,255,255,.12)">${CRSound.muted ? "🔇" : "🔊"}</button>
          <button id="fl-info" class="friend-username" style="border:0;cursor:pointer;color:#fff;background:rgba(255,255,255,.12)">ⓘ</button>
        </div></div>
      <div id="fl-hist" style="display:flex;gap:6px;overflow-x:auto;padding:2px 2px 8px"></div>
      <canvas id="fl-canvas" style="width:100%;height:300px;display:block;border-radius:14px;background:#0B0D12"></canvas>
      <div style="display:flex;justify-content:space-between;margin:6px 4px 0;font-size:11px;color:#9aa3b5">
        <span>Real ETB · house edge 4%</span><a href="#" id="fl-more" style="color:#35b9ff;text-decoration:none">Fairness &amp; history</a></div>
      <div id="fl-fair" style="display:none;margin-top:8px"></div>
      <div id="fl-ctl" style="margin-top:10px"></div>
    </div>
    <div class="card"><button class="btn secondary" id="g-back">⬅️ Back</button></div>`;
  bindBack();
  document.getElementById("fl-mute").addEventListener("click", (e) => { e.currentTarget.textContent = CRSound.toggle() ? "🔇" : "🔊"; });
  document.getElementById("fl-more").addEventListener("click", (e) => {
    e.preventDefault(); FL.fairOpen = !FL.fairOpen;
    const fr = document.getElementById("fl-fair"); fr.style.display = FL.fairOpen ? "block" : "none"; if (FL.fairOpen) { fr.dataset.k = String(FL.st && FL.st.history[0] && FL.st.history[0].id); flFairRender(fr); }
  });
  document.getElementById("fl-info").addEventListener("click", () => tg.showAlert(
    "Nova Flight: place a bet during the countdown. The plane takes off and the multiplier rises. Press COLLECT before it crashes: you get bet × multiplier. If it crashes first, the bet is lost.\n\nYou can set an auto-collect multiplier; the server enforces it.\n\nBet " + (FL.st ? FL.st.min_bet + "–" + FL.st.max_bet : "1–500") + " ETB. Max payout " + (FL.st ? FL.st.max_payout : 2000) + " ETB per bet.\n\nFair: the chance a flight reaches x is 96% ÷ x for every player (house edge 4%). Each result is fixed before take-off and can be verified under 'Fairness & history'."));
  const cv = document.getElementById("fl-canvas");
  const fit = () => { const d = Math.min(2, window.devicePixelRatio || 1); cv.width = Math.round(cv.clientWidth * d); cv.height = Math.round(cv.clientHeight * d); };
  fit(); window.addEventListener("resize", fit);
  let alive = true;
  const here = () => alive && document.getElementById("fl-canvas") === cv;
  const poll = async () => {
    if (!here()) { window.removeEventListener("resize", fit); return; }
    try { flApply(await apiGet("/webapp/flight/state")); flTop(); flPanel(); } catch (e) {
      FL.msg = e.message;
      const c = document.getElementById("fl-ctl");
      if (c && !FL.st) c.innerHTML = `<div class="error-text">${e.message}</div>`;
    }
    const fast = FL.st && !FL.ended && flNow() >= FL.st.round.start_ms;
    setTimeout(poll, fast ? 450 : 900);
  };
  const loop = () => { if (!here()) { alive = false; return; } if (FL.st) { flDraw(cv); flPanel(); } requestAnimationFrame(loop); };
  await poll(); loop();
}
