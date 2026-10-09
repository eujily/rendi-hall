// Rendi Home — a mini cottage: white walls, purple roof, chimney, wooden door.
// Near: windows light up one after another. Focused: smoke puffs, door lamp on.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMesh, flatMaterial } from '../kit/toon.js';
import { COLORS, mix } from '../core/tokens.js';
import { createPedestal, PEDESTAL_H } from './_pedestal.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const seg = (x, a, b) => clamp01((x - a) / (b - a));
const smooth = (x) => x * x * (3 - 2 * x);
const approach = (v, to, dt, rate) => v + (to - v) * (1 - Math.exp(-rate * dt));
const YAW = THREE.MathUtils.degToRad(15);
const UP = new THREE.Vector3(0, 1, 0);

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

// House dimensions (ridge runs along X, so the front +Z face is the gable with the door).
const W = 1.3, D = 1.1, H = 1.0, PEAK = 1.6;
const SLOPE = (PEAK - H) / (W / 2); // rise per unit x
const ROOF_T = 0.08 / Math.cos(Math.atan(SLOPE)); // vertical thickness of the roof slab
const OVER = 0.13; // eave overhang
const HOUSE_YAW = -0.45; // show the front gable and the +X side to the isometric camera
const CHIMNEY = new THREE.Vector3(0.38, 1.75, 0);

// Frame bars (black) around a w×h rectangle at `centre`, facing +Z, then turned by rotY about the house axis.
function frameParts(w, h, centre, rotY, bar = 0.03, depth = 0.04) {
  const c = new THREE.Vector3(...centre);
  const at = (lx, ly, lz) => new THREE.Vector3(lx, ly, lz).applyAxisAngle(UP, rotY).add(c).toArray();
  const rot = [0, rotY, 0];
  return [
    [new THREE.BoxGeometry(w + bar * 2, bar, depth), at(0, h / 2 + bar / 2, 0), rot],
    [new THREE.BoxGeometry(w + bar * 2, bar, depth), at(0, -h / 2 - bar / 2, 0), rot],
    [new THREE.BoxGeometry(bar, h + bar * 2, depth), at(w / 2 + bar / 2, 0, 0), rot],
    [new THREE.BoxGeometry(bar, h + bar * 2, depth), at(-w / 2 - bar / 2, 0, 0), rot],
    [new THREE.BoxGeometry(w, 0.02, depth), at(0, 0, 0), rot],
    [new THREE.BoxGeometry(0.02, h, depth), at(0, 0, 0), rot],
  ];
}

let dio, house, windows = [], lamp, puffs = [], litMat, darkMat;
let energy = 0, focus = 0;

