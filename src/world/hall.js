import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMesh, toonMaterial, flatMaterial } from '../kit/toon.js';
import { COLORS, mix } from '../core/tokens.js';
import { ROOM, STANDS } from '../core/layout.js';

// Rendi Hall: floor, two visible walls, cloud rugs and Stardew-cozy decor.
// Everything is built once; static parts of one colour are merged into a single mesh
// (+ its outline hull), so the whole hall stays around 25 draw calls.

const WALL_H = 4;
const WALL_T = 0.3;
const OUTLINE = 0.03;

const LEAF_DARK = mix(COLORS.sage, COLORS.black, 0.18);
const LEAF_LIGHT = COLORS.sage;
const GLASS = mix(COLORS.white, COLORS.yellow, 0.18);
const SEAM = mix(COLORS.floorA, COLORS.black, 0.08);
const RUG_RING = mix(COLORS.yellow, COLORS.white, 0.5);

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
function xf(geo, p, r, s) {
  return geo.applyMatrix4(matrix(p, r, s));
}
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
// Local wall frame: lx along the wall, ly up, lz out of the wall into the room.
const WALL_M = {
  back: matrix([0, 0, ROOM.minZ]),
  left: matrix([ROOM.minX, 0, 0], [0, Math.PI / 2, 0]), // world z = -lx
};
const wallPart = (wall, geo) => geo.applyMatrix4(WALL_M[wall]);

function addWindow(wall, lx, ly, glassGeos, glareGeos) {
  const w = 1.8, h = 1.5, t = 0.14, d = 0.12;
  const at = (g) => wallPart(wall, xf(g, [lx, ly, 0]));
  add(COLORS.white, at(xf(box(w + 2 * t, t, d), [0, h / 2 + t / 2, d / 2])));
  add(COLORS.white, at(xf(box(w + 2 * t, t, d), [0, -h / 2 - t / 2, d / 2])));
  add(COLORS.white, at(xf(box(t, h, d), [-w / 2 - t / 2, 0, d / 2])));
  add(COLORS.white, at(xf(box(t, h, d), [w / 2 + t / 2, 0, d / 2])));
  add(COLORS.white, at(xf(box(0.07, h, 0.08), [0, 0, 0.06])));
  add(COLORS.white, at(xf(box(w, 0.07, 0.08), [0, 0, 0.06])));
  add(COLORS.white, at(xf(box(w + 0.6, 0.1, 0.32), [0, -h / 2 - t - 0.05, 0.16])));
  glassGeos.push(at(xf(new THREE.PlaneGeometry(w, h), [0, 0, 0.03])));
  // two soft diagonal glare streaks
  for (const [ox, sw] of [[-0.35, 0.22], [0.1, 0.1]]) {
    const sh = new THREE.Shape();
    sh.moveTo(ox - sw / 2 + 0.5, -h / 2);
    sh.lineTo(ox + sw / 2 + 0.5, -h / 2);
    sh.lineTo(ox + sw / 2 - 0.2, h / 2);
    sh.lineTo(ox - sw / 2 - 0.2, h / 2);
    glareGeos.push(at(xf(new THREE.ShapeGeometry(sh), [0, 0, 0.035])));
  }
}

// ---------- cloud rugs ----------
function cloudPoints(R, lobes, phase, n = 160) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = R * (0.8 + 0.2 * Math.pow(Math.abs(Math.sin((lobes * a) / 2 + phase)), 0.55));
    pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  return pts;
}
function flatShape(shape) {
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2); // lie on the floor, facing up
  return g;
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
      const tilt = 0.3 + 0.38 * (k % 3) / 2;
      const len = 0.62 + 0.2 * rnd(seed + k);
      const leaf = ellipsoid(0.14, len, 0.045);
      leaf.translate(0, len * 0.9, 0);
      leaf.applyMatrix4(new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeRotationX(tilt)));
      leaf.translate(0, base - 0.05, 0);
      put(k % 2 ? LEAF_LIGHT : LEAF_DARK, leaf);
    }
  } else {
    // tall: slim wooden stem with flattened leaf clouds
    put(COLORS.wood, xf(cyl(0.045, 0.06, 1.2, 8), [0, base + 0.6, 0]));
    const blobs = [
      [0, 1.25, 0, 0.44], [-0.32, 0.95, 0.1, 0.34], [0.34, 0.85, -0.08, 0.34], [0.05, 1.62, 0.05, 0.3], [0.1, 0.62, 0.3, 0.26],
    ];
    blobs.forEach(([bx, by, bz, br], k) => {
      put(k % 2 ? LEAF_LIGHT : LEAF_DARK, xf(ellipsoid(br * 1.15, br * 0.75, br * 1.15), [bx, base + by, bz]));
    });
  }
}

