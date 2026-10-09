import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { addOutline, toonMaterial, flatMaterial } from '../kit/toon.js';
import { texturedToon, animatedWater, surfaceUV } from '../kit/textures.js';
import { COLORS, mix } from '../core/tokens.js';
import { TOWN, BUILDINGS, PLAZA, TOWN_SPAWN } from '../core/layout.js';

// Rendi Town props kit: ground, paths, water, trees, bushes, flowers, fences, lamps, benches, wells...
// Hand-painted look = textured toon (src/kit/textures.js) + black hulls, all in brand-derived colours.
// Static pieces are merged per (texture|colour) bucket (one mesh + one hull each); repeated organics
// (trees, bushes, flowers, rocks...) are InstancedMeshes. Total budget: ~55 draw calls.

const OUT = 0.028; // one hull thickness for every static bucket

// ---------------------------------------------------------------- palette (brand mixes only)
const W = COLORS;
export const PAL = {
  grass: mix(W.sage, W.white, 0.26),
  grassDark: mix(W.sage, W.black, 0.05),
  grassLight: mix(mix(W.sage, W.yellow, 0.28), W.white, 0.3),
  dirt: mix(mix(W.yellow, W.wood, 0.4), W.lavender, 0.38),
  cobble: mix(W.lavender, W.yellow, 0.3),
  plaza: mix(W.lavender, W.mascot, 0.28),
  tileA: mix(W.lavender, W.white, 0.35),
  tileB: mix(W.lavender, W.mascot, 0.55),
  stoneWall: mix(W.lavender, W.black, 0.08),
  stone: mix(W.lavender, W.black, 0.08),
  stoneLight: mix(W.lavender, W.white, 0.3),
  wood: W.wood,
  woodLight: mix(W.wood, W.yellow, 0.4),
  bark: mix(W.wood, W.black, 0.16),
  leaf: W.sage,
  leafLight: mix(W.sage, W.white, 0.3),
  leafDark: mix(W.sage, W.black, 0.18),
  bloomA: mix(W.mascot, W.white, 0.4),
  bloomB: mix(W.mascot, W.white, 0.75),
  water: mix(W.mascot, W.white, 0.36),
  glow: mix(W.yellow, W.white, 0.18),
  roof: W.purple,
};
const FLOWER = [W.red, W.yellow, W.purple, W.white];

// ---------------------------------------------------------------- tiny helpers
const rnd = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const noise3 = (x, y, z, s) => Math.sin(x * 2.3 + s * 1.7) * Math.cos(y * 2.9 + s * 2.9) * 0.5 + Math.sin(z * 3.3 + x * 1.3 + s * 0.7) * 0.5;
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _mx = new THREE.Matrix4();
const M4 = (p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) =>
  new THREE.Matrix4().compose(_v.set(p[0], p[1], p[2]), _q.setFromEuler(_e.set(r[0], r[1], r[2])), _s.set(s[0], s[1], s[2]));
const xf = (g, p, r, s) => g.applyMatrix4(M4(p, r, s));
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);
/** box of size w,h,d centred at (x,y,z) with optional rotation */
const bx = (w, h, d, x, y, z, rot) => xf(box(w, h, d), [x, y, z], rot);
const cy = (rt, rb, h, x, y, z, rot, seg = 10) => xf(cyl(rt, rb, h, seg), [x, y, z], rot);
const smooth = (a, b, t) => a + (b - a) * t;

function toNI(g) {
  return g.index ? g.toNonIndexed() : g;
}
function keepAttrs(g, names) {
  const out = toNI(g);
  for (const n of Object.keys(out.attributes)) if (!names.includes(n)) out.deleteAttribute(n);
  return out;
}
function paint(g, color) {
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const strip = (g) => { // position + normal only
  g.deleteAttribute('uv');
  return g;
};
/** merge vertex-coloured pieces (all get position/normal/color, non-indexed) */
const mergeColored = (list) => mergeGeometries(list.map((g) => keepAttrs(g, ['position', 'normal', 'color'])), false);

/** displacement of a unit-sphere direction: shared by lumpy() and the fruit-dot placement */
const lump = (x, y, z, seed, amp) => 1 + noise3(x, y, z, seed) * amp;
function lumpy(rx, ry, rz, seed = 0, detail = 2, amp = 0.13) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    _v.fromBufferAttribute(p, i);
    const k = lump(_v.x, _v.y, _v.z, seed, amp);
    p.setXYZ(i, _v.x * rx * k, _v.y * ry * k, _v.z * rz * k);
  }
  g.computeVertexNormals();
  return g;
}
/** faceted boulder, flat on the bottom */
function rockGeo() {
  let g = new THREE.IcosahedronGeometry(1, 1);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    _v.fromBufferAttribute(p, i);
    const k = lump(_v.x, _v.y, _v.z, 5.5, 0.22);
    p.setXYZ(i, _v.x * k, Math.max(_v.y * k * 0.8, -0.18) + 0.18, _v.z * k);
  }
  const ni = g.toNonIndexed();
  ni.computeVertexNormals(); // flat facets
  return ni;
}

/** blob on a lumpy canopy surface (fruit / blossom dots), exact against lumpy() displacement */
function dotsOn(blob, n, cols, r, seed, minY = 0.1) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const th = rnd(seed + k * 3.1) * Math.PI * 2;
    const y = minY + rnd(seed + k * 3.1 + 1) * (0.96 - minY);
    const rr = Math.sqrt(1 - y * y);
    const d = [Math.cos(th) * rr, y, Math.sin(th) * rr];
    const kk = lump(d[0], d[1], d[2], blob.s, 0.13);
    const g = new THREE.IcosahedronGeometry(r, 0);
    strip(g);
    g.translate(blob.c[0] + d[0] * blob.r[0] * kk, blob.c[1] + d[1] * blob.r[1] * kk, blob.c[2] + d[2] * blob.r[2] * kk);
    out.push(paint(g, cols[k % cols.length]));
  }
  return out;
}
function canopy(blobs, dots, seed) {
  const geos = [];
  blobs.forEach((b, i) => {
    b.s = seed + i * 3.1;
    geos.push(paint(xf(lumpy(b.r[0], b.r[1], b.r[2], b.s, 2, 0.13), b.c), b.col));
  });
  dots.forEach(([bi, n, cols, r], di) => geos.push(...dotsOn(blobs[bi], n, cols, r, seed * 7 + di * 19)));
  return mergeColored(geos);
}

/** trunk with flaring roots; textured later (UV computed in tree-local space) */
function trunkGeo({ h = 1.8, rt = 0.14, rb = 0.24, roots = 4, branch = true, bend = 0 }) {
  const parts = [];
  parts.push(cy(rt, rb, h, bend * 0.5, h / 2, 0, [0, 0, -bend * 0.5], 10));
  for (let i = 0; i < roots; i++) {
    const yaw = (i / roots) * Math.PI * 2 + rnd(i * 5.1 + rb) * 0.7;
    const g = new THREE.ConeGeometry(0.12, 0.8, 6);
    g.rotateZ(-Math.PI / 2 - 0.35);
    g.translate(rb + 0.18, 0.1, 0);
    g.rotateY(yaw);
    parts.push(g);
  }
  if (branch) {
    parts.push(cy(0.045, 0.08, 0.9, -0.32, h - 0.15, 0.05, [0, 0, 0.7], 6));
    parts.push(cy(0.04, 0.07, 0.8, 0.3, h - 0.25, -0.08, [0, 0, -0.65], 6));
  }
  const g = mergeGeometries(parts.map((p) => keepAttrs(p, ['position', 'normal'])), false);
  return surfaceUV(g, 1.5);
}

