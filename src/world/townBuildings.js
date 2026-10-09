import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { addOutline } from '../kit/toon.js';
import { texturedToon, surfaceUV } from '../kit/textures.js';
import { COLORS as K, mix } from '../core/tokens.js';
import { BUILDINGS } from '../core/layout.js';

// The five Rendi Town buildings (Products, About, How we work, News, Post) with real roofs, trim,
// hand-painted textures (src/kit/textures.js) and lots of small cosy detail.
//
// Draw-call strategy (whole building set = ~18 calls):
//   * every flat-coloured outlined part -> ONE vertex-coloured toon mesh
//   * every unlit part (glass, glow, bulbs, silhouettes) -> ONE vertex-coloured basic mesh
//   * textured parts -> one mesh per (kind, base colour)
//   * every black outline -> ONE merged inverted hull
//   * sign atlas -> one mesh, window glass overlay -> one transparent mesh
// Everything is built in building-local space (origin = footprint centre, +Z = front/door, +X = east),
// moved into TOWN-LOCAL space by `T` right before a part is stored.

const OUT = 0.03;
const UPR = 1.4; // world units per texture repeat (32px) -> ~2px texels on screen

// ------------------------------------------------------------------ palette (brand mixes only)
const P = {
  white: K.white,
  black: K.black,
  wall: K.wall,
  wallTex: mix(K.lavender, K.white, 0.45),
  cream: mix(K.yellow, K.white, 0.62),
  lilac: mix(K.lavender, K.mascot, 0.5),
  wood: K.wood,
  woodLight: mix(K.wood, K.yellow, 0.4),
  woodDark: mix(K.wood, K.black, 0.3),
  stone: mix(K.lavender, K.black, 0.06),
  found: mix(K.lavender, K.black, 0.3),
  pipe: mix(K.lavender, K.black, 0.4),
  iron: mix(K.lavender, K.black, 0.7),
  brick: mix(K.red, K.lavender, 0.22),
  clay: mix(K.red, K.yellow, 0.12),
  leaf: K.sage,
  leafLight: mix(K.sage, K.white, 0.3),
  leafDark: mix(K.sage, K.black, 0.16),
  glass: mix(K.yellow, K.white, 0.5),
  glow: mix(K.yellow, K.white, 0.18),
  glowSoft: mix(K.yellow, K.white, 0.62),
  floorWarm: mix(K.yellow, K.wood, 0.45),
  sil: mix(K.purple, K.black, 0.6),
  silLight: mix(K.lavender, K.white, 0.45),
  doorPurple: K.purple,
  roofPurple: K.purple,
  roofYellow: mix(K.yellow, K.wood, 0.12),
  roofRed: mix(K.red, K.purple, 0.1),
  paper: mix(K.white, K.yellow, 0.14),
  cardboard: mix(K.yellow, K.wood, 0.55),
};
const FLOWER = [K.red, K.yellow, K.purple, K.white];

// ------------------------------------------------------------------ geometry + matrix helpers
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const mat4 = (p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) =>
  new THREE.Matrix4().compose(_v.set(p[0], p[1], p[2]), _q.setFromEuler(_e.set(r[0], r[1], r[2])), _s.set(s[0], s[1], s[2]));
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, seg = 10) => new THREE.CylinderGeometry(rt, rb, h, seg);
const blob = (rx, ry = rx, rz = rx, detail = 1) => new THREE.IcosahedronGeometry(1, detail).scale(rx, ry, rz);
const plane = (w, h) => new THREE.PlaneGeometry(w, h);
const flatPlane = (w, d) => new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);

/** rotate (Euler XYZ) + translate in the local frame, then (optionally) into a face frame `F`. */
function at(g, p = [0, 0, 0], r = [0, 0, 0], F = null) {
  g.applyMatrix4(mat4(p, r));
  if (F) g.applyMatrix4(F);
  return g;
}

/** Box oriented from p0 to p1 (w x h cross-section). */
function beam(p0, p1, w, h) {
  const a = new THREE.Vector3(...p0), b = new THREE.Vector3(...p1);
  const len = a.distanceTo(b);
  const dir = b.clone().sub(a).normalize();
  const up = Math.abs(dir.y) > 0.98 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), dir.clone().negate(), up);
  m.setPosition(a.clone().add(b).multiplyScalar(0.5));
  return box(w, h, len).applyMatrix4(m);
}

// ------------------------------------------------------------------ buckets
let T = new THREE.Matrix4();
let flatGeos, basicGeos, glassGeos, plateGeos, hullGeos, texBuckets;
function resetBuckets() {
  flatGeos = []; basicGeos = []; glassGeos = []; plateGeos = []; hullGeos = []; texBuckets = new Map();
}

const _c = new THREE.Color();
function paint(g, hex) {
  _c.setHex(hex);
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function prep(g, keepUV) {
  const out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'normal' && !(keepUV && name === 'uv')) out.deleteAttribute(name);
  }
  return out;
}
function addHull(g) {
  const h = new THREE.BufferGeometry();
  h.setAttribute('position', g.getAttribute('position').clone());
  const m = mergeVertices(h, 1e-4);
  m.computeVertexNormals();
  hullGeos.push(m);
}

/** flat brand colour, toon-lit; `o` = gets a black outline */
function flat(color, g, o = true) {
  g.applyMatrix4(T);
  const out = paint(prep(g, false), color);
  flatGeos.push(out);
  if (o) addHull(out);
  return g;
}
/** hand-painted texture (world-scale UVs on the final geometry) */
function tex(kind, base, upr, g, o = true) {
  g.applyMatrix4(T);
  surfaceUV(g, upr);
  const out = prep(g, true);
  const key = `${kind}|${base}`;
  if (!texBuckets.has(key)) texBuckets.set(key, { kind, base, geos: [] });
  texBuckets.get(key).geos.push(out);
  if (o) addHull(out);
  return g;
}
/** unlit colour (glass, glow, bulbs, silhouettes) */
function basic(color, g) {
  g.applyMatrix4(T);
  basicGeos.push(paint(prep(g, false), color));
  return g;
}
function glassT(g) {
  g.applyMatrix4(T);
  glassGeos.push(prep(g, false));
  return g;
}

// shorthand placers: building-local (BX/TBX) or inside a face frame M (FB/FT)
const BX = (color, w, h, d, x, y0, z, o = true, r = [0, 0, 0]) => flat(color, at(box(w, h, d), [x, y0 + h / 2, z], r), o);
const TBX = (kind, base, w, h, d, x, y0, z, o = true, r = [0, 0, 0], upr = UPR) =>
  tex(kind, base, upr, at(box(w, h, d), [x, y0 + h / 2, z], r), o);
const FB = (M, color, w, h, d, u, y0, v, o = true, r = [0, 0, 0]) => flat(color, at(box(w, h, d), [u, y0 + h / 2, v], r, M), o);
const FT = (M, kind, base, w, h, d, u, y0, v, o = true, upr = UPR) => tex(kind, base, upr, at(box(w, h, d), [u, y0 + h / 2, v], [0, 0, 0], M), o);
const FPl = (M, color, w, h, u, y, v, rz = 0) => flat(color, at(plane(w, h), [u, y, v], [0, 0, rz], M), false);
const FBas = (M, color, w, h, u, y, v, rz = 0) => basic(color, at(plane(w, h), [u, y, v], [0, 0, rz], M));
const FBlob = (M, color, r, u, y, v, o = false, sy = 1) => flat(color, at(blob(r, r * sy, r, 0), [u, y, v], [0, 0, 0], M), o);
const FCyl = (M, color, rt, rb, h, u, y, v, rot = [0, 0, 0], o = true, seg = 10) => flat(color, at(cyl(rt, rb, h, seg), [u, y, v], rot, M), o);

// face frames (u runs along the face, v out of it)
const frameF = (b) => mat4([0, 0, b.d / 2]);
const frameE = (b) => mat4([b.w / 2, 0, 0], [0, Math.PI / 2, 0]);

// ------------------------------------------------------------------ signs (own atlas, Montserrat 800 italic)
const AW = 2048, AH = 1312;
const SIGN = {
  products: { x: 0, y: 0, w: 1792, h: 416, ww: 4.9, wh: 1.14, text: 'PRODUCTS', fill: K.yellow },
  about: { x: 0, y: 432, w: 800, h: 300, ww: 1.5, wh: 0.5625, text: 'About', fill: K.white },
  how: { x: 816, y: 432, w: 1100, h: 300, ww: 2.05, wh: 0.56, text: 'How we work', fill: mix(K.purple, K.white, 0.4) },
  news: { x: 0, y: 748, w: 640, h: 300, ww: 1.2, wh: 0.5625, text: 'News', fill: K.yellow },
  post: { x: 656, y: 748, w: 640, h: 300, ww: 1.2, wh: 0.5625, text: 'Post', fill: K.white },
  n1: { x: 0, y: 1064, w: 240, h: 240, ww: 0.3, wh: 0.3, text: '1', fill: K.white, num: true },
  n3: { x: 260, y: 1064, w: 240, h: 240, ww: 0.3, wh: 0.3, text: '3', fill: K.white, num: true },
  n5: { x: 520, y: 1064, w: 240, h: 240, ww: 0.3, wh: 0.3, text: '5', fill: K.white, num: true },
  n7: { x: 780, y: 1064, w: 240, h: 240, ww: 0.3, wh: 0.3, text: '7', fill: K.white, num: true },
  n9: { x: 1040, y: 1064, w: 240, h: 240, ww: 0.3, wh: 0.3, text: '9', fill: K.white, num: true },
};
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;

