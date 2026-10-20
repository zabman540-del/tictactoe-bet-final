/* flight3d.js — small software 3D engine for Nova Flight (canvas 2D, real perspective,
 * lit/shaded polygons, terrain, clouds, contrail, explosion). No external libraries,
 * works on every phone. Forward = +Z, up = +Y, right = +X. */
const F3 = (() => {
  const S = { scroll: 0, speed: 0, camY: 3, last: 0, parts: [], trail: [], shake: 0, clouds: null, stars: null,
    boomT: -1, boomPos: null, alt: 0.8, cloudSpr: null, sunSpr: null, reduce: false };
  try { S.reduce = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rnd = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const h2 = (a, b) => rnd(a * 12.9898 + b * 78.233);
  const sm = (t) => t * t * (3 - 2 * t);
  function vn(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = sm(x - ix), fy = sm(y - iy);
    return lerp(lerp(h2(ix, iy), h2(ix + 1, iy), fx), lerp(h2(ix, iy + 1), h2(ix + 1, iy + 1), fx), fy);
  }
  const STEP = 16, COLS = 17, ROWS = 17;
  function terrainH(ix, iz) {
    const x = Math.abs(ix * STEP);
    const side = sm(clamp((x - 20) / 70, 0, 1));
    return (vn(ix * 0.33, iz * 0.33) * 1.0 + vn(ix * 0.9, iz * 0.9) * 0.3) * 34 * side + vn(ix * 1.7, iz * 1.7) * 1.2 * side;
  }
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const rgb = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  const HORIZON = [230, 96, 62], FOGC = [74, 28, 62];

  function sprites() {
    if (S.cloudSpr) return;
    const c = document.createElement("canvas"); c.width = 128; c.height = 64; const g = c.getContext("2d");
    [[40, 38, 26], [66, 32, 30], [92, 38, 24], [64, 42, 34]].forEach(([x, y, r]) => {
      const gr = g.createRadialGradient(x, y, 2, x, y, r); gr.addColorStop(0, "rgba(255,206,196,.9)"); gr.addColorStop(.6, "rgba(190,110,140,.35)"); gr.addColorStop(1, "rgba(120,60,110,0)");
      g.fillStyle = gr; g.fillRect(0, 0, 128, 64);
    });
    S.cloudSpr = c;
    const s = document.createElement("canvas"); s.width = s.height = 128; const sg = s.getContext("2d");
    const gr = sg.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, "rgba(255,240,200,1)"); gr.addColorStop(.25, "rgba(255,170,90,.7)"); gr.addColorStop(1, "rgba(255,90,60,0)");
    sg.fillStyle = gr; sg.fillRect(0, 0, 128, 128); S.sunSpr = s;
    S.stars = Array.from({ length: 70 }, (_, i) => ({ x: rnd(i + 1), y: rnd(i + 99) * 0.55, r: 0.5 + rnd(i + 7) * 1.2, p: rnd(i + 3) * 6 }));
    S.clouds = Array.from({ length: 18 }, (_, i) => ({ x: (rnd(i + 5) - .5) * 160, dy: -14 + rnd(i + 11) * 40, z: 20 + rnd(i + 21) * 240, w: 22 + rnd(i + 31) * 30 }));
  }

  /* ----- plane model (local space) ----- */
  const RINGS = [[-4.3, .1], [-3.2, .3], [-1.6, .5], [.4, .56], [2, .5], [3.3, .3], [4.4, .03]];
  const SEG = 8;
  const RED = [255, 61, 79], DRED = [200, 36, 54], WHITE = [238, 240, 246], GLASS = [120, 200, 255], DARK = [60, 64, 78];
  function ringPt(k, s) { const a = (s / SEG) * Math.PI * 2 + Math.PI / SEG; const [z, r] = RINGS[k]; return [Math.sin(a) * r * 1.0, Math.cos(a) * r * 0.92, z]; }
  const FACES = (() => {
    const f = [];
    for (let k = 0; k < RINGS.length - 1; k++) for (let s = 0; s < SEG; s++) {
      const s2 = (s + 1) % SEG, p = [ringPt(k, s), ringPt(k, s2), ringPt(k + 1, s2), ringPt(k + 1, s)];
      let c = RED;
      if (s >= 3 && s <= 4) c = WHITE;                                   // belly
      if ((s === 0 || s === 7) && k >= 3 && k <= 4) c = GLASS;           // canopy
      if (k === 2 && (s === 1 || s === 2 || s === 5 || s === 6)) c = DRED;
      f.push({ p, c, two: false });
    }
    // wings (swept)
    f.push({ p: [[.5, -.1, 1.4], [.5, -.1, -.5], [5.2, .35, -2.4], [5.2, .35, -1.0]], c: [230, 48, 66], two: true });
    f.push({ p: [[-.5, -.1, -.5], [-.5, -.1, 1.4], [-5.2, .35, -1.0], [-5.2, .35, -2.4]], c: [230, 48, 66], two: true });
    // tailplanes
    f.push({ p: [[.15, .1, -3.3], [.15, .1, -4.2], [2.2, .2, -4.7], [2.2, .2, -3.9]], c: DRED, two: true });
    f.push({ p: [[-.15, .1, -4.2], [-.15, .1, -3.3], [-2.2, .2, -3.9], [-2.2, .2, -4.7]], c: DRED, two: true });
    // fin
    f.push({ p: [[0, .45, -2.6], [0, .45, -4.3], [0, 2.3, -4.8], [0, 2.3, -4.0]], c: RED, two: true });
    // engines (boxes under wings)
    [[-1.9, 1], [1.9, 1]].forEach(([x]) => {
      const a = x - .22, b = x + .22, y0 = -.62, y1 = -.18, z0 = -1.5, z1 = .8;
      f.push({ p: [[a, y1, z1], [b, y1, z1], [b, y0, z1], [a, y0, z1]], c: DARK, two: true });
      f.push({ p: [[a, y0, z0], [b, y0, z0], [b, y0, z1], [a, y0, z1]], c: DARK, two: true });
      f.push({ p: [[a, y1, z0], [a, y0, z0], [a, y0, z1], [a, y1, z1]], c: [90, 94, 110], two: true });
      f.push({ p: [[b, y1, z1], [b, y0, z1], [b, y0, z0], [b, y1, z0]], c: [90, 94, 110], two: true });
    });
    return f;
  })();
  const L = (() => { const v = [-0.5, 0.8, 0.35], m = Math.hypot(...v); return v.map((x) => x / m); })();

  function draw(cv, info) {
    sprites();
    const ctx = cv.getContext("2d"), dpr = cv.width / cv.clientWidth, W = cv.clientWidth, H = cv.clientHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const now = performance.now(), dt = clamp((now - (S.last || now)) / 1000, 0, 0.05); S.last = now;
    const time = now / 1000;
    const ph = info.phase, t = info.t;
    const crashed = ph === "ended";

    if (info.boom && S.boomT < 0) { S.boomT = time; S.shake = S.reduce ? 0 : 1; }
    if (!crashed) { S.boomT = -1; S.boomPos = null; S.parts.length = 0; }

    // flight model
    const tt = crashed ? info.crashT : t;
    const ta = Math.max(0, tt - 2.4);
    const alt = 0.8 + Math.pow(1 - Math.exp(-0.2 * ta), 1.35) * 30;
    const pitch = ph === "countdown" ? 0 : 0.30 * (1 - Math.exp(-1.5 * ta)) * (0.45 + 0.55 * Math.exp(-0.15 * ta));
    const roll = Math.sin(time * 0.8) * (ph === "countdown" ? 0 : 0.07);
    let spTarget = 0;
    if (ph === "flying") spTarget = Math.min(34, 14 * tt) + Math.min(60, 3 * tt);
    if (crashed) spTarget = 0;
    S.speed = lerp(S.speed, spTarget, clamp(dt * (crashed ? 4 : 6), 0, 1));
    S.scroll += S.speed * dt;
    if (ph === "countdown") S.scroll = 0;
    S.alt = crashed ? S.alt : alt;
    const planeY = S.alt + (ph === "flying" && tt < 2.4 ? Math.sin(time * 70) * 0.012 : 0);

    // camera
    S.camY = lerp(S.camY, planeY + 2.6, clamp(dt * 3, 0, 1));
    const sh = S.shake > 0 ? S.shake : 0; S.shake = Math.max(0, S.shake - dt * 1.8);
    const cam = [3.0 + (Math.random() - .5) * sh * 1.2, S.camY + (Math.random() - .5) * sh * 1.2, -13];
    const look = [0, planeY + 2.0, 14];
    let f = [look[0] - cam[0], look[1] - cam[1], look[2] - cam[2]]; const fl = Math.hypot(...f); f = f.map((v) => v / fl);
    let r = [f[2], 0, -f[0]]; const rl = Math.hypot(...r); r = r.map((v) => v / rl);
    const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
    const focal = W * 0.72;
    const proj = (p) => {
      const dx = p[0] - cam[0], dy = p[1] - cam[1], dz = p[2] - cam[2];
      const z = dx * f[0] + dy * f[1] + dz * f[2];
      if (z < 0.4) return null;
      return [W / 2 + focal * (dx * r[0] + dy * r[1] + dz * r[2]) / z, H / 2 - focal * (dx * u[0] + dy * u[1] + dz * u[2]) / z, z];
    };
    const horizonY = H / 2 + focal * f[1] / Math.hypot(f[0], f[2]);

    // ----- sky -----
    const hy = clamp(horizonY, 30, H);
    const sg = ctx.createLinearGradient(0, 0, 0, hy);
    sg.addColorStop(0, "#050816"); sg.addColorStop(.5, "#1d1034"); sg.addColorStop(.82, "#7a2a55"); sg.addColorStop(1, "#ff7a45");
    ctx.fillStyle = sg; ctx.fillRect(0, 0, W, hy + 1);
    ctx.fillStyle = rgb(mix(FOGC, [10, 20, 22], .5)); ctx.fillRect(0, hy, W, H - hy);
    S.stars.forEach((s) => { const a = 0.35 + 0.4 * Math.sin(time * 2 + s.p); ctx.globalAlpha = a * clamp(1 - (s.y * H) / (hy * 0.9), 0, 1); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(s.x * W, s.y * H * (hy / (H * .55)) * .6, s.r, 0, 7); ctx.fill(); });
    ctx.globalAlpha = 1;
    // sun glow
    const sun = proj([-120, 6, 1000]);
    if (sun) { ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = .9; ctx.drawImage(S.sunSpr, sun[0] - 110, sun[1] - 110, 220, 220); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; }

    // ----- terrain -----
    const base = Math.floor(S.scroll / STEP), off = S.scroll - base * STEP;
    const zRel = (iz) => iz * STEP - off - 14;          // world z of row iz (0..ROWS) relative to plane z=0 (camera z=-13)
    const fog = (z) => Math.pow(clamp((z - 28) / 200, 0, 1), 1.1);
    const hAt = (ix, iz) => terrainH(ix, iz + base);
    const half = (COLS - 1) / 2;
    for (let iz = ROWS - 1; iz >= 0; iz--) {
      for (let ix = -half; ix < half; ix++) {
        const x0 = ix * STEP, x1 = x0 + STEP, z0 = zRel(iz), z1 = zRel(iz + 1);
        const hA = hAt(ix, iz), hB = hAt(ix + 1, iz), hC = hAt(ix + 1, iz + 1), hD = hAt(ix, iz + 1);
        const P = [proj([x0, hA, z0]), proj([x1, hB, z0]), proj([x1, hC, z1]), proj([x0, hD, z1])];
        if (!P[0] || !P[1] || !P[2] || !P[3]) continue;
        const hv = (hA + hB + hC + hD) / 4;
        const slope = ((hA + hD) - (hB + hC)) * 0.05;
        const lit = clamp(0.72 + slope, 0.35, 1.25);
        let col = mix([22, 40, 34], [112, 92, 96], clamp(hv / 30, 0, 1));
        if (hv > 22) col = mix(col, [190, 175, 190], clamp((hv - 22) / 12, 0, 1));
        col = col.map((c) => c * lit);
        col = mix(col, FOGC, fog(P[2][2]));
        ctx.fillStyle = rgb(col); ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]); ctx.lineTo(P[1][0], P[1][1]); ctx.lineTo(P[2][0], P[2][1]); ctx.lineTo(P[3][0], P[3][1]); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = .6; ctx.stroke();
        // village lights
        if (hv < 1 && h2(ix + 31, iz + base + 17) > 0.9) {
          const q = proj([x0 + 6, 0.2, z0 + 6]);
          if (q) { ctx.globalAlpha = 1 - fog(q[2]); ctx.fillStyle = "#ffd77a"; ctx.beginPath(); ctx.arc(q[0], q[1], clamp(120 / q[2], .6, 3), 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
        }
      }
    }
    // runway
    if (S.scroll < 220) {
      const z0 = -60 - S.scroll, z1 = 150 - S.scroll;
      const q = [proj([-5, 0.03, z0]), proj([5, 0.03, z0]), proj([5, 0.03, z1]), proj([-5, 0.03, z1])];
      if (q[2] && q[3]) {
        const a = q[0] || proj([-5, .03, -13 + .5]), b = q[1] || proj([5, .03, -13 + .5]);
        if (a && b) {
          ctx.fillStyle = "#23262f"; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(q[2][0], q[2][1]); ctx.lineTo(q[3][0], q[3][1]); ctx.closePath(); ctx.fill();
        }
        for (let k = -8; k < 26; k++) {
          const zz = k * 9 - (S.scroll % 9) - 2;
          const d = [proj([-.25, .05, zz]), proj([.25, .05, zz]), proj([.25, .05, zz + 4]), proj([-.25, .05, zz + 4])];
          if (d.every(Boolean)) { ctx.fillStyle = "rgba(255,255,255," + (1 - fog(d[0][2])) + ")"; ctx.beginPath(); ctx.moveTo(d[0][0], d[0][1]); d.slice(1).forEach((p) => ctx.lineTo(p[0], p[1])); ctx.closePath(); ctx.fill(); }
        }
        for (let k = -8; k < 26; k++) {          // edge lights
          const zz = k * 9 - (S.scroll % 9);
          [-5, 5].forEach((xx) => { const d = proj([xx, .25, zz]); if (d) { ctx.fillStyle = "#ffc46b"; ctx.globalAlpha = 1 - fog(d[2]); ctx.beginPath(); ctx.arc(d[0], d[1], clamp(60 / d[2], .6, 2.5), 0, 7); ctx.fill(); ctx.globalAlpha = 1; } });
        }
      }
    }

    // ----- clouds (far ones first) -----
    const drawClouds = (far) => {
      S.clouds.forEach((c) => {
        const zc = c.z; if ((zc > 0) !== far) return;
        const p = proj([c.x, S.alt + c.dy, zc]); if (!p) return;
        const w = (c.w / p[2]) * focal, a = clamp(1 - fog(p[2]) * 0.7, 0.1, 1) * 0.8;
        ctx.globalAlpha = a; ctx.drawImage(S.cloudSpr, p[0] - w / 2, p[1] - w / 4, w, w / 2); ctx.globalAlpha = 1;
      });
    };
    S.clouds.forEach((c) => { c.z -= S.speed * dt; if (c.z < -16) { c.z = 230 + Math.random() * 60; c.x = (Math.random() - .5) * 160; c.dy = -14 + Math.random() * 40; c.w = 22 + Math.random() * 30; } });
    drawClouds(true);

    // ----- contrail -----
    if (!crashed && ph === "flying") S.trail.push({ y: planeY, t: time });
    while (S.trail.length && time - S.trail[0].t > 2.4) S.trail.shift();
    if (S.trail.length > 2) {
      ctx.lineCap = "round";
      for (let i = 1; i < S.trail.length; i++) {
        const a = S.trail[i - 1], b = S.trail[i], age = time - b.t;
        const za = -(time - a.t) * S.speed - 3.6, zb = -(age) * S.speed - 3.6;
        const pa = proj([0.0, a.y - .1, za]), pb = proj([0.0, b.y - .1, zb]);
        if (pa && pb) { ctx.strokeStyle = `rgba(255,200,190,${0.55 * (1 - age / 2.4)})`; ctx.lineWidth = clamp(24 / pb[2], .6, 5) * (1 + age); ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke(); }
      }
    }

    // ----- plane -----
    if (!crashed) {
      const cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
      const T = (p) => {
        let x = p[0], y = p[1], z = p[2];
        const y1 = y * cp + z * sp, z1 = -y * sp + z * cp;       // pitch (nose up)
        const x2 = x * cr - y1 * sr, y2 = x * sr + y1 * cr;      // roll
        return [x2, y2 + planeY, z1];
      };
      const items = [];
      FACES.forEach((fc) => {
        const w = fc.p.map(T);
        const e1 = [w[1][0] - w[0][0], w[1][1] - w[0][1], w[1][2] - w[0][2]], e2 = [w[2][0] - w[0][0], w[2][1] - w[0][1], w[2][2] - w[0][2]];
        let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; const nl = Math.hypot(...n) || 1; n = n.map((v) => v / nl);
        if (!fc.two) n = n.map((v) => -v);          // body rings are wound inward: flip to outward normals
        const toCam = [cam[0] - w[0][0], cam[1] - w[0][1], cam[2] - w[0][2]];
        if (n[0] * toCam[0] + n[1] * toCam[1] + n[2] * toCam[2] < 0) { if (fc.two) n = n.map((v) => -v); else return; }
        const pr = w.map(proj); if (pr.some((q) => !q)) return;
        const b = clamp(0.38 + 0.78 * Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]), 0.3, 1.2);
        const c = fc.c.map((v, i) => clamp(v * b + (i === 0 ? 24 : i === 1 ? 6 : 0) * (b - .5) * 2, 0, 255));
        const d = (pr[0][2] + pr[1][2] + pr[2][2] + pr[3][2]) / 4;
        items.push({ pr, c, d });
      });
      items.sort((a, b) => b.d - a.d);
      items.forEach((it) => {
        ctx.fillStyle = rgb(it.c); ctx.strokeStyle = `rgba(20,10,20,.35)`; ctx.lineWidth = .8;
        ctx.beginPath(); ctx.moveTo(it.pr[0][0], it.pr[0][1]); for (let i = 1; i < 4; i++) ctx.lineTo(it.pr[i][0], it.pr[i][1]); ctx.closePath(); ctx.fill(); ctx.stroke();
      });
      // engine flames + nav lights
      const fAmt = ph === "countdown" ? 0.25 : 1;
      [[-1.9, -.4], [1.9, -.4]].forEach(([ex, ey]) => {
        const a = proj(T([ex, ey, -1.5])), b = proj(T([ex, ey, -1.5 - (1.6 + Math.random() * 1.2) * fAmt]));
        if (a && b) { const g = ctx.createLinearGradient(a[0], a[1], b[0], b[1]); g.addColorStop(0, "rgba(255,240,180,.95)"); g.addColorStop(.5, "rgba(255,150,60,.7)"); g.addColorStop(1, "rgba(255,60,40,0)"); ctx.strokeStyle = g; ctx.lineWidth = clamp(70 / a[2], 2, 9); ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
      });
      [[-5.2, .35, -1.7, "#ff3040"], [5.2, .35, -1.7, "#35ff90"], [0, 2.3, -4.9, "#ffffff"]].forEach(([x, y, z, col]) => {
        const q = proj(T([x, y, z])); if (q && Math.sin(time * 6 + x) > -.3) { ctx.fillStyle = col; ctx.globalAlpha = .95; ctx.beginPath(); ctx.arc(q[0], q[1], clamp(40 / q[2], 1, 3.2), 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
      });
      // shadow on the ground (takeoff only)
      if (planeY < 4) { const q = proj([0, .06, 0]); if (q) { ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.beginPath(); ctx.ellipse(q[0], q[1], clamp(560 / q[2] / (1 + planeY), 8, 90), clamp(70 / q[2], 3, 12), 0, 0, 7); ctx.fill(); } }
    } else {
      // ----- explosion -----
      if (!S.boomPos) {
        S.boomPos = [0, planeY, 0];
        for (let i = 0; i < 140; i++) { const a = Math.random() * 6.283, b = (Math.random() - .3) * 3, sp = 3 + Math.random() * 16; S.parts.push({ p: [0, planeY, 0], v: [Math.cos(a) * sp, Math.sin(b) * sp * .8 + 3, Math.sin(a) * sp * .6], life: 1, k: i % 3, big: Math.random() * 1.6 + .5 }); }
      }
      const age = time - S.boomT;
      ctx.globalCompositeOperation = "lighter";
      S.parts.forEach((q) => {
        q.p[0] += q.v[0] * dt; q.p[1] += q.v[1] * dt; q.p[2] += q.v[2] * dt; q.v[1] -= 9 * dt; q.life -= dt * (q.k === 2 ? 0.45 : 0.9);
        if (q.life <= 0) return; const p = proj(q.p); if (!p) return;
        const s = clamp((q.big * focal * 0.5) / p[2], 1, 40) * (q.k === 2 ? 1.6 : q.life);
        const col = q.k === 0 ? "255,170,60" : q.k === 1 ? "255,70,50" : "255,230,200";
        const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], s); g.addColorStop(0, `rgba(${col},${.8 * q.life})`); g.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p[0], p[1], s, 0, 7); ctx.fill();
      });
      const c0 = proj(S.boomPos);
      if (c0 && age < 1.4) {
        const R = (age * 120 + 12) * (focal / 260) * (20 / c0[2]) * 0.8, a = Math.max(0, 1 - age / 1.2);
        const g = ctx.createRadialGradient(c0[0], c0[1], 0, c0[0], c0[1], R); g.addColorStop(0, `rgba(255,250,220,${a})`); g.addColorStop(.4, `rgba(255,150,60,${a * .8})`); g.addColorStop(1, "rgba(255,60,30,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c0[0], c0[1], R, 0, 7); ctx.fill();
        ctx.strokeStyle = `rgba(255,220,180,${a * .7})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(c0[0], c0[1], R * 1.25, 0, 7); ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    }
    drawClouds(false);

    // ----- vignette + HUD text -----
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * .25, W / 2, H / 2, H * .85); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.45)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.shadowColor = "rgba(0,0,0,.65)"; ctx.shadowBlur = 12;
    const FONT = "-apple-system,Segoe UI,Roboto,sans-serif";
    if (ph === "countdown") {
      ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.font = `800 13px ${FONT}`; ctx.fillText(`ROUND #${info.roundId} · TAKE-OFF IN`, W / 2, H * .2);
      ctx.fillStyle = "#fff"; ctx.font = `900 64px ${FONT}`; ctx.fillText(String(info.left), W / 2, H * .33);
    } else if (!crashed) {
      ctx.fillStyle = "#fff"; ctx.font = `900 ${Math.round(W * .17)}px ${FONT}`; ctx.fillText(info.mult.toFixed(2) + "x", W / 2, H * .24);
    } else {
      ctx.fillStyle = "#ff4d5e"; ctx.font = `900 ${Math.round(W * .17)}px ${FONT}`; ctx.fillText(info.crash.toFixed(2) + "x", W / 2, H * .24);
      ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.font = `800 15px ${FONT}`; ctx.fillText("CRASHED", W / 2, H * .36);
    }
    ctx.shadowBlur = 0;
  }
  return { draw };
})();
