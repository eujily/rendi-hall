import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMesh, toonMaterial, flatMaterial } from '../kit/toon.js';
import { COLORS, mix } from '../core/tokens.js';
import {
  TOWN, BUILDINGS, PLAZA, PLACES, PRODUCTS_DOOR, TOWN_SPAWN, TOWN_FROM_HALL, TOWN_VILLAGERS, BUGS,
} from '../core/layout.js';

// Rendi Town: a cosy Stardew-style village in brand flats + black outlines.
// Built once in TOWN-LOCAL coordinates; static geometry of one colour is merged into one
// mesh (+ its outline hull) so the whole town stays around 45 draw calls.

const OUT = 0.03; // one hull thickness for every bucket (keeps draw calls low)

// ---------- derived town colours (mixes of the brand palette only) ----------
const C = {
  wall: COLORS.wall,
  cream: mix(COLORS.yellow, COLORS.white, 0.62),
  lilac: mix(COLORS.lavender, COLORS.mascot, 0.5),
  roofLight: mix(COLORS.purple, COLORS.white, 0.4),
  stone: mix(COLORS.lavender, COLORS.black, 0.06),
  cobble: mix(COLORS.lavender, COLORS.mascot, 0.55),
  plaza: mix(COLORS.lavender, COLORS.mascot, 0.25),
  sand: mix(COLORS.yellow, COLORS.white, 0.55),
  wood: COLORS.wood,
  woodLight: mix(COLORS.wood, COLORS.yellow, 0.4),
  leaf: COLORS.sage,
  leafLight: mix(COLORS.sage, COLORS.white, 0.3),
  leafDark: mix(COLORS.sage, COLORS.black, 0.16),
  water: mix(COLORS.mascot, COLORS.white, 0.2),
  glass: mix(COLORS.yellow, COLORS.white, 0.5),
  glow: mix(COLORS.yellow, COLORS.white, 0.18),
  grass: [mix(COLORS.sage, COLORS.white, 0.34), mix(COLORS.sage, COLORS.white, 0.24), mix(mix(COLORS.sage, COLORS.yellow, 0.18), COLORS.white, 0.26)],
};
const FLOWER = [COLORS.red, COLORS.yellow, COLORS.purple, COLORS.white];

// ---------- tiny helpers ----------
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
function matrix(p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
  _q.setFromEuler(_e.set(r[0], r[1], r[2]));
  return new THREE.Matrix4().compose(_v.set(p[0], p[1], p[2]), _q, _s.set(s[0], s[1], s[2]));
}
const xf = (geo, p, r, s) => geo.applyMatrix4(matrix(p, r, s));
const rnd = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, seg = 16) => new THREE.CylinderGeometry(rt, rb, h, seg);
const blob = (rx, ry, rz, detail = 1) => new THREE.IcosahedronGeometry(1, detail).scale(rx, ry, rz);
const flatDisc = (r, seg = 40) => new THREE.CircleGeometry(r, seg).rotateX(-Math.PI / 2);
const flatRect = (w, d) => new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);

// bucket kinds: 'o' outlined toon | 'f' flat toon (no outline, no shadow) | 'b' basic unlit
const buckets = new Map();
function put(kind, color, geo, o = OUT) {
  o = o > 0 ? OUT : 0;
  const key = `${kind}|${color}|${kind === 'o' ? o : 0}`;
  if (!buckets.has(key)) buckets.set(key, { kind, color, o, geos: [] });
  buckets.get(key).geos.push(geo);
  return geo;
}
const add = (color, geo, o = OUT) => put('o', color, geo, o);
const addThin = (color, geo) => put('o', color, geo, 0); // poles, strings: no hull
const addFlat = (color, geo) => put('f', color, geo);
const addBasic = (color, geo) => put('b', color, geo);

function prep(g) {
  const out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'normal') out.deleteAttribute(name);
  }
  return out;
}
function flushBuckets(group) {
  for (const [key, { kind, color, o, geos }] of buckets) {
    const merged = mergeGeometries(geos.map(prep), false);
    let mesh;
    if (kind === 'o') mesh = toonMesh(merged, color, { outline: o, cast: true, receive: true });
    else if (kind === 'f') {
      mesh = new THREE.Mesh(merged, toonMaterial(color));
      mesh.receiveShadow = true;
    } else mesh = new THREE.Mesh(merged, flatMaterial(color));
    mesh.name = `town-${key}`;
    group.add(mesh);
  }
  buckets.clear();
}

// ---------- keep-free zones ----------
const KEEP = [];
const SEGS = [];
PLACES.forEach((p) => KEEP.push({ x: p.x, z: p.z, r: 1.6 }));
for (const p of [PRODUCTS_DOOR, TOWN_SPAWN, TOWN_FROM_HALL]) KEEP.push({ x: p.x, z: p.z, r: 1.6 });
BUGS.filter((b) => b.zone === 'town').forEach((b) => KEEP.push({ x: b.x, z: b.z, r: 1.2 }));
TOWN_VILLAGERS.forEach((v) => {
  v.waypoints.forEach((w, i) => {
    KEEP.push({ x: w.x, z: w.z, r: 0.8 });
    const n = v.waypoints[(i + 1) % v.waypoints.length];
    SEGS.push([w.x, w.z, n.x, n.z]);
  });
});
function segDist(px, pz, [ax, az, bx, bz]) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
function blocked(x, z, r = 0) {
  for (const k of KEEP) if (Math.hypot(x - k.x, z - k.z) < k.r + r) return true;
  for (const s of SEGS) if (segDist(x, z, s) < 0.8 + r) return true;
  return false;
}

// ---------- paths (dirt) : axis-aligned rects, drawn flat ----------
const PATHS = [
  { minX: -1, maxX: 1, minZ: -6.6, maxZ: 13.6 }, // spawn -> plaza -> products
  { minX: -14, maxX: 14, minZ: -3.4, maxZ: -1.6 }, // east-west road in front of the row of shops
  { minX: -13.9, maxX: -12.1, minZ: -4.6, maxZ: -2.5 }, // about door
  { minX: 12.1, maxX: 13.9, minZ: -4.6, maxZ: -2.5 }, // how door
  { minX: -16, maxX: 13.5, minZ: 10.0, maxZ: 11.8 }, // south road: news / spawn / post
  { minX: -12.9, maxX: -11.1, minZ: 9.2, maxZ: 10.2 }, // news door
];
const PLAZA_R = 4.0;
const POND = { x: -17.5, z: 12.8, rx: 3.0, rz: 2.2 };
function onGround(x, z, m = 0.5) {
  for (const p of PATHS) if (x > p.minX - m && x < p.maxX + m && z > p.minZ - m && z < p.maxZ + m) return true;
  if (Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA_R + m) return true;
  for (const b of BUILDINGS) if (Math.abs(x - b.x) < b.w / 2 + m + 0.5 && Math.abs(z - b.z) < b.d / 2 + m + 0.5) return true;
  if (((x - POND.x) / (POND.rx + m)) ** 2 + ((z - POND.z) / (POND.rz + m)) ** 2 < 1) return true;
  return false;
}

