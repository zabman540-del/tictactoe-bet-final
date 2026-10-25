/* duels2.js — Car Race and Pool screens (the server runs the real rules and physics). */

/* ------------------------------------------------------------- CAR RACE */
DUEL_VIEWS.race = {
  mount(root, s, ctx) {
    this.ctx = ctx; this.log = []; this.lane = 1; this.vis = 1; this.crashes = 0; this.judged = 0;
    this.submitted = false; this.flash = 0; this.lastT = -1000; this.sent = 0; this.trackKey = null;
    root.innerHTML = `<style>
      .rc-cv{display:block;margin:6px auto;width:100%;max-width:340px;border-radius:12px;background:#0b1410;touch-action:none}
      .rc-btns{display:flex;gap:10px;margin:8px 0}.rc-btns button{flex:1;font-size:30px;padding:14px}
    </style>
    <div id="rc-top" class="center-note"></div>
    <canvas class="rc-cv" id="rc-cv" width="340" height="420"></canvas>
    <div id="rc-ctl"></div>`;
    this.cv = document.getElementById("rc-cv");
    const area = this.cv;
    area.addEventListener("pointerdown", (e) => {
      const r = area.getBoundingClientRect();
      this.steer((e.clientX - r.left) < r.width / 2 ? -1 : 1);
    });
    this.key = (e) => { if (e.key === "ArrowLeft") this.steer(-1); if (e.key === "ArrowRight") this.steer(1); };
    window.addEventListener("keydown", this.key);
    this.raf = () => {
      if (!root.isConnected) { window.removeEventListener("keydown", this.key); return; }
      this.paint();
      requestAnimationFrame(this.raf);
    };
    requestAnimationFrame(this.raf);
  },
  destroy() { window.removeEventListener("keydown", this.key); },
  t() { return duelNow() - new Date(this.ctx.s.g.start_at).getTime(); },
  steer(dir) {
    const s = this.ctx.s; if (!s || s.status !== "playing" || s.g.phase !== "racing" || this.submitted) return;
    const t = this.t(); if (t < 0 || t > s.g.base * 1000) return;
    if (t - this.lastT < 110) return;
    const nl = Math.max(0, Math.min(2, this.lane + dir));
    if (nl === this.lane) return;
    this.lane = nl; this.lastT = t; this.log.push([Math.round(t), nl]);
    try { tg.HapticFeedback.impactOccurred("light"); } catch (e) {}
  },
  update(s) {
    const g = s.g, side = s.you_are;
    const ctl = document.getElementById("rc-ctl"), top = document.getElementById("rc-top");
    if (g.phase === "ready" && s.status === "playing") {
      const me = g.ready[side];
      top.innerHTML = me ? "✅ You're ready. Waiting for your opponent…" : "Both players must press READY. Same track for both — fastest time wins.";
      if (!ctl.dataset.m || ctl.dataset.m !== "ready" + me) {
        ctl.dataset.m = "ready" + me;
        ctl.innerHTML = me ? `` : `<button class="btn" id="rc-ready">🏁 READY</button>`;
        const b = document.getElementById("rc-ready");
        if (b) b.addEventListener("click", () => this.ctx.post("move", { ready: true }));
      }
      return;
    }
    if (g.phase === "racing") {
      if (this.trackKey !== g.start_at) { this.trackKey = g.start_at; this.log = []; this.lane = 1; this.vis = 1; this.crashes = 0; this.judged = 0; this.submitted = !!g.my_result; }
      if (!ctl.dataset.m || ctl.dataset.m !== "drive") {
        ctl.dataset.m = "drive";
        ctl.innerHTML = `<div class="rc-btns"><button class="btn secondary" id="rc-l">◀</button><button class="btn secondary" id="rc-r">▶</button></div>
          <p class="center-note">Tap the left / right side of the road (or the buttons) to change lane.</p>`;
        document.getElementById("rc-l").addEventListener("pointerdown", (e) => { e.preventDefault(); this.steer(-1); });
        document.getElementById("rc-r").addEventListener("pointerdown", (e) => { e.preventDefault(); this.steer(1); });
      }
      if (g.my_result) this.submitted = true;
      const done = s.status !== "playing";
      if (done && g.results) {
        const me = g.results[s.you_are], op = g.results[s.you_are === "c" ? "o" : "c"];
        top.innerHTML = `<b>You: ${me ? me.time.toFixed(2) + "s (" + me.crashes + " crashes)" : "—"}</b><br>Opponent: ${op ? op.time.toFixed(2) + "s (" + op.crashes + " crashes)" : "did not finish"}`;
      } else if (g.my_result) top.innerHTML = `🏁 Your time: <b>${g.my_result.time.toFixed(2)}s</b> (${g.my_result.crashes} crashes)<br>${g.opp_done ? "Opponent finished — result…" : "Waiting for your opponent to finish…"}`;
    }
  },
  paint() {
    const s = this.ctx.s; if (!s || !s.g) return;
    const g = s.g, c = this.cv.getContext("2d"), W = 340, H = 420;
    c.clearRect(0, 0, W, H);
    if (g.phase !== "racing") {
      c.fillStyle = "#0e1c15"; c.fillRect(0, 0, W, H); c.font = "64px sans-serif"; c.textAlign = "center"; c.fillText("🏎️", W / 2, H / 2 + 20);
      return;
    }
    const t = this.t(), ms = Math.max(0, Math.min(t, g.base * 1000)), pos = g.speed * ms / 1000;
    // crash judging — identical rule to the server
    const tr = g.track;
    while (this.judged < tr.length) {
      const [d, ln] = tr[this.judged];
      const t1 = (d + 14) / g.speed * 1000;
      if (t < t1) break;
      const t0 = (d - 14) / g.speed * 1000, tm = d / g.speed * 1000;
      const laneAt = (x) => { let l = 1; for (const e of this.log) { if (e[0] <= x) l = e[1]; else break; } return l; };
      const lanes = new Set([laneAt(t0), laneAt(tm), laneAt(t1)]);
      this.log.forEach((e) => { if (e[0] > t0 && e[0] < t1) lanes.add(e[1]); });
      if (lanes.has(ln)) { this.crashes++; this.flash = Date.now(); try { tg.HapticFeedback.notificationOccurred("error"); } catch (e) {} }
      this.judged++;
    }
    this.vis += (this.lane - this.vis) * 0.28;
    const HZ = 70, CARY = 350;
    const proj = (z) => { const k = 1 / (1 + z / 320); return { y: HZ + (CARY - HZ) * k, k }; };
    // sky + road
    c.fillStyle = "#123524"; c.fillRect(0, 0, W, H);
    c.fillStyle = "#1c2a24"; c.fillRect(0, 0, W, HZ);
    const road = (z) => { const p = proj(z); return { y: p.y, l: W / 2 - 135 * p.k, r: W / 2 + 135 * p.k, k: p.k }; };
    const near = road(0), far = road(900);
    c.fillStyle = "#2b2f36"; c.beginPath(); c.moveTo(far.l, far.y); c.lineTo(far.r, far.y); c.lineTo(W / 2 + 135 * 1.4, H); c.lineTo(W / 2 - 135 * 1.4, H); c.fill();
    // lane lines moving
    c.strokeStyle = "#fff"; c.lineWidth = 2;
    for (let k = -1; k <= 1; k += 2) {
      for (let z0 = -((pos) % 80); z0 < 900; z0 += 80) {
        const a = proj(Math.max(0, z0)), b = proj(Math.max(0, z0 + 40));
        c.lineWidth = 2 * a.k + 1;
        c.beginPath(); c.moveTo(W / 2 + k * 45 * a.k, a.y); c.lineTo(W / 2 + k * 45 * b.k, b.y); c.stroke();
      }
    }
    // finish line
    const fz = g.length - pos;
    if (fz > -20 && fz < 900) { const p = proj(Math.max(0, fz)); c.fillStyle = "#fff"; c.fillRect(W / 2 - 135 * p.k, p.y - 3, 270 * p.k, 6 * p.k + 2); }
    // obstacles (far -> near)
    for (let i = tr.length - 1; i >= 0; i--) {
      const z = tr[i][0] - pos; if (z < -30 || z > 900) continue;
      const p = proj(Math.max(0, z)), x = W / 2 + (tr[i][1] - 1) * 90 * p.k, w = 56 * p.k, h = 40 * p.k;
      c.fillStyle = "#e8433f"; c.fillRect(x - w / 2, p.y - h, w, h);
      c.fillStyle = "#fff"; c.fillRect(x - w / 2, p.y - h * 0.6, w, h * 0.2);
    }
    // my car
    const cx = W / 2 + (this.vis - 1) * 90, shake = Date.now() - this.flash < 300 ? (Math.random() - 0.5) * 10 : 0;
    c.save(); c.translate(cx + shake, CARY);
    c.fillStyle = "#2fa86a"; c.fillRect(-20, -52, 40, 52);
    c.fillStyle = "#bfe8d0"; c.fillRect(-14, -44, 28, 14);
    c.fillStyle = "#111"; c.fillRect(-24, -46, 6, 14); c.fillRect(18, -46, 6, 14); c.fillRect(-24, -12, 6, 14); c.fillRect(18, -12, 6, 14);
    c.restore();
    if (Date.now() - this.flash < 500) { c.fillStyle = "rgba(255,40,40,.28)"; c.fillRect(0, 0, W, H); c.fillStyle = "#fff"; c.font = "bold 24px sans-serif"; c.textAlign = "center"; c.fillText("CRASH +" + g.penalty + "s", W / 2, 120); }
    // HUD
    c.fillStyle = "rgba(0,0,0,.5)"; c.fillRect(0, 0, W, 34);
    c.fillStyle = "#fff"; c.font = "bold 15px sans-serif"; c.textAlign = "left";
    const el = Math.max(0, ms / 1000);
    c.fillText(`⏱ ${(el + this.crashes * g.penalty).toFixed(1)}s`, 10, 22);
    c.textAlign = "right"; c.fillText(`💥 ${this.crashes}`, W - 10, 22);
    c.textAlign = "center"; c.fillText(`${Math.min(100, Math.round(pos / g.length * 100))}%`, W / 2, 22);
    if (t < 0) { c.fillStyle = "rgba(0,0,0,.45)"; c.fillRect(0, 0, W, H); c.fillStyle = "#fff"; c.font = "bold 90px sans-serif"; c.textAlign = "center"; c.fillText(String(Math.ceil(-t / 1000)), W / 2, H / 2 + 30); }
    else if (t < 700) { c.fillStyle = "#34d17a"; c.font = "bold 70px sans-serif"; c.textAlign = "center"; c.fillText("GO!", W / 2, H / 2); }
    // finished -> submit
    if (!this.submitted && t >= g.base * 1000 + 300 && s.status === "playing" && Date.now() - this.sent > 1500) {
      this.sent = Date.now();
      this.ctx.post("move", { log: this.log }).then((r) => { if (r) this.submitted = true; });
    }
  },
};

