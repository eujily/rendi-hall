// Shared "blob species": Randy and the NPC visitors are all built here.
//
// Body   — the mascot silhouette (union of 5 ellipses + 2 lenses, see silhouette.js) as a
//          THREE.Shape → ExtrudeGeometry with a soft bevel, depth ≈ 0.25 of the height.
//          A flat cut-out standing vertical, facing the isometric camera (yaw = π/4).
// Face   — two white ellipsoid eyes (flat material + black hull outline), black pupils and
//          a thin black smile tube.
// Limbs  — black tubes along CatmullRom curves (arm + mitten hand in ONE curve, leg + boat
//          foot in ONE curve). All black parts (limbs, smile, pupils) are merged into a single
//          SkinnedMesh with rigid-ish bones; animation rotates the bones (shoulders, elbows,
//          hips) and translates the pupil bone. No geometry is ever created in update().
// Shadow — flat ellipse decal in COLORS.shadow on the floor (the shadow-map shadow of a thin
//          cut-out is barely visible); the body still casts a real shadow.
//
// Draw calls per character (main pass): body + body outline + eyes + eyes outline +
// black skinned mesh + shadow decal = 6.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMesh, flatMaterial, addOutline } from '../kit/toon.js';
import { COLORS } from '../core/tokens.js';
import { sampleSilhouette, svgToBody, REF_FACE } from './silhouette.js';

// ---------- proportions (world units for a scale-1 blob) ----------
const BODY_H = 1.28; // bbox height of the body cut-out
const BODY_BOTTOM = 0.16; // feet poke ~0.13 below the lowest petal
const BODY_Y = BODY_BOTTOM + BODY_H / 2; // centre of the body
const DEPTH = 0.25 * BODY_H;
const BEVEL = 0.05;
const FRONT_Z = DEPTH / 2 + BEVEL; // z of the front face
const BODY_OUTLINE = 0.025; // the 2D mascot has no body stroke; keep it thin
const EYE_OUTLINE = 0.018;
const EYE_THICK = 0.03;
const ARM_R = 0.024;
const LEG_R = 0.028;
const SMILE_R = 0.016;
const LIMB_Z = FRONT_Z + 0.05;
const DECAL_Y = 0.03; // above the hall's cloud rugs (0.015–0.022)

// Screen-space basis of the isometric camera (direction (1,1,1)) expressed in world XZ.
const SCREEN_RIGHT = { x: Math.SQRT1_2, z: -Math.SQRT1_2 };
const SCREEN_UP = { x: -Math.SQRT1_2, z: -Math.SQRT1_2 };

// Bone indices in the black skinned mesh.
const B = { root: 0, shoulderL: 1, elbowL: 2, shoulderR: 3, elbowR: 4, hipL: 5, hipR: 6, pupils: 7 };

// ---------- limb design in body units (height = 1, origin = body centre, y up, facing right) ----------
// Arms: shoulder → elbow → … → wrist, then the mitten loop drawn in the hand's own frame.
const ARM_R_PTS = [[0.3, 0.03], [0.42, 0.01], [0.51, -0.05], [0.57, -0.11]];
const ARM_L_PTS = [[-0.3, 0.02], [-0.4, -0.04], [-0.5, -0.07], [-0.58, -0.03]];
// Mitten outline (x along the hand direction, y across): palm, three finger loops, back.
const MITTEN = [
  [0, -0.035], [0.05, -0.045], [0.09, -0.04],
  [0.13, -0.058], [0.165, -0.04], [0.125, -0.015], // finger 1
  [0.16, 0.002], [0.17, 0.03], [0.125, 0.022], // finger 2
  [0.15, 0.052], [0.135, 0.075], [0.09, 0.048], // finger 3
  [0.05, 0.047], [0, 0.035],
];
// Legs: hip → knee → ankle → boat foot loop → ankle.
const LEG_L_PTS = [[-0.05, -0.26], [-0.09, -0.4], [-0.08, -0.52], [-0.14, -0.555], [-0.24, -0.575], [-0.17, -0.6], [-0.03, -0.585], [-0.07, -0.535]];
const LEG_R_PTS = [[0.13, -0.26], [0.16, -0.4], [0.17, -0.52], [0.23, -0.555], [0.33, -0.575], [0.26, -0.6], [0.12, -0.585], [0.17, -0.535]];

const bodyToWorld = ([x, y], z = LIMB_Z) => new THREE.Vector3(x * BODY_H, BODY_Y + y * BODY_H, z);

function armCurvePoints(pts) {
  const wrist = pts[pts.length - 1], prev = pts[pts.length - 2];
  let dx = wrist[0] - prev[0], dy = wrist[1] - prev[1];
  const len = Math.hypot(dx, dy); dx /= len; dy /= len;
  const nx = -dy, ny = dx;
  const hand = MITTEN.map(([u, v]) => [wrist[0] + u * dx + v * nx, wrist[1] + u * dy + v * ny]);
  return [...pts, ...hand, wrist].map((p) => bodyToWorld(p));
}