// ---------- bench ----------
function buildBench(x, z) {
  const P = matrix([x, 0, z]);
  const put = (color, geo) => add(color, geo.applyMatrix4(P));
  put(COLORS.wood, xf(box(2.6, 0.1, 0.7), [0, 0.5, 0]));
  put(COLORS.wood, xf(box(2.6, 0.5, 0.08), [0, 0.88, -0.31]));
  for (const sx of [-1.15, 1.15]) {
    for (const sz of [-0.26, 0.26]) put(COLORS.wood, xf(box(0.1, 0.5, 0.1), [sx, 0.25, sz]));
  }
  put(COLORS.purple, xf(box(0.62, 0.16, 0.46), [-0.6, 0.63, 0.02], [0, 0.12, 0]));
  put(COLORS.red, xf(box(0.62, 0.16, 0.46), [0.65, 0.63, 0.02], [0, -0.1, 0]));
}

// ---------- floor lamp ----------
function buildLamp(x, z) {
  const P = matrix([x, 0, z]);
  const put = (color, geo) => add(color, geo.applyMatrix4(P));
  put(COLORS.black, xf(cyl(0.3, 0.34, 0.1, 20), [0, 0.05, 0]));
  put(COLORS.black, xf(cyl(0.035, 0.035, 1.7, 8), [0, 0.9, 0]));
  put(COLORS.yellow, xf(cyl(0.28, 0.46, 0.62, 20), [0, 1.9, 0]));
}

// ---------- bunting ----------
function buildBunting() {
  const palette = [COLORS.yellow, COLORS.red, COLORS.purple, COLORS.white];
  const yTop = 3.65, sag = 0.4;
  const tri = new THREE.Shape();
  tri.moveTo(-0.15, 0); tri.lineTo(0.15, 0); tri.lineTo(0, -0.36); tri.lineTo(-0.15, 0);
  let ci = 0;
  for (const wall of ['back', 'left']) {
    const lo = wall === 'back' ? ROOM.minX : -9;
    const hi = wall === 'back' ? ROOM.maxX : 9;
    for (let a = lo; a < hi - 0.01; a += 3) {
      const yAt = (t) => yTop - sag * 4 * t * (1 - t);
      const SEG = 10;
      for (let i = 0; i < SEG; i++) {
        const t0 = i / SEG, t1 = (i + 1) / SEG;
        const x0 = a + 3 * t0, x1 = a + 3 * t1;
        const y0 = yAt(t0), y1 = yAt(t1);
        const len = Math.hypot(x1 - x0, y1 - y0);
        const g = xf(box(len + 0.01, 0.025, 0.025), [(x0 + x1) / 2, (y0 + y1) / 2, 0.1], [0, 0, Math.atan2(y1 - y0, x1 - x0)]);
        add(COLORS.black, wallPart(wall, g));
      }
      for (let k = 0; k < 5; k++) {
        const t = (k + 0.5) / 5;
        const slope = Math.atan2(-sag * 4 * (1 - 2 * t), 3);
        const flag = new THREE.ExtrudeGeometry(tri, { depth: 0.02, bevelEnabled: false });
        xf(flag, [a + 3 * t, yAt(t), 0.1], [0, 0, slope + (rnd(ci * 3 + 1) - 0.5) * 0.14]);
        add(palette[ci++ % palette.length], wallPart(wall, flag));
      }
    }
  }
}