/* ------------------------------------------------------------- POOL */
const PL = { W: 800, H: 400, R: 11, PAD: 40, MAXSPEED: 1700 };
const PL_COL = { 1: "#f5c518", 2: "#1e5bd8", 3: "#d92b2b", 4: "#6a2fa0", 5: "#f58a1f", 6: "#1f8f3c", 7: "#7a1d1d", 8: "#111" };
const PL_POCKETS = [[0, 0, 27], [400, -4, 22], [800, 0, 27], [0, 400, 27], [400, 404, 22], [800, 400, 27]];

DUEL_VIEWS.pool = {
  mount(root, s, ctx) {
    this.ctx = ctx; this.angle = Math.PI; this.power = 0.6; this.placed = null; this.anim = null;
    this.playedNo = s.g.shot_no; this.fetching = false; this.shown = s.g.balls.map((b) => [b[0], b[1], b[2]]);
    root.innerHTML = `<style>
      .pl-cv{display:block;margin:6px auto;width:100%;border-radius:10px;touch-action:none}
      .pl-tray{display:flex;justify-content:space-between;gap:6px;font-size:12px;margin:4px 0;min-height:24px}
      .pl-tray span{display:inline-flex;gap:3px;align-items:center;flex-wrap:wrap}
      .pl-dot{width:15px;height:15px;border-radius:50%;display:inline-block;border:1px solid #000;font-size:8px;color:#fff;text-align:center;line-height:15px}
      .pl-ctl{display:flex;gap:8px;align-items:center;margin:6px 0}
      .pl-ctl button{padding:10px 14px;margin:0;width:auto}
      .pl-ctl input[type=range]{flex:1}
    </style>
    <div id="pl-info" class="center-note" style="margin:2px 0"></div>
    <canvas class="pl-cv" id="pl-cv" width="${PL.W + PL.PAD * 2}" height="${PL.H + PL.PAD * 2}"></canvas>
    <div class="pl-tray"><span id="pl-t-me"></span><span id="pl-t-op"></span></div>
    <div class="pl-ctl"><button class="btn secondary" id="pl-m">◀</button>
      <input type="range" id="pl-pw" min="5" max="100" value="60"><button class="btn secondary" id="pl-p">▶</button></div>
    <p class="center-note" style="margin:0">Drag on the table to aim · ◀ ▶ fine-tune · slider = power</p>
    <button class="btn" id="pl-shoot">🎱 SHOOT</button>`;
    this.cv = document.getElementById("pl-cv");
    const pt = (e) => {
      const r = this.cv.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * (PL.W + PL.PAD * 2) - PL.PAD, ((e.clientY - r.top) / r.height) * (PL.H + PL.PAD * 2) - PL.PAD];
    };
    let drag = false;
    const aimTo = (e) => {
      const s2 = this.ctx.s, me = s2.you_are; const cue = this.cue(s2);
      const [x, y] = pt(e);
      this.angle = Math.atan2(y - cue[1], x - cue[0]);
    };
    this.cv.addEventListener("pointerdown", (e) => {
      const s2 = this.ctx.s; if (!this.myTurn(s2)) return;
      const [x, y] = pt(e);
      if (s2.g.in_hand === s2.you_are && !this.placed) {
        if (this.validSpot(s2, x, y)) { this.placed = [x, y]; try { tg.HapticFeedback.impactOccurred("light"); } catch (er) {} }
        return;
      }
      drag = true; this.cv.setPointerCapture(e.pointerId); aimTo(e);
    });
    this.cv.addEventListener("pointermove", (e) => { if (drag) aimTo(e); });
    const up = () => { drag = false; };
    this.cv.addEventListener("pointerup", up); this.cv.addEventListener("pointercancel", up);
    document.getElementById("pl-pw").addEventListener("input", (e) => { this.power = Number(e.target.value) / 100; });
    document.getElementById("pl-m").addEventListener("click", () => { this.angle -= 0.007; });
    document.getElementById("pl-p").addEventListener("click", () => { this.angle += 0.007; });
    document.getElementById("pl-shoot").addEventListener("click", () => this.shoot());
    this.raf = () => { if (!root.isConnected) return; this.paint(); requestAnimationFrame(this.raf); };
    requestAnimationFrame(this.raf);
    this.tick = setInterval(() => { if (!root.isConnected) return clearInterval(this.tick); this.info(this.ctx.s); }, 500);
  },
  destroy() { clearInterval(this.tick); },
  myTurn(s) { return s.status === "playing" && s.g.turn === s.you_are && !this.anim; },
  cue(s) { return this.placed && s.g.in_hand === s.you_are ? this.placed : [s.g.balls[0][0], s.g.balls[0][1]]; },
  validSpot(s, x, y) {
    const R = PL.R; if (x < R || x > PL.W - R || y < R || y > PL.H - R) return false;
    for (let i = 1; i < 16; i++) { const b = s.g.balls[i]; if (!b[2] && Math.hypot(b[0] - x, b[1] - y) < 2 * R) return false; }
    for (const p of PL_POCKETS) if (Math.hypot(p[0] - x, p[1] - y) < p[2] + R) return false;
    return true;
  },
  async shoot() {
    const s = this.ctx.s; if (!this.myTurn(s)) return;
    const body = { angle: this.angle, power: this.power };
    if (s.g.in_hand === s.you_are) { if (!this.placed) { const e = document.getElementById("dl-err"); if (e) e.textContent = "Tap the table to place the cue ball first."; return; } body.place = this.placed; }
    document.getElementById("dl-err").textContent = "";
    const r = await this.ctx.post("move", body);
    if (r) this.placed = null;
  },
  info(s) {
    const g = s.g, el = document.getElementById("pl-info"); if (!el) return;
    const grp = (x) => (x === "solid" ? "SOLIDS" : x === "stripe" ? "STRIPES" : "open table");
    let t;
    if (s.status !== "playing") t = "Game over";
    else if (this.anim) t = "🎱 Balls are rolling…";
    else if (g.turn === s.you_are) t = (g.in_hand === s.you_are ? "<b>Your turn — tap the table to place the cue ball</b>" : "<b>Your turn</b>") + ` ⏱ ${duelSecs(s.deadline)}s`;
    else t = "Opponent's turn…";
    let last = "";
    if (g.last && g.last.foul && !this.anim) {
      const why = { scratch: "scratch", no_hit: "no ball hit", wrong_ball: "wrong ball first", hit_8_first: "hit the 8 first", timeout: "ran out of time" }[g.last.why] || "foul";
      last = `<br><span style="color:#ff6b6b">Foul (${why}) — ball in hand for ${g.last.by === s.you_are ? "opponent" : "you"}</span>`;
    }
    el.innerHTML = `${t}${last}<br><span style="font-size:12px;color:#8b95ad">You: ${grp(g.my_group)} · Opponent: ${grp(g.opp_group)}</span>`;
    const btn = document.getElementById("pl-shoot");
    if (btn) btn.disabled = !this.myTurn(s);
  },
  update(s) {
    const g = s.g;
    if (g.shot_no > this.playedNo && !this.fetching) {
      this.fetching = true; const no = g.shot_no;
      apiGet(`/webapp/duels/${s.game_id}/anim/${no}`).then((a) => {
        if (a.frames && a.frames.length) this.anim = { frames: a.frames, t0: Date.now() };
        this.playedNo = no;
      }).catch(() => { this.playedNo = no; }).finally(() => { this.fetching = false; });
    }
    if (!this.anim) this.shown = g.balls.map((b) => [b[0], b[1], b[2]]);
    if (g.in_hand !== s.you_are) this.placed = null;
    // tray of potted balls
    const dots = (ids) => ids.map((i) => `<i class="pl-dot" style="background:${i === 8 ? "#111" : PL_COL[i > 8 ? i - 8 : i]};${i > 8 ? "box-shadow:inset 0 0 0 3px #fff" : ""}">${i}</i>`).join("");
    const potted = []; for (let i = 1; i < 16; i++) if (g.balls[i][2]) potted.push(i);
    const mine = potted.filter((i) => (g.my_group === "solid" && i < 8) || (g.my_group === "stripe" && i > 8));
    const opp = potted.filter((i) => (g.opp_group === "solid" && i < 8) || (g.opp_group === "stripe" && i > 8) || i === 8);
    const rest = potted.filter((i) => !mine.includes(i) && !opp.includes(i));
    document.getElementById("pl-t-me").innerHTML = "You: " + dots(mine) + dots(rest);
    document.getElementById("pl-t-op").innerHTML = "Opp: " + dots(opp);
    this.info(s);
    const foot = document.getElementById("dl-foot");
    if (foot && s.status === "playing" && !document.getElementById("pl-resign")) {
      foot.innerHTML = `<button class="btn secondary" id="pl-resign">🏳️ Resign</button>`;
      document.getElementById("pl-resign").addEventListener("click", () => {
        const go = () => this.ctx.post("resign");
        tg.showConfirm ? tg.showConfirm("Resign and lose your stake?", (ok) => ok && go()) : go();
      });
    }
  },
  ballsNow() {
    if (this.anim) {
      const a = this.anim, f = ((Date.now() - a.t0) / 1000) * 24, i = Math.floor(f);
      if (i >= a.frames.length - 1) { this.anim = null; return null; }
      const p = a.frames[i], q = a.frames[i + 1], k = f - i, out = [];
      for (let b = 0; b < 16; b++) {
        const x0 = p[b * 2], y0 = p[b * 2 + 1], x1 = q[b * 2], y1 = q[b * 2 + 1];
        if (x0 < 0) out.push([0, 0, 1]);
        else out.push(x1 < 0 ? [x0, y0, 0] : [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, 0]);
      }
      return out;
    }
    return null;
  },
  ball(c, id, x, y) {
    const R = PL.R;
    c.save(); c.translate(x, y);
    c.beginPath(); c.arc(1.5, 2, R, 0, 6.3); c.fillStyle = "rgba(0,0,0,.35)"; c.fill();
    c.beginPath(); c.arc(0, 0, R, 0, 6.3); c.clip();
    if (id === 0) c.fillStyle = "#f4f4ee";
    else if (id === 8) c.fillStyle = "#111";
    else c.fillStyle = id > 8 ? "#f4f4ee" : PL_COL[id];
    c.fillRect(-R, -R, 2 * R, 2 * R);
    if (id > 8) { c.fillStyle = PL_COL[id - 8]; c.fillRect(-R, -R * 0.55, 2 * R, R * 1.1); }
    c.restore();
    if (id > 0) {
      c.beginPath(); c.arc(x, y, R * 0.45, 0, 6.3); c.fillStyle = "#fff"; c.fill();
      c.fillStyle = "#000"; c.font = "bold 8px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(String(id), x, y + 0.5);
    }
    const g = c.createRadialGradient(x - 3.5, y - 4, 1, x, y, R);
    g.addColorStop(0, "rgba(255,255,255,.55)"); g.addColorStop(0.35, "rgba(255,255,255,0)");
    c.beginPath(); c.arc(x, y, R, 0, 6.3); c.fillStyle = g; c.fill();
  },
  paint() {
    const s = this.ctx.s; if (!s || !s.g) return;
    const g = s.g, c = this.cv.getContext("2d"), P = PL.PAD, W = PL.W, H = PL.H, R = PL.R;
    const live = this.ballsNow();
    const balls = live || (this.anim ? this.shown : g.balls);
    c.clearRect(0, 0, W + 2 * P, H + 2 * P);
    // frame + felt
    c.fillStyle = "#4a2c12"; c.beginPath(); c.roundRect ? c.roundRect(0, 0, W + 2 * P, H + 2 * P, 26) : c.rect(0, 0, W + 2 * P, H + 2 * P); c.fill();
    c.fillStyle = "#1d7a45"; c.fillRect(P, P, W, H);
    c.strokeStyle = "rgba(0,0,0,.35)"; c.lineWidth = 3; c.strokeRect(P, P, W, H);
    c.strokeStyle = "rgba(255,255,255,.18)"; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(P + W * 0.25, P); c.lineTo(P + W * 0.25, P + H); c.stroke();
    c.fillStyle = "rgba(255,255,255,.35)"; c.beginPath(); c.arc(P + W * 0.72, P + H / 2, 2.5, 0, 6.3); c.fill();
    PL_POCKETS.forEach((p) => { c.beginPath(); c.fillStyle = "#050505"; c.arc(P + p[0], P + p[1], p[2] * 0.8, 0, 6.3); c.fill(); });
    // placed cue
    let cue = null;
    if (g.in_hand === s.you_are && this.placed && this.myTurn(s)) cue = this.placed;
    for (let i = 15; i >= 0; i--) {
      if (balls[i][2]) continue;
      if (i === 0 && cue) continue;
      this.ball(c, i, P + balls[i][0], P + balls[i][1]);
    }
    if (cue) this.ball(c, 0, P + cue[0], P + cue[1]);
    if (g.in_hand === s.you_are && !this.placed && this.myTurn(s)) {
      c.fillStyle = "rgba(255,255,255,.9)"; c.font = "bold 22px sans-serif"; c.textAlign = "center"; c.fillText("Tap to place the cue ball", P + W / 2, P + H / 2);
    }
    // aim guide
    if (this.myTurn(s) && !(g.in_hand === s.you_are && !this.placed)) {
      const cs = this.cue(s), dx = Math.cos(this.angle), dy = Math.sin(this.angle);
      let tmin = 1e9, hit = -1;
      const tx = dx > 0 ? (W - R - cs[0]) / dx : dx < 0 ? (R - cs[0]) / dx : 1e9;
      const ty = dy > 0 ? (H - R - cs[1]) / dy : dy < 0 ? (R - cs[1]) / dy : 1e9;
      tmin = Math.min(tx, ty);
      for (let i = 1; i < 16; i++) {
        const b = g.balls[i]; if (b[2]) continue;
        const px = b[0] - cs[0], py = b[1] - cs[1], bb = dx * px + dy * py, cc = px * px + py * py - 4 * R * R;
        const disc = bb * bb - cc;
        if (bb > 0 && disc >= 0) { const t = bb - Math.sqrt(disc); if (t > 0 && t < tmin) { tmin = t; hit = i; } }
      }
      const gx = cs[0] + dx * tmin, gy = cs[1] + dy * tmin;
      c.setLineDash([8, 6]); c.strokeStyle = "rgba(255,255,255,.85)"; c.lineWidth = 2;
      c.beginPath(); c.moveTo(P + cs[0], P + cs[1]); c.lineTo(P + gx, P + gy); c.stroke(); c.setLineDash([]);
      c.beginPath(); c.arc(P + gx, P + gy, R, 0, 6.3); c.stroke();
      if (hit > 0) {
        const b = g.balls[hit], nx = b[0] - gx, ny = b[1] - gy, nl = Math.hypot(nx, ny) || 1;
        c.strokeStyle = "rgba(255,230,120,.9)"; c.beginPath(); c.moveTo(P + b[0], P + b[1]); c.lineTo(P + b[0] + nx / nl * 60, P + b[1] + ny / nl * 60); c.stroke();
      }
      // cue stick
      const back = 26 + (1 - this.power) * 10 + this.power * 70, sx = cs[0] - dx * (R + back), sy = cs[1] - dy * (R + back);
      c.strokeStyle = "#d9b27a"; c.lineWidth = 6; c.lineCap = "round";
      c.beginPath(); c.moveTo(P + sx, P + sy); c.lineTo(P + sx - dx * 120, P + sy - dy * 120); c.stroke(); c.lineCap = "butt";
    }
  },
};
