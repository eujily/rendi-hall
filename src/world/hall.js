import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMesh, toonMaterial, addOutline } from '../kit/toon.js';
import { COLORS, mix } from '../core/tokens.js';
import { ROOM, HALL_WALL_H, FRAME, EXHIBITS, HALL_EXIT } from '../core/layout.js';

// Rendi Hall: a cosy Stardew-style museum of products with an IT flavour.
// Walls carry the exhibit frames (built in stands/_frame.js); this file builds floor, walls,
// the PRODUCTS neon, spotlight track, benches, plants, server rack, vending machine and the exit.
// Static parts of one colour are merged into one mesh (+ outline hull): ~30 draw calls.

const WALL_H = HALL_WALL_H;
const WALL_T = 0.3;
const OUTLINE = 0.03;

const LEAF_DARK = mix(COLORS.sage, COLORS.black, 0.18);
const LEAF_LIGHT = COLORS.sage;
const SEAM = mix(COLORS.floorA, COLORS.black, 0.08);
const RACK = mix(COLORS.purple, COLORS.black, 0.62);
const RACK_UNIT = mix(RACK, COLORS.white, 0.16);
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

// colour -> geometries to merge
const buckets = new Map();
function add(color, geo) {
  if (!buckets.has(color)) buckets.set(color, []);
  buckets.get(color).push(geo);
  return geo;
}
function prep(g) {
  const out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'normal') out.deleteAttribute(name);
  }
  return out;
}
function flushBuckets(group, { outlineFor = () => OUTLINE, name = 'decor' } = {}) {
  for (const [color, geos] of buckets) {
    const merged = mergeGeometries(geos.map(prep), false);
    const mesh = toonMesh(merged, color, { outline: outlineFor(color), cast: true, receive: true });
    mesh.name = `${name}-${color.toString(16)}`;
    group.add(mesh);
  }
  buckets.clear();
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, seg = 16) => new THREE.CylinderGeometry(rt, rb, h, seg);

// ---------- wall frames ----------
// Local wall frame: lx along the wall, ly up, lz out of the wall into the room (left wall: lx = -z).
const WALL_M = {
  back: matrix([0, 0, ROOM.minZ]),
  left: matrix([ROOM.minX, 0, 0], [0, Math.PI / 2, 0]),
};
const wallPart = (wall, geo) => geo.applyMatrix4(WALL_M[wall]);

function canvasPlane(w, h, cw, ch, draw, { transparent = true } = {}) {
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
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent, depthWrite: !transparent }),
  );
  mesh.raycast = () => {};
  return mesh;
}

// ---------- plants ----------
function ellipsoid(rx, ry, rz) {
  return new THREE.IcosahedronGeometry(1, 2).scale(rx, ry, rz);
}
function buildPlant(x, z, type, potColor, scale, seed) {
  const P = matrix([x, 0, z], [0, rnd(seed) * Math.PI * 2, 0], [scale, scale, scale]);
  const put = (color, geo) => add(color, geo.applyMatrix4(P));
  put(potColor, xf(cyl(0.36, 0.26, 0.5), [0, 0.25, 0]));
  put(potColor, xf(cyl(0.41, 0.41, 0.11), [0, 0.55, 0]));
  const base = 0.58;
  if (type === 'bush') {
    put(LEAF_DARK, xf(ellipsoid(0.46, 0.4, 0.46), [0, base + 0.3, 0]));
    put(LEAF_LIGHT, xf(ellipsoid(0.3, 0.28, 0.3), [-0.3, base + 0.22, 0.12]));
    put(LEAF_DARK, xf(ellipsoid(0.32, 0.3, 0.32), [0.3, base + 0.2, -0.1]));
    put(LEAF_LIGHT, xf(ellipsoid(0.28, 0.26, 0.28), [0.04, base + 0.68, 0.04]));
  } else if (type === 'fan') {
    const n = 9;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const tilt = 0.3 + (0.38 * (k % 3)) / 2;
      const len = 0.62 + 0.2 * rnd(seed + k);
      const leaf = ellipsoid(0.14, len, 0.045);
      leaf.translate(0, len * 0.9, 0);
      leaf.applyMatrix4(new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeRotationX(tilt)));
      leaf.translate(0, base - 0.05, 0);
      put(k % 2 ? LEAF_LIGHT : LEAF_DARK, leaf);
    }
  } else {
    put(COLORS.wood, xf(cyl(0.045, 0.06, 1.2, 8), [0, base + 0.6, 0]));
    const blobs = [
      [0, 1.25, 0, 0.44], [-0.32, 0.95, 0.1, 0.34], [0.34, 0.85, -0.08, 0.34], [0.05, 1.62, 0.05, 0.3], [0.1, 0.62, 0.3, 0.26],
    ];
    blobs.forEach(([bx, by, bz, br], k) => {
      put(k % 2 ? LEAF_LIGHT : LEAF_DARK, xf(ellipsoid(br * 1.15, br * 0.75, br * 1.15), [bx, base + by, bz]));
    });
  }
}

