import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addOutline, toonMaterial } from '../kit/toon.js';
import { texturedToon, surfaceUV } from '../kit/textures.js';
import { COLORS, mix } from '../core/tokens.js';
import { ROOM, HALL_WALL_H, FRAME, EXHIBITS, HALL_EXIT, exhibitSpot } from '../core/layout.js';

// Rendi Hall: a cosy Stardew-style museum of products with an IT flavour.
// Walls carry the exhibit frames (built in stands/_frame.js); this file builds floor, walls, rugs,
// the PRODUCTS neon, cable trays + pendant lamps, benches, plants, reception desk, server rack,
// vending machine, stanchions, floor guide lines and the exit arch.
// Static parts are merged per (texture kind + colour) bucket into one mesh (+ outline hull).

const WALL_H = HALL_WALL_H;
const WALL_T = 0.3;
const OUTLINE = 0.03;
const WAIN_H = 1.25; // wainscot height
const WAIN_OUT = 0.05; // how far the wainscot stands out of the wallpaper

const LEAF_DARK = mix(COLORS.sage, COLORS.black, 0.18);
const LEAF_LIGHT = COLORS.sage;
const RACK = mix(COLORS.purple, COLORS.black, 0.6);
const RACK_UNIT = mix(RACK, COLORS.white, 0.2);
const WAINSCOT = mix(COLORS.purple, COLORS.lavender, 0.3);
const FLOOR = mix(COLORS.lavender, COLORS.white, 0.3);
const BRASS = COLORS.yellow;
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;

// ---------- tiny helpers ----------
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

function matrix(p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
  _q.setFromEuler(_e.set(r[0], r[1], r[2]));
  return new THREE.Matrix4().compose(_v.set(p[0], p[1], p[2]), _q, _s.set(s[0], s[1], s[2]));
}
const xf = (geo, p, r, s) => geo.applyMatrix4(matrix(p, r, s));
// Deterministic pseudo-random in [0,1) so the hall looks the same on every load.
const rnd = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// key -> { kind, color, outline, geos }. Flat colours and textured kinds both merge per bucket.
const buckets = new Map();
const archBuckets = new Map(); // the exit arch gets its own meshes so it can fade out in close-ups
let target = buckets;
function bucketFor(key, entry) {
  if (!target.has(key)) target.set(key, { ...entry, geos: [] });
  return target.get(key);
}
/** Flat brand colour. Geometry must already be in its final (world) position. */
function add(color, geo, outline = color === COLORS.black || color === COLORS.lavender ? 0 : OUTLINE) {
  bucketFor(`flat|${color}`, { kind: null, color, outline }).geos.push(geo);
  return geo;
}
/** Textured: world-scale UVs on the final geometry, merged per (kind, base colour). */
function addTex(kind, base, geo, unitsPerRepeat = 1.6, outline = OUTLINE) {
  surfaceUV(geo, unitsPerRepeat);
  bucketFor(`${kind}|${base}`, { kind, color: base, outline }).geos.push(geo);
  return geo;
}
// Hand-painted look: the kit's 32px tiles, but filtered smoothly (mipmaps + linear) instead of nearest.
const smoothCache = new Map();
function smoothToon(kind, base) {
  const key = `${kind}|${base}`;
  if (!smoothCache.has(key)) {
    const src = texturedToon(kind, base);
    const map = src.map.clone();
    map.generateMipmaps = true;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.magFilter = THREE.LinearFilter;
    map.anisotropy = 8;
    map.needsUpdate = true;
    const mat = src.clone();
    mat.map = map;
    smoothCache.set(key, mat);
  }
  return smoothCache.get(key);
}
function prep(g, keepUv) {
  const out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) {
    if (name === 'position' || name === 'normal' || (keepUv && name === 'uv')) continue;
    out.deleteAttribute(name);
  }
  return out;
}
function flushBuckets(group, map = buckets, name = 'decor') {
  for (const [key, b] of map) {
    const merged = mergeGeometries(b.geos.map((g) => prep(g, !!b.kind)), false);
    const mesh = new THREE.Mesh(merged, b.kind ? smoothToon(b.kind, b.color) : toonMaterial(b.color));
    mesh.castShadow = b.kind !== 'floorHerringbone';
    mesh.receiveShadow = true;
    if (b.outline) addOutline(mesh, b.outline);
    mesh.name = `${name}-${key.replace('|', '-')}`;
    group.add(mesh);
  }
  map.clear();
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, seg = 16) => new THREE.CylinderGeometry(rt, rb, h, seg);
const ball = (r, d = 2) => new THREE.IcosahedronGeometry(r, d);

// ---------- wall frames ----------
// Local wall frame: lx along the wall, ly up, lz out of the wall into the room (left wall: lx = -z).
const WALL_M = {
  back: matrix([0, 0, ROOM.minZ]),
  left: matrix([ROOM.minX, 0, 0], [0, Math.PI / 2, 0]),
};
const wallPart = (wall, geo) => geo.applyMatrix4(WALL_M[wall]);
// lx extent of each wall (the back wall also covers the corner thickness)
const WALL_SPAN = {
  back: [ROOM.minX - WALL_T, ROOM.maxX],
  left: [-ROOM.maxZ, -ROOM.minZ],
};
/** Box in wall-local space: lx in [a, b], y in [y0, y1], lz in [z0, z1]. */
const wbox = (wall, a, b, y0, y1, z0, z1) =>
  wallPart(wall, xf(box(b - a, y1 - y0, z1 - z0), [(a + b) / 2, (y0 + y1) / 2, (z0 + z1) / 2]));

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function canvasPlane(w, h, cw, ch, draw, { transparent = true, order = 0 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const run = () => {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);
    draw(ctx, cw, ch);
    tex.needsUpdate = true;
  };
  run();
  document.fonts?.load?.('italic 800 64px Montserrat').then(run).catch(() => {});
  document.fonts?.load?.('700 64px Montserrat').then(run).catch(() => {});
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent, depthWrite: !transparent }),
  );
  mesh.renderOrder = order;
  mesh.raycast = () => {};
  return mesh;
}
/** Position a painted plane through a parent matrix (so it follows rotated furniture). */
function placePlane(group, mesh, parent, p, r) {
  mesh.applyMatrix4(parent.clone().multiply(matrix(p, r)));
  group.add(mesh);
  return mesh;
}

