// Rendi Learn — a diorama on a little grass slab: a stack of chunky books with a tree growing out of the top one.
// Its "leaves" are rounded letter tiles (one CanvasTexture atlas, one draw call, shared with the floating letters).
// Props: a swinging lantern hung from a branch, a red bookmark, two small side stacks, grass tufts.
// idle: tree sways, tiles rest as buds · near: tiles pop in one by one, letters drift up · focused: tiles flutter.
// Box: |x| <= ~1.6 (slab), content within r ~1.45 so the ±15° sway stays inside |x| <= 1.7, |z| <= 0.9; top y ~ 2.2.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMesh, flatMaterial } from '../kit/toon.js';
import { COLORS, mix } from '../core/tokens.js';

const css = (c) => `#${c.toString(16).padStart(6, '0')}`;
const damp = (dt, k) => 1 - Math.exp(-dt * k);
const elasticOut = (p) =>
  p <= 0 ? 0 : p >= 1 ? 1 : 2 ** (-10 * p) * Math.sin(((p * 10 - 0.75) * 2 * Math.PI) / 3) + 1;
// deterministic jitter so the stand looks the same every load
const jitter = (i, k) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};

const SLAB_H = 0.12;
const TREE_S = 1.25; // tree scale inside the diorama
const BOARD = 0.035; // cover board thickness
const BOOKS = [
  { w: 1.0, d: 0.7, h: 0.22, color: COLORS.purple, yaw: 0.12, dx: 0.0, dz: 0.0 },
  { w: 0.9, d: 0.64, h: 0.2, color: COLORS.yellow, yaw: -0.2, dx: 0.05, dz: 0.03 },
  { w: 0.94, d: 0.6, h: 0.22, color: COLORS.white, yaw: 0.06, dx: -0.04, dz: 0.04 },
  { w: 0.82, d: 0.56, h: 0.2, color: COLORS.purple, yaw: -0.32, dx: 0.03, dz: -0.02 },
];
const STACKS = [
  { x: 0, z: 0, s: 1, yaw: 0, books: BOOKS },
  { x: -1.1, z: 0.12, s: 0.62, yaw: 0.5, books: [BOOKS[1], BOOKS[0], BOOKS[2]] },
  { x: 1.12, z: 0.05, s: 0.55, yaw: -0.45, books: [BOOKS[2], BOOKS[3]] },
];

const TRUNK_H = 0.56;
// branches in tree-local space (base of trunk = origin)
const BRANCHES = [
  { from: [0, 0.3, 0], dir: [0.82, 0.57, 0.06], len: 0.34 },
  { from: [0, 0.38, 0], dir: [-0.78, 0.6, -0.16], len: 0.3 },
  { from: [0, 0.46, 0], dir: [0.1, 0.72, -0.68], len: 0.26 },
];
const LANTERN_AT = [-0.19, 0.47, -0.04]; // hook point on the left branch (tree-local)

// letters with a language flavour; tiles cycle through the brand fills, ink always black
const LEAVES = [
  { ch: 'R', tile: COLORS.purple, size: 0.36 },
  { ch: 'ñ', tile: COLORS.yellow, size: 0.3 },
  { ch: 'é', tile: COLORS.white, size: 0.3 },
  { ch: 'ü', tile: COLORS.yellow, size: 0.3 },
  { ch: 'ø', tile: COLORS.white, size: 0.26 },
  { ch: 'ß', tile: COLORS.purple, size: 0.26 },
  { ch: 'a', tile: COLORS.yellow, size: 0.26 },
];
// small letters drifting up out of the canopy: [atlas cell, base x, base z] in tree-local space
const FLOATERS = [
  [1, -0.85, 0.15],
  [3, 0.8, 0.2],
  [5, -0.5, -0.25],
  [2, 0.55, -0.2],
  [6, 0.02, 0.3],
];
const FLOAT_SIZE = 0.2;
const ATLAS_COLS = 4;
const ATLAS_ROWS = 2;
const CELL = 256;

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function leafAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * CELL;
  canvas.height = ATLAS_ROWS * CELL;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const font = 'italic 800 150px Montserrat, system-ui, sans-serif';
  const draw = () => {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    LEAVES.forEach((leaf, i) => {
      const x = (i % ATLAS_COLS) * CELL;
      const y = Math.floor(i / ATLAS_COLS) * CELL;
      const pad = 24;
      roundedRect(ctx, x + pad, y + pad, CELL - 2 * pad, CELL - 2 * pad, 64);
      ctx.fillStyle = css(leaf.tile);
      ctx.fill();
      ctx.lineWidth = 16;
      ctx.strokeStyle = css(COLORS.black);
      ctx.stroke();
      ctx.fillStyle = css(COLORS.black);
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(leaf.ch, x + CELL / 2, y + CELL / 2 + 8);
    });
    tex.needsUpdate = true;
  };
  draw();
  document.fonts?.load(font).then(draw).catch(() => {});
  return tex;
}