function makeAtlas() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = AW; canvas.height = AH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const tex2 = new THREE.CanvasTexture(canvas);
  tex2.colorSpace = THREE.SRGBColorSpace;
  tex2.anisotropy = 8;
  const draw = () => {
    ctx.clearRect(0, 0, AW, AH);
    for (const s of Object.values(SIGN)) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(6, s.h * 0.035);
      ctx.strokeStyle = hex(K.black);
      ctx.fillStyle = hex(s.fill);
      const pad = ctx.lineWidth;
      ctx.beginPath();
      ctx.roundRect(pad, pad, s.w - 2 * pad, s.h - 2 * pad, s.h * 0.16);
      ctx.fill();
      ctx.stroke();
      if (!s.num) { // painted inner border line
        ctx.lineWidth = Math.max(3, s.h * 0.014);
        ctx.strokeStyle = hex(mix(s.fill, K.black, 0.45));
        ctx.beginPath();
        ctx.roundRect(pad * 3, pad * 3, s.w - 6 * pad, s.h - 6 * pad, s.h * 0.1);
        ctx.stroke();
      }
      ctx.fillStyle = s.num ? hex(K.red) : hex(K.black);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let fs = s.h * (s.num ? 0.66 : 0.52);
      const maxW = s.w * 0.84;
      ctx.font = `italic 800 ${fs}px Montserrat, system-ui, sans-serif`;
      const mw = ctx.measureText(s.text).width;
      if (mw > maxW) { fs *= maxW / mw; ctx.font = `italic 800 ${fs}px Montserrat, system-ui, sans-serif`; }
      ctx.fillText(s.text, s.w / 2, s.h / 2 + fs * 0.05);
      ctx.restore();
    }
    tex2.needsUpdate = true;
  };
  draw();
  if (document.fonts?.load) document.fonts.load('italic 800 64px Montserrat').then(draw).catch(() => {});
  return tex2;
}

/** flat sign plate from the atlas, facing +Z rotated by ry about Y, centred at p (building-local) */
function plate(id, p, ry = 0, scale = 1, F = null) {
  const s = SIGN[id];
  const g = new THREE.PlaneGeometry(s.ww * scale, s.wh * scale);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (s.x + uv.getX(i) * s.w) / AW, 1 - (s.y + (1 - uv.getY(i)) * s.h) / AH);
  }
  at(g, p, [0, ry, 0], F);
  g.applyMatrix4(T);
  plateGeos.push(g);
}

// ------------------------------------------------------------------ building parts
/** Shared mass: textured walls, foundation band + ledge, corner boards, top plate. */
function walls(w, d, H, kind, base, { corner = P.white, plate: top = P.white } = {}) {
  tex(kind, base, UPR, at(box(w, H, d), [0, H / 2, 0]), true);
  tex('foundation', P.found, UPR, at(box(w + 0.12, 0.42, d + 0.12), [0, 0.21, 0]), true);
  BX(P.stone, w + 0.2, 0.07, d + 0.2, 0, 0.4, 0, true);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) BX(corner, 0.17, H - 0.46, 0.17, sx * (w / 2 + 0.005), 0.46, sz * (d / 2 + 0.005), true);
  BX(top, w + 0.14, 0.14, d + 0.14, 0, H - 0.14, 0, true);
}

/** slope height of a gable roof (ridge along X) at depth z */
const gableY = (R, z) => R.y0 + (R.a - Math.abs(z)) * R.k;

function gableRoof(o) {
  const { w, d, y0, h, ox, oz, kind, base, trim = P.white, gKind, gBase, ridgeColor = null } = o;
  const a = d / 2 + oz, L = w + 2 * ox, t = 0.14;
  const th = Math.atan2(h, a), cs = Math.cos(th), sn = Math.sin(th);
  const ls = Math.hypot(a, h) + 0.04;
  const ridge = ridgeColor ?? mix(base, K.black, 0.22);
  for (const s of [1, -1]) {
    // slab: top surface follows the slope line
    tex(kind, base, UPR, at(box(L, t, ls), [0, y0 + h / 2 - (t / 2) * cs, s * (a / 2 - (t / 2) * sn)], [s * th, 0, 0]), true);
    // eave fascia board + gutter
    BX(trim, L + 0.04, 0.2, 0.06, 0, y0 - 0.12, s * (a - 0.01), true);
    flat(P.pipe, at(cyl(0.065, 0.065, L, 8), [0, y0 - 0.2, s * (a + 0.02)], [0, 0, Math.PI / 2]), false);
    // ridge cap: two boards forming a tent
    flat(ridge, at(box(L + 0.14, 0.07, 0.34), [0, y0 + h + 0.0 - 0.01 + 0.02, s * 0.15 * cs], [s * th, 0, 0]), true);
    // rake (barge) boards on both gable ends
    for (const sx of [-1, 1]) {
      flat(trim, at(box(0.07, 0.26, ls + 0.12), [sx * (L / 2 - 0.02), y0 + h / 2 - (t / 2) * cs + 0.01, s * (a / 2 - (t / 2) * sn)], [s * th, 0, 0]), true);
    }
  }
  // gable-end walls (pentagon under the roof) in the wall texture
  const hw = h * (1 - d / 2 / a) - 0.07;
  const sh = new THREE.Shape();
  sh.moveTo(-d / 2, 0); sh.lineTo(d / 2, 0); sh.lineTo(d / 2, hw); sh.lineTo(0, h - 0.07); sh.lineTo(-d / 2, hw); sh.closePath();
  for (const sx of [-1, 1]) {
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.12, bevelEnabled: false });
    g.translate(0, 0, -0.06);
    g.rotateY(sx * Math.PI / 2);
    g.translate(sx * (w / 2 - 0.0), y0 - 0.02, 0);
    tex(gKind, gBase, UPR, g, true);
  }
  return { y0, a, k: h / a, h, w, d, ox, oz, kind, base, trim, gKind, gBase, L };
}

/** Hip roof (low pyramid with a ridge), convex solid with fascia thickness. */
function hipRoof(o) {
  const { w, d, y0, h, ov, kind, base, trim = P.white } = o;
  const A = w / 2 + ov, D = d / 2 + ov, R = Math.max(0.4, A - D), f = 0.22;
  const pts = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    pts.push(new THREE.Vector3(sx * A, y0, sz * D), new THREE.Vector3(sx * A, y0 - f, sz * D));
  }
  pts.push(new THREE.Vector3(-R, y0 + h, 0), new THREE.Vector3(R, y0 + h, 0));
  tex(kind, base, UPR, new ConvexGeometry(pts), true);
  const rc = mix(base, K.black, 0.22);
  // hip lines and ridge
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    flat(rc, beam([sx * A, y0 + 0.03, sz * D], [sx * R, y0 + h + 0.03, 0], 0.17, 0.09), true);
  }
  flat(rc, at(box(2 * R + 0.5, 0.15, 0.34), [0, y0 + h + 0.05, 0]), true);
  // fascia + gutters
  for (const s of [-1, 1]) {
    BX(trim, 2 * A + 0.04, 0.2, 0.06, 0, y0 - 0.19, s * (D + 0.005), true);
    BX(trim, 0.06, 0.2, 2 * D + 0.04, s * (A + 0.005), y0 - 0.19, 0, true);
    flat(P.pipe, at(cyl(0.065, 0.065, 2 * A, 8), [0, y0 - 0.27, s * (D + 0.04)], [0, 0, Math.PI / 2]), false);
  }
  return { y0, A, D, R, k: h / D, h };
}
const hipY = (R, z) => R.y0 + (R.D - Math.abs(z)) * R.k;

/** Small gabled dormer sitting on the front slope of a gable roof. */
function dormer(R, u, o = {}) {
  const { w = 1.3, hd = 0.95, back = 0.7, shutter = P.doorPurple, curtain = P.cream, round = false } = o;
  const zf = R.a - back;
  const ys = (z) => gableY(R, z);
  const base = ys(zf) - 0.2, top = ys(zf) + hd;
  const zBack = R.a - (top - R.y0) / R.k - 0.05;
  tex(R.gKind, R.gBase, UPR, at(box(w, top - base, zf - zBack), [u, (base + top) / 2, (zf + zBack) / 2]), true);
  // small corner trims
  for (const s of [-1, 1]) BX(R.trim, 0.1, hd + 0.05, 0.1, u + s * (w / 2 + 0.01), ys(zf) - 0.02, zf + 0.01, true);
  const phi = 0.62, rw = w / 2 + 0.24, rh = rw * Math.tan(phi), sl = rw / Math.cos(phi), t = 0.12;
  const zr = R.a - (top + rh - R.y0) / R.k;
  const zFront = zf + 0.26, zEnd = zr - 0.05, Lz = zFront - zEnd, zc = (zFront + zEnd) / 2;
  for (const s of [1, -1]) {
    tex(R.kind, R.base, UPR, at(box(sl + 0.04, t, Lz), [u + s * (rw / 2 - (t / 2) * Math.sin(phi)), top + rh / 2 - (t / 2) * Math.cos(phi), zc], [0, 0, -s * phi]), true);
    flat(R.trim, at(box(sl + 0.06, 0.2, 0.06), [u + s * (rw / 2 - (t / 2) * Math.sin(phi)), top + rh / 2 - (t / 2) * Math.cos(phi), zFront - 0.02], [0, 0, -s * phi]), true);
  }
  flat(mix(R.base, K.black, 0.22), at(box(0.16, 0.1, Lz + 0.05), [u, top + rh + 0.02, zc]), true);
  // gable triangle above the front wall
  const tri = new THREE.Shape();
  const tw = w / 2 + 0.02, th2 = rh * (tw / rw) - 0.04;
  tri.moveTo(-tw, 0); tri.lineTo(tw, 0); tri.lineTo(0, th2); tri.closePath();
  const tg = new THREE.ExtrudeGeometry(tri, { depth: 0.1, bevelEnabled: false });
  tg.translate(u, top - 0.01, zf - 0.07);
  tex(R.gKind, R.gBase, UPR, tg, true);
  // window
  const M = mat4([u, 0, zf]);
  if (round) {
    FCyl(M, R.trim, 0.3, 0.3, 0.1, 0, ys(zf) + hd / 2 - 0.02, 0.05, [Math.PI / 2, 0, 0], true, 16);
    flat(P.glass, at(new THREE.CircleGeometry(0.22, 16), [0, ys(zf) + hd / 2 - 0.02, 0.105], [0, 0, 0], M), false);
    basic(P.glass, at(new THREE.CircleGeometry(0.22, 16), [0, ys(zf) + hd / 2 - 0.02, 0.106], [0, 0, 0], M));
    FB(M, R.trim, 0.04, 0.44, 0.03, 0, ys(zf) + hd / 2 - 0.24, 0.12, false);
    FB(M, R.trim, 0.44, 0.04, 0.03, 0, ys(zf) + hd / 2 - 0.04, 0.12, false);
  } else {
    win(M, 0, ys(zf) + hd / 2 + 0.02, 0.62, 0.52, { shutter, curtain, sill: true });
  }
  return { zf };
}