// ---------- plants (layered leaves) ----------
const ell = (rx, ry, rz, d = 1) => ball(1, d).scale(rx, ry, rz);
function buildPlant(x, z, type, potColor, scale, seed) {
  const P = matrix([x, 0, z], [0, rnd(seed) * Math.PI * 2, 0], [scale, scale, scale]);
  const put = (color, geo) => add(color, geo.applyMatrix4(P));
  const band = potColor === COLORS.white ? COLORS.purple : COLORS.white;
  put(potColor, xf(cyl(0.36, 0.26, 0.5, 18), [0, 0.25, 0]));
  put(potColor, xf(cyl(0.41, 0.41, 0.11, 18), [0, 0.55, 0]));
  put(band, xf(cyl(0.415, 0.415, 0.035, 18), [0, 0.55, 0]));
  put(COLORS.black, xf(cyl(0.36, 0.36, 0.02, 14), [0, 0.6, 0]));
  const base = 0.58;
  const leafCol = (k) => (k % 2 ? LEAF_LIGHT : LEAF_DARK);
  // broad leaf on a stem: azimuth a, tilt phi (from vertical), stem length L
  const stemLeaf = (a, phi, L, rx, rz, color) => {
    const R = new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeRotationZ(-phi));
    const end = new THREE.Vector3(0, L, 0).applyMatrix4(R).add(new THREE.Vector3(0, base, 0));
    put(color === LEAF_LIGHT ? LEAF_DARK : LEAF_LIGHT, cyl(0.018, 0.026, L, 6).translate(0, L / 2, 0).applyMatrix4(R).translate(0, base - 0.02, 0));
    const leaf = ell(rx, 0.03, rz, 1).translate(rx * 0.75, 0, 0);
    leaf.applyMatrix4(new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeRotationZ(0.25 - phi * 0.2)));
    leaf.translate(end.x, end.y, end.z);
    put(color, leaf);
  };
  if (type === 'bush') {
    // three tiers of blobs, a few flowers
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.3;
      put(leafCol(k), xf(ell(0.25, 0.22, 0.25), [Math.cos(a) * 0.34, base + 0.18, Math.sin(a) * 0.34]));
    }
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.9;
      put(leafCol(k + 1), xf(ell(0.25, 0.22, 0.25), [Math.cos(a) * 0.2, base + 0.46, Math.sin(a) * 0.2]));
    }
    put(LEAF_LIGHT, xf(ell(0.26, 0.24, 0.26), [0, base + 0.74, 0]));
    put(LEAF_DARK, xf(ell(0.4, 0.2, 0.4), [0, base + 0.28, 0]));
    const flowers = [COLORS.yellow, COLORS.white, COLORS.red, COLORS.white, COLORS.yellow];
    flowers.forEach((c, k) => {
      const a = k * 2.4 + 0.5, h = 0.3 + (k % 3) * 0.2, rr = 0.46 - h * 0.28;
      put(c, xf(ball(0.055, 1), [Math.cos(a) * rr, base + h, Math.sin(a) * rr]));
    });
  } else if (type === 'fan') {
    // two layers of upright blades (outer wide, inner short)
    const outer = 9, inner = 6;
    for (let k = 0; k < outer; k++) {
      const a = (k / outer) * Math.PI * 2;
      const len = 0.66 + 0.2 * rnd(seed + k);
      const leaf = ell(0.13, len, 0.04);
      leaf.translate(0, len * 0.9, 0);
      leaf.applyMatrix4(new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeRotationX(0.62 + 0.2 * (k % 3))));
      leaf.translate(0, base - 0.05, 0);
      put(k % 2 ? LEAF_LIGHT : LEAF_DARK, leaf);
    }
    for (let k = 0; k < inner; k++) {
      const a = (k / inner) * Math.PI * 2 + 0.5;
      const len = 0.55 + 0.15 * rnd(seed + 20 + k);
      const leaf = ell(0.1, len, 0.035);
      leaf.translate(0, len * 0.9, 0);
      leaf.applyMatrix4(new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeRotationX(0.22 + 0.1 * (k % 2))));
      leaf.translate(0, base - 0.05, 0);
      put(k % 2 ? LEAF_DARK : LEAF_LIGHT, leaf);
    }
  } else if (type === 'monstera') {
    // broad tilted leaves on stems, three height tiers
    const tiers = [[7, 0.5, 1.0, 0.42, 0.3], [5, 0.85, 0.7, 0.36, 0.26], [3, 1.15, 0.4, 0.3, 0.22]];
    tiers.forEach(([n, L, phi, rx, rz], t) => {
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + t * 0.7 + rnd(seed + k) * 0.3;
        stemLeaf(a, phi, L, rx, rz, leafCol(k + t));
      }
    });
  } else {
    // 'tall': trunk + layered canopy rings
    put(COLORS.wood, xf(cyl(0.045, 0.065, 1.2, 8), [0, base + 0.6, 0]));
    put(COLORS.wood, xf(cyl(0.035, 0.045, 0.5, 8), [0.08, base + 1.3, 0], [0, 0, -0.25]));
    const rings = [[5, 0.42, 0.95, 0.34], [4, 0.32, 1.28, 0.3], [3, 0.2, 1.58, 0.26]];
    rings.forEach(([n, rr, h, r], t) => {
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + t * 0.8;
        put(leafCol(k + t), xf(ell(r * 1.15, r * 0.7, r * 1.15), [Math.cos(a) * rr, base + h, Math.sin(a) * rr]));
      }
    });
    put(LEAF_LIGHT, xf(ell(0.34, 0.26, 0.34), [0, base + 1.85, 0]));
  }
}

