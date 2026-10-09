// Rendi Care — a terracotta pot on a grass patch; a seedling grows into a red flower when you come
// near (a watering can tips over it), butterflies flutter, a little sun spins. Focused: hearts.
// Diorama only: origin = bottom-centre, front = +Z, fits |x|<=1.7, 0<=y<=2.4, |z|<=0.9.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMesh, flatMaterial } from '../kit/toon.js';
import { COLORS, mix } from '../core/tokens.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const seg = (x, a, b) => clamp01((x - a) / (b - a));
const smooth = (x) => x * x * (3 - 2 * x);
const backOut = (x) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;
const approach = (v, to, dt, rate) => v + (to - v) * (1 - Math.exp(-rate * dt));
const YAW = THREE.MathUtils.degToRad(15);

// Bake [geometry, position, eulerXYZ, scale] parts into one non-indexed geometry (one draw call).
function merged(parts) {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  return mergeGeometries(
    parts.map(([geo, pos = [0, 0, 0], rot = [0, 0, 0], scale = 1]) => {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      q.setFromEuler(new THREE.Euler(...rot));
      typeof scale === 'number' ? s.setScalar(scale) : s.set(...scale);
      return g.applyMatrix4(m.compose(p.set(...pos), q, s));
    }),
    false,
  );
}

// Pointed oval blade lying flat in XZ, base at the origin, tip at +X.
function bladeGeometry(len, half, thick) {
  const sh = new THREE.Shape();
  sh.moveTo(0, 0);
  sh.quadraticCurveTo(len * 0.5, half * 2, len, 0);
  sh.quadraticCurveTo(len * 0.5, -half * 2, 0, 0);
  const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -thick / 2);
  g.rotateX(-Math.PI / 2);
  return g;
}

function heartGeometry(size, thick) {
  const s = new THREE.Shape();
  s.moveTo(0, 0.35);
  s.bezierCurveTo(0, 0.6, -0.5, 0.6, -0.5, 0.25);
  s.bezierCurveTo(-0.5, -0.05, 0, -0.3, 0, -0.5);
  s.bezierCurveTo(0, -0.3, 0.5, -0.05, 0.5, 0.25);
  s.bezierCurveTo(0.5, 0.6, 0, 0.6, 0, 0.35);
  const d = thick / size;
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 8 });
  g.translate(0, 0, -d / 2);
  g.scale(size, size, size);
  return g;
}

const POT_H = 0.6;
const GROUND_H = 0.1;
const SOIL_TOP = POT_H + 0.035;
const STEM_H = 0.95;
const CAN_AT = [-1.1, 0.3];
const TUFTS = [[-1.25, -0.4], [-0.8, 0.5], [1.1, 0.45], [1.35, -0.2], [0.8, -0.55], [-0.55, -0.55], [0.7, 0.6], [-1.4, 0.05]];

let dio, plant, stem, pair1, pair2, flower, heart, can, sun, flies = [];
let energy = 0, focus = 0;