function tube(points, radius, segments) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
  return { geo: new THREE.TubeGeometry(curve, segments, radius, 7, false), curve };
}

// Arc-length fraction along `curve` closest to world point `p` (for skin weights).
function arcFractionAt(curve, p) {
  let best = 0, bestD = Infinity;
  for (let u = 0; u <= 1; u += 0.005) {
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

/**
 * @param {{ color?: number, seed?: number|string, scale?: number }} opts
 * @returns {{ object3d: THREE.Group, rig: object }}
 */
export function createBlob({ color = COLORS.mascot, seed = 0, scale = 1 } = {}) {
  const object3d = new THREE.Group();
  object3d.name = 'blob';

  // visual: faces the camera (+X+Z), scale.x flips for left/right facing.
  const visual = new THREE.Group();
  visual.rotation.y = Math.PI / 4;
  // bob: walk bob + breathing scale (feet-anchored).
  const bob = new THREE.Group();
  visual.add(bob);
  object3d.add(visual);

  // ---------- body ----------
  const { points, frame } = sampleSilhouette({ seed: hashSeed(seed) });
  const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p.x * BODY_H, p.y * BODY_H)));
  const bodyGeo = new THREE.ExtrudeGeometry(shape, {
    depth: DEPTH,
    steps: 1,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: 0.04,
    bevelOffset: -0.035,
    bevelSegments: 4,
  });
  bodyGeo.translate(0, BODY_Y, -DEPTH / 2);
  bodyGeo.computeVertexNormals();
  const body = toonMesh(bodyGeo, color, { outline: BODY_OUTLINE, cast: true });
  body.name = 'body';
  bob.add(body);

  // ---------- eyes (white, merged) ----------
  const toLocal = (sx, sy) => {
    const p = svgToBody(frame, sx, sy);
    return [p.x * BODY_H, BODY_Y + p.y * BODY_H];
  };
  const eyeGeos = REF_FACE.eyes.map((e) => {
    const [x, y] = toLocal(e.cx, e.cy);
    const g = new THREE.SphereGeometry(1, 24, 12);
    g.scale((e.rx / frame.h) * BODY_H, (e.ry / frame.h) * BODY_H, EYE_THICK);
    g.rotateZ((e.tiltDeg * Math.PI) / 180);
    g.translate(x, y, FRONT_Z);
    return g;
  });
  const eyes = new THREE.Mesh(mergeGeometries(eyeGeos, false), flatMaterial(COLORS.white));
  eyes.name = 'eyes';
  eyes.castShadow = false;
  addOutline(eyes, EYE_OUTLINE);
  bob.add(eyes);

  // ---------- black parts → one skinned mesh ----------
  const parts = [];

  // pupils (bone 7)
  const pupilR = (REF_FACE.pupilR / frame.h) * BODY_H;
  const pupilCentres = REF_FACE.eyes.map((e) => toLocal(e.cx + e.pupil[0], e.cy + e.pupil[1]));
  const pupilsMid = [
    (pupilCentres[0][0] + pupilCentres[1][0]) / 2,
    (pupilCentres[0][1] + pupilCentres[1][1]) / 2,
  ];
  for (const [x, y] of pupilCentres) {
    const g = new THREE.CircleGeometry(pupilR, 20);
    g.translate(x, y, FRONT_Z + EYE_THICK + 0.012);
    parts.push(skin(g, () => [B.pupils, B.pupils, 0]));
  }

  // smile (bone 0)
  const smilePts = REF_FACE.smile.map(([sx, sy]) => {
    const [x, y] = toLocal(sx, sy);
    return new THREE.Vector3(x, y, FRONT_Z + 0.02);
  });
  const smileCurve = new THREE.CubicBezierCurve3(...smilePts);
  parts.push(skin(new THREE.TubeGeometry(smileCurve, 12, SMILE_R, 6, false), () => [B.root, B.root, 0]));

  // arms (shoulder bone → elbow bone, blended around the elbow)
  const ARM_SEG = 72;
  const buildArm = (pts, shoulder, elbow) => {
    const { geo, curve } = tube(armCurvePoints(pts), ARM_R, ARM_SEG);
    const tElbow = arcFractionAt(curve, bodyToWorld(pts[1]));
    parts.push(skin(geo, (i) => {
      const t = tubeFraction(i, 7, ARM_SEG);
      return [shoulder, elbow, smoothstep(tElbow - 0.05, tElbow + 0.05, t)];
    }));
  };
  buildArm(ARM_L_PTS, B.shoulderL, B.elbowL);
  buildArm(ARM_R_PTS, B.shoulderR, B.elbowR);

  // legs (rigid on the hip bone)
  const LEG_SEG = 48;
  for (const [pts, bone] of [[LEG_L_PTS, B.hipL], [LEG_R_PTS, B.hipR]]) {
    const { geo } = tube(pts.map((p) => bodyToWorld(p)), LEG_R, LEG_SEG);
    parts.push(skin(geo, () => [bone, bone, 0]));
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
  const hipR = mkBone('hipR', bodyToWorld(LEG_R_PTS[0]), root);
  const pupils = mkBone('pupils', new THREE.Vector3(pupilsMid[0], pupilsMid[1], 0), root);
  const bones = [root, shoulderL, elbowL, shoulderR, elbowR, hipL, hipR, pupils];

  const black = new THREE.SkinnedMesh(blackGeo, flatMaterial(COLORS.black));
  black.name = 'limbs';
  black.castShadow = true;
  black.frustumCulled = false;
  black.add(root);
  black.updateMatrixWorld(true);
  black.bind(new THREE.Skeleton(bones), new THREE.Matrix4());
  bob.add(black);

  // ---------- floor shadow decal ----------
  const shadowRoot = new THREE.Group();
  shadowRoot.rotation.y = Math.PI / 4;
  const decalGeo = new THREE.CircleGeometry(1, 32);
  decalGeo.rotateX(-Math.PI / 2);
  const decal = new THREE.Mesh(decalGeo, flatMaterial(COLORS.shadow));
  decal.name = 'shadow';
  decal.scale.set(0.5, 1, 0.26);
  decal.position.set(-0.06, DECAL_Y, 0.06); // like the mascot's down-left drop shadow
  decal.castShadow = false;
  decal.receiveShadow = false;
  decal.raycast = () => {};
  shadowRoot.add(decal);
  object3d.add(shadowRoot);

  object3d.scale.setScalar(scale);

  // ---------- rig / animation ----------
  const pupilRest = pupils.position.clone();
  const state = {
    t: 0,
    phase: 0,
    walk: 0, // 0..1 walk blend
    facing: 1,
    facingTarget: 1,
    look: new THREE.Vector2(), // screen-space look direction (x right, y up), eased
    lookTarget: new THREE.Vector2(),
    idleLook: null, // external look request while idle (NPC pause)
    waveT: 0,
  };

  const rig = {
    visual, bob, body, eyes, black, bones: { root, shoulderL, elbowL, shoulderR, elbowR, hipL, hipR, pupils },
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
      if (moving) {
        if (sx > 0.12 * speed) s.facingTarget = 1;
        else if (sx < -0.12 * speed) s.facingTarget = -1;
        s.lookTarget.set(Math.abs(sx) / speed, sy / speed);
      } else if (s.idleLook) {
        s.lookTarget.set(Math.abs(s.idleLook.x), s.idleLook.y);
      } else {
        s.lookTarget.set(0, 0);
      }
      const k = 1 - Math.exp(-dt * 10);
      s.look.lerp(s.lookTarget, k);
      s.facing += (s.facingTarget - s.facing) * (1 - Math.exp(-dt * 14));
      const fx = Math.abs(s.facing) < 0.06 ? (s.facing < 0 ? -0.06 : 0.06) : s.facing;
      visual.scale.x = fx;

      // walk blend + stride phase
      s.walk += ((moving ? 1 : 0) - s.walk) * (1 - Math.exp(-dt * 9));
      if (moving) s.phase += dt * (2.4 * speed + 4);
      else s.phase += dt * 4 * s.walk; // let a half-finished step settle
      const w = s.walk;
      const sin = Math.sin(s.phase);

      // body: breathing + bob + lean
      const breath = Math.sin(s.t * 2.2) * 0.02;
      bob.scale.set(1 - breath * 0.6, 1 + breath, 1);
      bob.position.y = 0.06 * w * (0.5 - 0.5 * Math.cos(2 * s.phase));
      visual.rotation.z = -0.05 * w;

      // legs scissor in the body plane
      hipL.rotation.z = 0.45 * w * sin;
      hipR.rotation.z = -0.45 * w * sin;

      // arms: idle sway + walk pump (+x arm rotates up on +z, -x arm rotates down → opposite pump)
      const sway = 0.06 * Math.sin(s.t * 1.7);
      let armL = sway + 0.32 * w * sin;
      let armR = -sway * 0.8 + 0.32 * w * sin;
      let foreL = 0.04 * Math.sin(s.t * 1.7 + 1.2);
      let foreR = 0.04 * Math.sin(s.t * 1.7 + 2.1);

      // wave: right arm up, forearm flapping
      if (s.waveT > 0) {
        s.waveT = Math.max(0, s.waveT - dt);
        const el = 1.2 - s.waveT;
        const amt = smoothstep(0, 0.18, el) * (1 - smoothstep(0.95, 1.2, el));
        armR = armR * (1 - amt) + 1.5 * amt;
        foreR = foreR * (1 - amt) + 0.5 * Math.sin(s.t * 18) * amt;
      }
      shoulderL.rotation.z = armL;
      shoulderR.rotation.z = armR;
      elbowL.rotation.z = foreL;
      elbowR.rotation.z = foreR;

      // pupils drift toward the movement / look direction
      pupils.position.set(pupilRest.x + s.look.x * 0.032, pupilRest.y + s.look.y * 0.022, 0);
    },
  };

  return { object3d, rig };
}