// ---------- museum bench (seat faces local +Z, rotated by ry) ----------
function buildBench(x, z, ry) {
  const P = matrix([x, 0, z], [0, ry, 0]);
  const put = (color, geo) => add(color, geo.applyMatrix4(P));
  const wood = (geo) => addTex('woodPlanks', COLORS.wood, geo.applyMatrix4(P), 1.6);
  wood(xf(box(2.4, 0.1, 0.7), [0, 0.5, 0]));
  wood(xf(box(2.4, 0.42, 0.08), [0, 0.86, -0.31]));
  wood(xf(box(2.4, 0.05, 0.1), [0, 0.5 - 0.1, 0.3])); // front apron
  for (const sx of [-1.05, 1.05]) {
    for (const sz of [-0.26, 0.26]) wood(xf(box(0.1, 0.5, 0.1), [sx, 0.25, sz]));
    wood(xf(box(0.08, 0.06, 0.62), [sx, 0.7, 0.0])); // armrest
    wood(xf(box(0.08, 0.2, 0.08), [sx, 0.6, 0.26]));
  }
  put(COLORS.white, xf(box(2.2, 0.06, 0.5), [0, 0.58, 0.02]));
  put(COLORS.purple, xf(box(0.6, 0.14, 0.44), [-0.55, 0.68, 0.02], [0, 0.1, 0]));
  put(COLORS.red, xf(box(0.6, 0.14, 0.44), [0.6, 0.68, 0.02], [0, -0.12, 0]));
  put(COLORS.yellow, xf(box(0.3, 0.05, 0.3), [0.02, 0.63, 0.1], [0, 0.4, 0])); // folded leaflet
}

// ---------- server rack with blinking LEDs (front faces local +Z) ----------
function buildServerRack(x, z, ledsA, ledsB) {
  const P = matrix([x, 0, z]);
  const put = (color, geo) => add(color, geo.applyMatrix4(P));
  const metal = (base, geo, u = 1.3) => addTex('metal', base, geo.applyMatrix4(P), u, base === RACK_UNIT ? 0 : OUTLINE);
  metal(RACK, xf(box(1.3, 2.5, 0.9), [0, 1.25, 0]));
  put(COLORS.black, xf(box(1.36, 0.08, 0.96), [0, 0.04, 0]));
  for (let k = 0; k < 6; k++) {
    const y = 0.5 + k * 0.34;
    metal(RACK_UNIT, xf(box(1.1, 0.26, 0.05), [0, y, 0.46]), 1.3);
    // drive bays + vent slit + handles
    for (let b = 0; b < 3; b++) put(COLORS.black, xf(box(0.14, 0.14, 0.02), [-0.42 + b * 0.18, y, 0.49]));
    for (let s = 0; s < 4; s++) put(COLORS.black, xf(box(0.3, 0.018, 0.02), [0.0, y - 0.075 + s * 0.045 + 0.05, 0.49]));
    put(COLORS.white, xf(box(0.04, 0.16, 0.04), [-0.52, y, 0.5]));
    put(COLORS.white, xf(box(0.04, 0.16, 0.04), [0.52, y, 0.5]));
    (k % 2 ? ledsB : ledsA).push(xf(box(0.07, 0.07, 0.04), [0.4, y + 0.05, 0.5]).applyMatrix4(P));
    (k % 2 ? ledsA : ledsB).push(xf(box(0.07, 0.07, 0.04), [0.3, y + 0.05, 0.5]).applyMatrix4(P));
    put(LEAF_LIGHT, xf(box(0.07, 0.07, 0.04), [0.4, y - 0.05, 0.5]));
    put(COLORS.yellow, xf(box(0.07, 0.07, 0.04), [0.3, y - 0.05, 0.5]));
  }
  // small status display on the top unit
  put(COLORS.black, xf(box(0.26, 0.12, 0.03), [-0.1, 0.5 + 5 * 0.34 + 0.0, 0.5]));
  put(LEAF_LIGHT, xf(box(0.2, 0.06, 0.03), [-0.1, 0.5 + 5 * 0.34, 0.52]));
  // side vent grille (the +x side faces the camera)
  for (let s = 0; s < 14; s++) put(COLORS.black, xf(box(0.02, 0.05, 0.5), [0.66, 0.6 + s * 0.12, 0.0]));
  put(COLORS.white, xf(box(1.3, 0.06, 0.9), [0, 2.53, 0]));
  // fans on the lid
  for (const fx of [-0.28, 0.28]) {
    put(COLORS.black, xf(cyl(0.17, 0.17, 0.03, 18), [fx, 2.57, 0.0]));
    put(COLORS.white, xf(cyl(0.05, 0.05, 0.04, 10), [fx, 2.58, 0.0]));
    for (let b = 0; b < 3; b++) put(COLORS.white, xf(box(0.28, 0.02, 0.05), [fx, 2.585, 0], [0, (b * Math.PI) / 3, 0]));
  }
  // cables: bundle to the ceiling tray + two patch loops to the side
  put(COLORS.black, xf(box(0.08, 0.5, 0.08), [-0.3, 2.8, -0.1]));
  const loop = (c, y0, y1, dz) => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.5, y0, 0.5),
      new THREE.Vector3(0.62, y0 - 0.12, 0.62 + dz),
      new THREE.Vector3(0.72, (y0 + y1) / 2 - 0.2, 0.5 + dz),
      new THREE.Vector3(0.62, y1 - 0.05, 0.54),
      new THREE.Vector3(0.5, y1, 0.5),
    ]);
    put(c, new THREE.TubeGeometry(curve, 14, 0.022, 6));
  };
  loop(COLORS.red, 1.2, 0.84, 0.18);
  loop(COLORS.yellow, 1.55, 1.2, 0.26);
}

