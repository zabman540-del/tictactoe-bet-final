/* race3d.js — realistic 3D renderer for Car Race (raw WebGL, no libraries).
 * Per-pixel lighting, glossy car paint with sky reflections, procedural asphalt,
 * atmospheric haze, clouds, acacia trees, mountains, barriers, cones and trucks.
 * The renderer only DRAWS. The server still decides the race result.
 * Race3D.create(canvas) -> renderer, or null when WebGL isn't available. */
const Race3D = (() => {
  const K = 0.25;          // 1 track unit = 0.25 m
  const LANE = 3.6;        // lane width (m)
  const ROAD_HALF = 5.4;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  /* ---------------------------------------------------------------- matrices */
  const m4 = {
    id: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    mul(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      return o;
    },
    persp(fovy, asp, n, f) {
      const t = 1 / Math.tan(fovy / 2), o = new Float32Array(16);
      o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f);
      return o;
    },
    look(e, t, up) {
      let zx = e[0] - t[0], zy = e[1] - t[1], zz = e[2] - t[2], l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
      let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx; l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
      const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
        -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1]);
    },
    inv(m) {
      const i = new Float32Array(16), [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
      const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11,
        b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30,
        b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
      let d = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06; d = 1 / d;
      i[0] = (a11 * b11 - a12 * b10 + a13 * b09) * d; i[1] = (a02 * b10 - a01 * b11 - a03 * b09) * d; i[2] = (a31 * b05 - a32 * b04 + a33 * b03) * d; i[3] = (a22 * b04 - a21 * b05 - a23 * b03) * d;
      i[4] = (a12 * b08 - a10 * b11 - a13 * b07) * d; i[5] = (a00 * b11 - a02 * b08 + a03 * b07) * d; i[6] = (a32 * b02 - a30 * b05 - a33 * b01) * d; i[7] = (a20 * b05 - a22 * b02 + a23 * b01) * d;
      i[8] = (a10 * b10 - a11 * b08 + a13 * b06) * d; i[9] = (a01 * b08 - a00 * b10 - a03 * b06) * d; i[10] = (a30 * b04 - a31 * b02 + a33 * b00) * d; i[11] = (a21 * b02 - a20 * b04 - a23 * b00) * d;
      i[12] = (a11 * b07 - a10 * b09 - a12 * b06) * d; i[13] = (a00 * b09 - a01 * b07 + a02 * b06) * d; i[14] = (a31 * b01 - a30 * b03 - a32 * b00) * d; i[15] = (a20 * b03 - a21 * b01 + a22 * b00) * d;
      return i;
    },
    // T * Ry * Rx * Rz * S
    model(tx, ty, tz, ry = 0, rx = 0, rz = 0, s = 1) {
      const cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx), cz = Math.cos(rz), sz = Math.sin(rz);
      const R = new Float32Array(16);
      // M = Ry*Rx (3x3) then times Rz
      const M = [[cy, sy * sx, sy * cx], [0, cx, -sx], [-sy, cy * sx, cy * cx]];
      const Z = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]];
      const P = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) P[i][j] = M[i][0] * Z[0][j] + M[i][1] * Z[1][j] + M[i][2] * Z[2][j];
      R[0] = P[0][0] * s; R[1] = P[1][0] * s; R[2] = P[2][0] * s;
      R[4] = P[0][1] * s; R[5] = P[1][1] * s; R[6] = P[2][1] * s;
      R[8] = P[0][2] * s; R[9] = P[1][2] * s; R[10] = P[2][2] * s;
      R[12] = tx; R[13] = ty; R[14] = tz; R[15] = 1;
      return R;
    },
  };

  /* ---------------------------------------------------------------- mesh builder */
  const MAT = { matte: 0, paint: 1, glass: 2, emit: 3, rubber: 4, chrome: 5, road: 6, ground: 7, blob: 9 };
  class MB {
    constructor() { this.v = []; }
    vert(p, n, c, m) { this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2], m); }
    tri(a, b, c, col, mat, n) {
      if (!n) {
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
        const l = Math.hypot(n[0], n[1], n[2]) || 1; n = [n[0] / l, n[1] / l, n[2] / l];
      }
      this.vert(a, n, col, mat); this.vert(b, n, col, mat); this.vert(c, n, col, mat);
    }
    quad(a, b, c, d, col, mat) { this.tri(a, b, c, col, mat); this.tri(a, c, d, col, mat); }
    box(cx, cy, cz, sx, sy, sz, col, mat) {
      const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
      const P = (x, y, z) => [x, y, z];
      this.quad(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), col, mat);
      this.quad(P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), col, mat);
      this.quad(P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0), col, mat);
      this.quad(P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1), col, mat);
      this.quad(P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), col, mat);
      this.quad(P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0), col, mat);
    }
    // smooth grid: rows[i][j] = [x,y,z]; wrapJ closes the ring
    grid(rows, colFn, matFn, wrapJ) {
      const R = rows.length, C = rows[0].length, nor = [];
      const at = (i, j) => rows[clamp(i, 0, R - 1)][wrapJ ? ((j % C) + C) % C : clamp(j, 0, C - 1)];
      for (let i = 0; i < R; i++) { nor.push([]); for (let j = 0; j < C; j++) {
        const a = at(i, j + 1), b = at(i, j - 1), c = at(i + 1, j), d = at(i - 1, j);
        const tx = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], ty = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
        let n = [tx[1] * ty[2] - tx[2] * ty[1], tx[2] * ty[0] - tx[0] * ty[2], tx[0] * ty[1] - tx[1] * ty[0]];
        const l = Math.hypot(n[0], n[1], n[2]) || 1; nor[i].push([n[0] / l, n[1] / l, n[2] / l]);
      } }
      const V = (i, j) => { const jj = wrapJ ? j % C : j; return [rows[i][jj], nor[i][jj], colFn(i, jj), matFn ? matFn(i, jj, nor[i][jj]) : 0]; };
      const jmax = wrapJ ? C : C - 1;
      for (let i = 0; i < R - 1; i++) for (let j = 0; j < jmax; j++) {
        const q = [V(i, j), V(i + 1, j), V(i + 1, j + 1), V(i, j + 1)];
        [0, 1, 2, 0, 2, 3].forEach((k) => this.vert(q[k][0], q[k][1], q[k][2], q[k][3]));
      }
    }
    cyl(cx, cy, cz, r, len, axis, seg, col, mat, caps = true, r2 = null) {
      const rows = [];
      const mk = (t, rr) => { const ring = []; for (let k = 0; k < seg; k++) { const a = k / seg * 6.2832, c = Math.cos(a) * rr, s = Math.sin(a) * rr, u = (t - 0.5) * len;
        ring.push(axis === "x" ? [cx + u, cy + c, cz + s] : axis === "y" ? [cx + c, cy + u, cz + s] : [cx + c, cy + s, cz + u]); } return ring; };
      rows.push(mk(0, r), mk(1, r2 == null ? r : r2));
      this.grid(rows, () => col, () => mat, true);
      if (caps) for (let e = 0; e < 2; e++) {
        const ring = rows[e], ctr = axis === "x" ? [cx + (e - 0.5) * len, cy, cz] : axis === "y" ? [cx, cy + (e - 0.5) * len, cz] : [cx, cy, cz + (e - 0.5) * len];
        const n = axis === "x" ? [e ? 1 : -1, 0, 0] : axis === "y" ? [0, e ? 1 : -1, 0] : [0, 0, e ? 1 : -1];
        for (let k = 0; k < seg; k++) this.tri(ctr, ring[k], ring[(k + 1) % seg], col, mat, n);
      }
    }
    ellipsoid(cx, cy, cz, rx, ry, rz, seg, rings, col, mat, jit = 0, seed = 1) {
      const rows = [];
      for (let i = 0; i <= rings; i++) { const p = i / rings * Math.PI, row = [];
        for (let k = 0; k < seg; k++) { const a = k / seg * 6.2832, j = 1 + (rnd(seed + i * 31 + k * 7) - 0.5) * jit;
          row.push([cx + Math.sin(p) * Math.cos(a) * rx * j, cy + Math.cos(p) * ry * j, cz + Math.sin(p) * Math.sin(a) * rz * j]); }
        rows.push(row); }
      this.grid(rows, typeof col === "function" ? col : () => col, () => mat, true);
    }
    lathe(prof, seg, cx, cy, cz) {   // prof = [[r, y, [r,g,b]], ...]
      const rows = prof.map((p) => { const ring = []; for (let k = 0; k < seg; k++) { const a = k / seg * 6.2832; ring.push([cx + Math.cos(a) * p[0], cy + p[1], cz + Math.sin(a) * p[0]]); } return ring; });
      this.grid(rows, (i) => prof[i][2], () => 0, true);
    }
    prism(profile, x0, x1, col, mat) {   // profile [[z,y],...] closed, extruded along x
      const n = profile.length;
      for (let i = 0; i < n; i++) { const a = profile[i], b = profile[(i + 1) % n];
        this.quad([x0, a[1], a[0]], [x1, a[1], a[0]], [x1, b[1], b[0]], [x0, b[1], b[0]], col, mat); }
      for (let i = 1; i < n - 1; i++) {
        this.tri([x0, profile[0][1], profile[0][0]], [x0, profile[i][1], profile[i][0]], [x0, profile[i + 1][1], profile[i + 1][0]], col, mat, [-1, 0, 0]);
        this.tri([x1, profile[0][1], profile[0][0]], [x1, profile[i + 1][1], profile[i + 1][0]], [x1, profile[i][1], profile[i][0]], col, mat, [1, 0, 0]);
      }
    }
    append(o, tx = 0, ty = 0, tz = 0, ry = 0, s = 1) {
      const c = Math.cos(ry), sn = Math.sin(ry);
      for (let i = 0; i < o.v.length; i += 10) {
        const x = o.v[i] * s, y = o.v[i + 1] * s, z = o.v[i + 2] * s, nx = o.v[i + 3], nz = o.v[i + 5];
        this.v.push(x * c + z * sn + tx, y + ty, -x * sn + z * c + tz, nx * c + nz * sn, o.v[i + 4], -nx * sn + nz * c, o.v[i + 6], o.v[i + 7], o.v[i + 8], o.v[i + 9]);
      }
    }
  }

  /* ---------------------------------------------------------------- shaders */
  const VS = `attribute vec3 aPos;attribute vec3 aNor;attribute vec3 aCol;attribute float aMat;
uniform mat4 uVP;uniform mat4 uM;varying vec3 vW;varying vec3 vN;varying vec3 vC;varying float vMat;
void main(){vec4 w=uM*vec4(aPos,1.);vW=w.xyz;vN=mat3(uM)*aNor;vC=aCol;vMat=aMat;gl_Position=uVP*w;}`;
  const SKY = `
vec3 skyc(vec3 d){
  float h=clamp(d.y,0.,1.);
  vec3 hor=vec3(.93,.80,.62), zen=vec3(.08,.26,.72);
  vec3 c=mix(hor,zen,pow(h,.5));
  float s=max(dot(d,uSun),0.);
  c+=vec3(1.,.82,.55)*(pow(s,900.)*14.+pow(s,16.)*.35+pow(s,4.)*.10);
  if(d.y<0.)c=mix(hor*.85,vec3(.30,.27,.20),clamp(-d.y*4.,0.,1.));
  return c;
}`;
  const NOISE = `
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x),mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*vn(p);p*=2.03;a*=.5;}return s;}
vec3 aces(vec3 c){c=c*(2.51*c+.03)/(c*(2.43*c+.59)+.14);return pow(clamp(c,0.,1.),vec3(.4545));}`;
  const FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec3 vW;varying vec3 vN;varying vec3 vC;varying float vMat;