// ---------- sign atlas (one canvas, one draw call) ----------
const ATLAS_W = 2048, ATLAS_H = 1536;
const SIGNS = {
  products: { x: 0, y: 0, w: 1792, h: 416, ww: 5.6, wh: 1.3, text: 'PRODUCTS' },
  about: { x: 0, y: 432, w: 800, h: 300, ww: 2.0, wh: 0.75, text: 'About' },
  how: { x: 816, y: 432, w: 1100, h: 300, ww: 2.75, wh: 0.75, text: 'How we work' },
  news: { x: 0, y: 748, w: 640, h: 300, ww: 1.5, wh: 0.7, text: 'News' },
  post: { x: 656, y: 748, w: 640, h: 300, ww: 1.5, wh: 0.7, text: 'Post' },
  aProducts: { x: 0, y: 1064, w: 600, h: 160, ww: 1.5, wh: 0.4, text: 'Products', arrow: 'R', fill: COLORS.yellow },
  aAbout: { x: 616, y: 1064, w: 600, h: 160, ww: 1.5, wh: 0.4, text: 'About', arrow: 'L', fill: COLORS.white },
  aHow: { x: 1232, y: 1064, w: 600, h: 160, ww: 1.5, wh: 0.4, text: 'How we work', arrow: 'R', fill: COLORS.purple },
  aNews: { x: 0, y: 1240, w: 600, h: 160, ww: 1.5, wh: 0.4, text: 'News', arrow: 'L', fill: COLORS.red },
  aPost: { x: 616, y: 1240, w: 600, h: 160, ww: 1.5, wh: 0.4, text: 'Post', arrow: 'R', fill: COLORS.mascot },
};
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;

function makeAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_H;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const draw = () => {
    ctx.clearRect(0, 0, ATLAS_W, ATLAS_H);
    for (const s of Object.values(SIGNS)) {
      const { x, y, w, h } = s;
      ctx.save();
      ctx.translate(x, y);
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(6, h * 0.035);
      ctx.strokeStyle = hex(COLORS.black);
      ctx.fillStyle = hex(s.fill ?? COLORS.yellow);
      const pad = ctx.lineWidth;
      let tx0 = 0, tx1 = w;
      if (s.arrow) {
        const head = h * 0.42;
        const L = s.arrow === 'L';
        const a = pad, b = w - pad;
        ctx.beginPath();
        if (L) {
          ctx.moveTo(a, h / 2); ctx.lineTo(a + head, pad); ctx.lineTo(b, pad); ctx.lineTo(b, h - pad); ctx.lineTo(a + head, h - pad);
          tx0 = head; tx1 = w;
        } else {
          ctx.moveTo(b, h / 2); ctx.lineTo(b - head, pad); ctx.lineTo(a, pad); ctx.lineTo(a, h - pad); ctx.lineTo(b - head, h - pad);
          tx0 = 0; tx1 = w - head;
        }
        ctx.closePath();
      } else {
        ctx.beginPath();
        ctx.roundRect(pad, pad, w - 2 * pad, h - 2 * pad, h * 0.16);
      }
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = hex(COLORS.black);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let fs = h * (s.arrow ? 0.5 : 0.56);
      const maxW = (tx1 - tx0) * (s.arrow ? 0.82 : 0.86);
      ctx.font = `italic 800 ${fs}px Montserrat, system-ui, sans-serif`;
      const mw = ctx.measureText(s.text).width;
      if (mw > maxW) {
        fs *= maxW / mw;
        ctx.font = `italic 800 ${fs}px Montserrat, system-ui, sans-serif`;
      }
      ctx.fillText(s.text, (tx0 + tx1) / 2, h / 2 + fs * 0.05);
      ctx.restore();
    }
    tex.needsUpdate = true;
  };
  draw();
  if (document.fonts?.load) document.fonts.load('italic 800 64px Montserrat').then(draw).catch(() => {});
  return tex;
}

const plateGeos = [];
/** Flat textured plate from the atlas; facing local +Z, centred at (x,y,z), yaw ry. */
function plate(id, x, y, z, ry = 0, tilt = 0) {
  const s = SIGNS[id];
  const g = new THREE.PlaneGeometry(s.ww, s.wh);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    const uu = uv.getX(i), vv = uv.getY(i);
    uv.setXY(i, (s.x + uu * s.w) / ATLAS_W, 1 - (s.y + (1 - vv) * s.h) / ATLAS_H);
  }
  xf(g, [x, y, z], [0, ry, tilt]);
  plateGeos.push(g);
}

// ---------- building kit ----------
// A "face frame": u along the face, y up, v outward. front = +Z face, east = +X face.
const faceM = (b, face) => (face === 'east' ? matrix([b.x + b.w / 2, 0, b.z], [0, Math.PI / 2, 0]) : matrix([b.x, 0, b.z + b.d / 2]));
const fbox = (M, color, w, h, d, u, y0, v, o = OUT, ry = 0) => add(color, xf(box(w, h, d), [u, y0 + h / 2, v], [0, ry, 0]).applyMatrix4(M), o);

const glassGeos = [];
const glowGeos = [];

function windowOn(M, u, y, w, h, { flowers = false, mull = true } = {}) {
  const t = 0.1, d = 0.14;
  fbox(M, COLORS.white, w + 2 * t, t, d, u, y + h / 2, d / 2);
  fbox(M, COLORS.white, w + 2 * t, t, d, u, y - h / 2 - t, d / 2);
  fbox(M, COLORS.white, t, h, d, u - w / 2 - t / 2, y - h / 2, d / 2);
  fbox(M, COLORS.white, t, h, d, u + w / 2 + t / 2, y - h / 2, d / 2);
  if (mull) {
    fbox(M, COLORS.white, 0.06, h, 0.08, u, y - h / 2, 0.06, 0);
    fbox(M, COLORS.white, w, 0.06, 0.08, u, y - 0.03, 0.06, 0);
  }
  fbox(M, COLORS.white, w + 0.36, 0.08, 0.3, u, y - h / 2 - t - 0.06, 0.15);
  glassGeos.push(xf(new THREE.PlaneGeometry(w, h), [u, y, 0.02]).applyMatrix4(M));
  if (flowers) {
    fbox(M, C.wood, w + 0.2, 0.24, 0.3, u, y - h / 2 - t - 0.32, 0.26);
    add(C.leafDark, xf(blob(w / 2 + 0.05, 0.14, 0.15), [u, y - h / 2 - t - 0.06, 0.26]).applyMatrix4(M));
    const n = Math.max(3, Math.round(w / 0.3));
    for (let i = 0; i < n; i++) {
      const fu = u - w / 2 + (w * (i + 0.5)) / n;
      add(FLOWER[(i + 1) % 4], xf(blob(0.08, 0.08, 0.08, 0), [fu, y - h / 2 - t + 0.04 + (i % 2) * 0.05, 0.3]).applyMatrix4(M), 0.02);
    }
  }
}

