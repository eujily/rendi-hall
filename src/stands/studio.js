// Rendi Studio — a white easel with a board; sticky notes fly in and stick one by one.
// Focused: the first note peels and re-sticks on a loop, a pencil on the tray wiggles.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMesh } from '../kit/toon.js';
import { COLORS } from '../core/tokens.js';
import { createPedestal, PEDESTAL_H } from './_pedestal.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const seg = (x, a, b) => clamp01((x - a) / (b - a));
const smooth = (x) => x * x * (3 - 2 * x);
const approach = (v, to, dt, rate) => v + (to - v) * (1 - Math.exp(-rate * dt));
const YAW = THREE.MathUtils.degToRad(15);

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

const EASEL_TILT = -0.1; // whole easel leans back
const BOARD_Y = 1.28, BOARD_FRONT = 0.085;
const NOTE = 0.3;
const TRAY_Y = 0.82;
// Notes: colour, home position (x, top-edge y), resting tilt. Note 0 is already on the board in idle.
const NOTES = [
  { color: COLORS.yellow, x: -0.25, y: BOARD_Y + 0.24 + NOTE / 2, rz: 0.08 },
  { color: COLORS.purple, x: 0.25, y: BOARD_Y + 0.24 + NOTE / 2, rz: -0.12 },
  { color: COLORS.white, x: -0.25, y: BOARD_Y - 0.24 + NOTE / 2, rz: 0.1 },
  { color: COLORS.yellow, x: 0.25, y: BOARD_Y - 0.24 + NOTE / 2, rz: -0.06 },
];

let dio, easel, notes = [], pencil;
let energy = 0, focus = 0;

export default {
  id: 'studio',

  build() {
    const root = new THREE.Group();
    root.add(createPedestal({ label: 'Rendi Studio', accent: COLORS.yellow }));

    dio = new THREE.Group();
    dio.position.y = PEDESTAL_H;
    root.add(dio);

    easel = new THREE.Group();
    easel.rotation.x = EASEL_TILT;
    dio.add(easel);

    // Easel frame + board in one white mesh: two splayed front legs, a rear leg, tray, top clamp, board.
    const leg = new THREE.BoxGeometry(0.07, 1.9, 0.07);
    const frame = toonMesh(
      merged([
        [leg, [-0.33, 0.95, 0], [0, 0, -0.13]],
        [leg, [0.33, 0.95, 0], [0, 0, 0.13]],
        [new THREE.BoxGeometry(0.07, 1.8, 0.07), [0, 0.93, -0.32], [0.36, 0, 0]],
        [new THREE.BoxGeometry(1.0, 0.06, 0.14), [0, 0.75, 0.07]], // tray
        [new THREE.BoxGeometry(0.28, 0.1, 0.1), [0, 1.86, 0.06]], // clamp
        [new THREE.BoxGeometry(1.1, 1.0, 0.05), [0, BOARD_Y, 0.06]], // board
      ]),
      COLORS.white,
      { receive: true },
    );
    easel.add(frame);

    // Sticky notes: thin outlined squares, pivot on the top edge (so they can peel).
    const noteGeo = new THREE.BoxGeometry(NOTE, NOTE, 0.025);
    noteGeo.translate(0, -NOTE / 2, 0);
    notes = NOTES.map((n) => {
      const m = toonMesh(noteGeo, n.color, { outline: 0.02, cast: false });
      easel.add(m);
      return m;
    });

    // Pencil on the tray: yellow body + sharpened collar in one mesh, black tip.
    pencil = new THREE.Group();
    pencil.position.set(0.12, TRAY_Y, 0.15);
    const body = toonMesh(
      merged([
        [new THREE.CylinderGeometry(0.035, 0.035, 0.5, 8)],
        [new THREE.CylinderGeometry(0.035, 0.012, 0.08, 8), [0, 0.29, 0]],
      ]),
      COLORS.yellow,
      { outline: 0.02 },
    );
    const tip = toonMesh(new THREE.CylinderGeometry(0.012, 0, 0.045, 8), COLORS.black, { outline: 0, cast: false });
    tip.position.y = 0.352;
    pencil.add(body, tip);
    easel.add(pencil);

    this.update(0, 0, 'idle');
    return root;
  },

  update(t, dt, state) {
    if (!dio) return;
    energy = approach(energy, state === 'idle' ? 0 : 1, dt, 1.8);
    focus = approach(focus, state === 'focused' ? 1 : 0, dt, 2.4);
    const e = energy, f = focus;

    // Notes 1..3 fly in from the front and stick in sequence; a damped wobble follows each landing.
    notes.forEach((m, i) => {
      const n = NOTES[i];
      const start = 0.05 + (i - 1) * 0.3;
      const p = i === 0 ? 1 : smooth(seg(e, start, start + 0.25));
      const w = i === 0 ? 1 : seg(e, start + 0.25, start + 0.45);
      m.visible = p > 0.001;
      const k = 1 - p;
      const side = Math.sign(n.x) || 1;
      m.position.set(n.x + k * side * 0.3, n.y + k * 0.4, BOARD_FRONT + 0.0125 + k * 0.7);
      m.scale.setScalar(1 + 0.35 * k);
      m.rotation.set(k * 0.6, 0, n.rz + k * side * 0.7 + Math.sin(w * Math.PI * 2.5) * (1 - w) * 0.3);
    });

    // Note 0: idle flutter; focused — peel up from the bottom edge, hold, snap back, wobble. Loop 3.4 s.
    const T = 3.4, ph = (t % T) / T;
    const peel = smooth(seg(ph, 0, 0.3)) * (1 - smooth(seg(ph, 0.5, 0.62)));
    const ww = seg(ph, 0.62, 0.9);
    const n0 = notes[0];
    n0.rotation.x = -(0.03 + 0.03 * Math.sin(t * 2)) * (1 - f) - 0.9 * peel * f;
    n0.rotation.z = NOTES[0].rz + Math.sin(ww * Math.PI * 3) * (1 - ww) * 0.25 * f;
    n0.position.z = BOARD_FRONT + 0.0125 + 0.01 * peel * f;

    // Pencil: lies along X on the tray; in focus it wiggles in short bursts and hops a little.
    const env = Math.max(0, Math.sin(t * 1.6)) ** 3;
    pencil.rotation.set(0, -0.25, -Math.PI / 2 + 0.06 + f * env * 0.2 * Math.sin(t * 16));
    pencil.position.y = TRAY_Y + f * env * 0.05;

    // Idle calm: the easel sways almost imperceptibly.
    easel.rotation.z = 0.006 * Math.sin(t * 1.1);

    dio.rotation.y = f * Math.sin(t * 0.5) * YAW;
  },

  focusPose: { height: 1.3, zoom: 2.9 },
};