function chimney(R, x, z, topY, o = {}) {
  const w = o.w ?? 0.8;
  const y0 = gableY(R, z) - 0.4, hgt = topY - y0;
  tex('brick', P.brick, UPR, at(box(w, hgt, w), [x, y0 + hgt / 2, z]), true);
  BX(P.stone, w + 0.14, 0.1, w + 0.14, x, topY - 0.55, z, true);
  BX(P.stone, w + 0.22, 0.14, w + 0.22, x, topY, z, true);
  for (const s of [-1, 1]) {
    flat(P.clay, at(cyl(0.1, 0.12, 0.26, 8), [x + s * 0.15, topY + 0.27, z]), true);
    flat(P.clay, at(cyl(0.14, 0.14, 0.05, 8), [x + s * 0.15, topY + 0.42, z]), false);
  }
  if (o.puffs !== false) {
    [[0.1, 0.9, 0.26], [0.28, 1.4, 0.34], [0.12, 1.95, 0.27]].forEach(([dx, dy, r]) =>
      flat(K.white, at(blob(r, r * 0.85, r, 1), [x + dx, topY + dy, z]), true));
  }
}

/** window with frame, mullions, sill and optional shutters / flower box / curtains. */
function win(M, u, y, w, h, o = {}) {
  const { trim = P.white, shutter = null, flowers = false, curtain = null, mull = 'cross', sill = true, glass = P.glass } = o;
  const t = 0.1, d = 0.13;
  FB(M, trim, w + 2 * t, t, d, u, y + h / 2, d / 2);
  FB(M, trim, w + 2 * t, t, d, u, y - h / 2 - t, d / 2);
  FB(M, trim, t, h, d, u - w / 2 - t / 2, y - h / 2, d / 2);
  FB(M, trim, t, h, d, u + w / 2 + t / 2, y - h / 2, d / 2);
  FBas(M, glass, w, h, u, y, 0.02);
  FBas(M, K.white, 0.07, h * 0.5, u - w * 0.22, y + h * 0.12, 0.025, 0.55);
  FBas(M, K.white, 0.035, h * 0.28, u - w * 0.1, y + h * 0.18, 0.025, 0.55);
  if (mull === 'cross' || mull === 'v') FB(M, trim, 0.05, h, 0.06, u, y - h / 2, 0.05, false);
  if (mull === 'cross') FB(M, trim, w, 0.05, 0.06, u, y - 0.025, 0.05, false);
  if (curtain != null) {
    FPl(M, curtain, w * 0.3, h * 0.92, u - w / 2 + w * 0.15, y - 0.03, 0.035);
    FPl(M, curtain, w * 0.3, h * 0.92, u + w / 2 - w * 0.15, y - 0.03, 0.035);
    FPl(M, mix(curtain, K.black, 0.12), w, 0.12, u, y + h / 2 - 0.06, 0.037);
  }
  if (sill) {
    FB(M, trim, w + 0.4, 0.09, 0.3, u, y - h / 2 - t - 0.07, 0.15);
    FB(M, trim, w + 0.32, 0.09, 0.2, u, y + h / 2 + t, 0.1);
  }
  if (shutter != null) {
    const sw = Math.min(0.36, w * 0.45), sd = mix(shutter, K.black, 0.25);
    for (const s of [-1, 1]) {
      const cu = u + s * (w / 2 + t + sw / 2 + 0.005);
      FB(M, shutter, sw, h + 2 * t, 0.05, cu, y - h / 2 - t, 0.045);
      const n = Math.max(3, Math.round(h / 0.22));
      for (let i = 0; i < n; i++) FB(M, sd, sw * 0.78, 0.028, 0.02, cu, y - h / 2 - t + 0.14 + i * ((h + 2 * t - 0.28) / (n - 1)), 0.078, false);
    }
  }
  if (flowers) {
    FB(M, P.wood, w + 0.26, 0.24, 0.3, u, y - h / 2 - t - 0.32, 0.27);
    FB(M, P.woodDark, w + 0.28, 0.05, 0.32, u, y - h / 2 - t - 0.2, 0.27, false);
    flat(P.leafDark, at(blob(w / 2 + 0.08, 0.09, 0.13, 1), [u, y - h / 2 - t - 0.05, 0.28], [0, 0, 0], M), false);
    const n = Math.max(3, Math.round((w + 0.1) / 0.2));
    for (let i = 0; i < n; i++) {
      const fu = u - (w + 0.1) / 2 + ((w + 0.1) * (i + 0.5)) / n;
      FBlob(M, P.leaf, 0.09, fu, y - h / 2 - t - 0.02, 0.28, false);
      FBlob(M, FLOWER[(i + 1) % 4], 0.075, fu, y - h / 2 - t + 0.07 + (i % 2) * 0.05, 0.3, false);
    }
  }
}

/** panelled door with frame, glazed top, knob, optional letter slot. */
function door(M, u, w, h, o = {}) {
  const { color = P.doorPurple, fy = 0.14, glazed = true, slot = false, trim = P.white } = o;
  const stile = mix(color, K.black, 0.28), panel = mix(color, K.white, 0.14);
  FB(M, trim, 0.13, h + 0.1, 0.2, u - w / 2 - 0.065, fy, 0.12);
  FB(M, trim, 0.13, h + 0.1, 0.2, u + w / 2 + 0.065, fy, 0.12);
  FB(M, trim, w + 0.26, 0.15, 0.22, u, fy + h, 0.12);
  FB(M, trim, w + 0.56, 0.08, 0.3, u, fy + h + 0.15, 0.15);
  FT(M, 'woodVertical', color, w, h, 0.1, u, fy, 0.14);
  for (const s of [-1, 1]) FB(M, stile, 0.1, h, 0.05, u + s * (w / 2 - 0.05), fy, 0.185, false);
  FB(M, stile, w, 0.14, 0.05, u, fy + 0.04, 0.185, false);
  FB(M, stile, w, 0.1, 0.05, u, fy + h * 0.5, 0.185, false);
  FB(M, stile, w, 0.14, 0.05, u, fy + h - 0.16, 0.185, false);
  FB(M, panel, w * 0.6, h * 0.28, 0.03, u, fy + h * 0.14 + 0.12, 0.2, false);
  if (glazed) {
    FBas(M, P.glass, w * 0.64, h * 0.3, u, fy + h * 0.74, 0.196);
    FB(M, stile, 0.04, h * 0.3, 0.03, u, fy + h * 0.74 - h * 0.15, 0.2, false);
    FB(M, stile, w * 0.66, 0.04, 0.03, u, fy + h * 0.74 - 0.02, 0.2, false);
  } else FB(M, panel, w * 0.6, h * 0.26, 0.03, u, fy + h * 0.64, 0.2, false);
  FB(M, K.yellow, 0.07, 0.22, 0.03, u + w * 0.35, fy + h * 0.37, 0.205, false);
  FBlob(M, K.yellow, 0.065, u + w * 0.35, fy + h * 0.45, 0.235, false);
  if (slot) FB(M, K.black, 0.34, 0.07, 0.03, u, fy + h * 0.5 + 0.12, 0.21, false);
}

/** steps + deck; returns nothing. depth = deck depth. */
function steps(M, u, w, depth, fy = 0.14) {
  FT(M, 'foundation', P.found, w, fy, depth, u, 0, depth / 2, true);
  FB(M, P.stone, w + 0.1, 0.05, depth + 0.1, u, fy - 0.0, depth / 2, true);
  FT(M, 'foundation', P.found, w - 0.3, fy * 0.5, 0.4, u, 0, depth + 0.2, true);
}

/** porch with posts, shed roof, beam, braces. */
function porch(M, u, w, depth, h, roofKind, roofBase, o = {}) {
  const { fy = 0.14, posts = true } = o;
  const by = fy + h;
  if (posts) {
    for (const s of [-1, 1]) {
      const pu = u + s * (w / 2 - 0.08);
      FB(M, P.white, 0.14, h, 0.14, pu, fy, depth - 0.1);
      FB(M, P.white, 0.22, 0.08, 0.22, pu, fy, depth - 0.1);
      FB(M, P.white, 0.2, 0.07, 0.2, pu, by - 0.07, depth - 0.1);
      // diagonal brace
      flat(P.white, at(beam([pu, by - 0.4, depth - 0.1], [pu - s * 0.4, by, depth - 0.1 - 0.02], 0.07, 0.07), [0, 0, 0], [0, 0, 0], M), false);
    }
  } else {
    for (const s of [-1, 1]) {
      const pu = u + s * (w / 2 - 0.12);
      flat(P.woodDark, at(beam([pu, by - 0.5, 0.02], [pu, by + 0.05, depth - 0.1], 0.08, 0.08), [0, 0, 0], [0, 0, 0], M), true);
    }
  }
  FB(M, P.white, w + 0.1, 0.2, 0.14, u, by - 0.02, depth - 0.1);
  // shed roof
  const rise = 0.45, run = depth + 0.12;
  const ang = Math.atan2(rise, run), len = Math.hypot(run, rise) + 0.1, t = 0.1;
  tex(roofKind, roofBase, UPR, at(box(w + 0.5, t, len), [u, by + 0.18 + rise / 2 - 0.07, run / 2 - 0.1 + 0.05], [ang, 0, 0], M), true);
  FB(M, mix(roofBase, K.black, 0.22), w + 0.56, 0.08, 0.14, u, by + 0.18 + rise - 0.04, -0.02);
  FB(M, P.white, w + 0.54, 0.14, 0.05, u, by + 0.07, depth + 0.02, true);
}