// ---------- vending machine (front faces local +Z) ----------
function buildVending(x, z, ry, leds) {
  const P = matrix([x, 0, z], [0, ry, 0]);
  const put = (color, geo) => add(color, geo.applyMatrix4(P));
  const metal = (geo, u = 1.3) => addTex('metal', COLORS.red, geo.applyMatrix4(P), u);
  metal(xf(box(1.3, 2.2, 0.9), [0, 1.1, 0]));
  put(COLORS.black, xf(box(1.36, 0.1, 0.96), [0, 0.05, 0]));
  // display window with backlit products
  put(COLORS.black, xf(box(0.98, 1.43, 0.04), [-0.12, 1.4, 0.45]));
  put(COLORS.lavender, xf(box(0.9, 1.35, 0.05), [-0.12, 1.4, 0.47]));
  const shelfCols = [COLORS.yellow, COLORS.purple, COLORS.mascot, COLORS.white, COLORS.red];
  for (let r = 0; r < 3; r++) {
    put(COLORS.black, xf(box(0.9, 0.04, 0.09), [-0.12, 0.95 + r * 0.42, 0.5]));
    for (let c = 0; c < 4; c++) {
      const col = shelfCols[(r * 2 + c) % 5];
      put(col, xf(box(0.15, 0.26, 0.1), [-0.4 + c * 0.22, 1.1 + r * 0.42, 0.53]));
      put(COLORS.black, xf(new THREE.TorusGeometry(0.06, 0.008, 5, 12), [-0.4 + c * 0.22, 0.99 + r * 0.42, 0.55])); // spiral coil
    }
  }
  // keypad column: buttons + display + coin slot
  put(COLORS.black, xf(box(0.24, 0.8, 0.05), [0.5, 1.45, 0.46]));
  leds.push(xf(box(0.16, 0.07, 0.03), [0.5, 1.77, 0.5]).applyMatrix4(P));
  const btn = [COLORS.white, COLORS.yellow, COLORS.white, COLORS.red];
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 3; i++) put(btn[(i + j) % 4], xf(box(0.05, 0.05, 0.03), [0.42 + i * 0.08, 1.64 - j * 0.1, 0.5]));
  }
  put(COLORS.white, xf(box(0.1, 0.02, 0.03), [0.5, 1.2, 0.5]));
  put(COLORS.yellow, xf(box(0.16, 0.05, 0.03), [0.5, 1.12, 0.5]));
  // pick-up flap
  put(COLORS.black, xf(box(0.82, 0.24, 0.06), [-0.05, 0.38, 0.46]));
  put(COLORS.lavender, xf(box(0.7, 0.16, 0.05), [-0.05, 0.38, 0.5]));
  // top light box
  put(COLORS.yellow, xf(box(1.3, 0.14, 0.9), [0, 2.27, 0]));
  put(COLORS.white, xf(box(1.1, 0.05, 0.03), [0, 2.27, 0.46]));
}

// ---------- reception / info desk (front faces local +Z) ----------
function buildDesk(group, x, z, ry) {
  const P = matrix([x, 0, z], [0, ry, 0]);
  const put = (color, geo) => add(color, geo.applyMatrix4(P));
  const wood = (geo, u = 1.6) => addTex('woodPlanks', COLORS.wood, geo.applyMatrix4(P), u);
  wood(xf(box(3.2, 0.95, 0.9), [0, 0.475, 0]));
  wood(xf(box(3.2, 0.32, 0.12), [0, 1.2, -0.35])); // back ledge
  put(COLORS.white, xf(box(3.44, 0.08, 1.08), [0, 0.99, 0.02]));
  put(COLORS.black, xf(box(3.1, 0.08, 0.8), [0, 0.04, 0]));
  put(COLORS.purple, xf(box(2.9, 0.1, 0.02), [0, 0.7, 0.46])); // inlay stripe
  put(COLORS.yellow, xf(box(2.9, 0.03, 0.02), [0, 0.6, 0.46]));
  // desk lamp-ish bell, brochures, mug
  put(COLORS.yellow, xf(new THREE.SphereGeometry(0.1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), [1.1, 1.03, 0.3]));
  put(COLORS.black, xf(cyl(0.13, 0.13, 0.03, 14), [1.1, 1.035, 0.3]));
  [COLORS.purple, COLORS.red, COLORS.yellow].forEach((c, i) =>
    put(c, xf(box(0.22, 0.03 + i * 0.002, 0.3), [0.5 + i * 0.01, 1.05 + i * 0.03, 0.3], [0, 0.2 - i * 0.15, 0])));
  put(COLORS.white, xf(cyl(0.07, 0.06, 0.13, 12), [-1.3, 1.09, 0.3]));
  put(COLORS.red, xf(box(0.02, 0.2, 0.02), [-1.3, 1.22, 0.3], [0.2, 0, 0.3]));
  // monitor on a stand
  put(COLORS.black, xf(cyl(0.2, 0.22, 0.04, 14), [-0.45, 1.05, -0.05]));
  put(COLORS.black, xf(box(0.08, 0.34, 0.08), [-0.45, 1.24, -0.06]));
  put(COLORS.black, xf(box(1.0, 0.64, 0.07), [-0.45, 1.68, -0.06]));
  const screen = canvasPlane(0.9, 0.54, 720, 432, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, hex(mix(COLORS.purple, COLORS.white, 0.35)));
    g.addColorStop(1, hex(COLORS.lavender));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = hex(COLORS.white);
    ctx.fillRect(0, 0, w, 54);
    [COLORS.red, COLORS.yellow, COLORS.purple].forEach((c, i) => {
      ctx.beginPath();
      ctx.arc(34 + i * 36, 27, 11, 0, Math.PI * 2);
      ctx.fillStyle = hex(c);
      ctx.fill();
    });
    ctx.fillStyle = hex(COLORS.black);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'italic 800 76px Montserrat, system-ui, sans-serif';
    ctx.fillText('Rendi Hall', w / 2, 168);
    ctx.font = '700 34px Montserrat, system-ui, sans-serif';
    ctx.fillText('Pick an exhibit', w / 2, 232);
    roundRect(ctx, w / 2 - 120, 290, 240, 70, 35);
    ctx.fillStyle = hex(COLORS.yellow);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = hex(COLORS.black);
    ctx.font = '800 36px Montserrat, system-ui, sans-serif';
    ctx.fillText('Start tour', w / 2, 327);
  }, { transparent: false });
  placePlane(group, screen, P, [-0.45, 1.68, -0.02]);
  // "Welcome" board on a post
  put(COLORS.black, xf(box(0.07, 0.8, 0.07), [1.1, 1.45, -0.1]));
  put(COLORS.white, xf(box(1.15, 0.52, 0.07), [1.1, 1.95, -0.1]));
  put(COLORS.purple, xf(box(1.21, 0.06, 0.09), [1.1, 2.24, -0.1]));
  put(COLORS.purple, xf(box(1.21, 0.06, 0.09), [1.1, 1.66, -0.1]));
  const sign = canvasPlane(1.05, 0.42, 840, 336, (ctx, w, h) => {
    ctx.fillStyle = hex(COLORS.white);
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'italic 800 150px Montserrat, system-ui, sans-serif';
    ctx.fillStyle = hex(COLORS.purple);
    ctx.fillText('Welcome', w / 2 + 5, h / 2 + 11, 760);
    ctx.fillStyle = hex(COLORS.black);
    ctx.fillText('Welcome', w / 2, h / 2 + 4, 760);
    ctx.fillStyle = hex(COLORS.yellow);
    for (const sx of [70, w - 70]) {
      ctx.beginPath();
      ctx.arc(sx, h - 56, 14, 0, Math.PI * 2);
      ctx.fill();
    }
  }, { transparent: false });
  placePlane(group, sign, P, [1.1, 1.95, -0.06]);
}