function doorOn(M, u, w, h, color, handle = true) {
  fbox(M, COLORS.mascot, w + 0.34, h + 0.17, 0.12, u, 0, 0.06);
  fbox(M, color, w, h, 0.1, u, 0, 0.1);
  if (handle) add(COLORS.yellow, xf(blob(0.07, 0.07, 0.07, 0), [u + w * 0.34, h * 0.45, 0.19]).applyMatrix4(M), 0.02);
  fbox(M, C.stone, w + 0.7, 0.12, 0.55, u, 0, 0.3);
}

/** Pitched roof, ridge along X, gable-end triangles in wall colour. */
function gableRoof(b, y0, h, roofColor, trimColor, overX = 0.3, overZ = 0.5) {
  const a = b.d / 2 + overZ;
  const L = b.w + 2 * overX;
  const sh = new THREE.Shape();
  sh.moveTo(-a, 0); sh.lineTo(a, 0); sh.lineTo(0, h); sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: L, bevelEnabled: false });
  g.translate(0, 0, -L / 2);
  g.rotateY(Math.PI / 2);
  add(roofColor, xf(g, [b.x, y0, b.z]));
  // gable triangle on both ends (inset, wall colour)
  const hw = b.d / 2 - 0.1;
  const tri = new THREE.Shape();
  const ta = hw, th = h * (1 - hw / a) - 0.2;
  tri.moveTo(-ta, 0.18); tri.lineTo(ta, 0.18); tri.lineTo(0, Math.max(th, 0.5)); tri.closePath();
  for (const sx of [-1, 1]) {
    const tg = new THREE.ExtrudeGeometry(tri, { depth: 0.06, bevelEnabled: false });
    tg.rotateY(sx > 0 ? Math.PI / 2 : -Math.PI / 2);
    add(trimColor, xf(tg, [b.x + sx * (b.w / 2 + overX), y0, b.z]), 0.02);
  }
  // ridge cap
  add(roofColor, xf(box(L + 0.1, 0.12, 0.3), [b.x, y0 + h + 0.02, b.z]));
}

function chimney(x, y0, z, hgt, puffs = true) {
  add(C.stone, xf(box(0.7, hgt, 0.7), [x, y0 + hgt / 2, z]));
  add(C.stone, xf(box(0.9, 0.14, 0.9), [x, y0 + hgt + 0.05, z]));
  if (puffs) {
    [[0.1, 0.55, 0.28], [0.3, 1.05, 0.38], [0.15, 1.6, 0.3]].forEach(([dx, dy, r]) => add(COLORS.white, xf(blob(r, r * 0.85, r, 1), [x + dx, y0 + hgt + dy, z]), 0.03));
  }
}

function awning(M, u, w, yTop, depth, drop, stripes = 6) {
  const sw = w / stripes;
  const len = Math.hypot(depth, drop);
  const ang = Math.atan2(drop, depth);
  for (let i = 0; i < stripes; i++) {
    const g = xf(box(sw, 0.07, len), [u - w / 2 + sw * (i + 0.5), yTop - drop / 2, depth / 2], [ang, 0, 0]).applyMatrix4(M);
    add(i % 2 ? COLORS.white : COLORS.red, g, 0.025);
  }
  // front valance
  for (let i = 0; i < stripes; i++) {
    add(i % 2 ? COLORS.white : COLORS.red, xf(box(sw, 0.16, 0.06), [u - w / 2 + sw * (i + 0.5), yTop - drop - 0.06, depth - 0.02]).applyMatrix4(M), 0.02);
  }
}