// ---------- museum bench (seat faces local +Z, rotated by ry) ----------
function buildBench(x, z, ry) {
  const P = matrix([x, 0, z], [0, ry, 0]);
  const put = (color, geo) => add(color, geo.applyMatrix4(P));
  put(COLORS.wood, xf(box(2.4, 0.1, 0.7), [0, 0.5, 0]));
  put(COLORS.wood, xf(box(2.4, 0.42, 0.08), [0, 0.86, -0.31]));
  for (const sx of [-1.05, 1.05]) {
    for (const sz of [-0.26, 0.26]) put(COLORS.wood, xf(box(0.1, 0.5, 0.1), [sx, 0.25, sz]));
  }
  put(COLORS.white, xf(box(2.2, 0.06, 0.5), [0, 0.58, 0.02]));
  put(COLORS.purple, xf(box(0.6, 0.14, 0.44), [-0.55, 0.68, 0.02], [0, 0.1, 0]));
  put(COLORS.red, xf(box(0.6, 0.14, 0.44), [0.6, 0.68, 0.02], [0, -0.12, 0]));
}

// ---------- server rack with blinking LEDs (front faces local +Z) ----------
function buildServerRack(x, z, ledsA, ledsB) {
  const P = matrix([x, 0, z]);
  const put = (color, geo) => add(color, geo.applyMatrix4(P));
  put(RACK, xf(box(1.3, 2.5, 0.9), [0, 1.25, 0]));
  put(COLORS.black, xf(box(1.36, 0.08, 0.96), [0, 0.04, 0]));
  for (let k = 0; k < 6; k++) {
    const y = 0.5 + k * 0.34;
    put(RACK_UNIT, xf(box(1.1, 0.24, 0.05), [0, y, 0.46]));
    put(COLORS.black, xf(box(0.5, 0.05, 0.02), [-0.18, y, 0.5]));
    (k % 2 ? ledsB : ledsA).push(xf(box(0.08, 0.08, 0.04), [0.4, y, 0.5]).applyMatrix4(P));
    (k % 2 ? ledsA : ledsB).push(xf(box(0.08, 0.08, 0.04), [0.27, y, 0.5]).applyMatrix4(P));
  }
  put(COLORS.white, xf(box(1.3, 0.06, 0.9), [0, 2.53, 0]));
  // cable bundle to the ceiling
  put(COLORS.black, xf(box(0.08, 0.5, 0.08), [-0.3, 2.8, -0.1]));
}