// ---------- pixel-art poster in a wall gap ----------
const HEART = ['.XX.XX.', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
const ALIEN = ['..X.X..', '.XXXXX.', 'XX.X.XX', 'XXXXXXX', 'X.X.X.X'];
function buildPoster(lx, ly, pattern, color) {
  const w = 1.3, h = 1.4;
  add(COLORS.white, wallPart('back', xf(box(w + 0.16, h + 0.16, 0.08), [lx, ly, 0.04])));
  add(COLORS.lavender, wallPart('back', xf(box(w, h, 0.04), [lx, ly, 0.1])));
  const px = 0.15;
  pattern.forEach((row, j) => {
    [...row].forEach((ch, i) => {
      if (ch !== 'X') return;
      add(color, wallPart('back', xf(box(px, px, 0.04), [lx + (i - 3) * px, ly + (2 - j) * px, 0.14])));
    });
  });
}

// ---------- cable trays, spotlights and pendant lamps along the top edge ----------
const TRAY_Y = 5.06;
const TRAYS = [
  ['back', -11.8, -2.7],
  ['back', 2.7, 11.8],
  ['left', -8.6, 8.4],
];
function buildTrays() {
  for (const [wall, a, b] of TRAYS) {
    const len = b - a, mid = (a + b) / 2;
    add(COLORS.black, wallPart(wall, xf(box(len, 0.03, 0.36), [mid, TRAY_Y, 0.2])));
    add(COLORS.black, wallPart(wall, xf(box(len, 0.1, 0.03), [mid, TRAY_Y + 0.05, 0.375])));
    add(COLORS.black, wallPart(wall, xf(box(len, 0.1, 0.03), [mid, TRAY_Y + 0.05, 0.025])));
    // rungs + wall brackets
    for (let lx = a + 0.4; lx < b; lx += 0.8) {
      add(COLORS.black, wallPart(wall, xf(box(0.04, 0.045, 0.36), [lx, TRAY_Y - 0.03, 0.2])));
    }
    for (let lx = a + 1.2; lx < b; lx += 2.4) {
      add(COLORS.black, wallPart(wall, xf(box(0.05, 0.3, 0.05), [lx, TRAY_Y - 0.17, 0.05])));
    }
    // cable bundle riding in the tray
    [[COLORS.red, 0.1], [COLORS.yellow, 0.2], [COLORS.purple, 0.3]].forEach(([c, lz], i) => {
      const g = new THREE.CylinderGeometry(0.03, 0.03, len - 0.1, 8).rotateZ(Math.PI / 2);
      add(c, wallPart(wall, g.translate(mid, TRAY_Y + 0.045, lz)), 0);
    });
  }
}
function buildSpotsAndPendants() {
  const spot = (wall, lx) => {
    add(COLORS.black, wallPart(wall, xf(box(0.05, 0.14, 0.05), [lx, TRAY_Y - 0.1, 0.22])));
    add(COLORS.black, wallPart(wall, xf(box(0.05, 0.05, 0.3), [lx, TRAY_Y - 0.18, 0.34])));
    add(COLORS.yellow, wallPart(wall, xf(cyl(0.1, 0.17, 0.3, 14), [lx, TRAY_Y - 0.32, 0.5], [-0.5, 0, 0])));
  };
  for (const lx of [-8.4, -5.6, -3.2, 3.2, 5.6, 8.4]) spot('back', lx);
  for (const z of [-5.4, -2.6, -0.6, 2.2, 4.2, 7.0]) spot('left', -z);

  const pendant = (wall, lx, i) => {
    const drop = 0.65;
    add(COLORS.black, wallPart(wall, xf(box(0.025, drop, 0.025), [lx, TRAY_Y - 0.02 - drop / 2, 0.3])));
    const shadeCol = i % 2 ? COLORS.white : COLORS.yellow;
    const dome = new THREE.SphereGeometry(0.3, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2);
    add(shadeCol, wallPart(wall, xf(dome, [lx, TRAY_Y - 0.02 - drop - 0.2, 0.3])));
    add(COLORS.black, wallPart(wall, xf(cyl(0.07, 0.07, 0.07, 10), [lx, TRAY_Y - 0.02 - drop + 0.0, 0.3])));
    add(i % 2 ? COLORS.purple : COLORS.red, wallPart(wall, xf(cyl(0.305, 0.305, 0.035, 18), [lx, TRAY_Y - 0.02 - drop - 0.19, 0.3])));
  };
  [-10.4, -3.6, 3.6, 10.4].forEach((lx, i) => pendant('back', lx, i));
  [7.8, 1.6, -3.2, -8.0].forEach((lx, i) => pendant('left', lx, i + 1));
}

// ---------- neon PRODUCTS sign ----------
function buildSign(group) {
  const W = 4.6, H = 0.7, Y = 4.93;
  add(COLORS.black, wallPart('back', xf(box(W, H, 0.12), [0, Y, 0.06])));
  add(COLORS.purple, wallPart('back', xf(box(W + 0.14, 0.05, 0.1), [0, Y + H / 2 + 0.05, 0.05])));
  add(COLORS.purple, wallPart('back', xf(box(W + 0.14, 0.05, 0.1), [0, Y - H / 2 - 0.05, 0.05])));
  const text = canvasPlane(W, H, 1472, 224, (ctx, w, h) => {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'italic 800 150px Montserrat, system-ui, sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '6px';
    ctx.shadowColor = hex(COLORS.purple);
    ctx.shadowBlur = 30;
    ctx.fillStyle = hex(COLORS.purple);
    ctx.fillText('PRODUCTS', w / 2, h / 2 + 10);
    ctx.fillText('PRODUCTS', w / 2, h / 2 + 10);
    ctx.shadowBlur = 0;
    ctx.lineWidth = 5;
    ctx.strokeStyle = hex(COLORS.white);
    ctx.strokeText('PRODUCTS', w / 2, h / 2 + 10);
    ctx.fillStyle = hex(mix(COLORS.purple, COLORS.white, 0.7));
    ctx.fillText('PRODUCTS', w / 2, h / 2 + 10);
  });
  text.name = 'sign-text';
  text.position.set(0, Y, 0.125);
  text.applyMatrix4(WALL_M.back);
  group.add(text);
}

// ---------- exit: door mat, arch with TOWN sign, light spill ----------
function buildExit(group) {
  const { x, z } = HALL_EXIT;
  add(COLORS.white, xf(box(2.3, 0.06, 1.1), [x, 0.03, z]));
  add(COLORS.yellow, xf(box(2.3, 0.07, 0.1), [x, 0.03, z - 0.5]));
  add(COLORS.yellow, xf(box(2.3, 0.07, 0.1), [x, 0.03, z + 0.5]));
  const mat = canvasPlane(2.1, 0.9, 840, 360, (ctx, w, h) => {
    ctx.fillStyle = hex(COLORS.black);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'italic 800 170px Montserrat, system-ui, sans-serif';
    ctx.fillText('← Town', w / 2, h / 2 + 10, 780);
  });
  mat.geometry.rotateX(-Math.PI / 2);
  mat.position.set(x, 0.075, z);
  mat.name = 'exit-mat-text';
  group.add(mat);

  // arch: U-shaped bevelled slab (pillars + half-round head), facing +Z. Own meshes (see archBuckets).
  const archGroup = new THREE.Group();
  archGroup.name = 'exit-arch';
  target = archBuckets;
  const PZ = z + 0.1, PX = 1.55, RIN = PX - 0.17, ROUT = PX + 0.17, PH = 1.75, DEP = 0.34;
  const s = new THREE.Shape();
  s.moveTo(-ROUT, 0);
  s.lineTo(-ROUT, PH);
  s.absarc(0, PH, ROUT, Math.PI, 0, true);
  s.lineTo(ROUT, 0);
  s.lineTo(RIN, 0);
  s.lineTo(RIN, PH);
  s.absarc(0, PH, RIN, 0, Math.PI, false);
  s.lineTo(-RIN, 0);
  s.closePath();
  const bt = 0.04;
  const arch = new THREE.ExtrudeGeometry(s, {
    depth: DEP - 2 * bt, bevelEnabled: true, bevelThickness: bt, bevelSize: bt, bevelOffset: -bt, bevelSegments: 2, curveSegments: 18,
  });
  arch.translate(x, 0.06, PZ - DEP / 2 + bt);
  add(COLORS.white, arch);
  // keystone + plinths + band of the brand colour on the pillars
  add(COLORS.wallTrim, xf(box(0.5, 0.22, DEP + 0.1), [x, PH + ROUT - 0.08, PZ]));
  for (const sx of [-1, 1]) {
    add(COLORS.wallTrim, xf(box(0.5, 0.2, DEP + 0.08), [x + sx * PX, 0.16, PZ]));
    add(COLORS.wallTrim, xf(box(0.44, 0.14, DEP + 0.06), [x + sx * PX, PH - 0.05, PZ]));
    // warm sconce on the inner side of each pillar
    add(COLORS.black, xf(box(0.07, 0.07, 0.12), [x + sx * (RIN - 0.06), 1.3, PZ + 0.0]));
    add(COLORS.yellow, xf(new THREE.SphereGeometry(0.11, 12, 8), [x + sx * (RIN - 0.14), 1.3, PZ]));
  }
  // sage TOWN board hanging in the arch on two cords
  const BW = 1.5, BH = 0.5, BY = PH + 0.62;
  add(LEAF_LIGHT, xf(box(BW, BH, 0.08), [x, BY, PZ]));
  add(COLORS.white, xf(box(BW + 0.08, 0.04, 0.1), [x, BY + BH / 2 + 0.02, PZ]));
  add(COLORS.white, xf(box(BW + 0.08, 0.04, 0.1), [x, BY - BH / 2 - 0.02, PZ]));
  for (const sx of [-0.55, 0.55]) add(COLORS.black, xf(box(0.025, 0.55, 0.025), [x + sx, BY + BH / 2 + 0.3, PZ]));
  const board = (into) => {
    const m = canvasPlane(BW - 0.1, BH - 0.08, 600, 192, (ctx, w, h) => {
      ctx.fillStyle = hex(LEAF_LIGHT);
      ctx.fillRect(0, 0, w, h);
      ctx.lineWidth = 5;
      ctx.strokeStyle = hex(COLORS.white);
      roundRect(ctx, 10, 10, w - 20, h - 20, 18);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'italic 800 120px Montserrat, system-ui, sans-serif';
      if ('letterSpacing' in ctx) ctx.letterSpacing = '8px';
      ctx.fillStyle = hex(mix(LEAF_LIGHT, COLORS.black, 0.4));
      ctx.fillText('TOWN', w / 2 + 4, h / 2 + 11);
      ctx.fillStyle = hex(COLORS.white);
      ctx.fillText('TOWN', w / 2, h / 2 + 6);
    }, { transparent: false });
    m.position.set(x, BY, PZ + 0.045);
    m.name = 'exit-sign-text';
    into.add(m);
  };
  board(archGroup);
  flushBuckets(archGroup, archBuckets, 'arch');
  target = buckets;
  group.add(archGroup);

  // light spill on the floor, from the doorway into the room
  const spill = canvasPlane(5.6, 3.4, 448, 272, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, h, 0, 0);
    g.addColorStop(0, 'rgba(255,238,170,0.55)');
    g.addColorStop(0.55, 'rgba(255,238,170,0.2)');
    g.addColorStop(1, 'rgba(255,238,170,0)');
    ctx.fillStyle = g;
    ctx.filter = 'blur(10px)';
    ctx.beginPath();
    ctx.moveTo(w * 0.27, h);
    ctx.lineTo(w * 0.73, h);
    ctx.lineTo(w * 0.96, 8);
    ctx.lineTo(w * 0.04, 8);
    ctx.closePath();
    ctx.fill();
  }, { order: 1 });
  spill.geometry.rotateX(-Math.PI / 2);
  spill.position.set(x, 0.1, z + 0.2 - 1.7);
  spill.name = 'exit-spill';
  // Close-up cameras (product views) look along the floor through the doorway: fade the arch out then.
  const _d = new THREE.Vector3();
  spill.onBeforeRender = (renderer, scene, camera) => {
    camera.getWorldDirection(_d);
    archGroup.visible = _d.y < -0.4;
  };
  group.add(spill);
}