function oakParts() {
  const L = [
    { c: [0, 2.5, 0], r: [1.3, 1.1, 1.25], col: PAL.leaf },
    { c: [-0.95, 2.05, 0.3], r: [0.85, 0.75, 0.85], col: PAL.leafLight },
    { c: [0.9, 2.75, -0.2], r: [0.8, 0.7, 0.8], col: PAL.leafLight },
    { c: [0.55, 1.95, 0.8], r: [0.72, 0.6, 0.7], col: PAL.leafDark },
    { c: [-0.25, 3.2, 0.1], r: [0.78, 0.66, 0.76], col: PAL.leafLight },
  ];
  const cn = canopy(L, [[0, 4, [W.red, W.red, W.yellow], 0.1], [1, 2, [W.red], 0.09], [2, 3, [W.red, W.yellow], 0.09], [3, 2, [W.red], 0.09]], 3.3);
  const tr = trunkGeo({ h: 1.9, rt: 0.16, rb: 0.27 });
  cn.scale(0.86, 0.86, 0.86);
  tr.scale(0.86, 0.86, 0.86);
  return { trunk: tr, canopy: cn, trunkKind: ['woodVertical', PAL.bark], sway: 0.02, out: 0.034 };
}
function coniferParts() {
  const tiers = [[0.7, 1.2, 1.35, PAL.leafDark], [1.5, 0.98, 1.25, PAL.leaf], [2.2, 0.76, 1.15, PAL.leaf], [2.85, 0.52, 1.05, PAL.leafLight]];
  const geos = tiers.map(([y, r, h, col], i) => {
    let g = new THREE.ConeGeometry(r, h, 8, 1, true);
    const p = g.getAttribute('position');
    for (let k = 0; k < p.count; k++) {
      _v.fromBufferAttribute(p, k);
      if (_v.y < 0) { const j = 1 + noise3(_v.x * 3, 0, _v.z * 3, i * 2.1) * 0.14; p.setXYZ(k, _v.x * j, _v.y, _v.z * j); }
    }
    g.rotateY(i * 0.55);
    g.translate(0, y + h / 2, 0);
    g = toNI(g);
    g.computeVertexNormals();
    strip(g);
    return paint(g, col);
  });
  // a little under-skirt disc so the first tier is not hollow from above
  geos.push(paint(strip(xf(cyl(0.9, 0.9, 0.05, 8), [0, 0.72, 0])), PAL.leafDark));
  const cn = mergeColored(geos);
  const tr = trunkGeo({ h: 1.0, rt: 0.13, rb: 0.2, roots: 3, branch: false });
  cn.scale(0.92, 0.92, 0.92);
  tr.scale(0.92, 0.92, 0.92);
  return { trunk: tr, canopy: cn, trunkKind: ['woodVertical', PAL.bark], sway: 0.012, out: 0.034 };
}
function blossomParts() {
  const L = [
    { c: [0, 2.45, 0], r: [1.35, 1.0, 1.3], col: PAL.bloomA },
    { c: [-1.0, 2.15, 0.2], r: [0.85, 0.7, 0.85], col: PAL.bloomB },
    { c: [0.95, 2.6, 0.1], r: [0.85, 0.72, 0.8], col: W.mascot },
    { c: [0.2, 3.0, -0.35], r: [0.85, 0.6, 0.8], col: PAL.bloomB },
    { c: [0.4, 2.0, 0.85], r: [0.7, 0.55, 0.65], col: PAL.bloomA },
    { c: [-0.4, 2.0, -0.8], r: [0.7, 0.55, 0.65], col: W.mascot },
  ];
  const cn = canopy(L, [[0, 5, [W.white, W.yellow], 0.09], [1, 3, [W.white, W.yellow], 0.08], [2, 3, [W.white], 0.08], [3, 3, [W.yellow, W.white], 0.08], [4, 2, [W.white], 0.08]], 7.7);
  const tr = trunkGeo({ h: 1.75, rt: 0.13, rb: 0.24, bend: 0.35 });
  cn.scale(0.86, 0.86, 0.86);
  tr.scale(0.86, 0.86, 0.86);
  return { trunk: tr, canopy: cn, trunkKind: ['woodVertical', mix(PAL.bark, W.mascot, 0.12)], sway: 0.028, out: 0.034 };
}
function bushGeo() {
  const L = [
    { c: [0, 0.42, 0], r: [0.72, 0.52, 0.66], col: PAL.leaf },
    { c: [0.5, 0.32, 0.12], r: [0.46, 0.38, 0.42], col: PAL.leafLight },
    { c: [-0.46, 0.3, -0.08], r: [0.42, 0.36, 0.4], col: PAL.leafLight },
    { c: [0.08, 0.27, 0.48], r: [0.42, 0.3, 0.36], col: PAL.leafDark },
  ];
  return canopy(L, [[0, 4, [W.red, W.white, W.red], 0.07], [1, 2, [W.red], 0.06], [2, 2, [W.yellow, W.red], 0.06]], 11.1);
}
function flowerGeo(petal, center) {
  const parts = [paint(strip(cy(0.012, 0.016, 0.28, 0, 0.14, 0, [0, 0, 0], 5)), PAL.leafDark)];
  parts.push(paint(strip(xf(new THREE.IcosahedronGeometry(1, 0), [0.05, 0.1, 0], [0, 0, 0.5], [0.06, 0.015, 0.03])), PAL.leaf));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const g = xf(new THREE.IcosahedronGeometry(1, 0), [Math.cos(a) * 0.07, 0.29, Math.sin(a) * 0.07], [0, -a, 0.35], [0.065, 0.028, 0.05]);
    parts.push(paint(strip(g), petal));
  }
  parts.push(paint(strip(xf(new THREE.IcosahedronGeometry(0.04, 0), [0, 0.305, 0])), center));
  return mergeColored(parts);
}
function tuftGeo() {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    const g = new THREE.ConeGeometry(0.032, 0.3 + (i % 2) * 0.1, 3);
    g.translate(0, 0.15 + (i % 2) * 0.05, 0);
    g.rotateZ(0.28 + (i % 3) * 0.08);
    g.rotateY(a);
    parts.push(paint(strip(g), i % 2 ? PAL.leafLight : PAL.leafDark));
  }
  return mergeColored(parts);
}
function mushroomGeo() {
  const parts = [paint(strip(cy(0.045, 0.065, 0.17, 0, 0.085, 0, [0, 0, 0], 6)), W.white)];
  const cap = new THREE.SphereGeometry(0.15, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  strip(cap);
  parts.push(paint(xf(cap, [0, 0.15, 0], [0, 0, 0], [1, 0.85, 1]), W.red));
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7 + 0.5, rr = i === 3 ? 0.0 : 0.075;
    parts.push(paint(strip(xf(new THREE.IcosahedronGeometry(0.028, 0), [Math.cos(a) * rr, 0.27 - (i === 3 ? 0 : 0.045), Math.sin(a) * rr])), W.white));
  }
  return mergeColored(parts);
}
function reedGeo() {
  const parts = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rnd(i) * 0.6;
    const h = 0.9 + rnd(i + 3) * 0.55;
    const g = new THREE.ConeGeometry(0.035, h, 4);
    g.translate(0, h / 2, 0);
    g.rotateZ(0.12 + rnd(i + 7) * 0.16);
    g.rotateY(a);
    parts.push(paint(strip(g), i % 2 ? PAL.leaf : PAL.leafDark));
    if (i % 3 === 0) {
      const t = cyl(0.04, 0.04, 0.26, 6);
      strip(t);
      t.translate(0, h * 0.82, 0);
      t.rotateZ(0.12 + rnd(i + 7) * 0.16 * 0.8);
      t.rotateY(a);
      parts.push(paint(t, PAL.bark));
    }
  }
  return mergeColored(parts);
}
function lotusGeo() {
  const parts = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    parts.push(paint(strip(xf(new THREE.IcosahedronGeometry(1, 0), [Math.cos(a) * 0.1, 0.07, Math.sin(a) * 0.1], [0, -a, 0.7], [0.1, 0.03, 0.045])), W.white));
  }
  parts.push(paint(strip(xf(new THREE.IcosahedronGeometry(0.06, 0), [0, 0.07, 0])), W.yellow));
  return mergeColored(parts);
}
function padGeo() {
  const g = new THREE.CircleGeometry(0.36, 14, 0.5, Math.PI * 2 - 0.8).rotateX(-Math.PI / 2);
  return strip(g);
}
function butterflyGeo() {
  const wing = (sx) => {
    const sh = new THREE.Shape();
    sh.moveTo(0, 0.02);
    sh.bezierCurveTo(0.12, 0.2, 0.34, 0.2, 0.34, 0.06);
    sh.bezierCurveTo(0.34, -0.02, 0.2, -0.04, 0.08, -0.02);
    sh.bezierCurveTo(0.24, -0.1, 0.22, -0.22, 0.1, -0.22);
    sh.bezierCurveTo(0.04, -0.2, 0.01, -0.1, 0, 0.02);
    const g = new THREE.ShapeGeometry(sh);
    g.rotateX(-Math.PI / 2);
    g.scale(sx, 1, 1);
    return strip(g);
  };
  const body = strip(xf(cyl(0.022, 0.016, 0.3, 5), [0, 0, 0.0], [Math.PI / 2, 0, 0]));
  const parts = [paint(wing(1), W.white), paint(wing(-1), W.white), paint(body, W.black)];
  return mergeColored(parts);
}

