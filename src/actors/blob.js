// Shared "blob species": Randy and the NPC visitors are all built here.
//
// Body    — the mascot silhouette (union of 5 ellipses + 2 lenses, see silhouette.js, 256 smooth
//           samples) as a THREE.Shape → ExtrudeGeometry with a soft 7-segment bevel. A flat
//           cut-out standing vertical, facing the isometric camera (yaw = π/4). A thin vertex-
//           coloured overlay strip hugs the front rim: lighter on the upper petals, deeper on the
//           lower side → soft 2-tone volume. Black inverted-hull outline.
// Face    — two white ellipsoid eyes (flat + hull outline) that blink; black pupils with specular
//           glints that follow the look direction; thin smile + an open happy mouth (wave()).
// Limbs   — black tubes along CatmullRom curves (arm + 3-finger mitten in ONE curve, leg + boat foot
//           in ONE curve). All black parts (limbs, pupils, glints, mouth, glasses…) are merged into a
//           single vertex-coloured SkinnedMesh. Bones: shoulder/elbow, hip/knee/ankle, pupils, mouth.
//           No geometry is ever created in update().
// Shadow  — soft radial-gradient decal on the floor (shadow-map shadow of a cut-out is faint).
// Dust    — one dynamic quad-pool mesh of footfall puffs.
// Extras  — optional accessory (NPCs): one toon vertex-coloured mesh + hull, black bits join the
//           skinned mesh.
//
// Draw calls per character (main pass): body + outline + rim overlay + eyes + eyes outline +
// black skinned mesh + shadow + dust = 8 (+2 with an accessory) ≤ 10.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { toonMesh, toonMaterial, addOutline } from '../kit/toon.js';
import { COLORS } from '../core/tokens.js';
import { sampleSilhouette, svgToBody, REF_FACE, mulberry32 } from './silhouette.js';

// ---------- proportions (world units for a scale-1 blob) ----------
const BODY_H = 1.28; // bbox height of the body cut-out
const BODY_BOTTOM = 0.16; // feet poke ~0.13 below the lowest petal
const BODY_Y = BODY_BOTTOM + BODY_H / 2; // centre of the body
const DEPTH = 0.25 * BODY_H;
const BEVEL = 0.055;
const BEVEL_IN = 0.036; // inset of the flat front face from the nominal outline
const FRONT_Z = DEPTH / 2 + BEVEL; // z of the front face
const BODY_OUTLINE = 0.024;
const EYE_OUTLINE = 0.018;
const EYE_THICK = 0.03;
const ARM_R = 0.022;
const LEG_R = 0.026;
const SMILE_R = 0.015;
const LIMB_Z = FRONT_Z + 0.05;
const DECAL_Y = 0.03; // above the hall's cloud rugs (0.015–0.022)
const R_SEG = 10; // radial segments of the limb tubes

// Screen-space basis of the isometric camera (direction (1,1,1)) expressed in world XZ.
const SCREEN_RIGHT = { x: Math.SQRT1_2, z: -Math.SQRT1_2 };
const SCREEN_UP = { x: -Math.SQRT1_2, z: -Math.SQRT1_2 };

// Bone indices in the black skinned mesh.
const B = {
  root: 0, shoulderL: 1, elbowL: 2, shoulderR: 3, elbowR: 4,
  hipL: 5, kneeL: 6, ankleL: 7, hipR: 8, kneeR: 9, ankleR: 10, pupils: 11, mouth: 12,
};

// ---------- limb design in body units (height = 1, origin = body centre, y up, facing right) ----------
const ARM_R_PTS = [[0.3, 0.03], [0.42, 0.012], [0.51, -0.05], [0.58, -0.115]];
const ARM_L_PTS = [[-0.3, 0.02], [-0.4, -0.04], [-0.5, -0.07], [-0.585, -0.03]];
// Mitten outline in the hand frame (u along the hand, v across): lower palm edge, three fingers
// (rounded lobes of differing length), upper palm edge, back to the wrist.
const MITTEN_SCALE = 0.92;
const MITTEN = [
  [0.0, -0.045], [0.07, -0.068], [0.125, -0.082],
  [0.18, -0.092], [0.215, -0.066], [0.185, -0.036], // finger 1 (short)
  [0.12, -0.03],
  [0.2, -0.026], [0.248, 0.0], [0.2, 0.026], // finger 2 (long)
  [0.12, 0.03],
  [0.175, 0.036], [0.205, 0.066], [0.17, 0.094], // finger 3
  [0.115, 0.086], [0.05, 0.062], [0.0, 0.042],
].map(([u, v]) => [u * MITTEN_SCALE, v * MITTEN_SCALE]);
// Legs: hip → knee → ankle → boat foot loop (heel, long thin sole, pointed up-turned toe, instep) → ankle.
const footLoop = (ax, dir) => [
  [ax + dir * 0.0, -0.545], [ax - dir * 0.035, -0.58], [ax + dir * 0.03, -0.598],
  [ax + dir * 0.13, -0.6], [ax + dir * 0.225, -0.584], [ax + dir * 0.17, -0.564],
  [ax + dir * 0.09, -0.552], [ax + dir * 0.025, -0.53],
];
const LEG_L_PTS = [[-0.05, -0.26], [-0.075, -0.33], [-0.09, -0.4], [-0.085, -0.47], [-0.085, -0.52], ...footLoop(-0.085, -1)];
const LEG_R_PTS = [[0.13, -0.26], [0.15, -0.33], [0.16, -0.4], [0.165, -0.47], [0.17, -0.52], ...footLoop(0.17, 1)];
const KNEE_IDX = 2, ANKLE_IDX = 4;

const bodyToWorld = ([x, y], z = LIMB_Z) => new THREE.Vector3(x * BODY_H, BODY_Y + y * BODY_H, z);