// ---------- stanchions with ropes at the sides of each frame ----------
function buildStanchion(x, z) {
  add(COLORS.black, xf(cyl(0.2, 0.22, 0.05, 16), [x, 0.025, z]));
  add(BRASS, xf(cyl(0.04, 0.05, 0.95, 10), [x, 0.5, z]));
  add(BRASS, xf(cyl(0.075, 0.075, 0.05, 12), [x, 0.3, z]));
  add(BRASS, xf(ball(0.1, 2), [x, 1.0, z]));
}
function buildRope(a, b) {
  const mid = new THREE.Vector3((a.x + b.x) / 2, 0.88, (a.z + b.z) / 2);
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(a.x, 0.93, a.z), mid, new THREE.Vector3(b.x, 0.93, b.z)]);
  add(COLORS.red, new THREE.TubeGeometry(curve, 10, 0.03, 6), 0);
}

// ---------- floor guide lines (dashes + arrowheads, flat decals) ----------
function guideLine(x0, z0, x1, z1) {
  const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz), ang = Math.atan2(dx, dz);
  const ux = dx / len, uz = dz / len;
  const arrowLen = 0.34;
  const end = len - arrowLen;
  for (let t = 0.1; t + 0.42 < end; t += 0.72) {
    const cx = x0 + ux * (t + 0.21), cz = z0 + uz * (t + 0.21);
    add(COLORS.yellow, xf(box(0.11, 0.012, 0.42), [cx, 0.022, cz], [0, ang, 0]), 0);
  }
  const ax = x0 + ux * (len - arrowLen / 2), az = z0 + uz * (len - arrowLen / 2);
  add(COLORS.yellow, xf(new THREE.CylinderGeometry(0.2, 0.2, 0.012, 3), [ax, 0.022, az], [0, ang, 0]), 0);
}
const toward = (from, spot, r = 1.75) => {
  const dx = from.x - spot.x, dz = from.z - spot.z, d = Math.hypot(dx, dz);
  return { x: spot.x + (dx / d) * r, z: spot.z + (dz / d) * r };
};