// ---------------------------------------------------------------- instanced mesh plumbing
const outlineMats = new Map();
function outlineMat(t) {
  if (!outlineMats.has(t)) {
    outlineMats.set(t, new THREE.ShaderMaterial({
      uniforms: { thickness: { value: t }, color: { value: new THREE.Color(W.black) } },
      vertexShader: /* glsl */ `
        uniform float thickness;
        void main() {
          vec4 p = vec4(position + normal * thickness, 1.0);
          #ifdef USE_INSTANCING
            p = instanceMatrix * p;
          #endif
          gl_Position = projectionMatrix * modelViewMatrix * p;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        void main() { gl_FragColor = vec4(color, 1.0); }`,
      side: THREE.BackSide,
    }));
  }
  return outlineMats.get(t);
}
const hullCache = new WeakMap();
function hullOf(geometry) {
  if (!hullCache.has(geometry)) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', geometry.getAttribute('position'));
    if (geometry.index) g.setIndex(geometry.index);
    const merged = mergeVertices(g, 1e-4);
    merged.computeVertexNormals();
    hullCache.set(geometry, merged);
  }
  return hullCache.get(geometry);
}
const _c = new THREE.Color();
function composeItem(it, rx = 0, rz = 0, out = _mx) {
  const sx = it.sx ?? it.s ?? 1, sy = it.sy ?? it.s ?? 1, sz = it.sz ?? it.s ?? 1;
  return out.compose(_v.set(it.x, it.y ?? 0, it.z), _q.setFromEuler(_e.set((it.rx ?? 0) + rx, it.ry ?? 0, (it.rz ?? 0) + rz)), _s.set(sx, sy, sz));
}

// vertex-coloured toon (copy of the shared 2-step ramp so we do not depend on kit internals)
const gradientMap = (() => {
  const tex = new THREE.DataTexture(new Uint8Array([Math.round(0.35 * 255), 255]), 2, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
})();
const vcToon = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap });

// ---------------------------------------------------------------- main
/**
 * @param {object} ctx { blocked(x,z,r), circle(x,z,r), bbox(minX,maxX,minZ,maxZ), PATHS, POND, PLAZA_R }
 *   PATHS entries: {minX,maxX,minZ,maxZ, kind:'cobble'|'dirt'}
 */