function lampOn(M, u, y) {
  FB(M, P.black, 0.07, 0.07, 0.2, u, y + 0.05, 0.1, false);
  FB(M, K.yellow, 0.15, 0.24, 0.15, u, y - 0.2, 0.2, true);
  basic(P.glow, at(box(0.1, 0.2, 0.17), [u, y - 0.08, 0.2], [0, 0, 0], M));
  flat(P.black, at(new THREE.ConeGeometry(0.13, 0.1, 4), [u, y + 0.2, 0.2], [0, Math.PI / 4, 0], M), false);
}

function numberPlate(M, id, u, y) {
  FB(M, P.woodDark, 0.34, 0.34, 0.04, u, y - 0.17, 0.03, true);
  plate(id, [u, y, 0.056], 0, 1, M);
}

function downpipe(x, z, topY) {
  flat(P.pipe, at(cyl(0.05, 0.05, topY - 0.12, 8), [x, 0.12 + (topY - 0.12) / 2, z]), true);
  flat(P.pipe, at(box(0.12, 0.08, 0.12), [x, 0.18, z]), false);
  flat(P.pipe, at(cyl(0.07, 0.07, 0.1, 8), [x, topY - 0.15, z]), false);
}

function awning(M, u, w, yTop, depth, drop, stripes, c1 = K.red, c2 = K.white) {
  const sw = w / stripes, len = Math.hypot(depth, drop), ang = Math.atan2(drop, depth);
  for (let i = 0; i < stripes; i++) {
    const cu = u - w / 2 + sw * (i + 0.5), c = i % 2 ? c2 : c1;
    flat(c, at(box(sw, 0.07, len), [cu, yTop - drop / 2, depth / 2], [ang, 0, 0], M), true);
    flat(c, at(box(sw, 0.2, 0.05), [cu, yTop - drop - 0.07, depth - 0.02], [0, 0, 0], M), true);
    flat(c, at(new THREE.ConeGeometry(sw * 0.5, 0.1, 4).rotateX(Math.PI).rotateY(Math.PI / 4).scale(1, 1, 0.35), [cu, yTop - drop - 0.2, depth - 0.02], [0, 0, 0], M), false);
  }
  for (const s of [-1, 1]) flat(P.woodDark, at(beam([u + s * (w / 2 - 0.1), yTop - drop - 0.12, depth - 0.04], [u + s * (w / 2 - 0.1), yTop + 0.02, 0.03], 0.06, 0.06), [0, 0, 0], [0, 0, 0], M), false);
}

/** bracket arm + hanging sign (two plates, facing +Z and -Z) on the east wall near the front corner. */
function hangSign(b, id, y, o = {}) {
  const { len = SIGN[id].ww + 0.55, z = b.d / 2 - 0.4, sc = 1 } = o;
  const x0 = b.w / 2 - 0.02, ww = SIGN[id].ww * sc, wh = SIGN[id].wh * sc;
  const xc = x0 + 0.3 + ww / 2 + 0.05;
  BX(P.black, len, 0.08, 0.08, x0 + len / 2, y, z, true);
  flat(P.black, beam([x0, y - 0.65, z], [x0 + len * 0.55, y + 0.02, z], 0.06, 0.06), false);
  flat(K.yellow, at(blob(0.09, 0.09, 0.09, 0), [x0 + len + 0.02, y + 0.04, z]), false);
  for (const s of [-1, 1]) BX(P.black, 0.025, 0.2, 0.025, xc + s * (ww / 2 - 0.1), y - 0.2, z, false);
  BX(P.wood, ww + 0.1, wh + 0.1, 0.07, xc, y - 0.2 - wh - 0.06, z, true);
  plate(id, [xc, y - 0.2 - wh / 2 - 0.01, z + 0.045], 0, sc);
  plate(id, [xc, y - 0.2 - wh / 2 - 0.01, z - 0.045], Math.PI, sc);
}

function planter(x, z, o = {}) {
  const { w = 0.8, h = 0.62, d = 0.62, shrub = true } = o;
  TBX('woodPlanks', P.woodLight, w, h, d, x, 0, z, true);
  BX(P.woodDark, w + 0.1, 0.07, d + 0.1, x, h, z, true);
  BX(P.woodDark, w + 0.04, 0.06, d + 0.04, x, 0.0, z, false);
  if (shrub) {
    flat(P.leaf, at(blob(0.42, 0.42, 0.42, 1), [x, h + 0.42, z]), true);
    flat(P.leafLight, at(blob(0.28, 0.28, 0.28, 1), [x + 0.14, h + 0.62, z - 0.05]), true);
    flat(P.leafLight, at(blob(0.2, 0.2, 0.2, 0), [x - 0.2, h + 0.35, z + 0.18]), false);
    for (const [dx, dy, dz, c] of [[0.22, 0.5, 0.22, K.red], [-0.25, 0.6, 0.12, K.yellow], [0.0, 0.88, 0.2, K.white], [-0.08, 0.35, 0.34, K.purple]]) {
      flat(c, at(blob(0.07, 0.07, 0.07, 0), [x + dx, h + dy, z + dz]), false);
    }
  }
}

function pennantString(M, u0, u1, y0, y1, v, n, sag = 0.18) {
  const cols = [K.red, K.yellow, K.white, K.purple];
  const pts = [];
  for (let i = 0; i <= n * 2; i++) {
    const t = i / (n * 2);
    pts.push([u0 + (u1 - u0) * t, y0 + (y1 - y0) * t - Math.sin(t * Math.PI) * sag]);
  }
  for (let i = 1; i < pts.length; i++) {
    flat(P.black, beam([pts[i - 1][0], pts[i - 1][1], v], [pts[i][0], pts[i][1], v], 0.02, 0.02).applyMatrix4(M), false);
  }
  for (let i = 0; i < n; i++) {
    const [pu, py] = pts[i * 2 + 1];
    const g = new THREE.CircleGeometry(0.15, 3, Math.PI / 2 + Math.PI / 3, Math.PI * 2).scale(1, 1.15, 1);
    flat(cols[i % 4], at(g, [pu, py - 0.13, v + 0.01], [0, 0, 0], M), false);
    flat(cols[i % 4], at(g.clone().rotateY(Math.PI), [pu, py - 0.13, v - 0.01], [0, 0, 0], M), false);
  }
}

// ------------------------------------------------------------------ weather vane (animated, own meshes)
function makeVane() {
  const g = new THREE.Group();
  const parts = [];
  const add = (color, geo) => parts.push(paint(prep(geo, false), color));
  add(P.black, box(1.1, 0.05, 0.05));
  add(K.red, new THREE.ConeGeometry(0.13, 0.3, 4).rotateZ(-Math.PI / 2).translate(0.65, 0, 0));
  add(K.white, box(0.5, 0.05, 0.34).translate(-0.7, 0, 0));
  add(K.red, beam([-0.95, 0.025, -0.17], [-0.7, 0.025, 0], 0.03, 0.02));
  add(K.red, beam([-0.45, 0.025, -0.17], [-0.7, 0.025, 0], 0.03, 0.02));
  add(K.yellow, blob(0.07, 0.07, 0.07, 0));
  const geo = mergeGeometries(parts, false);
  const mesh = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: gradient, side: THREE.DoubleSide }));
  mesh.castShadow = true;
  const hullG = (() => { const h = new THREE.BufferGeometry(); h.setAttribute('position', geo.getAttribute('position').clone()); const m = mergeVertices(h, 1e-4); m.computeVertexNormals(); return m; })();
  const dummy = new THREE.Mesh(hullG);
  addOutline(dummy, 0.02);
  const hull = dummy.children[0];
  hull.geometry = hullG;
  g.add(mesh, hull);
  return g;
}

// ------------------------------------------------------------------ shared materials
const gradient = (() => {
  const t = new THREE.DataTexture(new Uint8Array([Math.round(0.35 * 255), 255]), 2, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();
let flatMat, basicMat, glassMat;
function mats() {
  if (flatMat) return;
  flatMat = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: gradient, side: THREE.DoubleSide });
  basicMat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide });
  glassMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false });
}