// ---------- props ----------
function tree(x, z, s = 1, seed = 0) {
  add(C.wood, xf(cyl(0.16 * s, 0.24 * s, 1.2 * s, 8), [x, 0.6 * s, z]));
  const j = (n) => (rnd(seed * 7 + n) - 0.5) * 0.3 * s;
  add(C.leaf, xf(blob(1.15 * s, 1.0 * s, 1.15 * s), [x, 2.1 * s, z]));
  add(C.leafLight, xf(blob(0.8 * s, 0.7 * s, 0.8 * s), [x - 0.7 * s + j(1), 1.75 * s, z + 0.35 * s + j(2)]));
  add(C.leafLight, xf(blob(0.7 * s, 0.65 * s, 0.7 * s), [x + 0.65 * s + j(3), 2.5 * s, z - 0.3 * s + j(4)]));
  add(C.leaf, xf(blob(0.6 * s, 0.55 * s, 0.6 * s), [x + 0.5 * s + j(5), 1.65 * s, z + 0.5 * s + j(6)]));
}
function bush(x, z, s = 1) {
  add(C.leaf, xf(blob(0.6 * s, 0.5 * s, 0.6 * s), [x, 0.4 * s, z]));
  add(C.leafLight, xf(blob(0.4 * s, 0.36 * s, 0.4 * s), [x + 0.4 * s, 0.3 * s, z + 0.12 * s]));
  add(C.leafLight, xf(blob(0.36 * s, 0.34 * s, 0.36 * s), [x - 0.34 * s, 0.28 * s, z - 0.1 * s]));
}
function potPlant(x, z, potColor, s = 1) {
  add(potColor, xf(cyl(0.3 * s, 0.22 * s, 0.45 * s, 14), [x, 0.225 * s, z]));
  add(potColor, xf(cyl(0.34 * s, 0.34 * s, 0.1 * s, 14), [x, 0.48 * s, z]));
  add(C.leaf, xf(blob(0.42 * s, 0.42 * s, 0.42 * s), [x, 0.95 * s, z]));
  add(C.leafLight, xf(blob(0.28 * s, 0.28 * s, 0.28 * s), [x + 0.15 * s, 1.3 * s, z - 0.05 * s]));
  add(COLORS.white, xf(blob(0.09, 0.09, 0.09, 0), [x - 0.22 * s, 1.1 * s, z + 0.3 * s]), 0.02);
  add(COLORS.red, xf(blob(0.09, 0.09, 0.09, 0), [x + 0.28 * s, 1.0 * s, z + 0.28 * s]), 0.02);
}
function lamp(x, z) {
  add(COLORS.black, xf(cyl(0.2, 0.26, 0.2, 12), [x, 0.1, z]), 0);
  addThin(COLORS.black, xf(cyl(0.05, 0.05, 2.2, 8), [x, 1.1, z]));
  add(COLORS.black, xf(cyl(0.2, 0.3, 0.12, 12), [x, 2.28, z]), 0);
  add(COLORS.yellow, xf(box(0.34, 0.5, 0.34), [x, 2.0, z]), 0.03);
  add(COLORS.black, xf(box(0.46, 0.08, 0.46), [x, 2.3, z]), 0);
  addBasic(C.glow, xf(box(0.3, 0.46, 0.36), [x, 2.0, z]));
}
function bench(x, z, ry) {
  const M = matrix([x, 0, z], [0, ry, 0]);
  const p = (color, geo, pos) => add(color, xf(geo, pos).applyMatrix4(M), 0.03);
  p(C.wood, box(2.2, 0.1, 0.6), [0, 0.5, 0]);
  p(C.wood, box(2.2, 0.45, 0.07), [0, 0.88, -0.27]);
  for (const sx of [-0.95, 0.95]) for (const sz of [-0.22, 0.22]) p(C.wood, box(0.1, 0.5, 0.1), [sx, 0.25, sz]);
  p(COLORS.purple, box(0.5, 0.14, 0.4), [-0.45, 0.62, 0.02]);
}
function barrel(x, z, s = 1) {
  add(C.wood, xf(cyl(0.38 * s, 0.38 * s, 0.8 * s, 14), [x, 0.4 * s, z]));
  add(COLORS.black, xf(cyl(0.395 * s, 0.395 * s, 0.07 * s, 14), [x, 0.2 * s, z]), 0);
  add(COLORS.black, xf(cyl(0.395 * s, 0.395 * s, 0.07 * s, 14), [x, 0.6 * s, z]), 0);
}
function crate(x, y0, z, s = 0.8, ry = 0) {
  add(C.woodLight, xf(box(s, s, s), [x, y0 + s / 2, z], [0, ry, 0]));
  const M = matrix([x, y0 + s / 2, z], [0, ry, 0]);
  add(C.wood, xf(box(s + 0.04, 0.1, s + 0.04), [0, s * 0.3, 0]).applyMatrix4(M), 0.02);
  add(C.wood, xf(box(s + 0.04, 0.1, s + 0.04), [0, -s * 0.3, 0]).applyMatrix4(M), 0.02);
}
function bed(x, z, w, d, seed) {
  const t = 0.12, h = 0.3;
  add(C.wood, xf(box(w, h, t), [x, h / 2, z - d / 2 + t / 2]), 0.025);
  add(C.wood, xf(box(w, h, t), [x, h / 2, z + d / 2 - t / 2]), 0.025);
  add(C.wood, xf(box(t, h, d - 2 * t), [x - w / 2 + t / 2, h / 2, z]), 0.025);
  add(C.wood, xf(box(t, h, d - 2 * t), [x + w / 2 - t / 2, h / 2, z]), 0.025);
  add(C.leafDark, xf(box(w - 2 * t, 0.26, d - 2 * t), [x, 0.13, z]), 0);
  const step = 0.42;
  let i = 0;
  for (let fx = x - w / 2 + 0.3; fx < x + w / 2 - 0.2; fx += step) {
    for (let fz = z - d / 2 + 0.3; fz < z + d / 2 - 0.2; fz += step) {
      const k = seed * 13 + i++;
      add(FLOWER[Math.floor(rnd(k) * 4)], xf(blob(0.12, 0.1, 0.12, 0), [fx + (rnd(k + 3) - 0.5) * 0.12, 0.36 + rnd(k + 5) * 0.06, fz + (rnd(k + 9) - 0.5) * 0.12]), 0.02);
    }
  }
}
function fence(x0, z0, x1, z1, step = 1.1) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / step));
  const ang = Math.atan2(-(z1 - z0), x1 - x0);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    add(C.wood, xf(box(0.14, 0.85, 0.14), [x0 + (x1 - x0) * t, 0.42, z0 + (z1 - z0) * t]), 0.025);
  }
  for (const y of [0.3, 0.62]) {
    add(C.woodLight, xf(box(len, 0.1, 0.07), [(x0 + x1) / 2, y, (z0 + z1) / 2], [0, ang, 0]), 0.02);
  }
}