function armCurvePoints(pts) {
  const wrist = pts[pts.length - 1], prev = pts[pts.length - 2];
  let dx = wrist[0] - prev[0], dy = wrist[1] - prev[1];
  const len = Math.hypot(dx, dy); dx /= len; dy /= len;
  const nx = -dy, ny = dx;
  const hand = MITTEN.map(([u, v]) => [wrist[0] + u * dx + v * nx, wrist[1] + u * dy + v * ny]);
  return [...pts, ...hand, wrist].map((p) => bodyToWorld(p));
}

function tube(points, radius, segments, radial = R_SEG) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
  return { geo: new THREE.TubeGeometry(curve, segments, radius, radial, false), curve };
}

// Arc-length fraction along `curve` closest to world point `p` (for skin weights), searching u ≤ umax.
function arcFractionAt(curve, p, umax = 1) {
  let best = 0, bestD = Infinity;
  for (let u = 0; u <= umax; u += 0.002) {
    const d = curve.getPointAt(u).distanceTo(p);
    if (d < bestD) { bestD = d; best = u; }
  }
  return best;
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Assign skin indices/weights. `weightFn(vertexIndex) → [boneA, boneB, wB]`.
function skin(geo, weightFn) {
  const n = geo.attributes.position.count;
  const idx = new Uint16Array(n * 4);
  const w = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const [a, b, wb] = weightFn(i);
    idx[i * 4] = a; idx[i * 4 + 1] = b;
    w[i * 4] = 1 - wb; w[i * 4 + 1] = wb;
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
  return geo;
}

// Flat vertex colour on a whole geometry.
function paint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// Tube vertices come in rings of (radialSegments + 1) along the curve → ring index gives arc fraction.
function tubeFraction(i, radialSegments, tubularSegments) {
  return Math.floor(i / (radialSegments + 1)) / tubularSegments;
}

function hashSeed(seed) {
  if (typeof seed === 'number') return seed;
  let h = 2166136261;
  for (const ch of String(seed ?? '')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

const M4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
const place = (geo, m4) => { geo.applyMatrix4(m4); return geo; };

// ---------- shared textures / materials ----------
let shadowTex = null;
let puffTex = null;
let rimMat = null;
let limbMat = null;
let accMat = null;
let dustMats = null;

function radialTexture(size, stops) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [t, col] of stops) grad.addColorStop(t, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const getShadowTex = () => (shadowTex ??= radialTexture(128, [
  [0, 'rgba(70,40,120,0.34)'], [0.45, 'rgba(70,40,120,0.27)'], [0.75, 'rgba(70,40,120,0.1)'], [1, 'rgba(70,40,120,0)'],
]));
const getPuffTex = () => (puffTex ??= radialTexture(64, [
  [0, 'rgba(255,255,255,1)'], [0.5, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)'],
]));

// ---------- body rim overlay: lighter upper rim, deeper lower rim ----------
function buildRimOverlay(P, base) {
  const n = P.length;
  const lightDir = new THREE.Vector2(0.28, 0.96).normalize();
  const shadeDir = new THREE.Vector2(-0.34, -0.94).normalize();
  const hi = new THREE.Color(base).lerp(new THREE.Color(COLORS.white), 0.42);
  const lo = new THREE.Color(base).multiplyScalar(0.86).lerp(new THREE.Color(COLORS.purple), 0.14);
  const bc = new THREE.Color(base);

  const nrm = P.map((_, i) => {
    const a = P[(i - 1 + n) % n], b = P[(i + 1) % n];
    const tx = b.x - a.x, ty = b.y - a.y, l = Math.hypot(tx, ty) || 1;
    return new THREE.Vector2(ty / l, -tx / l); // CCW polygon → outward = right of travel
  });

  // outward-bulging (convex) vertices only: concave notches would make the inset strip fold over
  const convex = P.map((_, i) => {
    const a = nrm[(i - 1 + n) % n], b = nrm[(i + 1) % n];
    return Math.min(1, Math.max(0, 1 + (a.x * b.y - a.y * b.x) * 14)); // cross>0 ⇒ convex (CCW)
  });
  const blur = (arr, passes) => {
    let cur = arr;
    for (let k = 0; k < passes; k++) {
      cur = cur.map((_, i) => {
        let sum = 0, wsum = 0;
        for (let d = -3; d <= 3; d++) { const w = 4 - Math.abs(d); sum += cur[(i + d + n) % n] * w; wsum += w; }
        return sum / wsum;
      });
    }
    return cur;
  };

  const pos = [], col = [];
  const addRing = (width, dir, ramp, outerCol) => {
    // quads between inset BEVEL_IN and BEVEL_IN + w_i
    const raw = nrm.map((nv, i) => smoothstep(ramp[0], ramp[1], nv.dot(dir)) * (0.35 + 0.65 * convex[i]));
    const wl = blur(raw, 3).map((v) => v * width);
    const outer = [], inner = [];
    for (let i = 0; i < n; i++) {
      outer.push([P[i].x - nrm[i].x * BEVEL_IN, P[i].y - nrm[i].y * BEVEL_IN]);
      inner.push([P[i].x - nrm[i].x * (BEVEL_IN + wl[i]), P[i].y - nrm[i].y * (BEVEL_IN + wl[i])]);
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (wl[i] < 1e-4 && wl[j] < 1e-4) continue;
      const z = FRONT_Z + 0.003;
      const push = (p, c) => { pos.push(p[0], p[1], z); col.push(c.r, c.g, c.b); };
      push(outer[i], outerCol); push(outer[j], outerCol); push(inner[j], bc);
      push(outer[i], outerCol); push(inner[j], bc); push(inner[i], bc);
    }
  };
  addRing(0.07, shadeDir, [0.1, 0.9], lo);
  addRing(0.055, lightDir, [0.15, 0.9], hi);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// ---------- accessories (NPCs) ----------
export const ACCESSORIES = ['straw-hat', 'scarf', 'glasses', 'headphones', 'cap', 'backpack'];

function polyExtent(P, y) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    if ((a.y - y) * (b.y - y) <= 0 && a.y !== b.y) {
      const x = a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
      lo = Math.min(lo, x); hi = Math.max(hi, x);
    }
  }
  return [lo, hi];
}

function buildAccessory(kind, ctx) {
  const { P, eyes, mouth, bodyHex } = ctx;
  const colored = [], black = [];
  const col = (g, hex) => colored.push(paint(g, hex));
  const mix = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
  const accent = bodyHex === COLORS.red ? COLORS.purple : COLORS.red;
  let tip = P[0];
  for (const p of P) if (p.y > tip.y) tip = p;
  const blk = (pts, r, seg = 24, closed = false) => {
    const c = new THREE.CatmullRomCurve3(pts, closed, 'centripetal');
    black.push(new THREE.TubeGeometry(c, seg, r, 8, closed));
  };

  if (kind === 'straw-hat') {
    const straw = mix(COLORS.yellow, COLORS.red, 0.1);
    const y = tip.y - 0.1, x = tip.x + 0.02;
    const grp = (g, ox, oy, oz = 0, sx = 1, sy = 1, sz = 1) => place(g, M4(x + ox, y + oy, oz, 0, 0, 0.14, sx, sy, sz));
    col(grp(new THREE.CylinderGeometry(0.36, 0.36, 0.026, 32), 0, 0, 0, 1, 1, 0.75), straw);
    col(grp(new THREE.CylinderGeometry(0.34, 0.37, 0.012, 32), 0, 0.012, 0, 1, 1, 0.75), mix(straw, COLORS.black, 0.12));
    col(grp(new THREE.CylinderGeometry(0.17, 0.2, 0.16, 28), 0, 0.09), straw);
    col(grp(new THREE.SphereGeometry(0.17, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.17, 0, 1, 0.5, 1), straw);
    col(grp(new THREE.CylinderGeometry(0.205, 0.21, 0.05, 28), 0, 0.045), accent);
  } else if (kind === 'scarf') {
    const [x0, x1] = polyExtent(P, mouth.y - 0.17);
    const y = mouth.y - 0.17;
    const pts = [];
    for (let k = 0; k <= 16; k++) {
      const u = k / 16, e = 2 * u - 1;
      pts.push(new THREE.Vector3(
        THREE.MathUtils.lerp(x0 + 0.02, x1 - 0.02, u),
        y + 0.12 * e * e - 0.02,
        FRONT_Z + 0.04 - 0.34 * Math.abs(e) ** 7,
      ));
    }
    const c = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    col(new THREE.TubeGeometry(c, 40, 0.062, 10, false), accent);
    // stripes
    for (const u of [0.3, 0.7]) {
      const p = c.getPoint(u), t = c.getTangent(u);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), t);
      col(place(new THREE.TorusGeometry(0.064, 0.013, 6, 14), new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1))), COLORS.white);
    }
    const tx = x1 * 0.5;
    col(place(new THREE.BoxGeometry(0.14, 0.34, 0.05), M4(tx, y - 0.22, FRONT_Z + 0.09, 0, 0, 0.12)), accent);
    col(place(new THREE.BoxGeometry(0.145, 0.03, 0.055), M4(tx - 0.03, y - 0.3, FRONT_Z + 0.09, 0, 0, 0.12)), COLORS.white);
    col(place(new THREE.BoxGeometry(0.145, 0.03, 0.055), M4(tx - 0.045, y - 0.18, FRONT_Z + 0.09, 0, 0, 0.12)), COLORS.white);
  } else if (kind === 'glasses') {
    const R = 0.118, z = FRONT_Z + EYE_THICK + 0.012;
    for (const e of eyes) {
      black.push(place(new THREE.TorusGeometry(R, 0.0125, 8, 32), M4(e.x, e.y, z)));
    }
    const [a, b] = eyes[0].x < eyes[1].x ? [eyes[0], eyes[1]] : [eyes[1], eyes[0]];
    blk([new THREE.Vector3(a.x + R, a.y + 0.03, z), new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2 + 0.07, z + 0.01), new THREE.Vector3(b.x - R, b.y + 0.03, z)], 0.011, 14);
    blk([new THREE.Vector3(a.x - R, a.y + 0.03, z), new THREE.Vector3(a.x - R - 0.12, a.y + 0.04, z - 0.1), new THREE.Vector3(a.x - R - 0.2, a.y, z - 0.25)], 0.01, 10);
    blk([new THREE.Vector3(b.x + R, b.y + 0.03, z), new THREE.Vector3(b.x + R + 0.12, b.y + 0.04, z - 0.1), new THREE.Vector3(b.x + R + 0.2, b.y, z - 0.25)], 0.01, 10);
  } else if (kind === 'headphones') {
    const y = tip.y - 0.24;
    const [x0, x1] = polyExtent(P, y);
    const pts = [];
    for (let k = 0; k <= 16; k++) {
      const a = Math.PI * (k / 16);
      pts.push(new THREE.Vector3(
        THREE.MathUtils.lerp((x0 + x1) / 2, x1 + 0.01, 0) + Math.cos(Math.PI - a) * ((x1 - x0) / 2 + 0.035),
        y + Math.sin(a) * (tip.y - y + 0.1),
        0.02,
      ));
    }
    blk(pts, 0.03, 36);
    for (const [x, s] of [[x0 - 0.025, -1], [x1 + 0.025, 1]]) {
      col(place(new THREE.CylinderGeometry(0.1, 0.1, 0.13, 20), M4(x, y, 0.02, Math.PI / 2, 0, 0, 1, 1, 1)), accent);
      col(place(new THREE.CylinderGeometry(0.075, 0.075, 0.14, 20), M4(x + s * 0.012, y, 0.02, Math.PI / 2, 0, 0)), mix(accent, COLORS.black, 0.3));
    }
  } else if (kind === 'cap') {
    const capC = mix(COLORS.purple, COLORS.black, 0.12);
    const base = tip.y - 0.17, x = tip.x;
    col(place(new THREE.SphereGeometry(0.23, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), M4(x, base, 0, 0, 0, 0, 1, 0.85, 0.95)), capC);
    col(place(new THREE.CylinderGeometry(0.235, 0.235, 0.025, 24), M4(x, base, 0, 0, 0, 0, 1, 1, 0.95)), mix(capC, COLORS.black, 0.2));
    col(place(new THREE.CylinderGeometry(0.2, 0.2, 0.022, 24, 1, false, -Math.PI / 2, Math.PI), M4(x + 0.03, base - 0.01, 0.17, 0.12, 0, 0.0, 1, 1, 0.9)), mix(capC, COLORS.black, 0.2));
    // badge with a "</>" glyph, tilted to sit on the dome front
    const th = (50 * Math.PI) / 180;
    const bx = x, by = base + 0.85 * 0.23 * Math.cos(th), bz = 0.95 * 0.23 * Math.sin(th) + 0.012;
    const bm = M4(bx, by, bz, -(Math.PI / 2 - th), 0, 0);
    col(place(new THREE.CircleGeometry(0.082, 24), bm), COLORS.white);
    const glyph = (pts) => {
      const c = new THREE.CatmullRomCurve3(pts.map(([u, v]) => new THREE.Vector3(u, v, 0.006)), false, 'catmullrom', 0);
      black.push(place(new THREE.TubeGeometry(c, 8, 0.0085, 6, false), bm));
    };
    glyph([[-0.024, 0.032], [-0.056, 0], [-0.024, -0.032]]);
    glyph([[0.012, -0.036], [0.026, 0.036]]);
    glyph([[0.034, 0.032], [0.066, 0], [0.034, -0.032]]);
  } else if (kind === 'backpack') {
    const y = BODY_Y - 0.1;
    const [x0] = polyExtent(P, y);
    const pack = COLORS.sage;
    col(place(new RoundedBoxGeometry(0.34, 0.5, 0.26, 3, 0.06), M4(x0 - 0.03, y + 0.02, -0.12)), pack);
    col(place(new RoundedBoxGeometry(0.35, 0.17, 0.27, 3, 0.05), M4(x0 - 0.03, y + 0.19, -0.12)), mix(pack, COLORS.black, 0.18));
    col(place(new RoundedBoxGeometry(0.2, 0.2, 0.08, 3, 0.03), M4(x0 + 0.0, y - 0.1, -0.02)), mix(pack, COLORS.black, 0.1));
    // strap over the shoulder, on the front
    const sx = x0 * 0.5 - 0.02;
    blk([new THREE.Vector3(sx - 0.1, y + 0.4, FRONT_Z + 0.03), new THREE.Vector3(sx - 0.06, y + 0.15, FRONT_Z + 0.035), new THREE.Vector3(x0 + 0.12, y - 0.08, FRONT_Z + 0.02), new THREE.Vector3(x0 + 0.02, y - 0.12, 0.08)], 0.02, 24);
  }
  return { colored, black };
}