// ================================================================== PRODUCTS (hero gallery)
function buildProducts(b, extra) {
  const w = b.w, d = b.d, H = 4.7, zF = d / 2, F = frameF(b), E = frameE(b);
  // mass is recessed 0.7 behind the facade layer so the bays and portal have depth
  const mass = d - 0.7;
  TBX('woodVertical', P.wallTex, w, H, mass, 0, 0, -0.35, true);
  tex('foundation', P.found, UPR, at(box(w + 0.14, 0.5, d + 0.14), [0, 0.25, 0]), true);
  BX(P.stone, w + 0.22, 0.08, d + 0.22, 0, 0.5, 0, true);
  // facade layer pieces (frame F, v from -0.7 .. 0)
  const piers = [[-5.75, 0.5], [-1.725, 0.45], [1.725, 0.45], [5.75, 0.5]];
  for (const [pu, pw] of piers) {
    FT(F, 'woodVertical', P.wallTex, pw, H - 0.5, 0.7, pu, 0.5, -0.35);
    FB(F, K.mascot, pw + 0.1, 0.16, 0.8, pu, 0.5, -0.35);
    FB(F, K.mascot, pw + 0.08, 0.14, 0.78, pu, 3.3 - 0.14, -0.35);
  }
  // lintel across the whole facade, header beam over the portal
  FT(F, 'woodVertical', P.wallTex, w, H - 3.3, 0.7, 0, 3.3, -0.35);
  FB(F, K.mascot, w + 0.1, 0.2, 0.82, 0, 3.3, -0.35);
  FB(F, K.mascot, 3.35, 0.36, 0.9, 0, 2.94, -0.3);
  // bays
  for (const sx of [-1, 1]) {
    const cu = sx * 3.725, gw = 3.55, y0 = 1.0, y1 = 3.3;
    // bulkhead + sill + frame
    FT(F, 'woodVertical', P.doorPurple, gw, 0.5, 0.64, cu, 0.5, -0.35);
    FB(F, P.white, gw + 0.2, 0.1, 0.3, cu, 0.96, -0.1);
    FB(F, P.white, gw, 0.1, 0.16, cu, y1 - 0.1, -0.12, false);
    FB(F, P.white, gw, 0.07, 0.12, cu, 2.74, -0.1, false);
    for (const k of [-1, 0, 1]) { if (k !== 0 || true) FB(F, P.white, 0.08, y1 - y0, 0.12, cu + k * 1.185, y0, -0.1, false); }
    // interior
    FBas(F, P.glowSoft, gw, y1 - y0, cu, (y0 + y1) / 2, -0.68);
    basic(P.floorWarm, at(flatPlane(gw, 0.58), [cu, y0 + 0.025, -0.4], [0, 0, 0], F));
    // transparent glass
    glassT(at(plane(gw, y1 - y0), [cu, (y0 + y1) / 2, -0.09], [0, 0, 0], F));
    glassT(at(plane(0.5, 1.7), [cu - 1.1 * sx * 0.0 - 0.7, 2.3, -0.085], [0, 0, 0.5], F));
    // app-window vitrines (silhouettes)
    const appWin = (au, ay, ww, hh, v, seed) => {
      const L = cu + au;
      FBas(F, P.sil, ww, hh, L, ay, v);
      FBas(F, P.silLight, ww - 0.14, hh - 0.26, L, ay - 0.05, v + 0.004);
      for (let i = 0; i < 3; i++) FBas(F, [K.red, K.yellow, K.sage][i], 0.06, 0.06, L - ww / 2 + 0.14 + i * 0.11, ay + hh / 2 - 0.1, v + 0.008);
      const cols = [K.purple, K.mascot, P.sil];
      FBas(F, cols[seed % 3], ww * 0.34, hh * 0.38, L - ww * 0.17, ay - 0.12, v + 0.008);
      for (let i = 0; i < 3; i++) FBas(F, P.sil, ww * (0.3 - i * 0.05), 0.045, L + ww * 0.17, ay + 0.03 - i * 0.14, v + 0.008);
    };
    appWin(-0.85 * sx, 2.35, 1.5, 1.05, -0.66, 0 + (sx > 0 ? 1 : 0));
    appWin(0.85 * sx, 2.5, 1.15, 0.85, -0.64, 1);
    appWin(0.05 * sx, 1.72, 0.8, 0.52, -0.62, 2);
    // pendant lamps + plant silhouette
    for (const lu of [-1.35, 1.35]) {
      FBas(F, P.sil, 0.012, 0.35, cu + lu, 3.12, -0.6);
      FBas(F, P.glow, 0.2, 0.14, cu + lu, 2.9, -0.59);
    }
    flat(P.sil, at(blob(0.22, 0.3, 0.22, 0), [cu + 1.45 * sx, 1.3, -0.5], [0, 0, 0], F), false);
    FB(F, P.sil, 0.2, 0.2, 0.2, cu + 1.45 * sx, 1.025, -0.5, false);
  }
  // portal: glowing interior with the doors swung open
  FBas(F, P.glow, 3.0, 2.95, 0, 1.47, -0.68);
  FBas(F, P.glowSoft, 2.2, 2.6, 0, 1.55, -0.66);
  FBas(F, P.sil, 0.5, 1.5, -0.55, 0.85, -0.64);
  FBas(F, P.sil, 0.4, 1.3, 0.6, 0.75, -0.64);
  FBas(F, P.glow, 0.5, 0.3, 0, 2.6, -0.64);
  basic(P.glow, at(flatPlane(2.6, 1.8), [0, 0.045, 1.0], [0, 0, 0], F));
  basic(P.glowSoft, at(flatPlane(1.8, 1.2), [0, 0.048, 0.85], [0, 0, 0], F));
  for (const s of [-1, 1]) {
    FT(F, 'woodVertical', P.woodLight, 0.06, 2.9, 0.88, s * 1.46, 0.05, 0.4);
    FB(F, P.woodDark, 0.09, 2.9, 0.06, s * 1.46, 0.05, 0.86, false);
    FB(F, P.woodDark, 0.09, 0.14, 0.88, s * 1.46, 0.05, 0.4, false);
    FB(F, P.woodDark, 0.09, 0.14, 0.88, s * 1.46, 2.7, 0.4, false);
    FB(F, P.woodDark, 0.09, 0.1, 0.88, s * 1.46, 1.5, 0.4, false);
  }
  // portal steps + mat
  FT(F, 'foundation', P.found, 3.4, 0.08, 0.7, 0, 0, 0.33);
  FT(F, 'foundation', P.found, 3.7, 0.04, 1.0, 0, 0, 0.5, true);
  FB(F, K.red, 1.5, 0.03, 0.7, 0, 0.04, 1.2, false);
  FB(F, K.white, 1.5, 0.032, 0.06, 0, 0.04, 1.1, false);
  // awning over the doors
  awning(F, 0, 3.4, 3.26, 0.95, 0.42, 8);
  for (const s of [-1, 1]) {
    lampOn(F, s * 1.73, 2.5);
  }
  // roof-top sign with marquee bulbs (stands on the front eave, clear of the overhang)
  {
    const sy = H + 0.74, sv = 0.42;
    FB(F, K.mascot, 5.3, 1.4, 0.12, 0, sy - 0.7, sv);
    FB(F, P.white, 5.15, 1.25, 0.04, 0, sy - 0.625, sv + 0.07, false);
    plate('products', [0, sy, sv + 0.095], 0, 1, F);
    const bw = 2.55, bh = 0.62, step = 0.27, bulbs = [];
    for (let u = -bw; u <= bw + 0.001; u += step) { bulbs.push([u, bh]); bulbs.push([u, -bh]); }
    for (let y = -bh + step; y < bh - 0.01; y += step) { bulbs.push([-bw, y]); bulbs.push([bw, y]); }
    bulbs.forEach(([bu, by], i) => basic(i % 2 ? P.glow : K.white, at(blob(0.062, 0.062, 0.062, 0), [bu, sy + by, sv + 0.1], [0, 0, 0], F)));
    for (const s2 of [-1, 1]) {
      flat(P.woodDark, beam([s2 * 2.3, H + 0.95, sv - 0.04], [s2 * 2.3, H + 0.3, -0.5], 0.09, 0.09).applyMatrix4(F), false);
      FB(F, K.mascot, 0.16, 0.2, 0.16, s2 * 2.62, sy + 0.62, sv, true);
    }
  }
  // bunting along the lintel
  pennantString(F, -5.3, -2.0, H - 0.5, H - 0.5, 0.1, 7, 0.2);
  pennantString(F, 2.0, 5.3, H - 0.5, H - 0.5, 0.1, 7, 0.2);
  // banner poles at the front corners
  [[-1, K.purple, K.yellow], [1, K.yellow, K.purple]].forEach(([sx, c1, c2]) => {
    const pu = sx * 6.55;
    FCyl(F, P.black, 0.05, 0.07, 4.7, pu, 2.35, 0.5, [0, 0, 0], true, 8);
    FBlob(F, K.yellow, 0.1, pu, 4.74, 0.5, true);
    FB(F, P.black, 1.0, 0.05, 0.05, pu + sx * 0.5, 4.45, 0.5, false);
    FB(F, c1, 0.78, 1.3, 0.04, pu + sx * 0.52, 3.12, 0.5, true);
    flat(c1, at(new THREE.ConeGeometry(0.39, 0.3, 3).rotateX(Math.PI).scale(1, 1, 0.1), [pu + sx * 0.52, 3.0, 0.5], [0, 0, 0], F), false);
    flat(c2, at(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 14).rotateX(Math.PI / 2), [pu + sx * 0.52, 3.75, 0.53], [0, 0, 0], F), false);
    flat(K.white, at(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 10).rotateX(Math.PI / 2), [pu + sx * 0.52, 3.75, 0.55], [0, 0, 0], F), false);
    FB(F, c2, 0.78, 0.07, 0.045, pu + sx * 0.52, 3.3, 0.53, false);
  });
  // east wall: tall windows, trim band, door-less
  for (const u of [-1.7, 1.7]) win(E, u, 2.7, 1.5, 1.9, { mull: 'cross' });
  FB(E, K.mascot, mass + 0.1, 0.16, 0.08, -0.35 + 0.0 + 0.35 - 0.35, 3.8, 0.04, false);
  // hip roof with cupola, skylights
  const R = hipRoof({ w, d, y0: H, h: 1.5, ov: 0.6, kind: 'roofShingles', base: P.roofPurple });
  for (const sx of [-1, 1]) {
    const z = 1.9, cy = hipY(R, z) + 0.06, th = Math.atan2(R.h, R.D);
    const g = (gg) => at(gg, [sx * 3.4, cy, z], [th, 0, 0]);
    flat(P.white, g(box(1.7, 0.1, 1.15)), true);
    basic(mix(K.purple, K.white, 0.65), at(plane(1.4, 0.85).rotateX(-Math.PI / 2).translate(0, 0.07, 0), [sx * 3.4, cy, z], [th, 0, 0]));
    flat(P.white, g(box(0.06, 0.12, 0.9)), false);
  }
  // cupola
  const cy0 = H + R.h - 0.05;
  BX(P.wall, 1.4, 0.9, 1.4, 0, cy0, 0, true);
  BX(K.mascot, 1.56, 0.12, 1.56, 0, cy0, 0, true);
  BX(K.mascot, 1.56, 0.12, 1.56, 0, cy0 + 0.88, 0, true);
  basic(P.glow, at(plane(0.7, 0.55), [0, cy0 + 0.46, 0.71]));
  basic(P.glow, at(plane(0.7, 0.55), [0.71, cy0 + 0.46, 0], [0, Math.PI / 2, 0]));
  flat(K.mascot, at(new THREE.ConeGeometry(1.2, 0.8, 4), [0, cy0 + 1.0 + 0.4, 0], [0, Math.PI / 4, 0]), true);
  tex('roofShingles', P.roofPurple, UPR, at(new THREE.ConeGeometry(1.1, 0.74, 4), [0, cy0 + 1.0 + 0.42, 0], [0, Math.PI / 4, 0]), false);
  flat(P.black, at(cyl(0.025, 0.025, 0.8, 6), [0, cy0 + 2.2, 0]), false);
  flat(K.yellow, at(blob(0.08, 0.08, 0.08, 0), [0, cy0 + 2.62, 0]), false);
  // pennant flag on the cupola
  flat(K.red, at(new THREE.ConeGeometry(0.16, 0.6, 3).rotateZ(-Math.PI / 2).scale(1, 1, 0.12), [0.32, cy0 + 2.42, 0]), false);
  // downpipes on the piers
  for (const sx of [-1, 1]) {
    downpipe(sx * 6.0 - sx * 0.12, zF + 0.04, H - 0.3);
    downpipe(sx * 6.0 + 0.04 * sx, -zF + 0.04, H - 0.3);
  }
  // planters flanking the doors (outside the walkway)
  const colliders = [];
  for (const sx of [-1, 1]) {
    planter(sx * 2.35, zF + 0.55, { w: 0.8 });
    colliders.push({ x: b.x + sx * 2.35, z: b.z + zF + 0.55, r: 0.5 });
  }
  extra.vaneAt = null;
  return colliders;
}