export function createProps(ctx) {
  const { blocked, circle, bbox, PATHS, POND, PLAZA_R } = ctx;
  const group = new THREE.Group();
  group.name = 'town-props';

  // ---- static buckets ----
  const st = new Map();
  let CUR = new THREE.Matrix4();
  const put = (key, meta, geo) => {
    if (!st.has(key)) st.set(key, { ...meta, geos: [] });
    st.get(key).geos.push(geo);
    return geo;
  };
  /** textured prop piece: UV in prop-local space, then the current placement matrix */
  const T = (kind, base, geo, upr = 1.5, o = OUT) => {
    surfaceUV(geo, upr);
    geo.applyMatrix4(CUR);
    return put(`t|${kind}|${base}|${o ? 1 : 0}`, { type: 't', kind, base, o: o ? OUT : 0 }, geo);
  };
  /** textured ground piece: world UV, no hull, no shadow cast */
  const G = (kind, base, geo, upr) => {
    surfaceUV(geo, upr);
    return put(`g|${kind}|${base}`, { type: 'g', kind, base }, geo);
  };
  const F = (color, geo, o = OUT) => {
    geo.applyMatrix4(CUR);
    return put(`o|${color}|${o ? 1 : 0}`, { type: 'o', color, o: o ? OUT : 0 }, geo);
  };
  const BAS = (color, geo) => {
    geo.applyMatrix4(CUR);
    return put(`b|${color}`, { type: 'b', color }, geo);
  };
  const at = (p, ry, fn) => {
    CUR = M4(p, [0, ry, 0]);
    fn();
    CUR = new THREE.Matrix4();
  };
  const flatRect = (w, d, x, y, z) => xf(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), [x, y, z]);
  const blobShape = (r, seed, n = 28) => {
    const sh = new THREE.Shape();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (1 + 0.28 * noise3(Math.cos(a) * 1.3, Math.sin(a) * 1.3, 0, seed));
      if (i) sh.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else sh.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    sh.closePath();
    return sh;
  };
  const patch = (x, z, r, seed, y) => new THREE.ShapeGeometry(blobShape(r, seed)).rotateX(-Math.PI / 2).translate(x, y, z);

  // ---- instance lists ----
  const rocks = [];
  const flowers = [[], [], [], []];
  const tufts = [];
  const shrooms = [];
  const bushes = [];
  const reeds = [];
  const pads = [];
  const lotus = [];
  const treeInst = { oak: [], conifer: [], blossom: [] };
  const glows = [];
  const stoneCols = [PAL.stone, PAL.stoneLight, mix(W.lavender, W.mascot, 0.25), mix(W.lavender, W.black, 0.18)];
  const rock = (x, z, s, seed, { y = 0, flat = 1, color } = {}) =>
    rocks.push({ x, y, z, sx: s * (1 + rnd(seed) * 0.4), sy: s * 0.7 * flat, sz: s * (0.8 + rnd(seed + 2) * 0.4), ry: rnd(seed + 1) * 6.28, color: color ?? stoneCols[Math.floor(rnd(seed + 4) * 4)] });
  const flower = (x, z, seed, s = 1, type = Math.floor(rnd(seed) * 4)) =>
    flowers[type].push({ x, z, s: s * (0.8 + rnd(seed + 1) * 0.5), ry: rnd(seed + 2) * 6.28, rx: (rnd(seed + 3) - 0.5) * 0.2 });

  // ---- placement registry (solid props keep out of keep-free zones and out of each other) ----
  const occ = [];
  const free = (x, z, r) => {
    if (blocked(x, z, r)) return false;
    for (const o of occ) if (Math.hypot(x - o.x, z - o.z) < r + o.r - 0.15) return false;
    return true;
  };
  const claim = (x, z, r) => occ.push({ x, z, r });
  const solid = (x, z, r, build) => {
    if (!free(x, z, r)) return false;
    build();
    claim(x, z, r);
    if (r > 0) circle(x, z, r);
    return true;
  };
  const onPath = (x, z, m = 0.3) => {
    for (const p of PATHS) if (x > p.minX - m && x < p.maxX + m && z > p.minZ - m && z < p.maxZ + m) return true;
    if (Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA_R + m) return true;
    return false;
  };
  const onGround = (x, z, m = 0.5) => {
    if (onPath(x, z, m)) return true;
    for (const b of BUILDINGS) if (Math.abs(x - b.x) < b.w / 2 + m + 0.5 && Math.abs(z - b.z) < b.d / 2 + m + 0.5) return true;
    if (((x - POND.x) / (POND.rx + m)) ** 2 + ((z - POND.z) / (POND.rz + m)) ** 2 < 1) return true;
    return false;
  };

  const waterGeos = [];

  // ================================================================= GROUND
  {
    const x0 = TOWN.minX - 10, x1 = TOWN.maxX + 10, z0 = TOWN.minZ - 10, z1 = TOWN.maxZ + 10;
    G('grass', PAL.grass, new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, 0, (z0 + z1) / 2), 5);
    // painted patches: darker meadow, sun-bleached meadow, a few bare dirt spots
    let k = 0;
    for (let i = 0; i < 46 && k < 14; i++) {
      const x = TOWN.minX + 1 + rnd(i * 7 + 1) * (TOWN.maxX - TOWN.minX - 2);
      const z = TOWN.minZ + 1 + rnd(i * 7 + 2) * (TOWN.maxZ - TOWN.minZ - 2);
      if (onGround(x, z, 1.0)) continue;
      const r = 1.3 + rnd(i * 7 + 3) * 1.6;
      if (k % 3 === 2) G('grass', PAL.grassLight, patch(x, z, r, i, 0.016), 5);
      else G('grassDark', PAL.grassDark, patch(x, z, r, i, 0.012), 5);
      k++;
    }
    // worn dirt under the benches and the gate
    [[3.9, 5.2, 1.0], [-3.9, 5.2, 1.0], [3.9, -1.3, 1.0], [-3.9, -1.3, 1.0], [0, TOWN.maxZ - 1.2, 1.6], [-13.6, 13.4, 1.0]]
      .forEach(([x, z, r], i) => G('dirt', PAL.dirt, patch(x, z, r, 40 + i, 0.02), 2.4));

    // paths: dirt shoulder under everything, dirt tracks, cobble on top
    for (const p of PATHS) {
      const w = p.maxX - p.minX, d = p.maxZ - p.minZ, cx = (p.minX + p.maxX) / 2, cz = (p.minZ + p.maxZ) / 2;
      if (p.kind === 'cobble') {
        G('dirt', PAL.dirt, flatRect(w + 0.34, d + 0.34, cx, 0.028, cz), 2.4);
        G('cobble', PAL.cobble, flatRect(w, d, cx, 0.042, cz), 2.0);
      } else {
        G('dirt', PAL.dirt, flatRect(w + 0.12, d + 0.12, cx, 0.032, cz), 2.4);
      }
    }
    // edging stones along cobble paths, pebbles on dirt tracks
    const inOtherPath = (x, z, self) => {
      for (const p of PATHS) if (p !== self && x > p.minX - 0.15 && x < p.maxX + 0.15 && z > p.minZ - 0.15 && z < p.maxZ + 0.15) return true;
      if (Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA_R + 0.3) return true;
      for (const b of BUILDINGS) if (Math.abs(x - b.x) < b.w / 2 + 0.5 && Math.abs(z - b.z) < b.d / 2 + 0.5) return true;
      return false;
    };
    let si = 0;
    for (const p of PATHS) {
      if (p.kind !== 'cobble') continue;
      const along = p.maxZ - p.minZ >= p.maxX - p.minX ? 'z' : 'x';
      const lo = along === 'z' ? p.minZ : p.minX, hi = along === 'z' ? p.maxZ : p.maxX;
      for (const side of [0, 1]) {
        for (let t = lo + 0.3; t < hi; t += 0.62 + rnd(si * 3) * 0.18) {
          const off = side ? (along === 'z' ? p.maxX : p.maxZ) + 0.2 : (along === 'z' ? p.minX : p.minZ) - 0.2;
          const x = along === 'z' ? off : t, z = along === 'z' ? t : off;
          si++;
          if (inOtherPath(x, z, p)) continue;
          rock(x, z, 0.16 + rnd(si) * 0.07, si * 3, { flat: 0.8 });
        }
      }
    }
    for (let i = 0; i < 40; i++) {
      const dp = PATHS.filter((p) => p.kind === 'dirt');
      const p = dp[i % dp.length];
      const x = p.minX + 0.2 + rnd(i * 3 + 1) * (p.maxX - p.minX - 0.4), z = p.minZ + 0.2 + rnd(i * 3 + 2) * (p.maxZ - p.minZ - 0.4);
      if (Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA_R + 0.3 || inOtherPath(x, z, p)) continue;
      rocks.push({ x, y: 0.03, z, s: 0.045 + rnd(i) * 0.05, sy: 0.03, ry: rnd(i + 3) * 6, color: stoneCols[i % 4] });
    }
    // stepping stones (worn trail from the south road to the well)
    [[-8.1, 9.7], [-8.4, 8.9], [-8.9, 8.2], [-9.1, 7.4], [-9.4, 6.7]].forEach(([x, z], i) =>
      rocks.push({ x, y: 0.01, z, sx: 0.34, sy: 0.13, sz: 0.28, ry: i * 0.9, color: PAL.stoneLight }));
  }

  // ================================================================= PLAZA + FOUNTAIN
  {
    const { x, z } = PLAZA;
    // raised cobble disc
    T('cobble', PAL.plaza, xf(cyl(PLAZA_R, PLAZA_R + 0.08, 0.14, 56), [x, 0.07, z]), 2.2);
    // radial paving: two rings of sector tiles in alternating tints
    const ring = (r0, r1, n, off, y) => {
      for (let i = 0; i < n; i++) {
        const a0 = ((i + off) / n) * Math.PI * 2, da = (Math.PI * 2) / n;
        const gap = 0.035 / ((r0 + r1) / 2);
        const g = new THREE.RingGeometry(r0, r1, 2, 1, a0 + gap, da - 2 * gap).rotateX(-Math.PI / 2).translate(x, y, z);
        G('cobble', i % 2 ? PAL.tileB : PAL.tileA, g, 2.2);
      }
    };
    ring(2.5, 3.18, 24, 0, 0.152);
    ring(3.24, 3.9, 32, 0.5, 0.152);
    // deploy-pad ring around the basin
    const dr = new THREE.RingGeometry(2.1, 2.3, 48).rotateX(-Math.PI / 2).translate(x, 0.156, z);
    F(W.yellow, dr, 0);
    // basin: stone wall (textured), clean rim, water
    T('stoneWall', PAL.stoneWall, xf(cyl(1.78, 1.88, 0.3, 40), [x, 0.29, z]), 1.5);
    T('stoneWall', PAL.stoneWall, xf(new THREE.TorusGeometry(1.72, 0.16, 8, 44).rotateX(Math.PI / 2), [x, 0.5, z]), 1.5);
    // pedestal + two bowls + finial
    T('stoneWall', PAL.stoneWall, xf(cyl(0.32, 0.46, 0.75, 16), [x, 0.82, z]), 1.5);
    T('stoneWall', PAL.stoneWall, xf(cyl(0.82, 0.38, 0.26, 24), [x, 1.14, z]), 1.5);
    T('stoneWall', PAL.stoneWall, xf(new THREE.TorusGeometry(0.82, 0.07, 6, 28).rotateX(Math.PI / 2), [x, 1.27, z]), 1.5);
    T('stoneWall', PAL.stoneWall, xf(cyl(0.13, 0.17, 0.42, 10), [x, 1.47, z]), 1.5);
    T('stoneWall', PAL.stoneWall, xf(cyl(0.36, 0.15, 0.14, 16), [x, 1.66, z]), 1.5);
    // water discs (animated, merged with the pond below)
    waterGeos.push(xf(new THREE.CircleGeometry(1.62, 40).rotateX(-Math.PI / 2), [x, 0.5, z]));
    waterGeos.push(xf(new THREE.CircleGeometry(0.76, 28).rotateX(-Math.PI / 2), [x, 1.285, z]));
    claim(x, z, 1.9);
    circle(x, z, 1.85);
    // four stone planters at the plaza rim (spokes between the paths)
    [0.785, 2.356, 3.927, 5.498].forEach((a, i) => {
      const px = x + Math.cos(a) * 3.55, pz = z + Math.sin(a) * 3.55;
      at([px, 0.14, pz], a, () => {
        T('stoneWall', PAL.stoneWall, xf(cyl(0.34, 0.4, 0.34, 10), [0, 0.17, 0]), 1.5);
        T('stoneWall', PAL.stoneWall, xf(new THREE.TorusGeometry(0.35, 0.06, 6, 14).rotateX(Math.PI / 2), [0, 0.34, 0]), 1.5);
      });
      bushes.push({ x: px, y: 0.4, z: pz, s: 0.5, ry: i, color: 1 });
      flower(px + 0.1, pz, 700 + i, 1.2, i % 4);
      flower(px - 0.1, pz + 0.12, 710 + i, 1.1, (i + 1) % 4);
      claim(px, pz, 0.4);
      circle(px, pz, 0.4);
    });
  }

  // ================================================================= POND
  {
    const { x, z, rx, rz } = POND;
    waterGeos.push(xf(new THREE.CircleGeometry(1, 44).rotateX(-Math.PI / 2), [x, 0.06, z], [0, 0, 0], [rx, 1, rz]));
    const dockA = { z0: z - 0.9, z1: z + 0.5, xMin: x + rx - 1.4 };
    const inDock = (px, pz) => pz > dockA.z0 - 0.2 && pz < dockA.z1 + 0.2 && px > dockA.xMin;
    const n = 30;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(i) * 0.1;
      const px = x + Math.cos(a) * (rx + 0.12 + rnd(i + 9) * 0.1), pz = z + Math.sin(a) * (rz + 0.12 + rnd(i + 9) * 0.1);
      if (inDock(px, pz)) continue;
      rock(px, pz, 0.2 + rnd(i + 3) * 0.14, 900 + i * 4, { flat: 0.9 });
    }
    // reeds on the far bank + a clump at the front, lily pads with lotus
    [2.5, 2.9, 3.35, 3.8, 4.2, 5.55].forEach((a, i) => {
      const px = x + Math.cos(a) * (rx - 0.15), pz = z + Math.sin(a) * (rz - 0.1);
      reeds.push({ x: px, y: 0.04, z: pz, s: 0.85 + rnd(i * 3) * 0.5, ry: i * 1.7 });
    });
    [[-0.9, 0.3, 1], [0.8, -0.4, 0], [0.2, 0.7, 0], [-0.2, -0.6, 1], [1.5, 0.3, 0], [-1.7, -0.2, 0]].forEach(([dx, dz, withLotus], i) => {
      const item = { x: x + dx, y: 0.075, z: z + dz, s: 0.8 + rnd(i + 20) * 0.5, ry: i * 1.9, color: i % 2 ? PAL.leaf : PAL.leafDark };
      pads.push(item);
      if (withLotus) lotus.push({ x: x + dx, y: 0.075, z: z + dz, s: 1, ry: i });
    });
    // little wooden dock into the pond
    at([x + rx + 0.3, 0, z - 0.2], 0, () => {
      for (let i = 0; i < 9; i++) T('woodPlanks', PAL.wood, bx(0.27, 0.07, 1.25, -i * 0.3 + 0.15, 0.2, 0), [2.0, 0.5], 0.026);
      for (const sz of [-0.5, 0.5]) T('woodPlanks', PAL.wood, bx(2.8, 0.1, 0.1, -1.2, 0.12, sz), [1.5, 0.4]);
      for (const px of [0.1, -1.1, -2.3]) for (const sz of [-0.62, 0.62]) T('logs', PAL.bark, cy(0.075, 0.08, 0.55, px, 0.17, sz, [0, 0, 0], 8), 1.2);
      // coiled rope + a lantern post at the tip
      T('logs', PAL.bark, cy(0.07, 0.08, 0.9, -2.4, 0.5, 0.6, [0, 0, 0], 8), 1.2);
      BAS(PAL.glow, bx(0.16, 0.2, 0.16, -2.4, 1.03, 0.6));
      F(W.black, bx(0.24, 0.05, 0.24, -2.4, 1.16, 0.6), 0);
      F(W.black, bx(0.24, 0.05, 0.24, -2.4, 0.92, 0.6), 0);
    });
    circle(x - 1.5, z, 1.9);
    circle(x + 1.2, z, 1.9);
    circle(x + 3.0, z, 0.4);
    claim(x, z, 3.0);
  }

  // ================================================================= WELL, SIGNPOST
  const wellOk = solid(-9.2, 5.4, 0.95, () => {
    at([-9.2, 0, 5.4], 0.3, () => {
      T('stoneWall', PAL.stoneWall, cy(0.78, 0.84, 0.78, 0, 0.39, 0, [0, 0, 0], 14), 1.4);
      F(W.black, xf(new THREE.CircleGeometry(0.62, 14).rotateX(-Math.PI / 2), [0, 0.7, 0]), 0);
      T('stoneWall', PAL.stoneWall, xf(new THREE.TorusGeometry(0.72, 0.07, 6, 18).rotateX(Math.PI / 2), [0, 0.78, 0]), 1.5);
      for (const sx of [-0.8, 0.8]) T('woodVertical', PAL.wood, bx(0.13, 1.7, 0.13, sx, 0.85 + 0.45, 0), 1.5);
      T('logs', PAL.bark, cy(0.07, 0.07, 1.7, 0, 1.55, 0, [0, 0, Math.PI / 2], 8), 1.2);
      // roof: two shingle slabs + ridge
      for (const s of [-1, 1]) T('roofShingles', PAL.roof, bx(2.0, 0.07, 0.95, 0, 2.22, s * 0.4, [s * 0.62, 0, 0]), 1.6);
      T('woodPlanks', PAL.wood, bx(2.05, 0.1, 0.12, 0, 2.62, 0), 1.5);
      T('woodVertical', PAL.woodLight, cy(0.17, 0.2, 0.26, 0.15, 1.2, 0, [0, 0, 0], 8), 1.2); // hanging bucket
      F(W.black, bx(0.02, 0.35, 0.02, 0.15, 1.42, 0), 0);
    });
  });
  void wellOk;
  const signOk = solid(-2.6, 6.8, 0.3, () => {
    at([-2.6, 0, 6.8], 0, () => {
      T('woodVertical', PAL.wood, bx(0.16, 3.1, 0.16, 0, 1.55, 0), 1.5);
      T('woodPlanks', PAL.wood, bx(0.3, 0.1, 0.3, 0, 3.12, 0), 1.5);
      T('woodPlanks', PAL.wood, new THREE.ConeGeometry(0.2, 0.2, 4).rotateY(Math.PI / 4).translate(0, 3.27, 0), 1.5);
      for (let i = 0; i < 4; i++) rocks.push({ x: -2.6 + Math.cos(i * 1.6) * 0.3, y: 0, z: 6.8 + Math.sin(i * 1.6) * 0.3, s: 0.15, sy: 0.12, ry: i, color: PAL.stoneLight });
    });
  });

  // ================================================================= FENCES + GATE
  const fence = (x0, z0, x1, z1, step = 1.1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / step));
    const ang = Math.atan2(-(z1 - z0), x1 - x0);
    at([x0, 0, z0], ang, () => {
      const sp = len / n;
      for (let i = 0; i <= n; i++) {
        T('woodVertical', PAL.wood, bx(0.13, 0.86, 0.13, i * sp, 0.43, 0), 1.5);
        T('woodPlanks', PAL.woodLight, new THREE.ConeGeometry(0.115, 0.12, 4).rotateY(Math.PI / 4).translate(i * sp, 0.92, 0), 1.5);
      }
      for (let i = 0; i < n; i++) for (const y of [0.36, 0.72]) T('woodPlanks', PAL.woodLight, bx(sp - 0.06, 0.12, 0.07, (i + 0.5) * sp, y + 0.06, 0), [2.0, 0.48], 0.022);
    });
  };
  const gateX = TOWN_SPAWN.x, gateZ = TOWN.maxZ - 0.9;
  fence(TOWN.minX + 0.6, gateZ, gateX - 1.6, gateZ);
  fence(gateX + 1.6, gateZ, TOWN.maxX - 0.6, gateZ);
  fence(TOWN.minX + 0.6, TOWN.minZ + 1.0, TOWN.minX + 0.6, gateZ);
  fence(TOWN.maxX - 0.6, TOWN.minZ + 1.0, TOWN.maxX - 0.6, gateZ);
  at([gateX, 0, gateZ], 0, () => {
    for (const s of [-1, 1]) {
      T('woodVertical', PAL.wood, bx(0.22, 1.5, 0.22, s * 1.35, 0.75, 0), 1.5);
      T('woodPlanks', PAL.woodLight, bx(0.32, 0.08, 0.32, s * 1.35, 1.54, 0), 1.5);
      BAS(PAL.glow, new THREE.IcosahedronGeometry(0.1, 1).translate(s * 1.35, 1.68, 0));
      // open leaves, swung outward
      const hx = s * 1.2;
      const leaf = (g) => { g.translate(-hx, 0, 0); g.rotateY(s * 1.0); g.translate(hx, 0, 0); return g; };
      for (const y of [0.3, 0.78]) T('woodPlanks', PAL.woodLight, leaf(bx(1.0, 0.12, 0.07, s * 0.7, y + 0.06, 0)), [2.0, 0.48], 0.022);
      for (let i = 0; i < 4; i++) T('woodVertical', PAL.wood, leaf(bx(0.1, 0.92, 0.06, s * (0.3 + i * 0.28), 0.5, 0)), 1.5);
      T('woodPlanks', PAL.woodLight, leaf(bx(1.15, 0.07, 0.05, s * 0.7, 0.54, 0.05, [0, 0, s * -0.5])), 1.5);
    }
    T('woodPlanks', PAL.wood, bx(2.9, 0.14, 0.2, 0, 1.6, 0), [2.0, 0.56], 0.022);
    // little hanging plank
    T('woodPlanks', PAL.woodLight, bx(0.7, 0.28, 0.06, 0, 1.3, 0.02), 1.5);
    F(W.black, bx(0.03, 0.18, 0.03, -0.28, 1.5, 0.02), 0);
    F(W.black, bx(0.03, 0.18, 0.03, 0.28, 1.5, 0.02), 0);
  });

  // ================================================================= LAMPS
  const lamp = (x, z) => {
    at([x, 0, z], 0, () => {
      const blk = (g) => F(W.black, g, 0);
      blk(cy(0.3, 0.36, 0.16, 0, 0.08, 0, [0, 0, 0], 12));
      blk(cy(0.17, 0.26, 0.34, 0, 0.3, 0, [0, 0, 0], 12));
      blk(cy(0.045, 0.065, 2.3, 0, 1.45, 0, [0, 0, 0], 8));
      for (const y of [0.62, 1.55]) blk(cy(0.1, 0.1, 0.07, 0, y, 0, [0, 0, 0], 8));
      // curled bracket arms
      for (const s of [-1, 1]) blk(xf(new THREE.TorusGeometry(0.2, 0.022, 5, 12, Math.PI * 1.1), [s * 0.2, 2.05, 0], [0, 0, s > 0 ? -0.2 : Math.PI + 0.2 - Math.PI * 0.1]));
      // lantern
      blk(bx(0.5, 0.06, 0.5, 0, 2.3, 0));
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) blk(cy(0.024, 0.024, 0.55, sx * 0.19, 2.6, sz * 0.19, [0, 0, 0], 5));
      blk(bx(0.46, 0.05, 0.46, 0, 2.89, 0));
      blk(new THREE.ConeGeometry(0.4, 0.3, 4).rotateY(Math.PI / 4).translate(0, 3.07, 0));
      blk(new THREE.IcosahedronGeometry(0.06, 1).translate(0, 3.27, 0));
      BAS(PAL.glow, bx(0.34, 0.5, 0.34, 0, 2.6, 0));
      F(W.black, bx(0.36, 0.03, 0.03, 0, 2.6, 0.17), 0);
    });
    glows.push([x, z]);
  };
  [[-2.5, -3.2], [2.5, -3.2], [-2.6, 8.6], [2.6, 12.4], [-6.5, 10.0], [6.0, 12.5], [-8.6, -2.2], [8.6, -2.2], [-17.5, -3.2], [17.5, -3.2]]
    .forEach(([x, z]) => solid(x, z, 0.3, () => lamp(x, z)));

  // ================================================================= BENCHES
  const bench = (x, z, ry) => {
    at([x, 0, z], ry, () => {
      for (const k of [-0.21, -0.07, 0.07, 0.21]) T('woodPlanks', PAL.woodLight, bx(2.1, 0.05, 0.12, 0, 0.5, k), [1.6, 0.5]);
      for (const k of [0, 1, 2]) T('woodPlanks', PAL.woodLight, bx(2.1, 0.1, 0.045, 0, 0.74 + k * 0.14, -0.29 - k * 0.025, [-0.1, 0, 0]), [1.6, 0.5]);
      for (const s of [-1, 1]) {
        T('woodPlanks', PAL.wood, bx(0.08, 0.5, 0.52, s * 0.95, 0.25, 0), 1.5);
        T('woodVertical', PAL.wood, bx(0.08, 1.0, 0.08, s * 0.95, 0.5, -0.29), 1.5);
        T('woodPlanks', PAL.wood, bx(0.09, 0.06, 0.62, s * 0.97, 0.72, 0.0), 1.5);
        T('woodVertical', PAL.wood, bx(0.07, 0.24, 0.07, s * 0.97, 0.6, 0.27), 1.5);
      }
    });
  };
  const toPlaza = (x, z) => Math.atan2(PLAZA.x - x, PLAZA.z - z);
  const benchSolid = (x, z, ry) => {
    if (!free(x, z, 0.9)) return;
    bench(x, z, ry);
    claim(x, z, 0.9);
    for (const d of [-0.8, 0, 0.8]) circle(x + Math.cos(ry) * d, z - Math.sin(ry) * d, 0.5);
  };
  [[3.9, 5.2], [-3.9, 5.2], [3.9, -1.3], [-3.9, -1.3]].forEach(([x, z]) => benchSolid(x, z, toPlaza(x, z)));
  benchSolid(POND.x + 3.9, POND.z + 0.9, -Math.PI / 2);

  // ================================================================= BARRELS, CRATES, WOODPILE
  const barrelProfile = [[0.0, 0], [0.3, 0], [0.34, 0.1], [0.38, 0.3], [0.395, 0.4], [0.38, 0.5], [0.34, 0.7], [0.3, 0.8], [0.0, 0.8]];
  const radiusAt = (y) => {
    for (let i = 1; i < barrelProfile.length; i++) {
      const [r0, y0] = barrelProfile[i - 1], [r1, y1] = barrelProfile[i];
      if (y <= y1 && y1 > y0) return smooth(r0, r1, (y - y0) / (y1 - y0));
    }
    return 0.3;
  };
  const barrel = (x, z, s = 1) => {
    at([x, 0, z], rnd(x * 3.1 + z) * 6, () => {
      const g = new THREE.LatheGeometry(barrelProfile.map(([r, y]) => new THREE.Vector2(r * s, y * s)), 14);
      T('woodVertical', PAL.wood, g, 1.3);
      for (const y of [0.16, 0.34, 0.5, 0.66]) {
        if (y === 0.34 || y === 0.5) continue;
        F(W.black, cy(radiusAt(y) * s + 0.012, radiusAt(y) * s + 0.012, 0.06 * s, 0, y * s, 0, [0, 0, 0], 14), 0);
      }
      T('woodPlanks', PAL.woodLight, cy(0.27 * s, 0.27 * s, 0.03 * s, 0, 0.8 * s, 0, [0, 0, 0], 12), 1.3);
    });
  };
  const crate = (x, y0, z, s = 0.8, ry = 0) => {
    at([x, y0, z], ry, () => {
      T('woodPlanks', PAL.woodLight, box(s, s, s).translate(0, s / 2, 0), 1.3);
      for (const y of [0.18, 0.82]) T('woodPlanks', PAL.wood, bx(s + 0.05, 0.1 * s + 0.04, s + 0.05, 0, y * s, 0), [1.6, 0.3], 0.026);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) T('woodVertical', PAL.wood, bx(0.07, s + 0.02, 0.07, sx * s / 2, s / 2, sz * s / 2), 1.5);
      T('woodPlanks', PAL.wood, bx(s * 1.28, 0.07, 0.04, 0, s / 2, s / 2 + 0.03, [0, 0, 0.78]), 1.5);
    });
  };
  const logPile = (x, z, ry) => {
    at([x, 0, z], ry, () => {
      const rows = [[0.13, 5], [0.34, 4], [0.55, 3], [0.76, 2]];
      rows.forEach(([y, n], r) => {
        for (let i = 0; i < n; i++) {
          const px = (i - (n - 1) / 2) * 0.27;
          T('logs', PAL.bark, cy(0.125, 0.125, 1.1 + (rnd(r * 7 + i) - 0.5) * 0.08, px, y, 0, [Math.PI / 2, 0, 0], 8), 1.2);
        }
      });
      for (const px of [-0.6, 0.6]) T('woodVertical', PAL.wood, bx(0.07, 0.95, 0.07, px, 0.47, 0.65), 1.5);
    });
  };
  const stump = (x, z, s = 1) => {
    at([x, 0, z], rnd(x + z) * 6, () => {
      T('logs', PAL.bark, cy(0.26 * s, 0.32 * s, 0.34 * s, 0, 0.17 * s, 0, [0, 0, 0], 9), 1.2);
      T('woodPlanks', PAL.woodLight, cy(0.22 * s, 0.22 * s, 0.02, 0, 0.345 * s, 0, [0, 0, 0], 9), 1.2);
    });
  };
  const how = BUILDINGS.find((b) => b.id === 'how');
  const about = BUILDINGS.find((b) => b.id === 'about');
  const post = BUILDINGS.find((b) => b.id === 'post');
  solid(how.x - 3.2, how.z + 1.3, 0.5, () => crate(how.x - 3.2, 0, how.z + 1.3, 0.9, 0.2));
  solid(how.x - 2.7, how.z + 1.9, 0.45, () => crate(how.x - 2.7, 0, how.z + 1.9, 0.75, -0.3));
  crate(how.x - 3.2, 0.9, how.z + 1.3, 0.6, 0.5);
  solid(how.x + 3.6, how.z + 1.5, 0.45, () => barrel(how.x + 3.6, how.z + 1.5));
  solid(how.x + 3.4, how.z - 0.2, 0.45, () => barrel(how.x + 3.4, how.z - 0.2, 0.9));
  solid(how.x - 3.3, how.z - 1.2, 0.8, () => logPile(how.x - 3.4, how.z - 1.4, Math.PI / 2));
  solid(about.x + 3.4, about.z + 2.0, 0.45, () => barrel(about.x + 3.4, about.z + 2.0));
  solid(about.x - 3.3, about.z + 2.1, 0.4, () => stump(about.x - 3.3, about.z + 2.1, 1.1));
  solid(post.x - 3.4, post.z + 1.6, 0.4, () => crate(post.x - 3.4, 0, post.z + 1.6, 0.7, 0.4));
  solid(post.x + 3.2, post.z - 0.9, 0.4, () => barrel(post.x + 3.2, post.z - 0.9, 0.85));

  // ================================================================= FLOWER BEDS
  const bed = (x, z, w, d, seed) => {
    const t = 0.1, h = 0.32;
    at([x, 0, z], 0, () => {
      for (const sz of [-1, 1]) T('woodPlanks', PAL.wood, bx(w, h, t, 0, h / 2, sz * (d / 2 - t / 2)), [1.6, 0.48], 0.026);
      for (const sx of [-1, 1]) T('woodPlanks', PAL.wood, bx(t, h, d - 2 * t, sx * (w / 2 - t / 2), h / 2, 0), [1.6, 0.48], 0.026);
      T('dirt', mix(PAL.dirt, W.black, 0.35), bx(w - 2 * t, 0.26, d - 2 * t, 0, 0.13, 0), 1.6, 0);
    });
    let i = 0;
    for (let fx = x - w / 2 + 0.3; fx < x + w / 2 - 0.2; fx += 0.4) {
      for (let fz = z - d / 2 + 0.28; fz < z + d / 2 - 0.15; fz += 0.4) {
        const k = seed * 13 + i++;
        flowers[Math.floor(rnd(k) * 4)].push({ x: fx + (rnd(k + 3) - 0.5) * 0.12, y: 0.26, z: fz + (rnd(k + 9) - 0.5) * 0.12, s: 0.9 + rnd(k + 5) * 0.5, ry: rnd(k + 7) * 6.28, rx: (rnd(k + 8) - 0.5) * 0.25 });
      }
    }
  };
  [[-4.8, -5.7, 3.0, 0.9, 1], [4.8, -5.7, 3.0, 0.9, 2], [-15.4, -3.9, 1.4, 0.9, 3], [10.4, 10.2, 1.4, 0.9, 4]].forEach(([x, z, w, d, seed]) => {
    if (blocked(x, z, Math.max(w, d) * 0.25) && x !== -15.4) return;
    bed(x, z, w, d, seed);
    bbox(x - w / 2, x + w / 2, z - d / 2, z + d / 2);
    claim(x, z, Math.max(w, d) / 2);
  });

  // ================================================================= TREES / BUSHES / SCATTER
  const addTree = (sp, x, z, s, seed) =>
    treeInst[sp].push({ x, y: 0, z, s, ry: rnd(seed * 3.7) * 6.28, ph: rnd(seed * 1.9) * 6.28, tint: 0.92 + rnd(seed * 5.3) * 0.14, hue: rnd(seed * 2.2) });
  const tree = (sp, x, z, s, seed) => solid(x, z, 0.5 * s, () => {
    addTree(sp, x, z, s, seed);
    if (s >= 0.9) for (let k = 0; k < 2; k++) {
      const a = rnd(seed * 4 + k) * 6.28, d = 0.7 + rnd(seed * 4 + k + 9) * 0.4;
      shrooms.push({ x: x + Math.cos(a) * d * s, z: z + Math.sin(a) * d * s, s: 0.9 + rnd(seed + k) * 0.5, ry: a });
    }
  });
  // interior trees by species: o = oak, c = conifer, b = blossom (the pastel mascot trees flank the plaza)
  const SP = { o: 'oak', c: 'conifer', b: 'blossom' };
  [[-19, 1, 1.15, 'o'], [19.5, 3.5, 1.1, 'c'], [-19.5, -10, 1.2, 'c'], [19.5, -11, 1.2, 'c'], [-9, 12.5, 1.0, 'o'], [8, 14.5, 1.0, 'b'],
    [-20, 7, 1.0, 'c'], [18.5, 7.5, 1.0, 'o'], [-8, -12, 1.0, 'c'], [8, -13.5, 1.0, 'c'], [-15, 0, 1.0, 'o'], [14.5, 1.8, 1.0, 'o'],
    [-12, 3.6, 0.95, 'b'], [12, 4, 0.95, 'b']].forEach(([x, z, s, k], i) => tree(SP[k], x, z, s, i + 1));

  // bushes along building fronts and sides (+ a few extra by the pond)
  [[-9.0, -9.3, 1.2], [-17.3, -6.2, 1.1], [-17.0, -8.6, 1.2], [17.6, -7.5, 1.2], [17.2, -9.0, 1.0], [8.2, -9.0, 1.1], [-10.0, -9.0, 1.0],
    [-14.4, 8.8, 1.0], [-9.8, 6.6, 0.9], [15.4, 6.0, 1.1], [8.2, 7.0, 1.0], [-6.5, 7.2, 0.9], [-7.4, -4.5, 0.9], [7.4, -4.5, 0.9],
    [POND.x - 3.4, POND.z - 0.8, 1.0], [POND.x + 1.2, POND.z - 3.0, 0.9]].forEach(([x, z, s], i) => {
    solid(x, z, 0.55 * s, () => bushes.push({ x, y: 0, z, s, ry: rnd(i * 3) * 6.28, color: i % 3 }));
  });

  // border: tree line behind / beside the town (front edges stay low so the camera sees in)
  let ti = 0;
  const border = (x, z, s, kind) => addTree(kind, x, z, s, 30 + ti++);
  for (let x = TOWN.minX - 2; x <= TOWN.maxX + 2; x += 2.6) {
    border(x + (rnd(x * 3) - 0.5) * 0.8, TOWN.minZ - 0.6 + rnd(x) * 0.8, 1.05, ti % 3 === 0 ? 'oak' : 'conifer');
    border(x + 1.3 + (rnd(x * 5) - 0.5) * 0.8, TOWN.minZ - 2.4 + rnd(x + 2), 1.2, ti % 4 === 1 ? 'blossom' : 'conifer');
  }
  for (let z = TOWN.minZ + 1; z <= TOWN.maxZ + 2; z += 2.8) {
    border(TOWN.minX - 0.8 - rnd(z) * 0.8, z, 1.05, ti % 2 ? 'oak' : 'conifer');
    border(TOWN.minX - 2.8 - rnd(z + 1) * 0.6, z + 1.4, 1.2, ti % 3 === 0 ? 'blossom' : 'conifer');
  }
  for (let z = TOWN.minZ + 1; z <= TOWN.maxZ; z += 3.6) border(TOWN.maxX + 1.4 + rnd(z) * 0.8, z, 0.7, ti % 3 === 1 ? 'blossom' : 'oak');
  for (let x = TOWN.minX + 1; x <= TOWN.maxX; x += 3.4) border(x, TOWN.maxZ + 1.6 + rnd(x) * 0.8, 0.7, ti % 3 === 2 ? 'blossom' : 'oak');
  bbox(TOWN.minX - 4, TOWN.minX + 0.8, TOWN.minZ - 4, TOWN.maxZ + 4);
  bbox(TOWN.maxX - 0.8, TOWN.maxX + 4, TOWN.minZ - 4, TOWN.maxZ + 4);
  bbox(TOWN.minX - 4, TOWN.maxX + 4, TOWN.minZ - 4, TOWN.minZ + 0.8);
  bbox(TOWN.minX - 4, TOWN.maxX + 4, TOWN.maxZ - 0.9, TOWN.maxZ + 4);

  // rocks, flowers, tufts on the lawn
  [[-20.5, 4.5, 0.55], [-16.5, -1.8, 0.4], [20.4, -2.5, 0.5], [16.3, 4.4, 0.35], [-6.2, 14.6, 0.4], [10.5, -11.4, 0.5], [-11.4, -11.6, 0.45], [4.2, 14.6, 0.35]].forEach(([x, z, s], i) => {
    if (blocked(x, z, 0.4) || onGround(x, z, 0.2)) return;
    rock(x, z, s, 1200 + i * 5);
    rock(x + 0.55, z + 0.25, s * 0.55, 1300 + i * 5);
    if (s > 0.4) rock(x - 0.4, z + 0.4, s * 0.4, 1400 + i * 5);
    circle(x, z, s * 1.0);
  });
  for (let i = 0; i < 150; i++) {
    const x = TOWN.minX + 1 + rnd(i * 5 + 1) * (TOWN.maxX - TOWN.minX - 2);
    const z = TOWN.minZ + 1 + rnd(i * 5 + 2) * (TOWN.maxZ - TOWN.minZ - 2);
    if (onGround(x, z, 0.4)) continue;
    flower(x, z, 2000 + i * 7, 1);
    if (i % 4 === 0) { flower(x + 0.18, z + 0.1, 2003 + i * 7, 0.85); flower(x - 0.12, z + 0.2, 2005 + i * 7, 0.9); }
  }
  for (let i = 0; i < 260; i++) {
    const x = TOWN.minX - 1 + rnd(i * 5 + 3) * (TOWN.maxX - TOWN.minX + 2);
    const z = TOWN.minZ - 1 + rnd(i * 5 + 4) * (TOWN.maxZ - TOWN.minZ + 2);
    if (onGround(x, z, 0.2)) continue;
    tufts.push({ x, z, s: 0.8 + rnd(i + 6) * 0.8, ry: rnd(i + 8) * 6.28, color: 0 });
  }
  for (let i = 0; i < 10; i++) {
    const x = TOWN.minX + 2 + rnd(i * 5 + 11) * (TOWN.maxX - TOWN.minX - 4);
    const z = TOWN.minZ + 2 + rnd(i * 5 + 12) * (TOWN.maxZ - TOWN.minZ - 4);
    if (onGround(x, z, 0.5)) continue;
    shrooms.push({ x, z, s: 0.9 + rnd(i) * 0.5, ry: i });
    shrooms.push({ x: x + 0.2, z: z + 0.12, s: 0.6, ry: i + 2 });
  }

  // ================================================================= FLUSH static buckets
  for (const [key, b] of st) {
    const isTex = b.type === 't' || b.type === 'g';
    const merged = mergeGeometries(b.geos.map((g) => keepAttrs(g, isTex ? ['position', 'normal', 'uv'] : ['position', 'normal'])), false);
    let mesh;
    if (isTex) mesh = new THREE.Mesh(merged, texturedToon(b.kind, b.base));
    else if (b.type === 'o') mesh = new THREE.Mesh(merged, toonMaterial(b.color));
    else mesh = new THREE.Mesh(merged, flatMaterial(b.color));
    mesh.receiveShadow = b.type !== 'b';
    mesh.castShadow = b.type === 't' || b.type === 'o';
    if (b.o) addOutline(mesh, b.o);
    mesh.name = `props-${key}`;
    group.add(mesh);
  }

  // water: pond + fountain in ONE mesh, one animated texture
  const water = animatedWater({ base: PAL.water });
  {
    waterGeos.forEach((g) => surfaceUV(g, 1.2));
    const m = new THREE.Mesh(mergeGeometries(waterGeos.map((g) => keepAttrs(g, ['position', 'normal', 'uv'])), false), water.material);
    m.receiveShadow = true;
    m.name = 'props-water';
    group.add(m);
  }

  // ---- instanced pieces ----
  const instMesh = (name, geo, mat, list, { outline = 0, cast = true, receive = false, tint } = {}) => {
    if (!list.length) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => {
      mesh.setMatrixAt(i, composeItem(it));
      const col = tint ? tint(it, i) : it.color != null && it.color > 0xff ? _c.set(it.color) : null;
      if (col) mesh.setColorAt(i, col);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    mesh.frustumCulled = false;
    mesh.name = `props-${name}`;
    group.add(mesh);
    if (outline) {
      const hull = new THREE.InstancedMesh(hullOf(geo), outlineMat(outline), list.length);
      hull.instanceMatrix = mesh.instanceMatrix;
      hull.frustumCulled = false;
      hull.raycast = () => {};
      hull.name = `props-${name}-outline`;
      group.add(hull);
    }
    return mesh;
  };

  // trees (swayed in update)
  const swaySets = [];
  const defs = { oak: oakParts(), conifer: coniferParts(), blossom: blossomParts() };
  for (const sp of Object.keys(defs)) {
    const list = treeInst[sp], d = defs[sp];
    const tint = (it) => _c.setRGB(it.tint * (0.97 + it.hue * 0.06), it.tint, it.tint * (1.03 - it.hue * 0.06));
    const trunk = instMesh(`${sp}-trunk`, d.trunk, texturedToon(d.trunkKind[0], d.trunkKind[1]), list, { outline: d.out, tint });
    const can = instMesh(`${sp}-canopy`, d.canopy, vcToon, list, { outline: d.out, tint });
    if (can) swaySets.push({ meshes: [trunk, can], list, amp: d.sway });
  }
  // bushes
  instMesh('bush', bushGeo(), vcToon, bushes, { outline: 0.03, tint: (it) => _c.setRGB(1 - (it.color || 0) * 0.04, 1, 1 + (it.color || 0) * 0.02) });
  // flowers: four baked colours
  flowers.forEach((list, i) => instMesh(`flower-${i}`, flowerGeo(FLOWER[i], i === 3 ? W.yellow : i === 1 ? W.white : W.yellow), vcToon, list));
  instMesh('tuft', tuftGeo(), vcToon, tufts, { tint: (it, i) => _c.setRGB(0.9 + rnd(i) * 0.2, 0.95 + rnd(i + 1) * 0.1, 0.9 + rnd(i + 2) * 0.1) });
  instMesh('shroom', mushroomGeo(), vcToon, shrooms);
  instMesh('rock', rockGeo(), toonMaterial(W.white), rocks, { outline: 0.09, tint: (it) => _c.set(it.color) });
  instMesh('reed', reedGeo(), vcToon, reeds, { cast: false });
  instMesh('pad', padGeo(), toonMaterial(W.white), pads, { cast: false, tint: (it) => _c.set(it.color) });
  instMesh('lotus', lotusGeo(), vcToon, lotus, { cast: false });

  // lamp glow discs (warm, soft, drawn over the ground)
  if (glows.length) {
    const gg = glows.map(([x, z]) => new THREE.CircleGeometry(1.7, 28).rotateX(-Math.PI / 2).translate(x, 0.07, z));
    const glow = new THREE.Mesh(
      mergeGeometries(gg.map((g) => keepAttrs(g, ['position', 'normal'])), false),
      new THREE.MeshBasicMaterial({ color: PAL.glow, transparent: true, opacity: 0.2, depthWrite: false }),
    );
    glow.renderOrder = 2;
    glow.name = 'props-glow';
    group.add(glow);
  }

  // ---- fountain jet + sparkles ----
  const jet = new THREE.Group();
  jet.position.set(PLAZA.x, 1.73, PLAZA.z);
  {
    const parts = [
      cyl(0.05, 0.09, 0.55, 8).translate(0, 0.27, 0),
      new THREE.IcosahedronGeometry(0.17, 1).translate(0, 0.62, 0),
      ...[0, 1, 2, 3, 4, 5, 6].map((i) => new THREE.IcosahedronGeometry(0.065, 0).translate(Math.cos((i / 7) * 6.283) * 0.4, 0.12 + (i % 2) * 0.1, Math.sin((i / 7) * 6.283) * 0.4)),
    ];
    const jm = new THREE.Mesh(mergeGeometries(parts.map((g) => keepAttrs(g, ['position', 'normal'])), false), toonMaterial(PAL.water));
    addOutline(jm, 0.02);
    jet.add(jm);
    group.add(jet);
  }
  const spark = (() => {
    const mesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.06, 0), new THREE.MeshBasicMaterial({ color: W.white }), 18);
    mesh.frustumCulled = false;
    mesh.name = 'props-sparkle';
    group.add(mesh);
    return mesh;
  })();
  const sparkItem = { x: 0, y: 0, z: 0, s: 1 };

  // ---- butterflies ----
  const bfCfg = [
    { cx: -6.5, cz: 4.6, R: 2.2, w: 0.45, ph: 0, col: W.yellow },
    { cx: 7.2, cz: 6.8, R: 2.6, w: 0.38, ph: 2, col: W.mascot },
    { cx: -15.2, cz: 8.2, R: 1.8, w: 0.5, ph: 4, col: W.white },
  ];
  const bf = new THREE.InstancedMesh(butterflyGeo(), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }), bfCfg.length);
  bfCfg.forEach((b, i) => bf.setColorAt(i, _c.set(b.col)));
  bf.frustumCulled = false;
  bf.name = 'props-butterflies';
  group.add(bf);
  const bfPos = (b, t) => {
    const a = t * b.w + b.ph;
    return [b.cx + Math.sin(a) * b.R + Math.sin(a * 2.7) * 0.5, 1.1 + Math.sin(t * 1.7 + b.ph) * 0.35, b.cz + Math.cos(a * 0.8) * b.R * 0.75];
  };

  // ---- per-frame ----
  const update = (t) => {
    water.update(t);
    jet.scale.set(1, 1 + Math.sin(t * 3) * 0.12, 1);
    jet.position.y = 1.73 + Math.sin(t * 3) * 0.015;
    // sparkles arc out of the jet and fall back into the basin
    for (let i = 0; i < 18; i++) {
      const u = (t * 0.55 + i / 18) % 1;
      const a = i * 2.4 + Math.floor(t * 0.55 + i / 18) * 0.7;
      const rad = 1.35 * u;
      sparkItem.x = PLAZA.x + Math.cos(a) * rad;
      sparkItem.z = PLAZA.z + Math.sin(a) * rad;
      sparkItem.y = 1.75 + 1.7 * u - 2.95 * u * u;
      sparkItem.s = Math.max(0.01, Math.sin(Math.PI * u) ** 0.5 * (0.7 + 0.5 * Math.sin(t * 9 + i * 3)));
      spark.setMatrixAt(i, composeItem(sparkItem, 0, 0));
    }
    spark.instanceMatrix.needsUpdate = true;
    // butterflies: figure-eight drifts, wings flap by squashing x
    bfCfg.forEach((b, i) => {
      const p = bfPos(b, t), q = bfPos(b, t + 0.05);
      const flap = 0.25 + 0.75 * Math.abs(Math.sin(t * 14 + i * 2));
      _mx.compose(_v.set(p[0], p[1], p[2]), _q.setFromEuler(_e.set(0, Math.atan2(q[0] - p[0], q[2] - p[2]), 0)), _s.set(flap, 1, 1));
      bf.setMatrixAt(i, _mx);
    });
    bf.instanceMatrix.needsUpdate = true;
    // gentle tree sway
    for (const set of swaySets) {
      set.list.forEach((it, i) => {
        const gust = Math.sin(t * 0.45 - (it.x + it.z) * 0.07);
        const rx = (Math.sin(t * 0.8 + it.ph) * 0.5 + gust * 0.5) * set.amp * 0.6;
        const rz = (Math.cos(t * 0.65 + it.ph * 1.3) * 0.5 + gust * 0.5) * set.amp;
        composeItem(it, rx, rz);
        for (const m of set.meshes) m.setMatrixAt(i, _mx);
      });
      for (const m of set.meshes) m.instanceMatrix.needsUpdate = true;
    }
  };

  group.userData.stats = { treeCount: Object.values(treeInst).reduce((a, l) => a + l.length, 0) };
  return { group, update, signpost: signOk };
}