export default {
  id: 'home',

  build() {
    const root = new THREE.Group();
    // Lavender rim reads too close to the floor; mascot purple keeps the Home accent in the lavender family.
    root.add(createPedestal({ label: 'Rendi Home', accent: COLORS.mascot }));

    dio = new THREE.Group();
    dio.position.y = PEDESTAL_H;
    root.add(dio);

    house = new THREE.Group();
    house.rotation.y = HOUSE_YAW;
    dio.add(house);

    // Walls + gable prism + chimney + door step — all white, one mesh.
    const gable = new THREE.Shape();
    gable.moveTo(-W / 2, H);
    gable.lineTo(W / 2, H);
    gable.lineTo(0, PEAK);
    gable.closePath();
    const gableGeo = new THREE.ExtrudeGeometry(gable, { depth: D, bevelEnabled: false });
    gableGeo.translate(0, 0, -D / 2);
    const walls = toonMesh(
      merged([
        [new THREE.BoxGeometry(W, H, D), [0, H / 2, 0]],
        [gableGeo],
        [new THREE.BoxGeometry(0.2, 0.55, 0.2), [CHIMNEY.x, CHIMNEY.y - 0.275, CHIMNEY.z]],
        [new THREE.BoxGeometry(0.44, 0.06, 0.18), [0.28, 0.03, D / 2 + 0.09]],
      ]),
      COLORS.white,
      { receive: true },
    );

    // Roof: a thick chevron extruded along the ridge, overhanging eaves and gables.
    const half = W / 2 + OVER;
    const yo = (x) => H + ROOF_T + (W / 2 - Math.abs(x)) * SLOPE; // outer surface
    const yi = (x) => H + (W / 2 - Math.abs(x)) * SLOPE; // inner surface
    const chevron = new THREE.Shape();
    chevron.moveTo(-half, yo(-half));
    chevron.lineTo(0, yo(0));
    chevron.lineTo(half, yo(half));
    chevron.lineTo(half, yi(half));
    chevron.lineTo(0, yi(0));
    chevron.lineTo(-half, yi(-half));
    chevron.closePath();
    const roofGeo = new THREE.ExtrudeGeometry(chevron, { depth: D + 0.26, bevelEnabled: false });
    roofGeo.translate(0, 0, -(D + 0.26) / 2);
    const roof = toonMesh(roofGeo, COLORS.purple, { outline: 0.04 });

    // Flat details on the walls: door, three windows, door lamp. Glass swaps material when lit.
    darkMat = flatMaterial(mix(COLORS.purpleLink, COLORS.black, 0.6));
    litMat = flatMaterial(COLORS.yellow);
    const face = D / 2 + 0.012;
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.52), flatMaterial(COLORS.wood));
    door.position.set(0.28, 0.26, face);

    const win = (geo, pos, rotY = 0) => {
      const m = new THREE.Mesh(geo, darkMat);
      m.position.set(...pos);
      m.rotation.y = rotY;
      return m;
    };
    windows = [
      win(new THREE.PlaneGeometry(0.3, 0.3), [-0.25, 0.55, face]), // front
      win(new THREE.PlaneGeometry(0.3, 0.3), [W / 2 + 0.012, 0.6, 0.12], Math.PI / 2), // side
      win(new THREE.CircleGeometry(0.1, 14), [0, 1.22, face]), // attic
    ];
    lamp = win(new THREE.CircleGeometry(0.045, 10), [0.28, 0.62, face]);

    const frames = new THREE.Mesh(
      merged([
        ...frameParts(0.3, 0.3, [-0.25, 0.55, face + 0.008], 0),
        ...frameParts(0.3, 0.3, [W / 2 + 0.02, 0.6, 0.12], Math.PI / 2),
        [new THREE.TorusGeometry(0.1, 0.015, 6, 18), [0, 1.22, face + 0.008]],
        [new THREE.BoxGeometry(0.2, 0.02, 0.04), [0, 1.22, face + 0.008]],
        [new THREE.BoxGeometry(0.02, 0.2, 0.04), [0, 1.22, face + 0.008]],
        [new THREE.TorusGeometry(0.045, 0.012, 6, 14), [0.28, 0.62, face + 0.008]],
        [new THREE.BoxGeometry(0.36, 0.03, 0.04), [0.28, 0.535, face + 0.008]], // door top
        [new THREE.BoxGeometry(0.03, 0.52, 0.04), [0.115, 0.26, face + 0.008]],
        [new THREE.BoxGeometry(0.03, 0.52, 0.04), [0.445, 0.26, face + 0.008]],
        [new THREE.SphereGeometry(0.02, 8, 6), [0.37, 0.26, face + 0.02]], // knob
      ]),
      flatMaterial(COLORS.black),
    );

    house.add(walls, roof, door, frames, lamp, ...windows);

    // Smoke puffs (focused): soft low-poly spheres, no outline so they read as vapour.
    const puffGeo = new THREE.SphereGeometry(0.11, 8, 6);
    const puffColor = mix(COLORS.white, COLORS.lavender, 0.5);
    puffs = [0, 1, 2].map(() => {
      const p = toonMesh(puffGeo, puffColor, { outline: 0, cast: false });
      p.visible = false;
      house.add(p);
      return p;
    });

    this.update(0, 0, 'idle');
    return root;
  },

  update(t, dt, state) {
    if (!dio) return;
    // Slower energy so the window sequence is readable (~1.5 s).
    energy = approach(energy, state === 'idle' ? 0 : 1, dt, 1.6);
    focus = approach(focus, state === 'focused' ? 1 : 0, dt, 2.2);
    const e = energy, f = focus;

    // Windows light one after another with a little scale pop as each turns on.
    windows.forEach((w, i) => {
      const l = seg(e, 0.15 + i * 0.28, 0.27 + i * 0.28);
      w.material = l > 0.5 ? litMat : darkMat;
      const pop = 1 + 0.35 * Math.sin(l * Math.PI);
      w.scale.set(pop, pop, 1);
    });
    lamp.material = f > 0.5 ? litMat : darkMat;
    const lampPop = 1 + 0.4 * Math.sin(seg(f, 0.4, 0.7) * Math.PI);
    lamp.scale.set(lampPop, lampPop, 1);

    // Idle: the cottage breathes very gently, like a cartoon house.
    house.scale.y = 1 + 0.012 * Math.sin(t * 1.5);
    house.rotation.z = 0.008 * Math.sin(t * 0.9);
    house.rotation.y = HOUSE_YAW;

    // Smoke loop (focused): three puffs staggered over 2.6 s, rising and swelling before they vanish.
    puffs.forEach((p, i) => {
      const T = 2.6, ph = ((t + (i * T) / 3) % T) / T;
      const s = f * smooth(seg(ph, 0, 0.15)) * (1 - smooth(seg(ph, 0.65, 1))) * (0.5 + 0.8 * ph);
      p.visible = s > 0.01;
      p.scale.setScalar(Math.max(s, 0.001));
      p.position.set(CHIMNEY.x + 0.1 * Math.sin(ph * 5 + i), CHIMNEY.y + 0.05 + ph * 0.34, CHIMNEY.z + 0.06 * Math.cos(ph * 4 + i));
    });

    dio.rotation.y = f * Math.sin(t * 0.5) * YAW;
  },

  focusPose: { height: 1.25, zoom: 3.0 },
};