// ================================================================== ABOUT (cottage)
function buildAbout(b) {
  const w = b.w, d = b.d, H = 3.0, F = frameF(b), E = frameE(b);
  const wallBase = P.cream;
  walls(w, d, H, 'woodPlanks', wallBase);
  const R = gableRoof({ w, d, y0: H, h: 1.9, ox: 0.45, oz: 0.55, kind: 'roofTiles', base: mix(K.red, K.yellow, 0.1), gKind: 'woodPlanks', gBase: wallBase });
  dormer(R, 0, { w: 1.3, hd: 0.95, back: 0.75, shutter: K.mascot, curtain: K.red });
  chimney(R, 1.75, -0.85, H + 2.4, { w: 0.8 });
  // front
  door(F, 0, 1.05, 2.05, { color: P.doorPurple });
  steps(F, 0, 1.9, 1.0);
  porch(F, 0, 1.9, 1.0, 2.34, 'roofTiles', mix(K.red, K.yellow, 0.1));
  FB(F, K.red, 0.9, 0.03, 0.5, 0, 0, 1.38, false);
  FB(F, K.yellow, 0.9, 0.032, 0.06, 0, 0, 1.3, false);
  for (const s of [-1, 1]) win(F, s * 2.15, 1.65, 0.9, 1.1, { shutter: K.purple, flowers: true, curtain: s < 0 ? K.yellow : K.red });
  lampOn(F, 1.2, 2.2);
  numberPlate(F, 'n7', -1.2, 1.9);
  // east
  win(E, -1.15, 1.65, 0.9, 1.1, { shutter: K.purple, curtain: K.yellow });
  win(E, 1.1, 1.65, 0.9, 1.1, { shutter: K.purple, curtain: K.red, flowers: true });
  // round attic window in the east gable
  {
    const gy = H + 0.72;
    FCyl(E, P.white, 0.32, 0.32, 0.1, 0, gy, 0.06, [Math.PI / 2, 0, 0], true, 18);
    basic(P.glass, at(new THREE.CircleGeometry(0.24, 18), [0, gy, 0.115], [0, 0, 0], E));
    FB(E, P.white, 0.04, 0.5, 0.03, 0, gy - 0.25, 0.12, false);
    FB(E, P.white, 0.5, 0.04, 0.03, 0, gy - 0.02, 0.12, false);
  }
  downpipe(w / 2 + 0.05, d / 2 + 0.08, H - 0.1);
  downpipe(-w / 2 - 0.05, d / 2 + 0.08, H - 0.1);
  hangSign(b, 'about', 2.72);
  // trellis with climbing flowers on the west end of the front wall
  for (const s of [-1, 1]) BX(P.woodLight, 0.05, 1.7, 0.04, -2.85 + s * 0.15, 0.4, d / 2 + 0.08, false);
  for (let i = 0; i < 4; i++) BX(P.woodLight, 0.4, 0.04, 0.04, -2.85, 0.7 + i * 0.4, d / 2 + 0.085, false);
  flat(P.leaf, at(blob(0.32, 0.8, 0.12, 1), [-2.85, 1.2, d / 2 + 0.13]), false);
  [[0.0, 1.8], [0.1, 1.3], [-0.12, 0.9], [0.05, 1.55]].forEach(([dx, y], i) => flat(FLOWER[i % 4], at(blob(0.07, 0.07, 0.07, 0), [-2.85 + dx, y, d / 2 + 0.22]), false));
  return [];
}

// ================================================================== HOW WE WORK (workshop)
function gear(M, u, y, r, color, teeth = 8, v = 0.1) {
  flat(color, at(cyl(r, r, 0.12, 16).rotateX(Math.PI / 2), [u, y, v], [0, 0, 0], M), true);
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    flat(color, at(box(r * 0.5, r * 0.5, 0.12), [u + Math.cos(a) * r * 1.02, y + Math.sin(a) * r * 1.02, v], [0, 0, a], M), true);
  }
  flat(K.white, at(cyl(r * 0.4, r * 0.4, 0.16, 12).rotateX(Math.PI / 2), [u, y, v + 0.02], [0, 0, 0], M), true);
  flat(P.iron, at(cyl(r * 0.14, r * 0.14, 0.2, 8).rotateX(Math.PI / 2), [u, y, v + 0.04], [0, 0, 0], M), false);
}