// ---------- main ----------
export function createHall() {
  const group = new THREE.Group();
  group.name = 'hall';
  const colliders = [];
  const W = ROOM.maxX - ROOM.minX;
  const D = ROOM.maxZ - ROOM.minZ;

  // Floor: one slab, hand-painted herringbone parquet
  addTex('floorHerringbone', FLOOR, xf(box(W, 0.3, D), [0, -0.15, 0]), 2.8, OUTLINE);

  // Walls: wallpaper above a woodVertical wainscot (back wall z = minZ, left wall x = minX)
  for (const wall of ['back', 'left']) {
    const [a, b] = WALL_SPAN[wall];
    addTex('wallpaper', COLORS.wall, wbox(wall, a, b, WAIN_H, WALL_H, -WALL_T, 0), 1.6, OUTLINE);
    // the left wall's wainscot starts WAIN_OUT short of the corner so it does not overlap the back wall's
    const wa = wall === 'left' ? a : a;
    const wb = wall === 'left' ? b - WAIN_OUT : b;
    addTex('woodVertical', WAINSCOT, wbox(wall, wa, wb, 0, WAIN_H, -WALL_T, WAIN_OUT), [1.6, 1.6], 0);

    // trims, all flat colour: skirting, chair rail, crown moulding
    const ta = wall === 'left' ? a : ROOM.minX;
    const tb = wall === 'left' ? b - WAIN_OUT : b;
    add(COLORS.white, wbox(wall, ta, tb, 0, 0.3, WAIN_OUT, WAIN_OUT + 0.06));
    add(COLORS.wallTrim, wbox(wall, ta, tb, 0.3, 0.36, WAIN_OUT, WAIN_OUT + 0.075), 0);
    add(COLORS.white, wbox(wall, ta, tb, WAIN_H - 0.02, WAIN_H + 0.1, 0, WAIN_OUT + 0.09));
    add(COLORS.wallTrim, wbox(wall, a, b, WALL_H - 0.22, WALL_H + 0.05, -WALL_T - 0.04, 0.14));
    add(COLORS.white, wbox(wall, a, b, WALL_H - 0.3, WALL_H - 0.22, 0, 0.08));
  }

  buildSign(group);
  buildTrays();
  buildSpotsAndPendants();
  buildPoster(-3.2, 2.7, HEART, COLORS.red);
  buildPoster(3.75, 2.7, ALIEN, COLORS.purple);
  buildExit(group);

  // Rugs: carpet texture on a purple base. Central rug + runner from the exit. Flat on the floor.
  const RUG = { x: 0, z: 1.4, w: 6, d: 4.4 };
  addTex('carpet', COLORS.purple, xf(box(RUG.w, 0.03, RUG.d), [RUG.x, 0.015, RUG.z]), 2, OUTLINE);
  const RUN = { x: 0, z: 5.75, w: 2.3, d: 4.5 };
  addTex('carpet', COLORS.purple, xf(box(RUN.w, 0.03, RUN.d), [RUN.x, 0.015, RUN.z]), 2, OUTLINE);
  // yellow border lines + fringe
  const border = (cx, cz, w, d, inset, lw) => {
    const hw = w / 2 - inset, hd = d / 2 - inset;
    add(COLORS.yellow, xf(box(w - inset * 2, 0.012, lw), [cx, 0.036, cz - hd]), 0);
    add(COLORS.yellow, xf(box(w - inset * 2, 0.012, lw), [cx, 0.036, cz + hd]), 0);
    add(COLORS.yellow, xf(box(lw, 0.012, d - inset * 2), [cx - hw, 0.036, cz]), 0);
    add(COLORS.yellow, xf(box(lw, 0.012, d - inset * 2), [cx + hw, 0.036, cz]), 0);
  };
  border(RUG.x, RUG.z, RUG.w, RUG.d, 0.22, 0.07);
  border(RUN.x, RUN.z, RUN.w, RUN.d, 0.2, 0.06);
  for (const sz of [-1, 1]) {
    for (let i = 0; i < 24; i++) {
      add(COLORS.white, xf(box(0.07, 0.014, 0.16), [RUG.x - RUG.w / 2 + 0.12 + i * ((RUG.w - 0.24) / 23), 0.02, RUG.z + sz * (RUG.d / 2 + 0.08)]), 0);
    }
  }

  // Floor guide lines from the rugs toward every exhibit spot (stop at the spot's 1.5 radius)
  const spots = Object.fromEntries(EXHIBITS.map((e) => [e.id, exhibitSpot(e)]));
  const line = (from, id, r = 1.75) => {
    const to = toward(from, spots[id], r);
    guideLine(from.x, from.z, to.x, to.z);
  };
  const TRUNK_Z = -3.0;
  line({ x: 0, z: RUG.z - RUG.d / 2 - 0.1 }, 'pay');
  guideLine(-6.95, TRUNK_Z, 6.95, TRUNK_Z); // cross corridor between the two wall groups
  line({ x: -7, z: TRUNK_Z }, 'learn');
  line({ x: 7, z: TRUNK_Z }, 'flow');
  line({ x: -5.2, z: TRUNK_Z }, 'care');
  line({ x: RUG.x - RUG.w / 2 - 0.1, z: spots.home.z }, 'home');
  line({ x: -RUN.w / 2 - 0.1, z: spots.studio.z }, 'studio');

  // Frame footprints (vitrine boxes, world coords) + stanchions at the sides of each frame
  const lw = (e, lx, lz) => {
    const c = Math.cos(e.rotY), s = Math.sin(e.rotY);
    return { x: e.x + lx * c + lz * s, z: e.z - lx * s + lz * c };
  };
  const posts = new Map();
  for (const e of EXHIBITS) {
    const hw = FRAME.outerW / 2;
    const d = FRAME.depth;
    const nx = e.normal.x, nz = e.normal.z;
    const x0 = nx ? e.x : e.x - hw;
    const x1 = nx ? e.x + nx * d : e.x + hw;
    const z0 = nz ? e.z : e.z - hw;
    const z1 = nz ? e.z + nz * d : e.z + hw;
    colliders.push({ type: 'box', minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1) });

    // two short rope runs flanking the opening; the 1.5 radius around the spot stays clear
    for (const side of [-1, 1]) {
      const pa = lw(e, side * 1.75, FRAME.depth + 0.4);
      const pb = lw(e, side * 2.45, FRAME.depth + 0.4);
      for (const p of [pa, pb]) {
        const key = `${p.x.toFixed(2)},${p.z.toFixed(2)}`;
        if (posts.has(key)) continue;
        posts.set(key, true);
        buildStanchion(p.x, p.z);
        colliders.push({ x: p.x, z: p.z, r: 0.16 });
      }
      buildRope(pa, pb);
    }
  }

  // Plants (corners, wall gaps, front edge). Frames' spots (3.4 from the wall, r 1.5) stay free.
  const potCycle = [COLORS.white, COLORS.red, COLORS.yellow];
  const plants = [
    [11.3, -5.2, 'tall', 1.05],
    [-3.5, -8.4, 'tall', 1.05],
    [3.5, -8.4, 'fan', 1.1],
    [11.3, -1.3, 'bush', 1],
    [11.3, 5.3, 'fan', 1],
    [11.2, 8.2, 'tall', 1.05],
    [-11.2, 8.2, 'bush', 0.95],
    [-8.2, 8.3, 'fan', 0.9],
    [11.3, 2.0, 'monstera', 1.0],
    [3.3, 8.3, 'monstera', 0.95],
    [6.8, 8.3, 'bush', 0.9],
    [-9.4, -8.3, 'monstera', 0.9],
  ];
  plants.forEach(([x, z, type, sc], i) => {
    buildPlant(x, z, type, potCycle[i % 3], sc, i + 1);
    colliders.push({ x, z, r: 0.5 * sc });
  });

  // Museum benches in the middle, each facing a wall of exhibits
  const benches = [
    [-3.8, -1.8, Math.PI], // faces the back wall
    [3.8, -1.8, Math.PI],
    [-4.6, 3.2, -Math.PI / 2], // faces the left wall
  ];
  benches.forEach(([x, z, ry]) => {
    buildBench(x, z, ry);
    const ax = Math.cos(ry), az = -Math.sin(ry); // bench long axis in world
    for (const t of [-0.9, 0, 0.9]) colliders.push({ x: x + ax * t, z: z + az * t, r: 0.55 });
  });

  // Reception / info desk beside the exit, facing the doorway side (+Z)
  buildDesk(group, -4.3, 7.55, 0);
  for (const dx of [-1.2, -0.4, 0.4, 1.2]) colliders.push({ x: -4.3 + dx, z: 7.55, r: 0.6 });

  // Server rack (back-left corner) with blinking LEDs, vending machine (back-right corner)
  const ledsA = [], ledsB = [];
  buildServerRack(-10.5, -8.3, ledsA, ledsB);
  for (const dx of [-0.4, 0, 0.4]) colliders.push({ x: -10.5 + dx, z: -8.3, r: 0.55 });
  const ledsV = [];
  buildVending(10.7, -8.3, 0, ledsV);
  for (const dx of [-0.4, 0, 0.4]) colliders.push({ x: 10.7 + dx, z: -8.3, r: 0.55 });

  const blink = (geos, name, colA, colB, period) => {
    const mat = new THREE.MeshBasicMaterial({ color: colA });
    const mesh = new THREE.Mesh(mergeGeometries(geos.map((g) => prep(g, false)), false), mat);
    mesh.name = name;
    mesh.raycast = () => {};
    mesh.onBeforeRender = () => mat.color.setHex(Math.floor(performance.now() / period) % 2 ? colB : colA);
    group.add(mesh);
  };
  blink(ledsA.concat(ledsV), 'rack-led-a', COLORS.yellow, COLORS.white, 600);
  blink(ledsB, 'rack-led-b', COLORS.red, COLORS.purple, 900);

  flushBuckets(group);

  // arch pillars are solid
  for (const sx of [-1.55, 1.55]) colliders.push({ x: HALL_EXIT.x + sx, z: HALL_EXIT.z + 0.1, r: 0.25 });

  group.userData.decor = { plants, benches };
  return { object3d: group, colliders };
}