// ---------- sign ----------
function buildSign(group) {
  const W = 4.4, H = 1.2;
  add(COLORS.yellow, wallPart('back', xf(box(W, H, 0.12), [0, 2.1, 0.06])));
  // little hanging chains up to the trim
  add(COLORS.black, wallPart('back', xf(box(0.03, 0.9, 0.03), [-1.6, 3.2, 0.08])));
  add(COLORS.black, wallPart('back', xf(box(0.03, 0.9, 0.03), [1.6, 3.2, 0.08])));

  const canvas = document.createElement('canvas');
  canvas.width = 1408;
  canvas.height = 384;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = hex(COLORS.black);
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.roundRect(28, 28, canvas.width - 56, canvas.height - 56, 40);
    ctx.stroke();
    ctx.fillStyle = hex(COLORS.black);
    ctx.font = 'italic 800 230px Montserrat, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '-2px';
    ctx.fillText('RENDI', canvas.width / 2 - 6, canvas.height / 2 + 12);
    tex.needsUpdate = true;
  };
  draw();
  if (document.fonts?.load) {
    document.fonts.load('italic 800 64px Montserrat').then(draw).catch(() => {});
  }
  const textGeo = wallPart('back', xf(new THREE.PlaneGeometry(W, H), [0, 2.1, 0.135]));
  const text = new THREE.Mesh(
    textGeo,
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  text.name = 'sign-text';
  group.add(text);
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
  slab.position.set(0, -0.16, 0); // top at -0.06: seams between planks read as darker lines
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

  // Walls (x = minX and z = minZ). They own the colour `wall`; trim/skirting/frames are decor buckets.
  const wallGeos = [
    xf(box(WALL_T, WALL_H, D), [ROOM.minX - WALL_T / 2, WALL_H / 2, 0]),
    xf(box(W + WALL_T, WALL_H, WALL_T), [-WALL_T / 2, WALL_H / 2, ROOM.minZ - WALL_T / 2]),
  ];
  const walls = toonMesh(mergeGeometries(wallGeos.map(prep), false), COLORS.wall, { outline: OUTLINE, cast: false, receive: true });
  walls.name = 'walls';
  group.add(walls);

  // Top trim + skirting
  const TR = 0.2;
  add(COLORS.wallTrim, xf(box(WALL_T + 0.18, TR, D + WALL_T + 0.09), [ROOM.minX - WALL_T / 2 + 0.04, WALL_H - TR / 2 + 0.05, -0.045]));
  add(COLORS.wallTrim, xf(box(W + 0.09, TR, WALL_T + 0.18), [0.045 - 0.0, WALL_H - TR / 2 + 0.05, ROOM.minZ - WALL_T / 2 + 0.04]));
  add(COLORS.white, xf(box(0.1, 0.32, D), [ROOM.minX + 0.05, 0.16, 0]));
  add(COLORS.white, xf(box(W - 0.1, 0.32, 0.1), [0.05, 0.16, ROOM.minZ + 0.05]));

  // Windows: 2 on the back wall, 2 on the left wall (left wall: lx = -z)
  const glass = [], glare = [];
  addWindow('back', -6.5, 1.9, glass, glare);
  addWindow('back', 6.5, 1.9, glass, glare);
  addWindow('left', 2.0, 1.9, glass, glare); // z = -2
  addWindow('left', -6.0, 1.9, glass, glare); // z = 6
  const glassMesh = new THREE.Mesh(mergeGeometries(glass.map(prep), false), flatMaterial(GLASS));
  glassMesh.name = 'window-glass';
  const glareMesh = new THREE.Mesh(mergeGeometries(glare.map(prep), false), flatMaterial(COLORS.white));
  glareMesh.name = 'window-glare';
  group.add(glassMesh, glareMesh);

  buildSign(group);
  buildBunting();

  // Rugs: cloud under each stand
  const rugGeos = [];
  const ringGeos = [];
  STANDS.forEach((s, idx) => {
    const lobes = 8 + (idx % 3);
    const phase = rnd(idx + 5) * Math.PI;
    const outer = new THREE.Shape(cloudPoints(1.95, lobes, phase));
    rugGeos.push(xf(flatShape(outer), [s.x, 0, s.z], [0, rnd(idx + 9) * 0.6, 0]));
    const ring = new THREE.Shape(cloudPoints(1.95 * 0.8, lobes, phase));
    ring.holes.push(new THREE.Path(cloudPoints(1.95 * 0.74, lobes, phase).reverse()));
    ringGeos.push(xf(flatShape(ring), [s.x, 0, s.z], [0, rnd(idx + 9) * 0.6, 0]));
  });
  const rugs = toonMesh(mergeGeometries(rugGeos.map(prep), false), COLORS.yellow, { outline: 0, cast: false, receive: true });
  rugs.position.y = 0.015;
  rugs.name = 'rugs';
  const rings = toonMesh(mergeGeometries(ringGeos.map(prep), false), RUG_RING, { outline: 0, cast: false, receive: true });
  rings.position.y = 0.022;
  rings.name = 'rug-stitching';
  group.add(rugs, rings);

  // Decor on the floor (all >= 2.6 from every stand centre and from SPAWN; central walkway left clear)
  const potCycle = [COLORS.white, COLORS.red, COLORS.yellow];
  const plants = [
    [-11.2, -8.3, 'tall', 1.05],
    [0, -8.3, 'fan', 1.1],
    [11.3, -8.3, 'tall', 1.05],
    [-11.2, -2.8, 'bush', 1],
    [-11.2, 5.9, 'fan', 1],
    [11.3, -1.2, 'bush', 1],
    [11.3, 8.2, 'tall', 1.05],
    [-11.2, 8.2, 'bush', 0.95],
  ];
  plants.forEach(([x, z, type, sc], i) => {
    buildPlant(x, z, type, potCycle[i % 3], sc, i + 1);
    colliders.push({ x, z, r: 0.5 * sc });
  });

  const benches = [[-6.5, -8.45], [6.5, -8.45]];
  benches.forEach(([x, z]) => {
    buildBench(x, z);
    for (const dx of [-0.9, 0, 0.9]) colliders.push({ x: x + dx, z, r: 0.55 });
  });

  const lamps = [[-11.4, -6.1], [11.4, 5.4]];
  lamps.forEach(([x, z]) => {
    buildLamp(x, z);
    colliders.push({ x, z, r: 0.35 });
  });

  // black parts (poles, strings) are thin: no outline
  flushBuckets(group, { outlineFor: (c) => (c === COLORS.black ? 0 : OUTLINE) });

  group.userData.decor = { plants, benches, lamps };
  return { object3d: group, colliders };
}
