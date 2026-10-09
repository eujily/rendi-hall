// Rendi Learn — a stack of chunky books with a little tree growing out of the top one.
// Its "leaves" are rounded letter tiles (one CanvasTexture atlas, one draw call).
// idle: tree sways, tiles rest as small buds · near: tiles pop in one by one · focused: tiles flutter.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMesh } from '../kit/toon.js';
import { COLORS } from '../core/tokens.js';
import { createPedestal, PEDESTAL_H } from './_pedestal.js';

const css = (c) => `#${c.toString(16).padStart(6, '0')}`;
const damp = (dt, k) => 1 - Math.exp(-dt * k);
const elasticOut = (p) =>
  p <= 0 ? 0 : p >= 1 ? 1 : 2 ** (-10 * p) * Math.sin(((p * 10 - 0.75) * 2 * Math.PI) / 3) + 1;
// deterministic jitter so the stand looks the same every load
const jitter = (i, k) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};

const BOARD = 0.035; // cover board thickness
const BOOKS = [
  { w: 1.0, d: 0.7, h: 0.22, color: COLORS.purple, yaw: 0.12, dx: 0.0, dz: 0.0 },
  { w: 0.9, d: 0.64, h: 0.2, color: COLORS.yellow, yaw: -0.2, dx: 0.05, dz: 0.03 },
  { w: 0.94, d: 0.6, h: 0.22, color: COLORS.white, yaw: 0.06, dx: -0.04, dz: 0.04 },
  { w: 0.82, d: 0.56, h: 0.2, color: COLORS.purple, yaw: -0.32, dx: 0.03, dz: -0.02 },
];

const TRUNK_H = 0.56;
// branches in tree-local space (base of trunk = origin)
const BRANCHES = [
  { from: [0, 0.3, 0], dir: [0.82, 0.57, 0.06], len: 0.34 },
  { from: [0, 0.38, 0], dir: [-0.78, 0.6, -0.16], len: 0.3 },
  { from: [0, 0.46, 0], dir: [0.1, 0.72, -0.68], len: 0.26 },
];

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

function buildBooks() {
  const byColor = new Map();
  const push = (color, geo) => {
    if (!byColor.has(color)) byColor.set(color, []);
    byColor.get(color).push(geo);
  };
  const rot = new THREE.Matrix4();
  let y = 0;
  for (const b of BOOKS) {
    const place = (geo, lx, ly, lz) => {
      geo.translate(lx, ly, lz);
      geo.applyMatrix4(rot.makeRotationY(b.yaw));
      geo.translate(b.dx, y, b.dz);
      return geo;
    };
    // bottom board, top board, spine (left side), page block
    push(b.color, place(new THREE.BoxGeometry(b.w, BOARD, b.d), 0, BOARD / 2, 0));
    push(b.color, place(new THREE.BoxGeometry(b.w, BOARD, b.d), 0, b.h - BOARD / 2, 0));
    push(b.color, place(new THREE.BoxGeometry(BOARD, b.h, b.d), -b.w / 2 + BOARD / 2, b.h / 2, 0));
    push(
      COLORS.white,
      place(new THREE.BoxGeometry(b.w - BOARD - 0.03, b.h - 2 * BOARD - 0.008, b.d - 0.05), (BOARD - 0.03) / 2, b.h / 2, 0),
    );
    y += b.h;
  }
  const group = new THREE.Group();
  for (const [color, geos] of byColor) group.add(toonMesh(mergeGeometries(geos), color, { outline: 0.04 }));
  const top = BOOKS[BOOKS.length - 1];
  return { group, height: y, topCenter: new THREE.Vector3(top.dx, y, top.dz) };
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
  const n = LEAVES.length;
  const positions = new Float32Array(n * 12);
  const uvs = new Float32Array(n * 8);
  const index = [];
  const rigs = [];
  for (let i = 0; i < n; i++) {
    const col = i % ATLAS_COLS;
    const row = Math.floor(i / ATLAS_COLS);
    const u0 = col / ATLAS_COLS;
    const u1 = (col + 1) / ATLAS_COLS;
    const v1 = 1 - row / ATLAS_ROWS;
    const v0 = 1 - (row + 1) / ATLAS_ROWS;
    uvs.set([u0, v0, u1, v0, u1, v1, u0, v1], i * 8);
    index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    const half = LEAVES[i].size / 2;
    // tiles lean back toward the camera, with a little individual yaw/roll
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-0.35 + jitter(i, 1) * 0.1, jitter(i, 2) * 0.35, jitter(i, 3) * 0.2),
    );
    rigs.push({
      c: anchors[i],
      u: new THREE.Vector3(half, 0, 0).applyQuaternion(q),
      v: new THREE.Vector3(0, half, 0).applyQuaternion(q),
      phase: i * 1.7,
      s: 0.3, // current scale (0.3 = resting bud)
      p: 0, // pop progress
    });
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

let dio = null;
let tree = null;
let leaves = null;
let energy = 0;
let focusE = 0;
let enterT = 0;
let prevState = 'idle';

export default {
  id: 'learn',
  build() {
    const root = new THREE.Group();
    root.add(createPedestal({ label: 'Rendi Learn', accent: COLORS.purple }));

    dio = new THREE.Group();
    dio.position.y = PEDESTAL_H;
    root.add(dio);

    const books = buildBooks();
    dio.add(books.group);

    tree = new THREE.Group();
    tree.position.copy(books.topCenter);
    tree.add(buildTrunk());
    leaves = buildLeaves(leafAnchors());
    tree.add(leaves.mesh);
    dio.add(tree);

    writeLeaves(leaves.mesh, leaves.rigs, 0, 0, 0);
    return root;
  },
  update(t, dt, state) {
    if (!dio) return;
    if (state !== 'idle' && prevState === 'idle') enterT = t;
    prevState = state;
    energy += ((state === 'idle' ? 0 : 1) - energy) * damp(dt, 4);
    focusE += ((state === 'focused' ? 1 : 0) - focusE) * damp(dt, 3);

    // tree sways; a touch of breeze when someone is near
    tree.rotation.z = Math.sin(t * 1.3) * 0.03 + Math.sin(t * 2.3) * 0.05 * energy;
    tree.rotation.x = Math.cos(t * 1.1) * 0.02 + Math.cos(t * 1.9) * 0.03 * energy;
    dio.rotation.y = Math.sin(t * 0.45) * (Math.PI / 12) * focusE;

    // tiles pop in one by one with an elastic bounce, shrink back to buds when left alone
    leaves.rigs.forEach((r, i) => {
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
  focusPose: { height: 1.5, zoom: 3.0 },
};
