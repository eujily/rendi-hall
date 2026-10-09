import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMesh, toonMaterial, flatMaterial } from '../kit/toon.js';
import { COLORS, mix } from '../core/tokens.js';
import {
  TOWN, BUILDINGS, PLAZA, PLACES, PRODUCTS_DOOR, TOWN_SPAWN, TOWN_FROM_HALL, TOWN_VILLAGERS, BUGS,
} from '../core/layout.js';
import { createProps } from './props.js';
import { createTownBuildings } from './townBuildings.js';

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

// ---------- paths : axis-aligned rects (cobble main roads, dirt side tracks), painted by props.js ----------
const PATHS = [
  { minX: -1, maxX: 1, minZ: -6.6, maxZ: 13.6, kind: 'cobble' }, // spawn -> plaza -> products
  { minX: -14, maxX: 14, minZ: -3.4, maxZ: -1.6, kind: 'cobble' }, // east-west road in front of the row of shops
  { minX: -13.9, maxX: -12.1, minZ: -4.6, maxZ: -2.5, kind: 'cobble' }, // about door
  { minX: 12.1, maxX: 13.9, minZ: -4.6, maxZ: -2.5, kind: 'cobble' }, // how door
  { minX: -16, maxX: 13.5, minZ: 10.0, maxZ: 11.8, kind: 'dirt' }, // south road: news / spawn / post
  { minX: -12.9, maxX: -11.1, minZ: 9.2, maxZ: 10.2, kind: 'dirt' }, // news door
  { minX: -1, maxX: 1, minZ: 13.6, maxZ: 16.1, kind: 'dirt' }, // spawn -> garden gate
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
function potPlant(x, z, potColor, s = 1) {
  add(potColor, xf(cyl(0.3 * s, 0.22 * s, 0.45 * s, 14), [x, 0.225 * s, z]));
  add(potColor, xf(cyl(0.34 * s, 0.34 * s, 0.1 * s, 14), [x, 0.48 * s, z]));
  add(C.leaf, xf(blob(0.42 * s, 0.42 * s, 0.42 * s), [x, 0.95 * s, z]));
  add(C.leafLight, xf(blob(0.28 * s, 0.28 * s, 0.28 * s), [x + 0.15 * s, 1.3 * s, z - 0.05 * s]));
  add(COLORS.white, xf(blob(0.09, 0.09, 0.09, 0), [x - 0.22 * s, 1.1 * s, z + 0.3 * s]), 0.02);
  add(COLORS.red, xf(blob(0.09, 0.09, 0.09, 0), [x + 0.28 * s, 1.0 * s, z + 0.28 * s]), 0.02);
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

  // ---- ground, paths, plaza + fountain, pond, trees, fences, lamps, benches, scatter (src/world/props.js) ----
  const props = createProps({ blocked, circle, bbox, PATHS, POND, PLAZA_R });
  group.add(props.group);

  // ---- buildings: roofs, trim, textures, props (src/world/townBuildings.js) ----
  const glowFloor = [];
  const buildings = createTownBuildings();
  group.add(buildings.object3d);
  colliders.push(...buildings.colliders);

  // ---- sign post arrows (the post itself is built by props.js) ----
  if (props.signpost) {
    ['aProducts', 'aAbout', 'aHow', 'aNews', 'aPost'].forEach((id, i) => {
      const dir = SIGNS[id].arrow === 'L' ? -1 : 1;
      plate(id, -2.6 + dir * 0.55, 2.7 - i * 0.46, 6.8 + 0.12, 0, (i - 2) * 0.02);
    });
  }

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

  const update = (t, dt) => {
    props.update(t, dt);
    buildings.update(t);
  };

  group.userData.stats = { colliders: colliders.length };
  return { object3d: group, colliders, update };
}