function buildHow(b) {
  const w = b.w, d = b.d, H = 3.4, zF = d / 2, F = frameF(b), E = frameE(b);
  const wallBase = P.lilac;
  walls(w, d, H, 'woodVertical', wallBase);
  const R = gableRoof({ w, d, y0: H, h: 1.5, ox: 0.4, oz: 0.55, kind: 'roofShingles', base: P.roofYellow, gKind: 'woodVertical', gBase: wallBase });
  // roll-up door half raised, workbench visible inside
  const dw = 2.7, dh = 2.45, fy = 0.14;
  FB(F, P.white, 0.17, dh + 0.2, 0.2, -dw / 2 - 0.085, fy, 0.1);
  FB(F, P.white, 0.17, dh + 0.2, 0.2, dw / 2 + 0.085, fy, 0.1);
  FB(F, P.white, dw + 0.34, 0.2, 0.22, 0, fy + dh, 0.11);
  FBas(F, mix(K.purple, K.black, 0.72), dw, dh, 0, fy + dh / 2, 0.04);
  FBas(F, P.glow, dw - 0.3, 1.4, 0, fy + 0.8, 0.045);
  FBas(F, mix(K.yellow, K.wood, 0.3), dw - 0.3, 0.2, 0, fy + 0.1, 0.046);
  // silhouettes inside: workbench, shelf, lamp
  FBas(F, P.sil, 1.3, 0.1, -0.4, fy + 0.65, 0.05);
  FBas(F, P.sil, 0.08, 0.6, -1.0, fy + 0.35, 0.05);
  FBas(F, P.sil, 0.08, 0.6, 0.2, fy + 0.35, 0.05);
  FBas(F, P.sil, 0.3, 0.36, 0.95, fy + 0.4, 0.05);
  FBas(F, P.sil, 0.4, 0.22, -0.85, fy + 0.82, 0.05);
  FBas(F, P.glow, 0.28, 0.2, -0.1, 1.95, 0.05);
  const slatY = 1.18;
  const slats = Math.round((fy + dh - slatY) / 0.2);
  for (let i = 0; i < slats; i++) {
    const y = slatY + i * ((fy + dh - slatY) / slats);
    FB(F, i % 2 ? mix(K.lavender, K.black, 0.1) : K.lavender, dw, (fy + dh - slatY) / slats, 0.08, 0, y, 0.08, i === 0);
    FB(F, P.pipe, dw, 0.018, 0.09, 0, y, 0.082, false);
  }
  FB(F, P.pipe, dw + 0.04, 0.1, 0.12, 0, slatY - 0.1, 0.09, true);
  FB(F, K.yellow, 0.5, 0.06, 0.05, 0, slatY - 0.22, 0.1, false);
  FCyl(F, P.pipe, 0.14, 0.14, dw + 0.2, 0, fy + dh + 0.3, 0.14, [0, 0, Math.PI / 2], true, 12);
  FB(F, P.white, dw + 0.4, 0.06, 0.34, 0, fy + dh + 0.2, 0.13, false);
  // door-hood lamp + step
  lampOn(F, -1.75, 2.9);
  lampOn(F, 1.75, 2.9);
  steps(F, 0, 3.3, 0.5, fy);
  FB(F, K.red, 1.4, 0.03, 0.5, 0, 0, 0.95, false);
  FB(F, K.yellow, 1.4, 0.032, 0.06, 0, 0, 0.88, false);
  // window + gears on the front right
  win(F, 2.35, 1.7, 0.7, 0.9, { shutter: K.purple, mull: 'v', curtain: null });
  gear(F, 2.35, 2.82, 0.28, K.red, 8, 0.1);
  gear(F, 2.82, 2.58, 0.18, K.yellow, 6, 0.1);
  // pegboard + tools + workbench on the front left
  FT(F, 'woodVertical', P.woodLight, 1.2, 1.1, 0.06, -2.3, 1.2, 0.05, true);
  FB(F, P.woodDark, 1.28, 0.06, 0.08, -2.3, 2.3, 0.06, false);
  FB(F, P.woodDark, 1.28, 0.06, 0.08, -2.3, 1.14, 0.06, false);
  // hammer
  FB(F, P.sil, 0.05, 0.4, 0.03, -2.65, 1.5, 0.1, false);
  FB(F, P.sil, 0.2, 0.1, 0.03, -2.65, 1.85, 0.1, false);
  // wrench
  FB(F, P.sil, 0.07, 0.42, 0.03, -2.3, 1.4, 0.1, false);
  flat(P.sil, at(cyl(0.1, 0.1, 0.03, 8).rotateX(Math.PI / 2), [-2.3, 1.88, 0.1], [0, 0, 0], F), false);
  FPl(F, P.woodLight, 0.07, 0.07, -2.3, 1.9, 0.12);
  // saw
  FB(F, P.pipe, 0.08, 0.5, 0.03, -1.95, 1.45, 0.1, false, [0, 0, 0.0]);
  FB(F, P.woodDark, 0.15, 0.1, 0.03, -1.95, 1.4, 0.1, false);
  FB(F, K.red, 0.22, 0.28, 0.03, -1.95, 1.9, 0.1, false);
  // bench
  FB(F, P.woodLight, 1.5, 0.09, 0.55, -2.25, 0.8, 0.42);
  for (const s of [-1, 1]) for (const z of [0.22, 0.6]) FB(F, P.wood, 0.09, 0.66, 0.09, -2.25 + s * 0.65, 0.14, z);
  FB(F, P.wood, 1.4, 0.05, 0.45, -2.25, 0.35, 0.42, false);
  FB(F, P.black, 0.2, 0.2, 0.18, -2.8, 0.89, 0.5, true);
  FB(F, K.purple, 0.24, 0.14, 0.2, -1.85, 0.89, 0.4, true);
  FB(F, K.yellow, 0.18, 0.05, 0.1, -2.25, 0.89, 0.55, false);
  // east side: window, gear cluster, loft door + hoist beam
  win(E, 0.9, 1.7, 0.9, 1.0, { shutter: K.purple, curtain: K.yellow });
  gear(E, -1.15, 1.95, 0.42, K.purple, 9, 0.1);
  gear(E, -0.5, 1.5, 0.28, K.red, 7, 0.1);
  gear(E, -1.62, 1.35, 0.22, K.yellow, 6, 0.1);
  FT(E, 'woodVertical', P.doorPurple, 0.8, 0.8, 0.08, 0, H + 0.12, 0.05, true);
  FB(E, P.white, 0.96, 0.08, 0.14, 0, H + 0.92, 0.06, false);
  FB(E, P.white, 0.08, 0.9, 0.14, -0.44, H + 0.08, 0.06, false);
  FB(E, P.white, 0.08, 0.9, 0.14, 0.44, H + 0.08, 0.06, false);
  FB(E, P.woodDark, 0.12, 0.12, 1.3, 0, H + 1.12, 0.65, true);
  FB(E, P.woodDark, 0.08, 0.08, 0.6, 0, H + 0.98, 0.4, false, [0.6, 0, 0]);
  flat(P.pipe, at(cyl(0.1, 0.1, 0.06, 10).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), [0, H + 1.0, 1.15], [0, 0, 0], E), true);
  FB(E, P.black, 0.02, 0.8, 0.02, 0, H + 0.2, 1.15, false);
  FB(E, P.cardboard, 0.34, 0.3, 0.34, 0, H - 0.14, 1.15, true);
  FB(E, K.red, 0.36, 0.05, 0.36, 0, H - 0.01, 1.15, false);
  // antenna, beacon, exhaust
  const ay = gableY(R, -0.3);
  flat(P.pipe, at(cyl(0.045, 0.05, 2.3, 8), [-1.8, ay + 1.0, -0.3]), true);
  for (const [dy, len] of [[0.9, 1.1], [1.3, 0.8], [1.7, 0.55]]) flat(P.pipe, at(box(len, 0.045, 0.045), [-1.8, ay + dy, -0.3]), true);
  flat(P.pipe, at(cyl(0.34, 0.06, 0.14, 12).rotateX(Math.PI / 2 - 0.35), [-1.55, ay + 0.55, 0.1]), true);
  flat(K.red, at(blob(0.09, 0.09, 0.09, 0), [-1.8, ay + 2.2, -0.3]), true);
  basic(K.yellow, at(blob(0.05, 0.05, 0.05, 0), [-1.8, ay + 2.32, -0.3]));
  flat(P.iron, at(cyl(0.13, 0.13, 1.1, 8), [1.6, gableY(R, -1.2) + 0.55, -1.2]), true);
  flat(P.iron, at(cyl(0.18, 0.18, 0.1, 8), [1.6, gableY(R, -1.2) + 1.12, -1.2]), true);
  [[0.08, 1.7, 0.26], [0.3, 2.25, 0.34]].forEach(([dx, dy, r]) => flat(K.white, at(blob(r, r * 0.85, r, 1), [1.6 + dx, gableY(R, -1.2) + dy, -1.2]), true));
  downpipe(w / 2 + 0.05, zF + 0.08, H - 0.1);
  downpipe(-w / 2 - 0.05, zF + 0.08, H - 0.1);
  hangSign(b, 'how', 2.95, { sc: 1 });
  // cable drum on the front right (lying on its side)
  const dx = 1.9, dz = zF + 0.7;
  for (const s of [-1, 1]) flat(P.woodLight, at(cyl(0.5, 0.5, 0.08, 14), [dx + s * 0.28, 0.5, dz], [0, 0, Math.PI / 2]), true);
  flat(P.woodDark, at(cyl(0.18, 0.18, 0.5, 10), [dx, 0.5, dz], [0, 0, Math.PI / 2]), true);
  for (const s of [-0.12, 0, 0.12]) flat(P.iron, at(cyl(0.32, 0.32, 0.08, 14), [dx + s, 0.5, dz], [0, 0, Math.PI / 2]), true);
  flat(P.iron, at(cyl(0.025, 0.025, 0.9, 6), [dx + 0.1, 0.12, dz + 0.5], [0, 0, Math.PI / 2 - 0.1]), false);
  return [{ x: b.x + dx, z: b.z + dz, r: 0.55 }];
}

// ================================================================== NEWS (kiosk)
function buildNews(b) {
  const w = b.w, d = b.d, H = 2.9, zF = d / 2, F = frameF(b), E = frameE(b);
  const wallBase = P.cream;
  walls(w, d, H, 'woodPlanks', wallBase);
  const R = gableRoof({ w, d, y0: H, h: 1.0, ox: 0.35, oz: 0.55, kind: 'roofShingles', base: P.roofRed, gKind: 'woodPlanks', gBase: wallBase });
  // door in the middle, serving windows either side with counters
  door(F, 0, 0.84, 1.95, { color: K.mascot, glazed: true });
  FB(F, K.red, 0.7, 0.03, 0.4, 0, 0, 0.6, false);
  for (const s of [-1, 1]) {
    win(F, s * 1.08, 1.6, 0.8, 0.9, { mull: 'v', curtain: s < 0 ? K.red : K.yellow, sill: false });
    FB(F, P.woodLight, 1.15, 0.08, 0.38, s * 1.08, 0.93, 0.22);
    FB(F, P.woodDark, 1.2, 0.05, 0.4, s * 1.08, 0.88, 0.22, false);
    FB(F, P.woodDark, 1.1, 0.5, 0.04, s * 1.08, 0.42, 0.14, false);
    for (const k of [-1, 1]) FB(F, P.wood, 0.07, 0.5, 0.07, s * 1.08 + k * 0.5, 0.42, 0.4, false);
  }
  awning(F, 0, 3.55, 2.62, 0.85, 0.34, 8);
  steps(F, 0, 1.2, 0.5);
  // counters: stacks of papers + magazines
  const paper = (u, y0, ww, hh, dd, col, rot = 0) => FB(F, col, ww, hh, dd, u, y0, 0.24, true, [0, rot, 0]);
  paper(-1.35, 1.01, 0.34, 0.14, 0.26, P.paper, 0.1);
  paper(-1.33, 1.15, 0.3, 0.05, 0.22, K.yellow, -0.15);
  paper(-0.9, 1.01, 0.3, 0.06, 0.24, K.red);
  paper(-0.88, 1.07, 0.28, 0.05, 0.22, P.paper, 0.2);
  paper(0.85, 1.01, 0.36, 0.18, 0.26, P.paper, -0.1);
  paper(0.86, 1.19, 0.3, 0.05, 0.22, K.purple, 0.12);
  paper(1.3, 1.01, 0.28, 0.1, 0.22, K.mascot);
  FB(F, P.black, 0.3, 0.02, 0.03, 0.85, 1.12, 0.38, false);
  // hanging blackboard menu board
  FB(F, P.woodDark, 0.62, 0.5, 0.05, 1.12, 2.0, 0.08, false);
  // posters on the east wall
  const poster = (u, y, ww, hh, c1, c2) => {
    FB(E, c1, ww, hh, 0.03, u, y, 0.04, true);
    FB(E, c2, ww * 0.7, hh * 0.28, 0.034, u, y + hh * 0.58, 0.045, false);
    FB(E, P.black, ww * 0.6, 0.03, 0.035, u, y + hh * 0.38, 0.046, false);
    FB(E, P.black, ww * 0.45, 0.03, 0.035, u, y + hh * 0.26, 0.046, false);
    FB(E, c2, ww * 0.3, hh * 0.12, 0.034, u, y + hh * 0.08, 0.046, false);
  };
  poster(-0.62, 1.2, 0.5, 0.7, P.paper, K.red);
  poster(0.1, 1.55, 0.44, 0.58, K.yellow, K.purple);
  poster(0.62, 1.15, 0.4, 0.55, K.lavender, K.red);
  win(E, -0.3, 1.7, 0.5, 0.0001, { sill: false });
  downpipe(w / 2 + 0.05, zF + 0.08, H - 0.1);
  downpipe(-w / 2 - 0.05, zF + 0.08, H - 0.1);
  numberPlate(F, 'n3', -0.78, 2.35);
  lampOn(F, 1.0, 2.35 + 0.0);
  pennantString(F, -1.85, 1.85, 2.78, 2.78, 0.2, 9, 0.22);
  hangSign(b, 'news', 2.35, { len: 1.8, z: zF - 0.3 });
  // bundles of newspapers by the door
  BX(P.paper, 0.5, 0.2, 0.4, -1.1, 0, zF + 0.55, true, [0, 0.2, 0]);
  BX(P.black, 0.52, 0.04, 0.05, -1.1, 0.1, zF + 0.55, false, [0, 0.2, 0]);
  BX(P.paper, 0.46, 0.18, 0.36, -1.08, 0.2, zF + 0.52, true, [0, -0.1, 0]);
  BX(K.red, 0.48, 0.04, 0.05, -1.08, 0.3, zF + 0.5, false, [0, -0.1, 0]);
  // newspaper rack + notice board on the east
  const rx = w / 2 + 0.55, rz = zF - 1.6;
  BX(P.wood, 0.1, 1.5, 0.1, rx - 0.3, 0, rz - 0.55);
  BX(P.wood, 0.1, 1.5, 0.1, rx - 0.3, 0, rz + 0.55);
  BX(P.wood, 0.1, 1.25, 0.1, rx + 0.35, 0, rz - 0.55);
  BX(P.wood, 0.1, 1.25, 0.1, rx + 0.35, 0, rz + 0.55);
  for (let i = 0; i < 3; i++) {
    const y = 0.4 + i * 0.4;
    flat(P.woodLight, at(box(0.8, 0.06, 1.2), [rx + 0.03, y, rz], [0, 0, 0.0]), true);
    for (let k = 0; k < 4; k++) {
      flat([P.paper, K.yellow, K.lavender, K.red][(i + k) % 4], at(box(0.34, 0.04, 0.25), [rx + 0.05, y + 0.1 + 0.01 * k, rz - 0.45 + k * 0.3], [0, 0.0, -0.35]), true);
    }
  }
  flat(P.woodDark, at(box(0.9, 0.12, 1.3), [rx, 1.55, rz]), true);
  flat(K.red, at(box(0.7, 0.1, 1.2), [rx, 1.65, rz]), false);
  return [{ x: b.x + rx, z: b.z + rz, r: 0.75 }];
}