export default {
  id: 'care',

  build() {
    energy = 0;
    focus = 0;
    flies = [];
    const root = new THREE.Group();

    // Grass patch: a flat ellipse the diorama sits on (static, so the sway never pokes out of the box).
    const gGeo = new THREE.CylinderGeometry(1.6, 1.64, GROUND_H, 28);
    gGeo.scale(1, 1, 0.5);
    const ground = toonMesh(gGeo, COLORS.sage, { outline: 0.03, receive: true });
    ground.position.y = GROUND_H / 2;
    root.add(ground);

    // Grass tufts: clusters of little cones, one merged mesh.
    const cone = new THREE.ConeGeometry(0.045, 0.2, 4);
    const tuftParts = [];
    TUFTS.forEach(([x, z], i) => {
      [[-0.05, 0.02, -0.25], [0.03, -0.03, 0.2], [0.07, 0.05, 0.5]].forEach(([dx, dz, rz], j) =>
        tuftParts.push([cone, [x + dx, GROUND_H + 0.09, z + dz], [0, (i + j) * 0.7, rz * (j % 2 ? -1 : 1)], 0.8 + 0.25 * j]),
      );
    });
    root.add(toonMesh(merged(tuftParts), mix(COLORS.sage, COLORS.black, 0.28), { outline: 0, cast: false }));

    // Watering can (mascot purple): body, spout with rose, handle. Tips over the plant when approached.
    can = new THREE.Group();
    can.position.set(CAN_AT[0], GROUND_H, CAN_AT[1]);
    const spoutDir = [0.84, 0.54];
    can.add(
      toonMesh(
        merged([
          [new THREE.CylinderGeometry(0.2, 0.22, 0.3, 12), [0, 0.15, 0]],
          [new THREE.CylinderGeometry(0.035, 0.05, 0.38, 6), [0.17 + spoutDir[0] * 0.19, 0.1 + spoutDir[1] * 0.19, 0], [0, 0, -1.0]],
          [new THREE.CylinderGeometry(0.07, 0.05, 0.05, 8), [0.17 + spoutDir[0] * 0.39, 0.1 + spoutDir[1] * 0.39, 0], [0, 0, -1.0]],
          [new THREE.TorusGeometry(0.1, 0.025, 6, 12), [-0.23, 0.17, 0], [0, 0, 0], [0.8, 1, 1]],
        ]),
        COLORS.mascot,
        { outline: 0.025 },
      ),
    );
    root.add(can);

    // Sun: yellow disc with rays, flat-shaded (it glows), behind-right, spins slowly.
    const sunParts = [[new THREE.SphereGeometry(0.2, 12, 8)]];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      sunParts.push([new THREE.BoxGeometry(0.05, 0.14, 0.03), [-Math.sin(a) * 0.33, Math.cos(a) * 0.33, 0], [0, 0, a]]);
    }
    sun = new THREE.Mesh(merged(sunParts), flatMaterial(COLORS.yellow));
    sun.position.set(1.05, 1.85, -0.55);
    root.add(sun);

    // Butterflies: two wings merged, flapping by squashing X. Own double-sided flat material.
    const wing = new THREE.CircleGeometry(0.065, 8);
    const wingsGeo = merged([
      [wing, [-0.065, 0.03, 0], [0, 0, 0], [1, 1.2, 1]],
      [wing, [0.065, 0.03, 0], [0, 0, 0], [1, 1.2, 1]],
      [wing, [-0.045, -0.06, 0], [0, 0, 0], [0.7, 0.8, 1]],
      [wing, [0.045, -0.06, 0], [0, 0, 0], [0.7, 0.8, 1]],
    ]);
    [COLORS.purpleLink, COLORS.red].forEach((c) => {
      const m = new THREE.Mesh(wingsGeo, new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
      root.add(m);
      flies.push(m);
    });

    // Swaying group: pot + plant (everything within r<0.9 of the centre so the focused yaw stays in the box).
    dio = new THREE.Group();
    dio.position.y = GROUND_H;
    root.add(dio);

    // Pot: body + rolled rim + saucer, one terracotta mesh.
    const terracotta = mix(COLORS.red, COLORS.yellow, 0.45);
    const pot = toonMesh(
      merged([
        [new THREE.CylinderGeometry(0.46, 0.36, POT_H - 0.12, 12), [0, (POT_H - 0.12) / 2, 0]],
        [new THREE.CylinderGeometry(0.53, 0.5, 0.14, 12), [0, POT_H - 0.07, 0]],
        [new THREE.CylinderGeometry(0.52, 0.47, 0.06, 12), [0, 0.03, 0]],
      ]),
      terracotta,
      { receive: true },
    );
    const soil = toonMesh(new THREE.CylinderGeometry(0.46, 0.46, 0.05, 12), mix(COLORS.wood, COLORS.black, 0.5), {
      outline: 0,
      cast: false,
    });
    soil.position.y = POT_H + 0.01;
    dio.add(pot, soil);

    // Plant pivots at the soil so it can sway from the base.
    plant = new THREE.Group();
    plant.position.y = SOIL_TOP;
    dio.add(plant);

    const stemGeo = new THREE.CylinderGeometry(0.035, 0.05, STEM_H, 6);
    stemGeo.translate(0, STEM_H / 2, 0);
    stem = toonMesh(stemGeo, mix(COLORS.purple, COLORS.black, 0.45), { outline: 0 });
    plant.add(stem);

    // Two leaf pairs (each pair = one mesh, pivot on the stem axis). Pair 2 is turned 90 deg.
    const leaf = bladeGeometry(0.34, 0.1, 0.03);
    const leafPair = (yaw) =>
      toonMesh(
        merged([
          [leaf, [0, 0, 0], [0, yaw, 0.38]],
          [leaf, [0, 0, 0], [0, yaw + Math.PI, 0.38]],
        ]),
        COLORS.purple,
        { outline: 0.02 },
      );
    pair1 = leafPair(0.3);
    pair2 = leafPair(0.3 + Math.PI / 2);
    plant.add(pair1, pair2);

    // Flower: five red petals in one mesh (bowl-tilted so squeezing X/Z reads as a closed bud) + yellow centre.
    flower = new THREE.Group();
    const petal = bladeGeometry(0.27, 0.11, 0.03);
    const petals = toonMesh(
      merged([0, 1, 2, 3, 4].map((k) => [petal, [0, 0, 0], [0, (k * Math.PI * 2) / 5, 0.6]])),
      COLORS.red,
      { outline: 0.02 },
    );
    const centre = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), flatMaterial(COLORS.yellow));
    centre.position.y = 0.05;
    flower.add(petals, centre);
    plant.add(flower);

    // Heart particle (focused). Fades by scale — toon material stays opaque.
    heart = toonMesh(heartGeometry(0.17, 0.05), COLORS.red, { outline: 0, cast: false });
    heart.visible = false;
    dio.add(heart);

    this.update(0, 0, 'idle');
    return root;
  },

  update(t, dt, state) {
    if (!dio) return;
    energy = approach(energy, state === 'idle' ? 0 : 1, dt, 2.4);
    focus = approach(focus, state === 'focused' ? 1 : 0, dt, 2.4);
    const e = energy, f = focus;
    const g = smooth(e);

    // Growth timeline: stem → lower leaves → upper leaves → bloom.
    const stemS = 0.3 + 0.7 * smooth(seg(g, 0, 0.55));
    stem.scale.y = stemS;
    const h = STEM_H * stemS;

    pair1.position.y = h * 0.42;
    pair1.scale.setScalar(0.45 + 0.55 * backOut(seg(g, 0.2, 0.6)));
    pair1.rotation.z = Math.sin(t * 2.6 + 1) * 0.05 * f;

    const s2 = backOut(seg(g, 0.4, 0.8));
    pair2.visible = s2 > 0.01;
    pair2.position.y = h * 0.72;
    pair2.scale.setScalar(Math.max(s2, 0.001));
    pair2.rotation.x = Math.sin(t * 2.3) * 0.05 * f;

    const o = seg(g, 0.6, 1);
    flower.visible = o > 0.001;
    flower.position.y = h;
    const open = 0.05 + 0.95 * backOut(o);
    flower.scale.set(open, 0.6 + 0.4 * smooth(o), open);
    flower.rotation.y = (1 - smooth(o)) * 1.2 + Math.sin(t * 0.9) * 0.1 * f;
    flower.rotation.z = Math.sin(t * 2.2) * 0.14 * f;
    flower.rotation.x = Math.cos(t * 1.7) * 0.1 * f;

    // Whole plant sways from the soil; a touch livelier when alive.
    const sway = 0.6 + 0.4 * e;
    plant.rotation.z = Math.sin(t * 1.3) * 0.025 * sway;
    plant.rotation.x = Math.cos(t * 0.9) * 0.02 * sway;

    // Heart: pops in above the bloom, drifts up, shrinks away. Loop 2.4 s.
    const T = 2.4, ph = (t % T) / T;
    const hs = f * smooth(seg(ph, 0, 0.18)) * (1 - smooth(seg(ph, 0.62, 1)));
    heart.visible = hs > 0.01;
    heart.scale.setScalar(Math.max(hs, 0.001) * (1 + 0.08 * Math.sin(t * 9)));
    heart.position.set(0.12 * Math.sin(ph * Math.PI * 2), SOIL_TOP + h + 0.27 + ph * 0.3, 0.2);
    heart.rotation.y = Math.sin(ph * Math.PI * 2) * 0.35;

    dio.rotation.y = f * Math.sin(t * 0.5) * YAW;

    // Watering can tips toward the pot when approached, settles back when idle.
    const tip = smooth(e);
    can.rotation.z = -0.45 * tip + Math.sin(t * 2.1) * 0.02 * tip;
    can.position.y = GROUND_H + 0.12 * tip;

    // Sun spins slowly, pulses when someone is near.
    sun.rotation.z = -t * (0.25 + 0.5 * e);
    sun.scale.setScalar(1 + 0.04 * Math.sin(t * 2) + 0.03 * e);

    // Butterflies: lazy figure-eights around the plant, faster wings when near.
    flies.forEach((m, i) => {
      const sp = (0.55 + 0.25 * e) * (i ? 0.8 : 1), ph = i * 2.4, s = i ? -1 : 1;
      const a = t * sp + ph;
      m.position.set(s * 0.85 + Math.sin(a) * 0.45, (i ? 1.75 : 1.3) + 0.12 * Math.sin(a * 1.9), 0.1 + 0.5 * Math.cos(a * 0.8));
      m.rotation.z = Math.cos(a) * 0.35 * s;
      m.scale.x = 0.2 + 0.8 * Math.abs(Math.sin(t * (12 + 6 * e) + i));
    });
  },

  focusPose: { height: 1.2, zoom: 3.2 },
};