// ---------- main ----------
export function createTown() {
  const group = new THREE.Group();
  group.name = 'town';
  const colliders = [];
  const circle = (x, z, r) => colliders.push({ x, z, r });
  const bbox = (minX, maxX, minZ, maxZ) => colliders.push({ type: 'box', minX, maxX, minZ, maxZ });
  /** place a solid prop only when it stays out of the keep-free zones */
  const solid = (x, z, r, build) => {
    if (blocked(x, z, r)) return false;
    build();
    if (r > 0) circle(x, z, r);
    return true;
  };

  // ---- grass: three-tone checker + noise, instanced ----
  {
    const x0 = TOWN.minX - 5, x1 = TOWN.maxX + 5, z0 = TOWN.minZ - 5, z1 = TOWN.maxZ + 5;
    const mats = [[], [], []];
    for (let x = x0; x < x1; x++) {
      for (let z = z0; z < z1; z++) {
        const n = rnd(x * 31.7 + z * 17.3);
        const k = (x + z) % 2 === 0 ? (n > 0.82 ? 2 : 0) : n > 0.8 ? 2 : 1;
        mats[k].push(matrix([x + 0.5, 0, z + 0.5]));
      }
    }
    const tile = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    mats.forEach((list, i) => {
      const inst = new THREE.InstancedMesh(tile, toonMaterial(C.grass[i]), list.length);
      list.forEach((m, idx) => inst.setMatrixAt(idx, m));
      inst.instanceMatrix.needsUpdate = true;
      inst.receiveShadow = true;
      inst.name = `town-grass-${i}`;
      group.add(inst);
    });
  }

  // ---- dirt paths ----
  for (const p of PATHS) addFlat(C.sand, xf(flatRect(p.maxX - p.minX, p.maxZ - p.minZ), [(p.minX + p.maxX) / 2, 0.03, (p.minZ + p.maxZ) / 2]));
  // little pebbles on the paths
  for (let i = 0; i < 40; i++) {
    const p = PATHS[i % PATHS.length];
    const px = p.minX + 0.3 + rnd(i * 3 + 1) * (p.maxX - p.minX - 0.6);
    const pz = p.minZ + 0.3 + rnd(i * 3 + 2) * (p.maxZ - p.minZ - 0.6);
    if (Math.hypot(px - PLAZA.x, pz - PLAZA.z) < PLAZA_R + 0.3) continue;
    addFlat(C.cobble, xf(blob(0.1 + rnd(i) * 0.06, 0.012, 0.08, 0), [px, 0.04, pz], [0, rnd(i + 4) * 3, 0]));
  }

  // ---- plaza: raised cobble disc, ring pattern, deploy-pad ring, fountain ----
  {
    const { x, z } = PLAZA;
    add(C.plaza, xf(cyl(PLAZA_R, PLAZA_R + 0.08, 0.14, 48), [x, 0.07, z]), 0.03);
    // cobble ring pattern: alternating tiles
    const n = 26;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = 3.4;
      addFlat(C.cobble, xf(box(0.72, 0.012, 0.5), [x + Math.cos(a) * rr, 0.146, z + Math.sin(a) * rr], [0, -a, 0]));
      if (i % 2 === 0) addFlat(C.cobble, xf(box(0.5, 0.012, 0.4), [x + Math.cos(a) * 2.8, 0.146, z + Math.sin(a) * 2.8], [0, -a, 0]));
    }
    // yellow deploy ring around the basin
    const ring = new THREE.RingGeometry(2.1, 2.3, 48).rotateX(-Math.PI / 2);
    xf(ring, [x, 0.152, z]);
    addFlat(COLORS.yellow, ring);
    // basin
    add(COLORS.wall, xf(cyl(1.75, 1.85, 0.3, 40), [x, 0.29, z]), 0.03);
    const rim = new THREE.TorusGeometry(1.62, 0.18, 8, 40).rotateX(Math.PI / 2);
    add(COLORS.wall, xf(rim, [x, 0.46, z]), 0.03);
    // pedestal, bowl
    add(COLORS.wall, xf(cyl(0.3, 0.42, 0.55, 14), [x, 0.6, z]), 0.03);
    add(COLORS.wall, xf(cyl(0.62, 0.34, 0.2, 18), [x, 0.95, z]), 0.03);
    circle(x, z, 1.85);
  }

  // ---- pond with lily pads ----
  {
    const g = flatDisc(1, 40);
    xf(g, [POND.x, 0.06, POND.z], [0, 0, 0], [POND.rx, 1, POND.rz]);
    addFlat(C.water, g);
    // stone border
    const n = 22;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const s = 0.2 + rnd(i + 3) * 0.14;
      add(C.stone, xf(blob(s * 1.3, s * 0.8, s, 1), [POND.x + Math.cos(a) * (POND.rx + 0.1), 0.12, POND.z + Math.sin(a) * (POND.rz + 0.1)], [0, a, 0]), 0.03);
    }
    [[-0.9, 0.3, 0.38], [0.8, -0.4, 0.3], [0.2, 0.7, 0.28], [-0.2, -0.6, 0.34], [1.5, 0.3, 0.24]].forEach(([dx, dz, r], i) => {
      const lp = new THREE.CylinderGeometry(r, r, 0.03, 12);
      add(C.leaf, xf(lp, [POND.x + dx, 0.09, POND.z + dz], [0, i, 0]), 0.02);
    });
    add(COLORS.white, xf(blob(0.13, 0.1, 0.13, 1), [POND.x - 0.9, 0.17, POND.z + 0.3]), 0.02);
    add(COLORS.yellow, xf(blob(0.05, 0.05, 0.05, 0), [POND.x - 0.9, 0.24, POND.z + 0.3]), 0.01);
    add(COLORS.red, xf(blob(0.12, 0.09, 0.12, 1), [POND.x + 0.8, 0.16, POND.z - 0.4]), 0.02);
    circle(POND.x - 1.5, POND.z, 1.9);
    circle(POND.x + 1.2, POND.z, 1.9);
    circle(POND.x + 3.0, POND.z, 0.4);
  }

  // ---- buildings ----
  const glowFloor = [];
  for (const b of BUILDINGS) {
    bbox(b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2);
    const F = faceM(b, 'front');
    const E = faceM(b, 'east');
    const top = b.z + b.d / 2;
    if (b.id === 'products') {
      const H = 4.6;
      add(COLORS.wall, xf(box(b.w, H, b.d), [b.x, H / 2, b.z]));
      add(COLORS.mascot, xf(box(b.w + 0.2, 0.4, b.d + 0.2), [b.x, 0.2, b.z]), 0.03);
      // purple roof slab + inset top + skylights
      add(COLORS.purple, xf(box(b.w + 0.8, 0.45, b.d + 0.8), [b.x, H + 0.225, b.z]));
      add(C.roofLight, xf(box(b.w - 1.2, 0.3, b.d - 1.2), [b.x, H + 0.6, b.z]));
      for (const sx of [-3, 3]) {
        add(COLORS.mascot, xf(box(2.4, 0.45, 1.8), [b.x + sx, H + 0.97, b.z]), 0.03);
        addBasic(C.glass, xf(flatRect(2.0, 1.4), [b.x + sx, H + 1.2, b.z]));
      }
      // glass wings on the front
      for (const sx of [-1, 1]) {
        const cx = sx * 3.7;
        glassGeos.push(xf(new THREE.PlaneGeometry(3.7, 2.55), [cx, 1.85, 0.03]).applyMatrix4(F));
        for (let i = 0; i <= 3; i++) fbox(F, COLORS.white, 0.1, 2.75, 0.14, cx - 1.85 + i * (3.7 / 3), 0.5, 0.07, 0.025);
        fbox(F, COLORS.white, 3.9, 0.12, 0.14, cx, 3.05, 0.07, 0.025);
        fbox(F, COLORS.white, 3.9, 0.12, 0.14, cx, 0.5, 0.07, 0.025);
        fbox(F, COLORS.white, 3.7, 0.08, 0.1, cx, 1.8, 0.06, 0);
      }
      // entrance portal with the door standing open and glowing
      fbox(F, COLORS.mascot, 0.4, 3.0, 0.6, -1.3, 0, 0.3);
      fbox(F, COLORS.mascot, 0.4, 3.0, 0.6, 1.3, 0, 0.3);
      fbox(F, COLORS.mascot, 3.0, 0.38, 0.6, 0, 2.7, 0.3);
      glowGeos.push(xf(new THREE.PlaneGeometry(2.2, 2.7), [0, 1.35, 0.03]).applyMatrix4(F));
      // floor spill of light
      const spill = flatRect(2.3, 1.6);
      xf(spill, [0, 0.045, 0.85]).applyMatrix4(F);
      glowFloor.push(spill);
      for (const sx of [-1, 1]) {
        const hx = sx * 1.05, ang = sx > 0 ? Math.PI * 0.62 : Math.PI * 0.38; // outward open leaves
        const dx = Math.cos(ang) * 0.5, dz = Math.sin(ang) * 0.5;
        add(C.woodLight, xf(box(1.0, 2.5, 0.08), [hx + dx, 1.25, dz], [0, -ang, 0]).applyMatrix4(F), 0.025);
      }
      awning(F, 0, 3.2, 3.05, 1.35, 0.55, 8);
      for (const sx of [-1, 1]) {
        add(COLORS.yellow, xf(box(0.22, 0.4, 0.22), [sx * 1.3, 2.2, 0.68]).applyMatrix4(F), 0.025);
        addBasic(C.glow, xf(box(0.18, 0.36, 0.26), [sx * 1.3, 2.2, 0.68]).applyMatrix4(F));
      }
      plate('products', b.x, 3.95, top + 0.06);
      // east side windows
      for (const u of [-1.9, 1.9]) windowOn(E, u, 2.2, 1.9, 1.7);
      fbox(E, COLORS.mascot, 0.4, 3.0, 0.3, 0, 0, 0.15, OUT);
      // pots by the door
      for (const sx of [-1, 1]) solid(b.x + sx * 2.35, top + 0.55, 0.38, () => potPlant(b.x + sx * 2.35, top + 0.55, sx > 0 ? COLORS.red : COLORS.yellow, 1.1));
    } else if (b.id === 'about') {
      const H = 3.4;
      add(C.cream, xf(box(b.w, H, b.d), [b.x, H / 2, b.z]));
      add(C.stone, xf(box(b.w + 0.16, 0.35, b.d + 0.16), [b.x, 0.175, b.z]), 0.03);
      gableRoof(b, H, 1.9, COLORS.red, C.cream);
      chimney(b.x + 1.7, H + 0.5, b.z - 0.7, 1.7);
      doorOn(F, 0, 1.1, 2.0, COLORS.purple);
      for (const sx of [-1, 1]) windowOn(F, sx * 2.0, 1.6, 0.95, 1.0, { flowers: true });
      plate('about', b.x, 2.78, top + 0.08);
      windowOn(E, -0.9, 1.6, 0.95, 1.0);
      windowOn(E, 1.0, 1.6, 0.95, 1.0);
    } else if (b.id === 'how') {
      const H = 3.5;
      add(C.lilac, xf(box(b.w, H, b.d), [b.x, H / 2, b.z]));
      add(C.stone, xf(box(b.w + 0.16, 0.35, b.d + 0.16), [b.x, 0.175, b.z]), 0.03);
      gableRoof(b, H, 1.5, COLORS.yellow, C.lilac);
      // roll-up garage door as the main door
      fbox(F, COLORS.white, 2.9, 2.45, 0.12, 0, 0, 0.06);
      fbox(F, COLORS.lavender, 2.7, 2.3, 0.1, 0, 0, 0.1, 0.02);
      for (let i = 1; i < 6; i++) fbox(F, COLORS.black, 2.7, 0.04, 0.12, 0, i * 0.38, 0.1, 0);
      fbox(F, C.stone, 3.4, 0.12, 0.55, 0, 0, 0.3);
      // gear motif on the wall
      const gear = (u, y, r, color) => {
        const gM = matrix([0, 0, 0]).premultiply(F);
        const body = xf(cyl(r, r, 0.12, 16), [u, y, 0.1], [Math.PI / 2, 0, 0]).applyMatrix4(F);
        add(color, body, 0.03);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          add(color, xf(box(r * 0.5, r * 0.5, 0.12), [u + Math.cos(a) * r * 1.05, y + Math.sin(a) * r * 1.05, 0.1], [0, 0, a]).applyMatrix4(F), 0.03);
        }
        add(COLORS.white, xf(cyl(r * 0.38, r * 0.38, 0.16, 12), [u, y, 0.12], [Math.PI / 2, 0, 0]).applyMatrix4(F), 0.025);
        void gM;
      };
      gear(-2.25, 1.9, 0.38, COLORS.purple);
      gear(-1.9, 1.05, 0.26, COLORS.red);
      windowOn(F, 2.2, 1.9, 0.9, 0.9);
      plate('how', b.x, 2.95, top + 0.08);
      windowOn(E, -0.9, 1.7, 0.95, 1.0);
      windowOn(E, 1.0, 1.7, 0.95, 1.0);
      // exhaust pipe + puffs
      addThin(COLORS.black, xf(cyl(0.12, 0.12, 1.2, 8), [b.x - 1.8, H + 1.3, b.z - 0.8]));
      add(COLORS.white, xf(blob(0.3, 0.26, 0.3, 1), [b.x - 1.7, H + 2.2, b.z - 0.8]), 0.03);
      add(COLORS.white, xf(blob(0.22, 0.2, 0.22, 1), [b.x - 1.4, H + 2.7, b.z - 0.8]), 0.03);
    } else if (b.id === 'news') {
      const H = 3.6;
      add(C.cream, xf(box(b.w, H, b.d), [b.x, H / 2, b.z]));
      add(C.wood, xf(box(b.w + 0.1, 0.8, b.d + 0.1), [b.x, 0.4, b.z]), 0.03);
      gableRoof(b, H, 1.1, COLORS.mascot, C.cream, 0.25, 0.4);
      windowOn(F, 0, 1.5, 2.0, 0.9, { mull: false });
      fbox(F, C.woodLight, 2.4, 0.1, 0.5, 0, 0.67, 0.25, 0.025); // counter
      awning(F, 0, 2.5, 2.2, 0.8, 0.35, 6);
      plate('news', b.x, 2.85, top + 0.06);
      windowOn(E, 0, 1.6, 0.9, 0.9);
      // standing notice board with pinned papers
      const bx = b.x + 2.6, bz = b.z + 1.3;
      if (!blocked(bx, bz, 0.8)) {
        add(C.wood, xf(box(0.12, 1.9, 0.12), [bx - 0.75, 0.95, bz]), 0.025);
        add(C.wood, xf(box(0.12, 1.9, 0.12), [bx + 0.75, 0.95, bz]), 0.025);
        add(C.wood, xf(box(1.8, 1.25, 0.14), [bx, 1.35, bz]), 0.03);
        add(C.woodLight, xf(box(1.6, 1.05, 0.06), [bx, 1.35, bz + 0.08]), 0.0);
        [[-0.5, 1.6, COLORS.white, 0.1], [0.05, 1.65, COLORS.yellow, -0.08], [0.5, 1.55, COLORS.white, 0.06], [-0.35, 1.1, COLORS.red, -0.1], [0.2, 1.15, COLORS.purple, 0.12], [0.62, 1.08, COLORS.yellow, -0.05]].forEach(([dx, y, col, rot]) => {
          add(col, xf(box(0.36, 0.44, 0.03), [bx + dx, y - 0.15, bz + 0.13], [0, 0, rot]), 0.012);
          add(COLORS.black, xf(box(0.05, 0.05, 0.05), [bx + dx, y + 0.02, bz + 0.16], [0, 0, rot]), 0);
        });
        circle(bx, bz, 0.9);
      }
    } else if (b.id === 'post') {
      const H = 3.2;
      add(COLORS.wall, xf(box(b.w, H, b.d), [b.x, H / 2, b.z]));
      add(C.stone, xf(box(b.w + 0.16, 0.35, b.d + 0.16), [b.x, 0.175, b.z]), 0.03);
      gableRoof(b, H, 1.5, COLORS.mascot, COLORS.wall);
      chimney(b.x - 1.5, H + 0.4, b.z - 0.5, 1.4, false);
      doorOn(F, 0, 1.1, 2.0, COLORS.red);
      windowOn(F, -1.7, 1.6, 0.95, 1.0, { flowers: true });
      plate('post', b.x, 2.68, top + 0.08);
      // envelope icon
      fbox(F, COLORS.white, 0.95, 0.65, 0.07, 1.75, 1.2, 0.1, 0.03);
      const v1 = xf(box(0.62, 0.05, 0.03), [1.75 - 0.2, 1.2 + 0.46, 0.15], [0, 0, -0.62]).applyMatrix4(F);
      const v2 = xf(box(0.62, 0.05, 0.03), [1.75 + 0.2, 1.2 + 0.46, 0.15], [0, 0, 0.62]).applyMatrix4(F);
      add(COLORS.red, v1, 0.01);
      add(COLORS.red, v2, 0.01);
      windowOn(E, -0.6, 1.6, 0.95, 1.0);
      windowOn(E, 1.0, 1.6, 0.95, 1.0);
      // mailbox in front
      const mx = b.x + 3.2, mz = b.z + 2.6;
      solid(mx, mz, 0.4, () => {
        add(C.wood, xf(box(0.14, 1.0, 0.14), [mx, 0.5, mz]), 0.025);
        add(COLORS.red, xf(box(0.7, 0.45, 0.5), [mx, 1.15, mz]), 0.03);
        add(COLORS.red, xf(cyl(0.25, 0.25, 0.7, 12), [mx, 1.37, mz], [0, 0, Math.PI / 2]), 0.03);
        add(COLORS.yellow, xf(box(0.05, 0.4, 0.05), [mx + 0.42, 1.45, mz + 0.1]), 0.02);
        add(COLORS.yellow, xf(box(0.2, 0.12, 0.05), [mx + 0.52, 1.62, mz + 0.1]), 0.02);
      });
    }
  }
  // door mats
  for (const b of BUILDINGS) if (b.id !== 'products') addFlat(COLORS.red, xf(flatRect(1.1, 0.6), [b.door.x, 0.05, b.door.z + 0.3]));

  // ---- decor ----
  // flower beds flanking the products glass front and by the cottage
  const beds = [[-4.8, -5.7, 3.0, 0.9, 1], [4.8, -5.7, 3.0, 0.9, 2], [-15.4, -3.9, 1.4, 0.9, 3], [10.4, 10.2, 1.4, 0.9, 4]];
  for (const [x, z, w, d, seed] of beds) {
    if (blocked(x, z, Math.max(w, d) * 0.25) && !(x === -15.4)) continue;
    bed(x, z, w, d, seed);
    bbox(x - w / 2, x + w / 2, z - d / 2, z + d / 2);
  }

  // lamp posts, benches, barrels, crates, bushes, trees (all solid -> guarded by keep-free zones)
  [[-2.5, -3.2], [2.5, -3.2], [-2.6, 8.6], [2.6, 12.4], [-6.5, 10.0], [6.0, 12.5], [-8.6, -2.2], [8.6, -2.2], [-17.5, -3.2], [17.5, -3.2]]
    .forEach(([x, z]) => solid(x, z, 0.3, () => lamp(x, z)));

  const toPlaza = (x, z) => Math.atan2(PLAZA.x - x, PLAZA.z - z);
  [[3.9, 5.2], [-3.9, 5.2], [3.9, -1.3], [-3.9, -1.3]].forEach(([x, z]) => {
    if (blocked(x, z, 0.5)) return;
    bench(x, z, toPlaza(x, z));
    const a = toPlaza(x, z);
    for (const d of [-0.8, 0, 0.8]) circle(x + Math.cos(a) * d, z - Math.sin(a) * d, 0.5);
  });
  bench(POND.x + 0.4, POND.z + 3.4, Math.PI);
  for (const d of [-0.8, 0, 0.8]) circle(POND.x + 0.4 + d, POND.z + 3.4, 0.5);

  const how = BUILDINGS.find((b) => b.id === 'how');
  solid(how.x - 3.2, how.z + 1.3, 0.5, () => crate(how.x - 3.2, 0, how.z + 1.3, 0.9, 0.2));
  solid(how.x - 2.7, how.z + 1.9, 0.45, () => crate(how.x - 2.7, 0, how.z + 1.9, 0.75, -0.3));
  solid(how.x - 3.2, how.z + 1.3, 0.0, () => crate(how.x - 3.2, 0.9, how.z + 1.3, 0.6, 0.5));
  solid(how.x + 3.6, how.z + 1.5, 0.45, () => barrel(how.x + 3.6, how.z + 1.5));
  solid(how.x + 3.4, how.z - 0.2, 0.45, () => barrel(how.x + 3.4, how.z - 0.2, 0.9));
  const about = BUILDINGS.find((b) => b.id === 'about');
  solid(about.x + 3.4, about.z + 2.0, 0.45, () => barrel(about.x + 3.4, about.z + 2.0));
  const post = BUILDINGS.find((b) => b.id === 'post');
  solid(post.x - 3.4, post.z + 1.6, 0.4, () => crate(post.x - 3.4, 0, post.z + 1.6, 0.7, 0.4));

  // sign post with arrows (reads like a village crossroads)
  solid(-2.6, 6.8, 0.3, () => {
    add(C.wood, xf(box(0.16, 3.1, 0.16), [-2.6, 1.55, 6.8]), 0.03);
    add(C.wood, xf(box(0.3, 0.1, 0.3), [-2.6, 3.12, 6.8]), 0.02);
    ['aProducts', 'aAbout', 'aHow', 'aNews', 'aPost'].forEach((id, i) => {
      const dir = SIGNS[id].arrow === 'L' ? -1 : 1;
      plate(id, -2.6 + dir * 0.55, 2.7 - i * 0.46, 6.8 + 0.12, 0, (i - 2) * 0.02);
    });
  });

  // bushes along building fronts and sides
  [[-9.0, -9.3, 1.2], [-17.3, -6.2, 1.1], [-17.0, -8.6, 1.2], [17.6, -7.5, 1.2], [17.2, -9.0, 1.0], [8.2, -9.0, 1.1], [-10.0, -9.0, 1.0],
    [-14.4, 8.8, 1.0], [-9.8, 6.6, 0.9], [15.4, 6.0, 1.1], [8.2, 7.0, 1.0], [-6.5, 7.2, 0.9], [6.8, 2.5, 0.0], [-7.4, -4.5, 0.9], [7.4, -4.5, 0.9],
  ].forEach(([x, z, s]) => {
    if (s > 0) solid(x, z, 0.55 * s, () => bush(x, z, s));
  });

  // trees in the open spaces
  [[-19, 1, 1.15, 1], [19.5, 3.5, 1.1, 2], [-19.5, -10, 1.2, 3], [19.5, -11, 1.2, 4], [-9, 12.5, 1.0, 5], [8, 14.5, 1.0, 6], [-20, 7, 1.0, 7],
    [18.5, 7.5, 1.0, 8], [-8, -12, 1.0, 9], [8, -13.5, 1.0, 10], [-15, 0, 1.0, 11], [14.5, 1.8, 1.0, 12], [-12, 3.6, 0.9, 13], [12, 4, 0.9, 14]]
    .forEach(([x, z, s, seed]) => solid(x, z, 0.5 * s, () => tree(x, z, s, seed)));

  // loose flowers & tufts on the lawn
  for (let i = 0; i < 160; i++) {
    const x = TOWN.minX + 1 + rnd(i * 5 + 1) * (TOWN.maxX - TOWN.minX - 2);
    const z = TOWN.minZ + 1 + rnd(i * 5 + 2) * (TOWN.maxZ - TOWN.minZ - 2);
    if (onGround(x, z, 0.4)) continue;
    if (i % 3 === 0) {
      const tuft = new THREE.ConeGeometry(0.08, 0.3, 4);
      add(C.leafDark, xf(tuft, [x, 0.15, z], [0, i, 0.15]), 0);
      add(C.leafDark, xf(tuft.clone(), [x + 0.1, 0.12, z + 0.05], [0, i, -0.25]), 0);
    } else {
      const col = FLOWER[i % 4];
      add(col, xf(blob(0.1, 0.09, 0.1, 0), [x, 0.1, z]), 0.02);
      add(C.leafDark, xf(box(0.04, 0.1, 0.04), [x, 0.05, z]), 0);
    }
  }

  // ---- border: fences + tree line (the front edges, facing the camera, stay low) ----
  fence(TOWN.minX + 0.6, TOWN.maxZ - 0.9, TOWN.maxX - 0.6, TOWN.maxZ - 0.9);
  fence(TOWN.minX + 0.6, TOWN.minZ + 1.0, TOWN.minX + 0.6, TOWN.maxZ - 0.9);
  fence(TOWN.maxX - 0.6, TOWN.minZ + 1.0, TOWN.maxX - 0.6, TOWN.maxZ - 0.9);
  let ti = 0;
  const border = (x, z, s) => tree(x, z, s, 30 + ti++);
  for (let x = TOWN.minX - 2; x <= TOWN.maxX + 2; x += 2.6) { // north: tall
    border(x + (rnd(x * 3) - 0.5) * 0.8, TOWN.minZ - 0.6 + rnd(x) * 0.8, 1.05);
    border(x + 1.3 + (rnd(x * 5) - 0.5) * 0.8, TOWN.minZ - 2.4 + rnd(x + 2), 1.2);
  }
  for (let z = TOWN.minZ + 1; z <= TOWN.maxZ + 2; z += 2.8) { // west: tall
    border(TOWN.minX - 0.8 - rnd(z) * 0.8, z, 1.05);
    border(TOWN.minX - 2.8 - rnd(z + 1) * 0.6, z + 1.4, 1.2);
  }
  for (let z = TOWN.minZ + 1; z <= TOWN.maxZ; z += 3.6) border(TOWN.maxX + 1.4 + rnd(z) * 0.8, z, 0.7); // east: low
  for (let x = TOWN.minX + 1; x <= TOWN.maxX; x += 3.4) border(x, TOWN.maxZ + 1.6 + rnd(x) * 0.8, 0.7); // south: low
  bbox(TOWN.minX - 4, TOWN.minX + 0.8, TOWN.minZ - 4, TOWN.maxZ + 4);
  bbox(TOWN.maxX - 0.8, TOWN.maxX + 4, TOWN.minZ - 4, TOWN.maxZ + 4);
  bbox(TOWN.minX - 4, TOWN.maxX + 4, TOWN.minZ - 4, TOWN.minZ + 0.8);
  bbox(TOWN.minX - 4, TOWN.maxX + 4, TOWN.maxZ - 0.9, TOWN.maxZ + 4);

  // ---- window glass / door glow / signs ----
  const merge = (list) => mergeGeometries(list.map(prep), false);
  flushBuckets(group);
  if (glassGeos.length) {
    const m = new THREE.Mesh(merge(glassGeos), flatMaterial(C.glass));
    m.name = 'town-glass';
    group.add(m);
  }
  if (glowGeos.length || glowFloor.length) {
    const m = new THREE.Mesh(merge([...glowGeos, ...glowFloor]), flatMaterial(C.glow));
    m.name = 'town-glow';
    group.add(m);
  }
  const signMat = new THREE.MeshBasicMaterial({ map: makeAtlas(), alphaTest: 0.5, side: THREE.DoubleSide });
  const signMesh = new THREE.Mesh(mergeGeometries(plateGeos, false), signMat);
  signMesh.name = 'town-signs';
  group.add(signMesh);
  plateGeos.length = 0;
  glassGeos.length = 0;
  glowGeos.length = 0;

  // ---- fountain jet (animated) ----
  const jet = new THREE.Group();
  jet.position.set(PLAZA.x, 1.02, PLAZA.z);
  const jetGeo = mergeGeometries([
    cyl(0.07, 0.12, 0.34, 10).translate(0, 0.17, 0),
    new THREE.IcosahedronGeometry(0.2, 1).translate(0, 0.42, 0),
    ...[0, 1, 2, 3, 4, 5].map((i) => new THREE.IcosahedronGeometry(0.07, 0).translate(Math.cos((i / 6) * 6.283) * 0.42, 0.1, Math.sin((i / 6) * 6.283) * 0.42)),
  ].map(prep), false);
  const jetMesh = toonMesh(jetGeo, C.water, { outline: 0.02, cast: false });
  jet.add(jetMesh);
  jet.name = 'fountain-jet';
  group.add(jet);
  const basin = new THREE.Mesh(flatDisc(1.46, 36), toonMaterial(C.water));
  basin.position.set(PLAZA.x, 0.5, PLAZA.z);
  basin.receiveShadow = true;
  basin.name = 'fountain-water';
  group.add(basin);

  const update = (t) => {
    jet.scale.set(1, 1 + Math.sin(t * 3) * 0.12, 1);
    jet.position.y = 1.02 + Math.sin(t * 3) * 0.015;
    basin.position.y = 0.5 + Math.sin(t * 1.7) * 0.012;
  };

  group.userData.stats = { colliders: colliders.length };
  return { object3d: group, colliders, update };
}