// ---------- vending machine (front faces local +Z) ----------
function buildVending(x, z, ry) {
  const P = matrix([x, 0, z], [0, ry, 0]);
  const put = (color, geo) => add(color, geo.applyMatrix4(P));
  put(COLORS.red, xf(box(1.3, 2.2, 0.9), [0, 1.1, 0]));
  put(COLORS.black, xf(box(1.36, 0.1, 0.96), [0, 0.05, 0]));
  put(COLORS.white, xf(box(0.9, 1.35, 0.05), [-0.12, 1.4, 0.46]));
  const shelfCols = [COLORS.yellow, COLORS.purple, COLORS.mascot, COLORS.white];
  for (let r = 0; r < 3; r++) {
    put(COLORS.black, xf(box(0.9, 0.04, 0.07), [-0.12, 0.95 + r * 0.42, 0.5]));
    for (let c = 0; c < 4; c++) {
      put(shelfCols[(r + c) % 4], xf(box(0.15, 0.26, 0.1), [-0.4 + c * 0.22, 1.1 + r * 0.42, 0.52]));
    }
  }
  put(COLORS.black, xf(box(0.22, 0.7, 0.05), [0.5, 1.5, 0.46]));
  put(COLORS.yellow, xf(box(0.14, 0.1, 0.04), [0.5, 1.7, 0.5]));
  put(COLORS.black, xf(box(0.8, 0.22, 0.06), [0, 0.38, 0.46]));
  put(COLORS.yellow, xf(box(1.3, 0.14, 0.9), [0, 2.27, 0]));
}