/**
 * @param {{ color?: number, seed?: number|string, scale?: number, accessory?: string|null }} opts
 * @returns {{ object3d: THREE.Group, rig: object }}
 */
export function createBlob({ color = COLORS.mascot, seed = 0, scale = 1, accessory = null } = {}) {
  const object3d = new THREE.Group();
  object3d.name = 'blob';
  const rnd = mulberry32(hashSeed(seed) ^ 0x9e3779b9);

  // visual: faces the camera (+X+Z), scale.x flips for left/right facing.
  const visual = new THREE.Group();
  visual.rotation.y = Math.PI / 4;
  // bob: walk bob + breathing/squash scale (feet-anchored).
  const bob = new THREE.Group();
  visual.add(bob);
  object3d.add(visual);

  // ---------- body ----------
  const { points, frame } = sampleSilhouette({ seed: hashSeed(seed) });
  const P = points.map((p) => ({ x: p.x * BODY_H, y: BODY_Y + p.y * BODY_H }));
  const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p.x * BODY_H, p.y * BODY_H)));
  const bodyGeo = new THREE.ExtrudeGeometry(shape, {
    depth: DEPTH,
    steps: 1,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL_IN + 0.006,
    bevelOffset: -BEVEL_IN,
    bevelSegments: 7,
  });
  bodyGeo.translate(0, BODY_Y, -DEPTH / 2);
  bodyGeo.computeVertexNormals();
  const body = toonMesh(bodyGeo, color, { outline: BODY_OUTLINE, cast: true });
  body.name = 'body';
  bob.add(body);

  // soft 2-tone rim overlay
  rimMat ??= new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const rim = new THREE.Mesh(buildRimOverlay(P, color), rimMat);
  rim.name = 'rim';
  rim.castShadow = false;
  rim.raycast = () => {};
  bob.add(rim);

  // ---------- eyes (white, merged) ----------
  const toLocal = (sx, sy) => {
    const p = svgToBody(frame, sx, sy);
    return [p.x * BODY_H, BODY_Y + p.y * BODY_H];
  };
  const eyeInfo = [];
  const eyeGeos = REF_FACE.eyes.map((e) => {
    const [x, y] = toLocal(e.cx, e.cy);
    eyeInfo.push({ x, y });
    const g = new THREE.SphereGeometry(1, 28, 14);
    g.scale((e.rx / frame.h) * BODY_H, (e.ry / frame.h) * BODY_H, EYE_THICK);
    g.rotateZ((e.tiltDeg * Math.PI) / 180);
    g.translate(x, y, FRONT_Z);
    return g;
  });
  const eyes = new THREE.Mesh(mergeGeometries(eyeGeos, false), new THREE.MeshBasicMaterial({ color: COLORS.white }));
  eyes.name = 'eyes';
  eyes.castShadow = false;
  addOutline(eyes, EYE_OUTLINE);
  bob.add(eyes);
  const eyeCY = (eyeInfo[0].y + eyeInfo[1].y) / 2;

  // ---------- black parts → one vertex-coloured skinned mesh ----------
  const parts = [];
  const add = (g, hex, fn) => { paint(g, hex); parts.push(skin(g, fn)); };
  const toBone = (b) => () => [b, b, 0];

  // pupils (bone pupils) + specular glints
  const pupilR = (REF_FACE.pupilR / frame.h) * BODY_H;
  const pupilCentres = REF_FACE.eyes.map((e) => toLocal(e.cx + e.pupil[0], e.cy + e.pupil[1]));
  const pupilsMid = [
    (pupilCentres[0][0] + pupilCentres[1][0]) / 2,
    (pupilCentres[0][1] + pupilCentres[1][1]) / 2,
  ];
  const PZ = FRONT_Z + EYE_THICK + 0.012;
  for (const [x, y] of pupilCentres) {
    add(place(new THREE.CircleGeometry(pupilR, 28), M4(x, y, PZ)), COLORS.black, toBone(B.pupils));
    add(place(new THREE.CircleGeometry(pupilR * 0.34, 14), M4(x - pupilR * 0.3, y + pupilR * 0.34, PZ + 0.004)), COLORS.white, toBone(B.pupils));
    add(place(new THREE.CircleGeometry(pupilR * 0.16, 10), M4(x + pupilR * 0.38, y - pupilR * 0.4, PZ + 0.004)), COLORS.white, toBone(B.pupils));
  }

  // smile + open mouth (bone mouth scales from 0 → 1)
  const smilePts = REF_FACE.smile.map(([sx, sy]) => {
    const [x, y] = toLocal(sx, sy);
    return new THREE.Vector3(x, y, FRONT_Z + 0.02);
  });
  const smileCurve = new THREE.CubicBezierCurve3(...smilePts);
  add(new THREE.TubeGeometry(smileCurve, 20, SMILE_R, 8, false), COLORS.black, toBone(B.root));
  const smileW = smilePts[3].x - smilePts[0].x;
  const MOUTH_DEPTH = 0.095;
  const mouthTop = [];
  for (let k = 0; k <= 14; k++) mouthTop.push(smileCurve.getPoint(k / 14));
  const mouthShape = new THREE.Shape();
  mouthTop.forEach((p, k) => (k ? mouthShape.lineTo(p.x, p.y) : mouthShape.moveTo(p.x, p.y)));
  for (let k = 14; k >= 0; k--) {
    const p = mouthTop[k];
    mouthShape.lineTo(p.x, p.y - MOUTH_DEPTH * Math.pow(Math.sin(Math.PI * (k / 14)), 0.7));
  }
  const mouthY = mouthTop.reduce((s, p) => s + p.y, 0) / mouthTop.length;
  const mouthMid = smileCurve.getPoint(0.5);
  add(place(new THREE.ShapeGeometry(mouthShape, 8), M4(0, 0, FRONT_Z + 0.012 - 0.0)), COLORS.black, toBone(B.mouth));
  const tongue = new THREE.Shape();
  tongue.absellipse(mouthMid.x, mouthMid.y - MOUTH_DEPTH * 0.7, smileW * 0.2, MOUTH_DEPTH * 0.26, 0, Math.PI * 2, false, 0);
  add(place(new THREE.ShapeGeometry(tongue, 14), M4(0, 0, FRONT_Z + 0.016)), new THREE.Color(COLORS.red).lerp(new THREE.Color(COLORS.white), 0.28).getHex(), toBone(B.mouth));

  // arms (shoulder bone → elbow bone, blended around the elbow)
  const ARM_SEG = 140;
  const buildArm = (pts, shoulder, elbow) => {
    const { geo, curve } = tube(armCurvePoints(pts), ARM_R, ARM_SEG);
    const tElbow = arcFractionAt(curve, bodyToWorld(pts[1]), 0.5);
    add(geo, COLORS.black, (i) => {
      const t = tubeFraction(i, R_SEG, ARM_SEG);
      return [shoulder, elbow, smoothstep(tElbow - 0.05, tElbow + 0.05, t)];
    });
  };
  buildArm(ARM_L_PTS, B.shoulderL, B.elbowL);
  buildArm(ARM_R_PTS, B.shoulderR, B.elbowR);

  // legs: hip → knee → ankle (foot rigid on the ankle)
  const LEG_SEG = 110;
  for (const [pts, hip, knee, ankle] of [[LEG_L_PTS, B.hipL, B.kneeL, B.ankleL], [LEG_R_PTS, B.hipR, B.kneeR, B.ankleR]]) {
    const { geo, curve } = tube(pts.map((p) => bodyToWorld(p)), LEG_R, LEG_SEG);
    const tKnee = arcFractionAt(curve, bodyToWorld(pts[KNEE_IDX]), 0.5);
    const tAnkle = arcFractionAt(curve, bodyToWorld(pts[ANKLE_IDX]), 0.5);
    add(geo, COLORS.black, (i) => {
      const t = tubeFraction(i, R_SEG, LEG_SEG);
      if (t < tKnee + 0.05) return [hip, knee, smoothstep(tKnee - 0.05, tKnee + 0.05, t)];
      return [knee, ankle, smoothstep(tAnkle - 0.035, tAnkle + 0.035, t)];
    });
  }

  // accessory
  let accMesh = null;
  if (accessory) {
    const { colored, black } = buildAccessory(accessory, {
      P, eyes: eyeInfo, mouth: { x: mouthMid.x, y: mouthY }, bodyHex: color,
    });
    black.forEach((g) => add(g, COLORS.black, toBone(B.root)));
    if (colored.length) {
      accMat ??= (() => { const m = toonMaterial(0xffffff).clone(); m.vertexColors = true; return m; })();
      const merged = mergeGeometries(colored, false);
      colored.forEach((g) => g.dispose());
      accMesh = new THREE.Mesh(merged, accMat);
      accMesh.name = `accessory-${accessory}`;
      accMesh.castShadow = true;
      addOutline(accMesh, 0.013);
      bob.add(accMesh);
    }
  }

  const blackGeo = mergeGeometries(parts, false);
  blackGeo.computeBoundingSphere();
  parts.forEach((g) => g.dispose());

  // bones
  const mkBone = (name, pos, parent) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.copy(pos);
    if (parent) {
      parent.updateMatrixWorld(true);
      b.position.sub(parent.getWorldPosition(new THREE.Vector3()));
      parent.add(b);
    }
    return b;
  };
  const root = mkBone('root', new THREE.Vector3());
  const shoulderL = mkBone('shoulderL', bodyToWorld(ARM_L_PTS[0]), root);
  const elbowL = mkBone('elbowL', bodyToWorld(ARM_L_PTS[1]), shoulderL);
  const shoulderR = mkBone('shoulderR', bodyToWorld(ARM_R_PTS[0]), root);
  const elbowR = mkBone('elbowR', bodyToWorld(ARM_R_PTS[1]), shoulderR);
  const hipL = mkBone('hipL', bodyToWorld(LEG_L_PTS[0]), root);
  const kneeL = mkBone('kneeL', bodyToWorld(LEG_L_PTS[KNEE_IDX]), hipL);
  const ankleL = mkBone('ankleL', bodyToWorld(LEG_L_PTS[ANKLE_IDX]), kneeL);
  const hipR = mkBone('hipR', bodyToWorld(LEG_R_PTS[0]), root);
  const kneeR = mkBone('kneeR', bodyToWorld(LEG_R_PTS[KNEE_IDX]), hipR);
  const ankleR = mkBone('ankleR', bodyToWorld(LEG_R_PTS[ANKLE_IDX]), kneeR);
  const pupils = mkBone('pupils', new THREE.Vector3(pupilsMid[0], pupilsMid[1], 0), root);
  const mouthBone = mkBone('mouth', new THREE.Vector3(mouthMid.x, mouthY, 0), root);
  const bones = [root, shoulderL, elbowL, shoulderR, elbowR, hipL, kneeL, ankleL, hipR, kneeR, ankleR, pupils, mouthBone];

  limbMat ??= new THREE.MeshBasicMaterial({ vertexColors: true });
  const black = new THREE.SkinnedMesh(blackGeo, limbMat);
  black.name = 'limbs';
  black.castShadow = true;
  black.frustumCulled = false;
  black.add(root);
  black.updateMatrixWorld(true);
  black.bind(new THREE.Skeleton(bones), new THREE.Matrix4());
  bob.add(black);
  mouthBone.scale.set(1, 0.001, 1);

  // ---------- soft floor shadow decal ----------
  const shadowRoot = new THREE.Group();
  shadowRoot.rotation.y = Math.PI / 4;
  const decalGeo = new THREE.PlaneGeometry(2, 2);
  decalGeo.rotateX(-Math.PI / 2);
  const stex = getShadowTex();
  const decalMat = new THREE.MeshBasicMaterial(stex
    ? { map: stex, transparent: true, depthWrite: false }
    : { color: COLORS.shadow, transparent: true, opacity: 0.5, depthWrite: false });
  const decal = new THREE.Mesh(decalGeo, decalMat);
  decal.name = 'shadow';
  const SH = { x: 0.8, z: 0.45 };
  decal.scale.set(SH.x, 1, SH.z);
  decal.position.set(-0.08, DECAL_Y, 0.08); // like the mascot's down-left drop shadow
  decal.renderOrder = -1;
  decal.castShadow = false;
  decal.receiveShadow = false;
  decal.raycast = () => {};
  shadowRoot.add(decal);
  object3d.add(shadowRoot);

  // ---------- dust puffs (one dynamic mesh, pooled quads) ----------
  const N_PUFF = 6;
  const dustGeo = new THREE.BufferGeometry();
  const dPos = new Float32Array(N_PUFF * 12);
  const dCol = new Float32Array(N_PUFF * 16);
  const dUv = new Float32Array(N_PUFF * 8);
  const dIdx = [];
  for (let i = 0; i < N_PUFF; i++) {
    dUv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
    dIdx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3).setUsage(THREE.DynamicDrawUsage));
  dustGeo.setAttribute('color', new THREE.BufferAttribute(dCol, 4).setUsage(THREE.DynamicDrawUsage));
  dustGeo.setAttribute('uv', new THREE.BufferAttribute(dUv, 2));
  dustGeo.setIndex(dIdx);
  const ptex = getPuffTex();
  dustMats ??= new THREE.MeshBasicMaterial(ptex
    ? { map: ptex, vertexColors: true, transparent: true, depthWrite: false }
    : { vertexColors: true, transparent: true, depthWrite: false });
  const dust = new THREE.Mesh(dustGeo, dustMats);
  dust.name = 'dust';
  dust.frustumCulled = false;
  dust.castShadow = false;
  dust.renderOrder = 2;
  dust.raycast = () => {};
  object3d.add(dust);
  const dustTint = new THREE.Color(COLORS.lavender).lerp(new THREE.Color(COLORS.white), 0.55);
  const puffs = Array.from({ length: N_PUFF }, () => ({ age: 1, life: 0.5, x: 0, z: 0, size: 0.1 }));
  let puffNext = 0;
  const spawnPuff = (wx, wz, size) => {
    const p = puffs[puffNext];
    puffNext = (puffNext + 1) % N_PUFF;
    p.age = 0; p.life = 0.42 + 0.16 * Math.random(); p.x = wx; p.z = wz; p.size = size;
  };
  // camera-aligned billboard basis in world space
  const BR = new THREE.Vector3(SCREEN_RIGHT.x, 0, SCREEN_RIGHT.z);
  const BU = new THREE.Vector3(-1, 2, -1).normalize();

  function updateDust(dt) {
    const sc = object3d.scale.x || 1;
    for (let i = 0; i < N_PUFF; i++) {
      const p = puffs[i];
      p.age += dt;
      const u = Math.min(1, p.age / p.life);
      const alive = u < 1;
      const r = alive ? p.size * (0.5 + 0.9 * (1 - (1 - u) * (1 - u))) / sc : 0;
      const a = alive ? 0.55 * (1 - u) * Math.min(1, u * 8) : 0;
      const cx = (p.x - object3d.position.x) / sc;
      const cz = (p.z - object3d.position.z) / sc;
      const cy = (DECAL_Y + 0.05 + p.size * 0.5 + 0.12 * u) / sc;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (let k = 0; k < 4; k++) {
        const [a1, b1] = corners[k];
        const o = (i * 4 + k) * 3;
        dPos[o] = cx + (BR.x * a1 + BU.x * b1) * r;
        dPos[o + 1] = cy + (BU.y * b1) * r;
        dPos[o + 2] = cz + (BR.z * a1 + BU.z * b1) * r;
        const c = (i * 4 + k) * 4;
        dCol[c] = dustTint.r; dCol[c + 1] = dustTint.g; dCol[c + 2] = dustTint.b; dCol[c + 3] = a;
      }
    }
    dustGeo.attributes.position.needsUpdate = true;
    dustGeo.attributes.color.needsUpdate = true;
  }
  updateDust(0);

  object3d.scale.setScalar(scale);

  // ---------- rig / animation ----------
  const pupilRest = pupils.position.clone();
  const state = {
    t: 0,
    phase: 0,
    step: 0,
    land: 0,
    walk: 0, // 0..1 walk blend
    facing: 1,
    facingTarget: 1,
    look: new THREE.Vector2(), // local look direction (x forward, y up), eased
    lookTarget: new THREE.Vector2(),
    idleLook: null, // external look request while idle (NPC pause)
    waveT: 0,
    mouth: 0,
    blinkIn: 1.5 + rnd() * 2.5,
    blinkT: -1,
    blinkTwice: false,
    glanceIn: 2 + rnd() * 3,
    glanceFor: 0,
    glance: new THREE.Vector2(),
    breathPh: rnd() * 6.28,
  };

  const rig = {
    visual, bob, body, eyes, black, rim, dust, accessory: accMesh,
    bones: { root, shoulderL, elbowL, shoulderR, elbowR, hipL, kneeL, ankleL, hipR, kneeR, ankleR, pupils, mouth: mouthBone },
    height: BODY_BOTTOM + BODY_H,

    /** Flip the cut-out to face screen-left (-1) or screen-right (+1). */
    setFacing(dir) { state.facingTarget = dir < 0 ? -1 : 1; },

    /** Look toward a screen-space direction while idle (x right, y up); null = straight ahead. */
    setLook(sx, sy) { state.idleLook = sx == null ? null : new THREE.Vector2(sx, sy); },

    /** Face and look toward a world point (used by NPCs at a pause). */
    lookAtWorld(wx, wz) {
      const dx = wx - object3d.position.x, dz = wz - object3d.position.z;
      const sx = dx * SCREEN_RIGHT.x + dz * SCREEN_RIGHT.z;
      const sy = dx * SCREEN_UP.x + dz * SCREEN_UP.z;
      const len = Math.hypot(sx, sy) || 1;
      if (Math.abs(sx) > 0.3) rig.setFacing(sx);
      rig.setLook(sx / len, sy / len);
    },

    wave() { state.waveT = 1.2; },

    /** Advance the animation. vx/vz = world velocity (the caller moves object3d.position). */
    update(dt, vx = 0, vz = 0) {
      const s = state;
      s.t += dt;
      const speed = Math.hypot(vx, vz);
      const moving = speed > 0.05;

      // screen-space velocity → facing + look
      const sx = vx * SCREEN_RIGHT.x + vz * SCREEN_RIGHT.z;
      const sy = vx * SCREEN_UP.x + vz * SCREEN_UP.z;

      // occasional glance while idle
      if (!moving && !s.idleLook) {
        if (s.glanceFor > 0) {
          s.glanceFor -= dt;
        } else {
          s.glance.set(0, 0);
          s.glanceIn -= dt;
          if (s.glanceIn <= 0) {
            s.glanceIn = 2.5 + rnd() * 4;
            s.glanceFor = 0.7 + rnd() * 0.9;
            s.glance.set(rnd() < 0.5 ? -1 : 1, (rnd() - 0.4) * 0.8);
            if (rnd() < 0.3) s.glance.x *= 0.5;
          }
        }
      } else {
        s.glance.set(0, 0);
        s.glanceFor = 0;
      }

      if (moving) {
        if (sx > 0.12 * speed) s.facingTarget = 1;
        else if (sx < -0.12 * speed) s.facingTarget = -1;
        s.lookTarget.set(Math.abs(sx) / speed, sy / speed);
      } else if (s.idleLook) {
        s.lookTarget.set(Math.abs(s.idleLook.x), s.idleLook.y);
      } else {
        s.lookTarget.copy(s.glance);
      }
      const k = 1 - Math.exp(-dt * 12);
      s.look.lerp(s.lookTarget, k);
      s.facing += (s.facingTarget - s.facing) * (1 - Math.exp(-dt * 14));
      const fx = Math.abs(s.facing) < 0.06 ? (s.facing < 0 ? -0.06 : 0.06) : s.facing;
      visual.scale.x = fx;

      // walk blend + stride phase
      s.walk += ((moving ? 1 : 0) - s.walk) * (1 - Math.exp(-dt * 9));
      if (moving) s.phase += dt * (2.4 * speed + 4);
      else s.phase += dt * 4 * s.walk; // let a half-finished step settle
      const w = s.walk;
      const ph = s.phase;

      // footfall: legs at their widest spread (phase = π/2 + kπ) → squash + dust
      const stepIdx = Math.floor((ph + Math.PI / 2) / Math.PI);
      if (stepIdx !== s.step) {
        s.step = stepIdx;
        if (moving && w > 0.5) {
          s.land = 1;
          const inv = 1 / (speed || 1);
          const bx = object3d.position.x - vx * inv * 0.2 * scale + (Math.random() - 0.5) * 0.08;
          const bz = object3d.position.z - vz * inv * 0.2 * scale + (Math.random() - 0.5) * 0.08;
          spawnPuff(bx, bz, (0.07 + Math.random() * 0.03) * scale);
        }
      }
      s.land *= Math.exp(-dt * 11);

      // body: breathing + bob + squash/stretch + lean
      const breath = Math.sin(s.t * 2.1 + s.breathPh) * 0.022 * (1 - 0.6 * w);
      const q = Math.cos(2 * ph); // +1 legs together (up/stretch), −1 spread (down/squash)
      const sy1 = 1 + breath + w * (0.028 * q - 0.06 * s.land);
      bob.scale.set(1 - (sy1 - 1) * 0.7, sy1, 1);
      bob.position.y = 0.05 * w * (0.5 + 0.5 * q);
      visual.rotation.z = -0.06 * w * s.facing;
      const lift = bob.position.y;
      const dscale = 1 - 0.18 * (lift / 0.05) * w;
      decal.scale.set(SH.x * dscale, 1, SH.z * dscale);
      decal.material.opacity = stex ? 1 - 0.25 * (lift / 0.05) * w : 0.5;

      // legs: scissor + knee flex on the swing + heel-toe foot roll
      const leg = (hip, knee, ankle, p, toeSign) => {
        const sn = Math.sin(p), cs = Math.cos(p);
        const hr = 0.52 * w * sn;
        const kr = -(0.95 * Math.max(0, cs) ** 1.1 + 0.06) * w;
        const pitch = (sn > 0 ? 0.38 : 0.55) * sn * w; // toe up at heel-strike, toe down at push-off
        hip.rotation.z = hr;
        knee.rotation.z = kr;
        ankle.rotation.z = toeSign * pitch - hr - kr;
      };
      leg(hipL, kneeL, ankleL, ph, -1);
      leg(hipR, kneeR, ankleR, ph + Math.PI, 1);

      // arms: swing opposite the legs (+x arm raises on +z, −x arm lowers → opposite pump),
      // drooping while walking, forearm lagging behind
      const sin = Math.sin(ph);
      const sway = 0.06 * Math.sin(s.t * 1.7);
      let armL = sway + 0.3 * w * sin + 0.26 * w;
      let armR = -sway * 0.8 + 0.3 * w * sin - 0.26 * w;
      let foreL = 0.04 * Math.sin(s.t * 1.7 + 1.2) + 0.22 * w * Math.sin(ph - 1.0);
      let foreR = 0.04 * Math.sin(s.t * 1.7 + 2.1) + 0.22 * w * Math.sin(ph - 1.0);

      // wave: right arm up, forearm flapping, happy open mouth
      let mouthTarget = 0;
      if (s.waveT > 0) {
        s.waveT = Math.max(0, s.waveT - dt);
        const el = 1.2 - s.waveT;
        const amt = smoothstep(0, 0.18, el) * (1 - smoothstep(0.95, 1.2, el));
        armR = armR * (1 - amt) + 1.5 * amt;
        foreR = foreR * (1 - amt) + 0.5 * Math.sin(s.t * 18) * amt;
        mouthTarget = smoothstep(0, 0.12, el) * (1 - smoothstep(1.0, 1.2, el));
      }
      s.mouth += (mouthTarget - s.mouth) * (1 - Math.exp(-dt * 16));
      mouthBone.scale.set(1 + 0.08 * s.mouth, Math.max(0.001, s.mouth), 1);
      shoulderL.rotation.z = armL;
      shoulderR.rotation.z = armR;
      elbowL.rotation.z = foreL;
      elbowR.rotation.z = foreR;

      // blink (eyes + pupils squash about the eye line)
      let open = 1;
      if (s.blinkT >= 0) {
        s.blinkT += dt;
        const u = s.blinkT / 0.17;
        if (u >= 1) {
          s.blinkT = -1;
          if (s.blinkTwice) { s.blinkTwice = false; s.blinkIn = 0.12; } else s.blinkIn = 2.2 + rnd() * 3.6;
        } else {
          open = 1 - 0.93 * Math.sin(Math.PI * u);
        }
      } else {
        s.blinkIn -= dt;
        if (s.blinkIn <= 0) { s.blinkT = 0; s.blinkTwice = rnd() < 0.22; }
      }
      eyes.scale.y = open;
      eyes.position.y = eyeCY * (1 - open);

      // pupils drift toward the look direction; they follow the blink squash
      pupils.scale.y = open;
      pupils.position.set(
        pupilRest.x + s.look.x * 0.034,
        pupilRest.y + s.look.y * 0.026 + (1 - open) * (eyeCY - pupilRest.y),
        0,
      );

      updateDust(dt);
    },
  };

  return { object3d, rig };
}