// ================================================================== POST (post office)
function buildPost(b) {
  const w = b.w, d = b.d, H = 3.0, zF = d / 2, F = frameF(b), E = frameE(b);
  const wallBase = P.brick;
  walls(w, d, H, 'brick', wallBase, { corner: P.cream, plate: P.cream });
  const R = gableRoof({ w, d, y0: H, h: 1.5, ox: 0.4, oz: 0.5, kind: 'roofShingles', base: P.roofPurple, gKind: 'brick', gBase: wallBase });
  dormer(R, 0, { w: 1.2, hd: 0.85, back: 0.6, shutter: K.red, curtain: K.cream, round: true });
  chimney(R, -1.6, -0.6, H + 2.0, { w: 0.75 });
  // door
  door(F, 0, 1.05, 2.05, { color: K.red, slot: true, glazed: false });
  steps(F, 0, 1.5, 0.75);
  porch(F, 0, 1.5, 0.75, 2.34, 'roofShingles', P.roofPurple, { posts: false });
  FB(F, K.red, 0.9, 0.03, 0.5, 0, 0, 1.15, false);
  FB(F, K.white, 0.9, 0.032, 0.06, 0, 0, 1.07, false);
  // window with flower box
  win(F, -1.75, 1.65, 0.9, 1.1, { shutter: K.red, flowers: true, curtain: K.cream, trim: P.cream });
  // wall of mailboxes under its own little roof
  const mu = 1.65;
  FT(F, 'woodVertical', mix(K.mascot, K.white, 0.1), 1.45, 1.78, 0.08, mu, 0.52, 0.05, true);
  const cols = [K.red, K.yellow, K.purple, K.white];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
    const mx = mu + (c - 1) * 0.45, my = 0.62 + r * 0.43, col = cols[(r + c) % 4];
    FB(F, col, 0.37, 0.34, 0.16, mx, my, 0.16, true);
    FB(F, mix(col, K.white, 0.25), 0.3, 0.26, 0.02, mx, my + 0.04, 0.245, false);
    FB(F, K.black, 0.03, 0.06, 0.02, mx + 0.08, my + 0.12, 0.26, false);
    FB(F, P.black, 0.12, 0.025, 0.02, mx - 0.05, my + 0.2, 0.26, false);
  }
  FB(F, P.woodDark, 1.62, 0.1, 0.22, mu, 2.28, 0.12, true);
  tex('roofShingles', P.roofPurple, UPR, at(box(1.8, 0.09, 0.62), [mu, 2.44, 0.2], [0.35, 0, 0], F), true);
  FB(F, P.woodDark, 0.1, 1.9, 0.12, mu - 0.8, 0.42, 0.06, false);
  FB(F, P.woodDark, 0.1, 1.9, 0.12, mu + 0.8, 0.42, 0.06, false);
  // envelope emblem above the mail wall
  FB(F, K.white, 0.7, 0.45, 0.06, mu, 2.62, 0.08, true);
  FB(F, K.red, 0.62, 0.04, 0.07, mu - 0.17, 2.82, 0.09, false, [0, 0, -0.55]);
  FB(F, K.red, 0.62, 0.04, 0.07, mu + 0.17, 2.82, 0.09, false, [0, 0, 0.55]);
  lampOn(F, -0.95, 2.2);
  numberPlate(F, 'n5', 0.95, 1.85);
  // parcels
  const px = -0.9, pz = zF + 0.5;
  BX(P.cardboard, 0.6, 0.38, 0.45, px, 0, pz, true, [0, 0.15, 0]);
  BX(K.red, 0.62, 0.04, 0.08, px, 0.17, pz, false, [0, 0.15, 0]);
  BX(P.cardboard, 0.45, 0.3, 0.34, px + 0.02, 0.38, pz, true, [0, -0.2, 0]);
  BX(K.black, 0.04, 0.32, 0.36, px + 0.02, 0.38, pz, false, [0, -0.2, 0]);
  BX(P.paper, 0.2, 0.12, 0.02, px - 0.1, 0.5, pz + 0.18, false, [0, -0.2, 0]);
  // east wall
  win(E, -0.7, 1.65, 0.9, 1.1, { shutter: K.red, curtain: K.cream, trim: P.cream });
  win(E, 0.95, 1.65, 0.9, 1.1, { shutter: K.red, curtain: K.cream, trim: P.cream, flowers: true });
  downpipe(w / 2 + 0.05, zF + 0.08, H - 0.1);
  downpipe(-w / 2 - 0.05, zF + 0.08, H - 0.1);
  hangSign(b, 'post', 2.55, { len: 1.8, z: zF - 0.3 });
  // mast for the weather vane (the vane itself animates, see below)
  const ridge = H + R.h;
  flat(P.black, at(cyl(0.03, 0.04, 1.0, 6), [0.9, ridge + 0.5, 0]), false);
  BX(P.black, 0.9, 0.03, 0.03, 0.9, ridge + 0.74, 0, false);
  BX(P.black, 0.03, 0.03, 0.9, 0.9, ridge + 0.74, 0, false);
  for (const [dx, dz, c] of [[0.5, 0, K.red], [-0.5, 0, K.yellow], [0, 0.5, K.white], [0, -0.5, K.purple]]) flat(c, at(blob(0.06, 0.06, 0.06, 0), [0.9 + dx, ridge + 0.74, dz]), false);
  // freestanding mailbox out front
  const mx = 3.2, mz = zF + 0.6;
  BX(P.wood, 0.14, 1.0, 0.14, mx, 0, mz);
  flat(K.red, at(box(0.7, 0.45, 0.5), [mx, 1.15, mz]), true);
  flat(K.red, at(cyl(0.25, 0.25, 0.7, 12), [mx, 1.37, mz], [0, 0, Math.PI / 2]), true);
  BX(K.yellow, 0.05, 0.4, 0.05, mx + 0.42, 1.25, mz + 0.1, true);
  BX(K.yellow, 0.2, 0.12, 0.05, mx + 0.52, 1.62, mz + 0.1, true);
  return [{ x: b.x + mx, z: b.z + mz, r: 0.4 }, { x: b.x + px, z: b.z + pz, r: 0.35 }];
}

// ================================================================== assemble
const BUILDERS = { products: buildProducts, about: buildAbout, how: buildHow, news: buildNews, post: buildPost };

export function createTownBuildings() {
  resetBuckets();
  mats();
  const group = new THREE.Group();
  group.name = 'town-buildings';
  const colliders = [];
  const extra = {};
  const postB = BUILDINGS.find((b) => b.id === 'post');
  for (const b of BUILDINGS) {
    T = new THREE.Matrix4().makeTranslation(b.x, 0, b.z);
    colliders.push({ type: 'box', minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2 });
    const extras = BUILDERS[b.id]?.(b, extra) ?? [];
    colliders.push(...extras);
  }
  T = new THREE.Matrix4();

  if (flatGeos.length) {
    const m = new THREE.Mesh(mergeGeometries(flatGeos, false), flatMat);
    m.name = 'bld-flat'; m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }
  for (const { kind, base, geos } of texBuckets.values()) {
    const m = new THREE.Mesh(mergeGeometries(geos, false), texturedToon(kind, base));
    m.name = `bld-${kind}`; m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }
  if (basicGeos.length) {
    const m = new THREE.Mesh(mergeGeometries(basicGeos, false), basicMat);
    m.name = 'bld-glow';
    group.add(m);
  }
  if (hullGeos.length) {
    const dummy = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    addOutline(dummy, OUT);
    const hull = dummy.children[0];
    hull.geometry = mergeGeometries(hullGeos, false);
    hull.name = 'bld-outline';
    group.add(hull);
  }
  if (glassGeos.length) {
    const m = new THREE.Mesh(mergeGeometries(glassGeos, false), glassMat);
    m.name = 'bld-glass'; m.renderOrder = 2;
    group.add(m);
  }
  const atlas = plateGeos.length ? makeAtlas() : null;
  if (atlas) {
    const m = new THREE.Mesh(mergeGeometries(plateGeos, false), new THREE.MeshBasicMaterial({ map: atlas, alphaTest: 0.5 }));
    m.name = 'bld-signs';
    group.add(m);
  }
  // animated envelope weather vane on the post office (spins just above the mast cross-bars)
  const vane = makeVane();
  vane.position.set(postB.x + 0.9, 3.0 + 1.5 + 0.9, postB.z);
  group.add(vane);

  resetBuckets();
  const update = (t) => {
    vane.rotation.y = Math.sin(t * 0.45) * 0.9 + Math.sin(t * 1.3) * 0.12 + 0.6;
  };
  group.userData.stats = { colliders: colliders.length };
  return { object3d: group, colliders, update, extra };
}