// grass slab: one sage mesh = slab + tufts + a few little flowers' stems (all static, one colour)
function buildSlab() {
  const parts = [new THREE.BoxGeometry(3.2, SLAB_H, 1.5).translate(0, SLAB_H / 2, 0)];
  const tufts = [
    [-1.45, 0.55], [-0.6, 0.62], [0.65, 0.6], [1.4, 0.5], [1.45, -0.45], [0.5, -0.62], [-0.7, -0.6], [-1.4, -0.4],
  ];
  tufts.forEach(([x, z], i) => {
    for (let k = 0; k < 3; k++) {
      const h = 0.1 + 0.05 * ((i + k) % 3);
      const g = new THREE.BoxGeometry(0.035, h, 0.035);
      g.rotateZ((k - 1) * 0.35);
      g.translate(x + (k - 1) * 0.05, SLAB_H + h / 2 - 0.01, z + jitter(i, k) * 0.03);
      parts.push(g);
    }
  });
  return toonMesh(mergeGeometries(parts), COLORS.sage, { outline: 0.03, receive: true });
}

function buildBooks() {
  const byColor = new Map();
  const push = (color, geo) => {
    if (!byColor.has(color)) byColor.set(color, []);
    byColor.get(color).push(geo);
  };
  const m = new THREE.Matrix4();
  const tmp = new THREE.Matrix4();
  const mainTops = [];
  STACKS.forEach((st, si) => {
    let y = 0;
    st.books.forEach((b) => {
      const place = (geo, lx, ly, lz) => {
        geo.translate(lx, ly, lz);
        m.makeTranslation(st.x, SLAB_H - 0.01, st.z);
        m.multiply(tmp.makeRotationY(st.yaw));
        m.multiply(tmp.makeTranslation(b.dx * st.s, y, b.dz * st.s));
        m.multiply(tmp.makeRotationY(b.yaw));
        m.multiply(tmp.makeScale(st.s, st.s, st.s));
        return geo.applyMatrix4(m);
      };
      // bottom board, top board, spine (left side), page block
      push(b.color, place(new THREE.BoxGeometry(b.w, BOARD, b.d), 0, BOARD / 2, 0));
      push(b.color, place(new THREE.BoxGeometry(b.w, BOARD, b.d), 0, b.h - BOARD / 2, 0));
      push(b.color, place(new THREE.BoxGeometry(BOARD, b.h, b.d), -b.w / 2 + BOARD / 2, b.h / 2, 0));
      push(
        COLORS.white,
        place(new THREE.BoxGeometry(b.w - BOARD - 0.03, b.h - 2 * BOARD - 0.008, b.d - 0.05), (BOARD - 0.03) / 2, b.h / 2, 0),
      );
      y += b.h * st.s;
      if (si === 0) mainTops.push(y);
    });
  });
  const group = new THREE.Group();
  for (const [color, geos] of byColor) group.add(toonMesh(mergeGeometries(geos), color, { outline: 0.035 }));
  const top = BOOKS[BOOKS.length - 1];
  // bookmark: pivot sits on the top face of the 3rd book
  const bm = BOOKS[2];
  return {
    group,
    height: mainTops[mainTops.length - 1],
    topCenter: new THREE.Vector3(top.dx, SLAB_H - 0.01 + mainTops[mainTops.length - 1], top.dz),
    bookmarkBase: { y: SLAB_H - 0.01 + mainTops[2], book: bm },
  };
}

function buildBookmark(info) {
  const b = info.book;
  const base = new THREE.Group();
  base.position.set(b.dx, info.y, b.dz);
  base.rotation.y = b.yaw;
  const pivot = new THREE.Group();
  pivot.position.set(0.22, 0, b.d / 2 + 0.012);
  const ribbon = new THREE.BoxGeometry(0.055, 0.34, 0.012).translate(0, -0.17, 0);
  // swallow-tail notch
  const notch = new THREE.BoxGeometry(0.02, 0.04, 0.02).rotateZ(Math.PI / 4).translate(0, -0.34, 0);
  const mesh = new THREE.Mesh(mergeGeometries([ribbon, notch]), flatMaterial(COLORS.red));
  mesh.castShadow = false;
  pivot.add(mesh);
  base.add(pivot);
  return { group: base, pivot };
}