uniform vec3 uCam;uniform vec3 uSun;uniform float uTime;uniform float uQ;uniform float uFog;
${NOISE}${SKY}
void main(){
  vec3 tov=uCam-vW;float dist=length(tov);vec3 V=tov/dist;
  vec3 N=normalize(vN);if(dot(N,V)<0.)N=-N;
  float mt=floor(vMat+.5);
  vec3 col=vC;
  if(mt>8.){float a=smoothstep(1.,.15,length(vC.xy))*vC.z;gl_FragColor=vec4(0.,0.,0.,a);return;}
  float rough=1.,spec=0.,refl=0.,emis=0.;
  float detail=1.-smoothstep(12.,70.,dist);
  vec2 xz=vW.xz;
  if(mt>5.5&&mt<6.5){            // asphalt road
    float ax=abs(xz.x);
    vec3 asph=vec3(.115,.115,.12);
    float g=vn(xz*3.)*.5+vn(xz*14.)*.35+(uQ>.5?vn(xz*55.)*.3:0.);
    asph*=.72+g*.65*detail+g*.25*(1.-detail);
    float wear=smoothstep(.3,.7,fbm(xz*vec2(.4,.12)));asph*=.92+.16*wear;
    float lanes=smoothstep(.0,1.,abs(fract(xz.x/3.6+.5)-.5)*2.);
    asph*=1.-.18*smoothstep(.55,.9,1.-abs(ax-1.2)/1.2)*step(ax,2.6);     // tyre-worn tracks
    col=asph;
    // markings
    float dash=step(fract(xz.y/9.),.38);
    float dl=smoothstep(.12,.07,abs(abs(xz.x)-1.8))*dash;
    float edge=smoothstep(.13,.09,abs(ax-5.05));
    float mark=max(dl,edge);
    float chip=.65+.35*vn(xz*vec2(30.,30.));
    col=mix(col,vec3(.88,.86,.8)*chip,mark*.95);
    // shoulder (gravel/dirt) beyond the road
    float sh=smoothstep(5.35,5.55,ax);
    vec3 dirt=vec3(.40,.34,.24)*(.7+.6*fbm(xz*2.));
    col=mix(col,dirt,sh);
    rough=mix(.55,1.,sh);spec=mix(.35,0.,sh);refl=mix(.10,0.,sh);
  } else if(mt>6.5&&mt<7.5){     // grass / ground
    float n=fbm(xz*.35);float n2=vn(xz*3.);
    vec3 g1=vec3(.30,.36,.12),g2=vec3(.52,.47,.20),g3=vec3(.20,.28,.09);
    col=mix(g1,g2,smoothstep(.35,.7,n));col=mix(col,g3,smoothstep(.55,.9,fbm(xz*.12+9.))*.6);
    col*=.82+.35*n2*detail+.2*n2*(1.-detail);
    float ax=abs(xz.x);col=mix(vec3(.40,.34,.24)*.9,col,smoothstep(7.2,9.5,ax));
  }
  // lighting
  float ndl=max(dot(N,uSun),0.);
  vec3 H=normalize(uSun+V);float ndh=max(dot(N,H),0.);
  vec3 sunC=vec3(1.,.86,.64)*3.0;
  vec3 amb=mix(vec3(.17,.14,.11),vec3(.36,.46,.62),N.y*.5+.5)*1.15;
  float fr=pow(1.-max(dot(N,V),0.),5.);
  vec3 outc;
  if(mt<.5){outc=col*(amb+sunC*ndl*.62);}
  else if(mt<1.5){                         // glossy car paint
    vec3 diff=col*(amb*.8+sunC*ndl*.50);
    vec3 rv=reflect(-V,N);vec3 rc=skyc(vec3(rv.x,abs(rv.y)*.9+.02,rv.z));
    float F=.05+.95*fr;
    outc=mix(diff,rc*mix(vec3(1.),col*1.6+.25,.35),clamp(.05+F*.65,0.,1.));
    outc+=vec3(1.,.9,.7)*pow(ndh,140.)*2.4+vec3(1.,.9,.7)*pow(ndh,24.)*.12;
  } else if(mt<2.5){                       // glass
    vec3 rv=reflect(-V,N);vec3 rc=skyc(vec3(rv.x,abs(rv.y)*.8+.05,rv.z));
    float F=.18+.82*fr;outc=vec3(.012,.018,.024)*(amb+.4)+rc*F*.85+vec3(1.,.95,.85)*pow(ndh,200.)*3.;
  } else if(mt<3.5){outc=col*(1.8+.4*sin(uTime*14.));
  } else if(mt<4.5){outc=col*(amb*.8+sunC*ndl*.30)+vec3(.5)*pow(ndh,30.)*.06; // rubber
  } else if(mt<5.5){                       // chrome / metal
    vec3 rv=reflect(-V,N);vec3 rc=skyc(vec3(rv.x,abs(rv.y)*.85+.03,rv.z));
    outc=rc*col*1.05+col*amb*.25+vec3(1.,.95,.85)*pow(ndh,90.)*1.5;
  } else {
    outc=col*(amb+sunC*ndl*.58);
    outc+=spec*vec3(1.,.9,.75)*pow(ndh,60.)*.9;
    vec3 rv=reflect(-V,N);outc=mix(outc,skyc(vec3(rv.x,abs(rv.y)*.5+.04,rv.z)),refl*fr*1.6);
  }
  // atmospheric haze
  float f=1.-exp(-dist*uFog);f=clamp(f,0.,1.);
  vec3 hz=vec3(.90,.78,.60);
  float sunHaze=pow(max(dot(-V,uSun),0.),6.)*.35;
  outc=mix(outc,hz*(1.+sunHaze),f);
  gl_FragColor=vec4(aces(outc*.62),1.);
}`;
  const SKY_VS = `attribute vec2 aP;varying vec2 vP;void main(){vP=aP;gl_Position=vec4(aP,1.,1.);}`;
  const SKY_FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vP;uniform mat4 uInv;uniform vec3 uCam;uniform vec3 uSun;uniform float uTime;
${NOISE}${SKY}
void main(){
  vec4 p=uInv*vec4(vP,1.,1.);vec3 d=normalize(p.xyz/p.w-uCam);
  vec3 c=skyc(d);
  if(d.y>0.){
    vec2 uv=d.xz/(d.y+.22)*1.6+vec2(uTime*.012,0.);
    float cl=smoothstep(.50,.80,fbm(uv*1.3));float cl2=smoothstep(.55,.85,fbm(uv*3.1+7.));
    float shade=clamp(dot(normalize(vec3(uSun.x,0.,uSun.z)),normalize(vec3(d.x,0.,d.z)))*.5+.5,0.,1.);
    vec3 cc=mix(vec3(.62,.64,.70),vec3(1.,.95,.88),shade*.6+.35);
    c=mix(c,cc,clamp((cl*.85+cl2*.25)*smoothstep(.0,.22,d.y),0.,.9));
  }
  gl_FragColor=vec4(aces(c*.62),1.);
}`;

  /* ---------------------------------------------------------------- scene geometry */
  const paintCol = [0.02, 0.27, 0.12];

  function ringSE(hw, ybot, ytop, z, n, N = 28) {
    const ring = [], ym = (ytop + ybot) / 2, hh = (ytop - ybot) / 2, e = 2 / n;
    for (let k = 0; k < N; k++) {
      const a = k / N * 6.2832, c = Math.cos(a), s = Math.sin(a);
      ring.push([hw * Math.sign(c) * Math.pow(Math.abs(c), e), ym + hh * Math.sign(s) * Math.pow(Math.abs(s), e), z]);
    }
    return ring;
  }
  function capRows(rows) {   // collapse first & last rings to centers so the loft is closed
    const c = (r) => { const m = [0, 0, 0]; r.forEach((p) => { m[0] += p[0]; m[1] += p[1]; m[2] += p[2]; }); return r.map(() => [m[0] / r.length, m[1] / r.length, m[2] / r.length]); };
    return [c(rows[0]), ...rows, c(rows[rows.length - 1])];
  }

  function buildCar() {
    const b = new MB();
    // body (z from rear -2.25 to front +2.25, +z is forward)
    const zs = [-2.26, -2.22, -2.0, -1.5, -0.7, 0, 0.7, 1.3, 1.8, 2.1, 2.24];
    const hw = [0.74, 0.86, 0.93, 0.95, 0.96, 0.96, 0.95, 0.93, 0.88, 0.78, 0.62];
    const yb = [0.30, 0.26, 0.22, 0.20, 0.20, 0.20, 0.20, 0.20, 0.21, 0.24, 0.30];
    const yt = [0.70, 0.86, 0.90, 0.93, 0.94, 0.94, 0.92, 0.86, 0.75, 0.63, 0.50];
    let rows = zs.map((z, i) => ringSE(hw[i], yb[i], yt[i], z, 4.4));
    b.grid(capRows(rows), () => paintCol, () => MAT.paint, true);
    // cabin / greenhouse
    const cz = [-1.18, -0.95, -0.5, 0.1, 0.62, 0.98];
    const chw = [0.60, 0.68, 0.72, 0.70, 0.62, 0.52];
    const cyb = [0.90, 0.92, 0.94, 0.94, 0.90, 0.84];
    const cyt = [0.98, 1.20, 1.31, 1.27, 1.08, 0.88];
    rows = cz.map((z, i) => ringSE(chw[i], cyb[i], cyt[i], z, 3.0));
    b.grid(capRows(rows), () => paintCol, (i, j, n) => (n[1] > 0.78 ? MAT.paint : MAT.glass), true);
    // wheels
    const W = new MB();
    W.cyl(0, 0, 0, 0.345, 0.26, "x", 24, [0.025, 0.025, 0.028], MAT.rubber, true);
    W.cyl(0.131, 0, 0, 0.225, 0.02, "x", 24, [0.75, 0.76, 0.8], MAT.chrome, true);
    for (let k = 0; k < 5; k++) { const a = k / 5 * 6.2832; W.box(0.142, Math.sin(a) * 0.115, Math.cos(a) * 0.115, 0.012, 0.03, 0.2, [0.12, 0.12, 0.13], MAT.chrome); }
    W.cyl(0.14, 0, 0, 0.05, 0.02, "x", 12, [0.5, 0.5, 0.52], MAT.chrome, true);
    // details (rear is what the camera sees)
    const d = b;
    d.box(0, 0.70, -2.245, 1.25, 0.07, 0.03, [1, 0.05, 0.03], MAT.emit);               // tail-light bar
    d.box(-0.62, 0.62, -2.245, 0.32, 0.10, 0.04, [1, 0.06, 0.04], MAT.emit); d.box(0.62, 0.62, -2.245, 0.32, 0.10, 0.04, [1, 0.06, 0.04], MAT.emit);
    d.box(0, 0.50, -2.262, 0.52, 0.13, 0.03, [0.93, 0.93, 0.9], MAT.matte);              // number plate
    d.box(0, 0.50, -2.28, 0.46, 0.07, 0.01, [0.1, 0.1, 0.45], MAT.matte);
    d.box(0, 0.30, -2.12, 1.15, 0.10, 0.2, [0.03, 0.03, 0.035], MAT.matte);               // diffuser
    d.cyl(-0.5, 0.31, -2.25, 0.05, 0.14, "z", 12, [0.8, 0.8, 0.85], MAT.chrome, true);
    d.cyl(0.5, 0.31, -2.25, 0.05, 0.14, "z", 12, [0.8, 0.8, 0.85], MAT.chrome, true);
    d.box(0, 1.02, -1.98, 1.62, 0.045, 0.34, [0.03, 0.035, 0.04], MAT.paint);            // spoiler wing
    d.box(-0.55, 0.93, -1.98, 0.05, 0.13, 0.2, [0.03, 0.035, 0.04], MAT.paint); d.box(0.55, 0.93, -1.98, 0.05, 0.13, 0.2, [0.03, 0.035, 0.04], MAT.paint);
    d.box(-0.82, 0.2, 0, 0.1, 0.12, 3.2, [0.02, 0.02, 0.025], MAT.matte); d.box(0.82, 0.2, 0, 0.1, 0.12, 3.2, [0.02, 0.02, 0.025], MAT.matte); // skirts
    d.box(-0.95, 1.0, 0.55, 0.14, 0.1, 0.2, paintCol, MAT.paint); d.box(0.95, 1.0, 0.55, 0.14, 0.1, 0.2, paintCol, MAT.paint);                   // mirrors
    d.box(0, 0.40, 2.21, 1.1, 0.16, 0.06, [0.02, 0.02, 0.025], MAT.matte);                // front intake
    d.box(-0.66, 0.60, 2.1, 0.4, 0.08, 0.1, [1, 0.97, 0.85], MAT.emit); d.box(0.66, 0.60, 2.1, 0.4, 0.08, 0.1, [1, 0.97, 0.85], MAT.emit); // headlights
    d.box(0, 0.16, 0, 1.3, 0.05, 3.6, [0.01, 0.01, 0.012], MAT.matte);                     // under body
    return { body: b, wheel: W };
  }

  function buildObstacles() {
    const out = {};
    // jersey barrier striped red/white
    let b = new MB();
    const prof = [[-0.32, 0], [0.32, 0], [0.32, 0.17], [0.13, 0.78], [-0.13, 0.78], [-0.32, 0.17]];
    for (let i = 0; i < 9; i++) {
      const x0 = -1.62 + i * 0.36, red = i % 2 === 0;
      b.prism(prof, x0, x0 + 0.36, red ? [0.78, 0.07, 0.06] : [0.92, 0.91, 0.88], MAT.paint);
    }
    b.box(-1.5, 0.84, 0, 0.14, 0.12, 0.14, [1, 0.6, 0.05], MAT.emit); b.box(1.5, 0.84, 0, 0.14, 0.12, 0.14, [1, 0.6, 0.05], MAT.emit);
    b.box(0, 0.4, 0.33, 3.2, 0.2, 0.01, [0.9, 0.9, 0.9], MAT.matte);
    out.barrier = b;
    // cone cluster
    b = new MB();
    const cone = [[0.30, 0, [1, .33, .04]], [0.27, 0.05, [1, .33, .04]], [0.17, 0.30, [1, .33, .04]], [0.155, 0.31, [.95, .95, .95]], [0.125, 0.45, [.95, .95, .95]], [0.115, 0.46, [1, .33, .04]], [0.04, 0.73, [1, .33, .04]], [0.0, 0.74, [1, .33, .04]]];
    [[-1.1, 0.2], [0, -0.5], [1.1, 0.3], [-0.5, 1.2], [0.6, 1.1]].forEach(([x, z]) => {
      b.box(x, 0.02, z, 0.6, 0.04, 0.6, [0.03, 0.03, 0.03], MAT.rubber);
      b.lathe(cone, 14, x, 0.03, z);
    });
    out.cones = b;
    // broken-down box truck
    b = new MB();
    b.box(0, 1.9, -0.9, 2.5, 2.5, 5.2, [0.88, 0.89, 0.9], MAT.paint);
    b.box(0, 1.45, 2.4, 2.4, 1.9, 1.7, [0.1, 0.25, 0.65], MAT.paint);
    b.box(0, 2.0, 3.27, 2.1, 0.8, 0.05, [0.02, 0.03, 0.04], MAT.glass);
    b.box(0, 0.75, -3.52, 2.6, 0.3, 0.2, [0.05, 0.05, 0.05], MAT.matte);
    b.box(0, 1.9, -3.52, 2.2, 2.0, 0.04, [0.8, 0.8, 0.82], MAT.matte);
    b.box(-1.0, 0.95, -3.55, 0.28, 0.2, 0.05, [1, 0.05, 0.03], MAT.emit); b.box(1.0, 0.95, -3.55, 0.28, 0.2, 0.05, [1, 0.05, 0.03], MAT.emit);
    b.box(0, 2.6, -1.0, 2.52, 0.5, 5.22, [0.85, 0.12, 0.1], MAT.paint);
    [[-1.2, -2.4], [1.2, -2.4], [-1.2, -1.1], [1.2, -1.1], [-1.2, 2.5], [1.2, 2.5]].forEach(([x, z]) => b.cyl(x, 0.5, z, 0.5, 0.34, "x", 16, [0.03, 0.03, 0.03], MAT.rubber, true));
    b.box(0, 0.42, 0, 2.2, 0.35, 8, [0.05, 0.05, 0.05], MAT.matte);
    out.truck = b;
    return out;
  }

  function buildFinish(len) {
    const b = new MB(), z = len * K;
    for (let i = 0; i < 18; i++) for (let j = 0; j < 2; j++) {
      const c = (i + j) % 2 ? [0.02, 0.02, 0.02] : [0.95, 0.95, 0.95];
      b.box(-5.4 + 0.3 + i * 0.6, 0.012, z + j * 0.6, 0.6, 0.012, 0.6, c, MAT.matte);
    }
    b.box(-6.2, 3.2, z, 0.5, 6.4, 0.5, [0.25, 0.26, 0.3], MAT.paint); b.box(6.2, 3.2, z, 0.5, 6.4, 0.5, [0.25, 0.26, 0.3], MAT.paint);
    b.box(0, 6.4, z, 13.4, 1.5, 0.45, [0.12, 0.12, 0.14], MAT.paint);
    for (let i = 0; i < 26; i++) for (let j = 0; j < 2; j++) {
      const c = (i + j) % 2 ? [0.03, 0.03, 0.03] : [0.97, 0.97, 0.97];
      b.box(-6.0 + 0.24 + i * 0.46, 6.1 + j * 0.5, z - 0.24, 0.46, 0.5, 0.03, c, MAT.matte);
    }
    b.box(0, 7.5, z, 6, 0.6, 0.3, [0.85, 0.1, 0.08], MAT.emit);
    const s = new MB();
    for (let i = 0; i < 18; i++) s.box(-5.4 + 0.3 + i * 0.6, 0.012, 0.3, 0.6, 0.012, 0.6, i % 2 ? [0.03, 0.03, 0.03] : [0.95, 0.95, 0.95], MAT.matte);
    return { fin: b, start: s };
  }

  function buildChunk(seed, len) {
    const b = new MB();
    // acacia trees + bushes
    const n = 9;
    for (let i = 0; i < n; i++) {
      const side = rnd(seed * 13 + i) < 0.5 ? -1 : 1, x = side * (9 + rnd(seed * 7 + i * 3) * 40), z = rnd(seed * 5 + i * 11) * len;
      const t = rnd(seed + i * 17), s = 0.8 + t * 0.9;
      if (t < 0.28) {   // bush
        b.ellipsoid(x, 0.45 * s, z, 1.2 * s, 0.6 * s, 1.1 * s, 10, 6, [0.20 + t * .1, 0.30, 0.10], MAT.matte, 0.35, seed + i);
      } else {          // acacia
        const tr = new MB();
        tr.cyl(0, 1.7 * s, 0, 0.14 * s, 3.4 * s, "y", 8, [0.25, 0.17, 0.10], MAT.matte, false, 0.09 * s);
        tr.cyl(0.5 * s, 3.4 * s, 0, 0.07 * s, 1.6 * s, "x", 6, [0.25, 0.17, 0.10], MAT.matte, false);
        b.append(tr, x, 0, z, 0, 1);
        const can = (cx, cy, cz, r) => b.ellipsoid(cx, cy, cz, r * 1.9, r * 0.5, r * 1.7, 12, 6, (i2, j) => [0.18 + 0.06 * rnd(j + i2 * 3 + seed), 0.30 + 0.08 * rnd(j * 2 + i2), 0.09], MAT.matte, 0.28, seed * 3 + i);
        can(x, 3.7 * s, z, 1.5 * s); can(x + 1.5 * s, 3.5 * s, z + 0.5 * s, 1.0 * s);
      }
    }
    // roadside bollards with reflective band, every 12 m
    for (let z = 3; z < len; z += 12) for (const sx of [-1, 1]) {
      b.cyl(sx * 6.1, 0.45, z, 0.07, 0.9, "y", 8, [0.93, 0.93, 0.9], MAT.matte, true);
      b.cyl(sx * 6.1, 0.65, z, 0.075, 0.14, "y", 8, [0.9, 0.1, 0.08], MAT.matte, true);
    }
    // power pole on the right
    const pz = (rnd(seed * 31) * 0.5 + 0.2) * len;
    b.cyl(8.6, 4.5, pz, 0.14, 9, "y", 8, [0.30, 0.22, 0.15], MAT.matte, true);
    b.box(8.6, 8.6, pz, 0.12, 0.12, 2.2, [0.25, 0.2, 0.14], MAT.matte);
    b.box(8.6, 8.2, pz, 0.12, 0.1, 1.6, [0.25, 0.2, 0.14], MAT.matte);
    b.box(8.6, 8.7, pz, 0.05, 0.05, len, [0.04, 0.04, 0.04], MAT.matte);
    // a couple of rocks
    for (let i = 0; i < 3; i++) b.ellipsoid(side(i) * (8 + rnd(seed + i * 5) * 16), 0.3, rnd(seed * 3 + i * 7) * len, 0.7 + rnd(i + seed) * 0.7, 0.4, 0.6, 8, 5, [0.42, 0.38, 0.32], MAT.matte, 0.35, i + seed);
    return b;
    function side(i) { return rnd(seed * 9 + i) < 0.5 ? -1 : 1; }
  }

  function buildMountains() {
    const b = new MB();
    for (let i = 0; i < 14; i++) {
      const x = (i - 6.5) * 150 + (rnd(i) - 0.5) * 70, h = 60 + rnd(i + 5) * 120, w = 90 + rnd(i + 9) * 110;
      const col = (i2, j) => { const k = i2 / 7; return [0.40 - 0.1 * k + 0.05 * rnd(j + i), 0.36 - 0.08 * k, 0.30 - 0.05 * k]; };
      b.ellipsoid(x, -h * 0.15, 0, w, h, w * 0.7, 14, 8, col, MAT.matte, 0.22, i * 11);
    }
    return b;
  }

  /* ---------------------------------------------------------------- renderer */
  function create(canvas) {
    let gl = null;
    try { gl = canvas.getContext("webgl", { antialias: true, alpha: false, powerPreference: "high-performance" }) || canvas.getContext("experimental-webgl"); } catch (e) {}
    if (!gl) return null;
    const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = (vs, fs) => { const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; };
    let P, PS;
    try { P = prog(VS, FS); PS = prog(SKY_VS, SKY_FS); } catch (e) { try { console.log("race3d shader error", e.message); } catch (x) {} return null; }
    const U = (p, n) => gl.getUniformLocation(p, n);
    const u = { vp: U(P, "uVP"), m: U(P, "uM"), cam: U(P, "uCam"), sun: U(P, "uSun"), time: U(P, "uTime"), q: U(P, "uQ"), fog: U(P, "uFog") };
    const us = { inv: U(PS, "uInv"), cam: U(PS, "uCam"), sun: U(PS, "uSun"), time: U(PS, "uTime") };
    const sunDir = (() => { const v = [-0.55, 0.50, -0.42], l = Math.hypot(...v); return v.map((x) => x / l); })();

    const upload = (mb) => { const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mb.v), gl.STATIC_DRAW); return { buf, n: mb.v.length / 10 }; };
    const car = buildCar(), obs = buildObstacles();
    const M = { body: upload(car.body), wheel: upload(car.wheel), barrier: upload(obs.barrier), cones: upload(obs.cones), truck: upload(obs.truck) };
    const CH = 96, chunks = [];
    for (let i = 0; i < 8; i++) chunks.push(upload(buildChunk(i + 1, CH)));
    M.mount = upload(buildMountains());
    // road + ground + shadow quads
    const rb = new MB(); rb.quad([-ROAD_HALF - 3, 0.01, -80], [ROAD_HALF + 3, 0.01, -80], [ROAD_HALF + 3, 0.01, 700], [-ROAD_HALF - 3, 0.01, 700], [0.1, 0.1, 0.1], MAT.road); M.road = upload(rb);
    const gb = new MB(); gb.quad([-900, 0, -300], [900, 0, -300], [900, 0, 900], [-900, 0, 900], [0.3, 0.35, 0.12], MAT.ground); M.ground = upload(gb);
    const sb = new MB(); sb.quad([-1, 0.03, -1], [1, 0.03, -1], [1, 0.03, 1], [-1, 0.03, 1], [0, 0, 0.7], MAT.blob);
    // blob needs uv in col.xy: rebuild with explicit verts
    sb.v = []; const bv = (x, z, cx, cy) => sb.vert([x, 0.03, z], [0, 1, 0], [cx, cy, 0.72], MAT.blob);
    bv(-1, -1, -1, -1); bv(1, -1, 1, -1); bv(1, 1, 1, 1); bv(-1, -1, -1, -1); bv(1, 1, 1, 1); bv(-1, 1, -1, 1); M.blob = upload(sb);
    let fin = null, trackKey = null, track = [], trackLen = 2200;
    const skyBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    const R = { gl, ok: true, quality: 1, dpr: 1, frames: 0, slow: 0, lastT: 0 };
    R.setTrack = (tr, len) => { track = tr; trackLen = len; fin = (() => { const f = buildFinish(len); return { fin: upload(f.fin), start: upload(f.start) }; })(); };
    R.resize = (w, h, dpr) => {
      R.dpr = dpr; canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    };
    const attr = (name) => gl.getAttribLocation(P, name);
    const aPos = attr("aPos"), aNor = attr("aNor"), aCol = attr("aCol"), aMat = attr("aMat");
    const bind = (m) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, m.buf);
      gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 40, 0);
      gl.enableVertexAttribArray(aNor); gl.vertexAttribPointer(aNor, 3, gl.FLOAT, false, 40, 12);
      gl.enableVertexAttribArray(aCol); gl.vertexAttribPointer(aCol, 3, gl.FLOAT, false, 40, 24);
      gl.enableVertexAttribArray(aMat); gl.vertexAttribPointer(aMat, 1, gl.FLOAT, false, 40, 36);
    };
    const draw = (m, M4) => { bind(m); gl.uniformMatrix4fv(u.m, false, M4); gl.drawArrays(gl.TRIANGLES, 0, m.n); };

    /* p = { z (track units travelled), x (lateral lane position 0..2, fractional), yaw, bounce, shake, time (s), hits:{idx:age}, speed (0..1) } */
    R.render = (p) => {
      const W = canvas.width, H = canvas.height;
      gl.viewport(0, 0, W, H);
      const cz = p.z * K, cx = (p.x - 1) * LANE;
      const sh = p.shake || 0, shx = (Math.random() - 0.5) * 0.25 * sh, shy = (Math.random() - 0.5) * 0.18 * sh;
      const cam = [cx * 0.72 + shx, 2.35 + 0.05 * Math.sin(p.time * 9) * p.speed + shy, cz - 6.3];
      const tgt = [cx * 0.4, 1.05, cz + 9];
      const fov = (56 + 7 * p.speed) * Math.PI / 180;
      const proj = m4.persp(fov, W / H, 0.2, 1800), view = m4.look(cam, tgt, [0, 1, 0]), vp = m4.mul(proj, view);
      gl.clearColor(0.8, 0.7, 0.55, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      // sky
      gl.disable(gl.DEPTH_TEST); gl.useProgram(PS);
      gl.uniformMatrix4fv(us.inv, false, m4.inv(vp)); gl.uniform3fv(us.cam, cam); gl.uniform3fv(us.sun, sunDir); gl.uniform1f(us.time, p.time);
      const ap = gl.getAttribLocation(PS, "aP");
      for (let i = 0; i < 4; i++) gl.disableVertexAttribArray(i);
      gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3); gl.disableVertexAttribArray(ap);
      // world
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
      gl.useProgram(P);
      gl.uniformMatrix4fv(u.vp, false, vp); gl.uniform3fv(u.cam, cam); gl.uniform3fv(u.sun, sunDir);
      gl.uniform1f(u.time, p.time); gl.uniform1f(u.q, R.quality); gl.uniform1f(u.fog, 0.0023);
      draw(M.ground, m4.model(0, -0.02, cz));
      draw(M.road, m4.model(0, 0, Math.floor(cz / 100) * 100, 0, 0, 0, 1));
      if (fin) { draw(fin.start, m4.model(0, 0, 0)); draw(fin.fin, m4.id()); }
      // mountains
      draw(M.mount, m4.model(cx * 0.9, 0, cz + 1150, 0, 0, 0, 1));
      // roadside chunks
      const c0 = Math.floor((cz - 40) / CH);
      for (let i = c0; i < c0 + 8; i++) draw(chunks[((i % 8) + 8) % 8], m4.model(0, 0, i * CH));
      // obstacles
      for (let i = 0; i < track.length; i++) {
        const [d, ln] = track[i], oz = d * K;
        if (oz < cz - 12 || oz > cz + 320) continue;
        const ox = (ln - 1) * LANE, type = Math.floor(rnd(d * 3.1 + ln) * 3);
        const age = p.hits && p.hits[i] != null ? p.hits[i] : -1;
        let tx = ox, ty = 0, tz = oz, ry = 0, rx = 0, rz = 0;
        if (age >= 0) {
          if (age > 1.4) continue;
          const sgn = rnd(i + 3) < 0.5 ? -1 : 1;
          tx += sgn * age * 7; ty = Math.max(0, 5 * age - 7 * age * age); tz += age * 12; ry = sgn * age * 6; rz = sgn * age * 4; rx = age * 3;
        }
        const mesh = type === 0 ? M.barrier : type === 1 ? M.cones : M.truck;
        draw(mesh, m4.model(tx, ty, tz, ry, rx, rz, 1));
      }
      // car
      const yaw = p.yaw || 0, bounce = p.bounce || 0, roll = -(p.yaw || 0) * 0.18;
      const cy0 = 0.0 + bounce;
      const carM = (dx, dy, dz) => m4.model(cx, cy0, cz, yaw, 0, roll, 1);
      draw(M.body, carM());
      const wheelAt = (wx, wz, flip) => {
        const wm = m4.model(0, 0, 0, 0, 0, 0, 1); // placeholder
        // build: carM * T(wx,0.345,wz) * Rx(spin) * (flip about y)
        const spin = p.wheel || 0;
        const rot = m4.model(0, 0, 0, flip ? Math.PI : 0, spin * (flip ? -1 : 1), 0, 1);
        const T = m4.model(wx, 0.345, wz, 0, 0, 0, 1);
        return m4.mul(carM(), m4.mul(T, rot));
      };
      draw(M.wheel, wheelAt(-0.9, 1.38, true)); draw(M.wheel, wheelAt(0.9, 1.38, false));
      draw(M.wheel, wheelAt(-0.9, -1.38, true)); draw(M.wheel, wheelAt(0.9, -1.38, false));
      // blob shadows (blended)
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      const bs = (x, z, sx, sz) => { const m = m4.model(x, 0, z, 0, 0, 0, 1); m[0] = sx; m[10] = sz; draw(M.blob, m); };
      bs(cx, cz, 1.25, 2.6);
      for (let i = 0; i < track.length; i++) {
        const [d, ln] = track[i], oz = d * K; if (oz < cz - 8 || oz > cz + 120) continue;
        if (p.hits && p.hits[i] != null) continue;
        const type = Math.floor(rnd(d * 3.1 + ln) * 3);
        bs((ln - 1) * LANE, oz, type === 2 ? 1.7 : 1.9, type === 2 ? 4.2 : type === 1 ? 1.9 : 0.6);
      }
      gl.depthMask(true); gl.disable(gl.BLEND);
      // auto quality: drop to low when frames are slow
      const now = performance.now();
      if (R.lastT) { const dt = now - R.lastT; if (dt > 45) R.slow++; else R.slow = Math.max(0, R.slow - 1); if (R.slow > 25 && R.quality > 0) { R.quality = 0; R.onLow && R.onLow(); R.slow = 0; } }
      R.lastT = now; R.frames++;
    };
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); R.ok = false; R.onLost && R.onLost(); });
    return R;
  }
  return { create, K, LANE };
})();