// ---------- pixel-art poster in a wall gap ----------
const HEART = ['.XX.XX.', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
const ALIEN = ['..X.X..', '.XXXXX.', 'XX.X.XX', 'XXXXXXX', 'X.X.X.X'];
function buildPoster(lx, ly, pattern, color) {
  const w = 1.6, h = 1.4;
  add(COLORS.white, wallPart('back', xf(box(w + 0.16, h + 0.16, 0.08), [lx, ly, 0.04])));
  add(COLORS.lavender, wallPart('back', xf(box(w, h, 0.04), [lx, ly, 0.1])));
  const px = 0.17;
  pattern.forEach((row, j) => {
    [...row].forEach((ch, i) => {
      if (ch !== 'X') return;
      add(color, wallPart('back', xf(box(px, px, 0.04), [lx + (i - 3) * px, ly + (2 - j) * px, 0.14])));
    });
  });
}

// ---------- spotlight track ----------
function buildTrack() {
  const rails = [
    ['back', -11.8, -2.7],
    ['back', 2.7, 11.8],
    ['left', -8.6, 8.4],
  ];
  for (const [wall, a, b] of rails) {
    add(COLORS.black, wallPart(wall, xf(box(b - a, 0.07, 0.07), [(a + b) / 2, 5.15, 0.1])));
  }
  const spot = (wall, lx) => {
    add(COLORS.black, wallPart(wall, xf(box(0.05, 0.05, 0.34), [lx, 5.1, 0.27])));
    add(COLORS.yellow, wallPart(wall, xf(cyl(0.1, 0.17, 0.3, 14), [lx, 4.98, 0.44], [-0.5, 0, 0])));
  };
  for (const lx of [-8.4, -5.6, -3.2, 3.2, 5.6, 8.4]) spot('back', lx);
  for (const z of [-5.4, -2.6, -0.6, 2.2, 4.2, 7.0]) spot('left', -z);
}

// ---------- neon PRODUCTS sign ----------
function buildSign(group) {
  const W = 4.6, H = 0.92, Y = 4.86;
  add(COLORS.black, wallPart('back', xf(box(W, H, 0.12), [0, Y, 0.06])));
  add(COLORS.purple, wallPart('back', xf(box(W + 0.14, 0.05, 0.1), [0, Y + H / 2 + 0.07, 0.05])));
  add(COLORS.purple, wallPart('back', xf(box(W + 0.14, 0.05, 0.1), [0, Y - H / 2 - 0.07, 0.05])));
  const text = canvasPlane(W, H, 1472, 294, (ctx, w, h) => {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'italic 800 190px Montserrat, system-ui, sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '6px';
    ctx.shadowColor = hex(COLORS.purple);
    ctx.shadowBlur = 36;
    ctx.fillStyle = hex(COLORS.purple);
    ctx.fillText('PRODUCTS', w / 2, h / 2 + 14);
    ctx.fillText('PRODUCTS', w / 2, h / 2 + 14);
    ctx.shadowBlur = 0;
    ctx.lineWidth = 6;
    ctx.strokeStyle = hex(COLORS.white);
    ctx.strokeText('PRODUCTS', w / 2, h / 2 + 14);
    ctx.fillStyle = hex(mix(COLORS.purple, COLORS.white, 0.7));
    ctx.fillText('PRODUCTS', w / 2, h / 2 + 14);
  });
  text.name = 'sign-text';
  text.position.set(0, Y, 0.125);
  text.applyMatrix4(WALL_M.back);
  group.add(text);
}

// ---------- exit (door mat + posts) ----------
function buildExit(group) {
  const { x, z } = HALL_EXIT;
  add(COLORS.white, xf(box(2.3, 0.06, 1.1), [x, 0.03, z]));
  add(COLORS.yellow, xf(box(2.3, 0.07, 0.1), [x, 0.03, z - 0.5]));
  add(COLORS.yellow, xf(box(2.3, 0.07, 0.1), [x, 0.03, z + 0.5]));
  for (const sx of [-1.55, 1.55]) {
    add(COLORS.black, xf(cyl(0.26, 0.3, 0.1, 16), [x + sx, 0.05, z + 0.1]));
    add(COLORS.white, xf(cyl(0.13, 0.15, 1.35, 12), [x + sx, 0.75, z + 0.1]));
    add(COLORS.yellow, xf(new THREE.IcosahedronGeometry(0.2, 2), [x + sx, 1.5, z + 0.1]));
  }
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
}

// ---------- main ----------
export function createHall() {
  const group = new THREE.Group();
  group.name = 'hall';
  const colliders = [];
  const W = ROOM.maxX - ROOM.minX;
  const D = ROOM.maxZ - ROOM.minZ;

  // Floor: basket-weave parquet. 1.2 x 1.2 tiles of three planks, orientation and tone alternate.
  const slab = new THREE.Mesh(box(W, 0.2, D), toonMaterial(SEAM));
  slab.position.set(0, -0.16, 0);
  slab.receiveShadow = true;
  slab.name = 'floor-seams';
  group.add(slab);

  const TILE = 1.2, PL = 1.16, PW = 0.37, PH = 0.1;
  const plankGeo = box(1, 1, 1);
  const mats = { A: [], B: [] };
  for (let i = 0; i < W / TILE; i++) {
    for (let j = 0; j < D / TILE; j++) {
      const cx = ROOM.minX + TILE * i + TILE / 2;
      const cz = ROOM.minZ + TILE * j + TILE / 2;
      const alongX = (i + j) % 2 === 0;
      for (let k = 0; k < 3; k++) {
        const off = (k - 1) * (TILE / 3);
        const px = alongX ? cx : cx + off;
        const pz = alongX ? cz + off : cz;
        const m = matrix([px, -PH / 2, pz], [0, 0, 0], alongX ? [PL, PH, PW] : [PW, PH, PL]);
        (((i + j + k) % 2 === 0) ? mats.A : mats.B).push(m);
      }
    }
  }
  for (const [key, color] of [['A', COLORS.floorA], ['B', COLORS.floorB]]) {
    const inst = new THREE.InstancedMesh(plankGeo, toonMaterial(color), mats[key].length);
    mats[key].forEach((m, idx) => inst.setMatrixAt(idx, m));
    inst.instanceMatrix.needsUpdate = true;
    inst.receiveShadow = true;
    inst.castShadow = false;
    inst.name = `floor-${key}`;
    group.add(inst);
  }

  // Walls (x = minX and z = minZ)
  const wallGeos = [
    xf(box(WALL_T, WALL_H, D), [ROOM.minX - WALL_T / 2, WALL_H / 2, 0]),
    xf(box(W + WALL_T, WALL_H, WALL_T), [-WALL_T / 2, WALL_H / 2, ROOM.minZ - WALL_T / 2]),
  ];
  const walls = toonMesh(mergeGeometries(wallGeos.map(prep), false), COLORS.wall, { outline: OUTLINE, cast: false, receive: true });
  walls.name = 'walls';
  group.add(walls);

  // Top trim, skirting, chair rail
  const TR = 0.2;
  add(COLORS.wallTrim, xf(box(WALL_T + 0.18, TR, D + WALL_T + 0.09), [ROOM.minX - WALL_T / 2 + 0.04, WALL_H - TR / 2 + 0.05, -0.045]));
  add(COLORS.wallTrim, xf(box(W + 0.09, TR, WALL_T + 0.18), [0.045, WALL_H - TR / 2 + 0.05, ROOM.minZ - WALL_T / 2 + 0.04]));
  add(COLORS.white, xf(box(0.1, 0.32, D), [ROOM.minX + 0.05, 0.16, 0]));
  add(COLORS.white, xf(box(W - 0.1, 0.32, 0.1), [0.05, 0.16, ROOM.minZ + 0.05]));
  add(COLORS.wallTrim, xf(box(0.06, 0.08, D), [ROOM.minX + 0.03, 1.1, 0]));
  add(COLORS.wallTrim, xf(box(W - 0.06, 0.08, 0.06), [0.03, 1.1, ROOM.minZ + 0.03]));

  buildSign(group);
  buildTrack();
  buildPoster(-3.5, 2.7, HEART, COLORS.red);
  buildPoster(3.5, 2.7, ALIEN, COLORS.purple);
  buildExit(group);

  // Runner carpet from the exit towards the middle (flat decal, central area stays walkable)
  add(COLORS.red, xf(box(2.0, 0.03, 5.1), [0, 0.015, 5.25]));
  add(COLORS.yellow, xf(box(1.5, 0.045, 4.6), [0, 0.0225, 5.25]));
  add(COLORS.red, xf(box(1.1, 0.06, 4.2), [0, 0.03, 5.25]));

  // Frame footprints (vitrine boxes, world coords)
  for (const e of EXHIBITS) {
    const hw = FRAME.outerW / 2;
    const d = FRAME.depth;
    const nx = e.normal.x, nz = e.normal.z;
    const x0 = nx ? e.x : e.x - hw;
    const x1 = nx ? e.x + nx * d : e.x + hw;
    const z0 = nz ? e.z : e.z - hw;
    const z1 = nz ? e.z + nz * d : e.z + hw;
    colliders.push({ type: 'box', minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1) });
  }

  // Plants (corners, wall gaps, front-right). Frames' spots (3.4 from the wall, r 1.5) stay free.
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

  // Server rack (back-left corner) with blinking LEDs, vending machine (back-right corner)
  const ledsA = [], ledsB = [];
  buildServerRack(-10.5, -8.3, ledsA, ledsB);
  for (const dx of [-0.4, 0, 0.4]) colliders.push({ x: -10.5 + dx, z: -8.3, r: 0.55 });
  buildVending(10.7, -8.3, 0);
  for (const dx of [-0.4, 0, 0.4]) colliders.push({ x: 10.7 + dx, z: -8.3, r: 0.55 });

  const blink = (geos, name, colA, colB, period) => {
    const mat = new THREE.MeshBasicMaterial({ color: colA });
    const mesh = new THREE.Mesh(mergeGeometries(geos.map(prep), false), mat);
    mesh.name = name;
    mesh.raycast = () => {};
    mesh.onBeforeRender = () => mat.color.setHex(Math.floor(performance.now() / period) % 2 ? colB : colA);
    group.add(mesh);
  };
  blink(ledsA, 'rack-led-a', COLORS.yellow, COLORS.white, 600);
  blink(ledsB, 'rack-led-b', COLORS.red, COLORS.purple, 900);

  // black parts (rails, cables) are thin: no outline
  flushBuckets(group, { outlineFor: (c) => (c === COLORS.black ? 0 : OUTLINE) });

  // exit posts are solid
  for (const sx of [-1.55, 1.55]) colliders.push({ x: HALL_EXIT.x + sx, z: HALL_EXIT.z + 0.1, r: 0.25 });

  group.userData.decor = { plants, benches };
  return { object3d: group, colliders };
}