function buildTrunk() {
  const parts = [new THREE.CylinderGeometry(0.045, 0.075, TRUNK_H, 8).translate(0, TRUNK_H / 2, 0)];
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  for (const br of BRANCHES) {
    const dir = new THREE.Vector3(...br.dir).normalize();
    const g = new THREE.CylinderGeometry(0.025, 0.04, br.len, 6).translate(0, br.len / 2, 0);
    g.applyQuaternion(q.setFromUnitVectors(up, dir));
    g.translate(...br.from);
    parts.push(g);
  }
  return toonMesh(mergeGeometries(parts), COLORS.wood, { outline: 0.025 });
}

// hanging lantern: pivot at the hook, string + cap (black flat), glass (yellow toon), soft halo
function buildLantern() {
  const pivot = new THREE.Group();
  pivot.position.set(...LANTERN_AT);
  const frame = mergeGeometries([
    new THREE.BoxGeometry(0.012, 0.1, 0.012).translate(0, -0.05, 0),
    new THREE.BoxGeometry(0.11, 0.025, 0.11).translate(0, -0.11, 0),
  ]);
  const frameMesh = new THREE.Mesh(frame, flatMaterial(COLORS.black));
  frameMesh.castShadow = false;
  const glass = toonMesh(new THREE.BoxGeometry(0.085, 0.12, 0.085).translate(0, -0.185, 0), COLORS.yellow, {
    outline: 0.015,
    cast: false,
  });
  const haloMat = new THREE.MeshBasicMaterial({
    color: mix(COLORS.yellow, COLORS.white, 0.35),
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
  });
  const halo = new THREE.Mesh(new THREE.CircleGeometry(0.2, 20).translate(0, -0.185, 0.06), haloMat);
  halo.castShadow = false;
  pivot.add(frameMesh, glass, halo);
  return { pivot, haloMat };
}

// leaf anchor points in tree-local space: trunk top, branch tips, mid-branch
function leafAnchors() {
  const pts = [new THREE.Vector3(0, TRUNK_H + 0.14, 0)];
  const tips = [];
  const mids = [];
  for (const br of BRANCHES) {
    const from = new THREE.Vector3(...br.from);
    const dir = new THREE.Vector3(...br.dir).normalize();
    tips.push(from.clone().addScaledVector(dir, br.len + 0.09));
    mids.push(from.clone().addScaledVector(dir, br.len * 0.5).add(new THREE.Vector3(0, 0.1, 0.04)));
  }
  return pts.concat(tips, mids);
}

function buildLeaves(anchors) {
  const n = LEAVES.length + FLOATERS.length;
  const positions = new Float32Array(n * 12);
  const uvs = new Float32Array(n * 8);
  const index = [];
  const rigs = [];
  for (let i = 0; i < n; i++) {
    const isFloat = i >= LEAVES.length;
    const cellIdx = isFloat ? FLOATERS[i - LEAVES.length][0] : i;
    const col = cellIdx % ATLAS_COLS;
    const row = Math.floor(cellIdx / ATLAS_COLS);
    const u0 = col / ATLAS_COLS;
    const u1 = (col + 1) / ATLAS_COLS;
    const v1 = 1 - row / ATLAS_ROWS;
    const v0 = 1 - (row + 1) / ATLAS_ROWS;
    uvs.set([u0, v0, u1, v0, u1, v1, u0, v1], i * 8);
    index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    const half = (isFloat ? FLOAT_SIZE : LEAVES[i].size) / 2;
    // tiles lean back toward the camera, with a little individual yaw/roll
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-0.35 + jitter(i, 1) * 0.1, jitter(i, 2) * 0.35, jitter(i, 3) * 0.2),
    );
    const rig = {
      c: new THREE.Vector3(),
      u: new THREE.Vector3(half, 0, 0).applyQuaternion(q),
      v: new THREE.Vector3(0, half, 0).applyQuaternion(q),
      phase: i * 1.7,
      s: isFloat ? 0.0 : 0.3, // current scale (0.3 = resting bud)
      p: 0, // pop progress
      float: isFloat,
      base: new THREE.Vector3(),
    };
    if (isFloat) {
      const f = FLOATERS[i - LEAVES.length];
      rig.base.set(f[1], 0, f[2]);
      rig.c.set(f[1], 0.2, f[2]);
    } else {
      rig.c.copy(anchors[i]);
    }
    rigs.push(rig);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(index);
  const mat = new THREE.MeshBasicMaterial({ map: leafAtlas(), alphaTest: 0.5, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.frustumCulled = false; // bounds change every frame; the stand is small anyway
  return { mesh, rigs };
}

const tmpU = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpP = new THREE.Vector3();

function writeLeaves(mesh, rigs, t, energy, focusE) {
  const arr = mesh.geometry.attributes.position.array;
  rigs.forEach((r, i) => {
    const roll =
      Math.sin(t * 5.5 + r.phase) * (0.03 + 0.14 * focusE) + Math.sin(t * 1.7 + r.phase) * 0.05 * energy;
    const cs = Math.cos(roll) * r.s;
    const sn = Math.sin(roll) * r.s;
    tmpU.copy(r.u).multiplyScalar(cs).addScaledVector(r.v, sn);
    tmpV.copy(r.v).multiplyScalar(cs).addScaledVector(r.u, -sn);
    const o = i * 12;
    tmpP.copy(r.c).sub(tmpU).sub(tmpV).toArray(arr, o);
    tmpP.copy(r.c).add(tmpU).sub(tmpV).toArray(arr, o + 3);
    tmpP.copy(r.c).add(tmpU).add(tmpV).toArray(arr, o + 6);
    tmpP.copy(r.c).sub(tmpU).add(tmpV).toArray(arr, o + 9);
  });
  mesh.geometry.attributes.position.needsUpdate = true;
}

let root = null;
let content = null;
let tree = null;
let leaves = null;
let lantern = null;
let bookmark = null;
let energy = 0;
let focusE = 0;
let enterT = 0;
let prevState = 'idle';

export default {
  id: 'learn',
  build() {
    energy = 0;
    focusE = 0;
    enterT = 0;
    prevState = 'idle';

    root = new THREE.Group();
    root.add(buildSlab());

    content = new THREE.Group(); // swayed ±15° when focused
    root.add(content);

    const books = buildBooks();
    content.add(books.group);
    bookmark = buildBookmark(books.bookmarkBase);
    content.add(bookmark.group);

    tree = new THREE.Group();
    tree.position.copy(books.topCenter);
    tree.scale.setScalar(TREE_S);
    tree.add(buildTrunk());
    lantern = buildLantern();
    tree.add(lantern.pivot);
    leaves = buildLeaves(leafAnchors());
    tree.add(leaves.mesh);
    content.add(tree);

    writeLeaves(leaves.mesh, leaves.rigs, 0, 0, 0);
    return root;
  },
  update(t, dt, state) {
    if (!root) return;
    if (state !== 'idle' && prevState === 'idle') enterT = t;
    prevState = state;
    energy += ((state === 'idle' ? 0 : 1) - energy) * damp(dt, 4);
    focusE += ((state === 'focused' ? 1 : 0) - focusE) * damp(dt, 3);

    // tree sways; a touch of breeze when someone is near
    tree.rotation.z = Math.sin(t * 1.3) * 0.03 + Math.sin(t * 2.3) * 0.05 * energy;
    tree.rotation.x = Math.cos(t * 1.1) * 0.02 + Math.cos(t * 1.9) * 0.03 * energy;
    content.rotation.y = Math.sin(t * 0.45) * (Math.PI / 12) * focusE;

    // lantern swings (counter to the tree), halo breathes; bookmark flutters
    lantern.pivot.rotation.z = -tree.rotation.z * 1.5 + Math.sin(t * 1.9) * 0.1 * (0.5 + energy);
    lantern.pivot.rotation.x = Math.sin(t * 1.5 + 1) * 0.05;
    lantern.haloMat.opacity = 0.24 + 0.1 * Math.sin(t * 3.1) + 0.12 * energy;
    bookmark.pivot.rotation.x = Math.sin(t * 2.2) * 0.08 * (0.4 + energy);
    bookmark.pivot.rotation.z = Math.sin(t * 1.7 + 2) * 0.06;

    // tiles pop in one by one with an elastic bounce, shrink back to buds when left alone;
    // floating letters rise out of the canopy, brighter/bigger when someone is near
    leaves.rigs.forEach((r, i) => {
      if (r.float) {
        const life = (t * 0.1 + r.phase * 0.37) % 1;
        const fade = Math.sin(life * Math.PI);
        r.c.set(r.base.x + Math.sin(t * 0.9 + r.phase) * 0.07, 0.25 + life * 0.75, r.base.z);
        const goal = fade * (0.35 + 0.65 * energy);
        r.s += (goal - r.s) * damp(dt, 10);
        return;
      }
      const alive = state !== 'idle' && t - enterT > i * 0.14;
      let goal = 0.3;
      if (alive) {
        r.p = Math.min(1, r.p + dt * 2);
        goal = 0.3 + 0.7 * elasticOut(r.p);
      } else {
        r.p = 0;
      }
      r.s += (goal - r.s) * damp(dt, 16);
    });
    writeLeaves(leaves.mesh, leaves.rigs, t, energy, focusE);
  },
  focusPose: { height: 1.2, zoom: 3.2 },
};
