// Rendi Studio — a white easel on a rug with a board; sticky notes fly in and stick one by one.
// Beside it a little desk: coffee mug (steam), pencil cup, a floating idea bulb. Focused: the first
// note peels and re-sticks on a loop, the pencil on the tray wiggles, the bulb glows.
// Diorama only: origin = bottom-centre, front = +Z, fits |x|<=1.7, 0<=y<=2.4, |z|<=0.9.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMesh, flatMaterial } from '../kit/toon.js';
import { COLORS, mix } from '../core/tokens.js';

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

const RUG_H = 0.08;
const EASEL_AT = [-0.65, 0.05];
const EASEL_S = 0.95;
const EASEL_TILT = -0.1; // whole easel leans back
const BOARD_Y = 1.28, BOARD_FRONT = 0.085;
const NOTE = 0.3;
const TRAY_Y = 0.82;
const DESK_X = 0.95, DESK_TOP = RUG_H + 0.55;
const BULB_AT = [0.95, 1.55, 0.05];
// Notes: colour, home position (x, top-edge y), resting tilt. Note 0 is already on the board in idle.
const NOTES = [
  { color: COLORS.yellow, x: -0.25, y: BOARD_Y + 0.24 + NOTE / 2, rz: 0.08 },
  { color: COLORS.purple, x: 0.25, y: BOARD_Y + 0.24 + NOTE / 2, rz: -0.12 },
  { color: COLORS.mascot, x: -0.25, y: BOARD_Y - 0.24 + NOTE / 2, rz: 0.1 },
  { color: COLORS.red, x: 0.25, y: BOARD_Y - 0.24 + NOTE / 2, rz: -0.06 },
];

let dio, easel, notes = [], pencil, steam, bulb, bulbGlass, rays;
let energy = 0, focus = 0;

export default {
  id: 'studio',

  build() {
    energy = 0;
    focus = 0;
    notes = [];
    const root = new THREE.Group();
    dio = root;

    // Rug the scene stands on (static).
    const rug = toonMesh(new THREE.BoxGeometry(3.3, RUG_H, 1.7), mix(COLORS.lavender, COLORS.mascot, 0.55), {
      outline: 0.03,
      receive: true,
    });
    rug.position.y = RUG_H / 2;
    root.add(rug);

    // Easel sways on its own pivot (focused yaw); the desk stays put.
    const pivot = new THREE.Group();
    pivot.position.set(EASEL_AT[0], RUG_H, EASEL_AT[1]);
    pivot.scale.setScalar(EASEL_S);
    root.add(pivot);
    easel = new THREE.Group();
    easel.rotation.x = EASEL_TILT;
    pivot.add(easel);
    this._pivot = pivot;

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

    // Sticky notes: flat toon squares (no hull, to stay in budget), pivot on the top edge so they can peel.
    const noteGeo = new THREE.BoxGeometry(NOTE, NOTE, 0.025);
    noteGeo.translate(0, -NOTE / 2, 0);
    notes = NOTES.map((n) => {
      const m = toonMesh(noteGeo, n.color, { outline: 0, cast: false });
      easel.add(m);
      return m;
    });

    // Pencil on the tray: yellow body + sharpened collar in one mesh.
    pencil = toonMesh(
      merged([
        [new THREE.CylinderGeometry(0.035, 0.035, 0.5, 8)],
        [new THREE.CylinderGeometry(0.035, 0.005, 0.12, 8), [0, 0.31, 0]],
      ]),
      COLORS.yellow,
      { outline: 0, cast: false },
    );
    pencil.position.set(0.12, TRAY_Y, 0.15);
    easel.add(pencil);

    // Desk: wooden top with four legs.
    const desk = toonMesh(
      merged([
        [new THREE.BoxGeometry(1.15, 0.07, 0.65), [0, 0.515, 0]],
        ...[[-0.5, -0.27], [0.5, -0.27], [-0.5, 0.27], [0.5, 0.27]].map(([x, z]) => [new THREE.BoxGeometry(0.07, 0.48, 0.07), [x, 0.24, z]]),
      ]),
      COLORS.wood,
      { outline: 0.025, receive: true },
    );
    desk.position.set(DESK_X, RUG_H, 0);
    root.add(desk);

    // Coffee mug (red) + steam puffs (one white mesh that drifts up and fades by scale).
    const mugAt = [DESK_X - 0.28, DESK_TOP, 0.08];
    const mug = toonMesh(
      merged([
        [new THREE.CylinderGeometry(0.1, 0.085, 0.17, 12), [0, 0.085, 0]],
        [new THREE.TorusGeometry(0.055, 0.016, 6, 10), [0.12, 0.09, 0], [0, 0, 0], [0.9, 1, 1]],
      ]),
      COLORS.red,
      { outline: 0.02 },
    );
    mug.position.set(...mugAt);
    root.add(mug);
    steam = toonMesh(
      merged([
        [new THREE.SphereGeometry(0.035, 6, 5), [0, 0, 0]],
        [new THREE.SphereGeometry(0.03, 6, 5), [0.03, 0.09, 0]],
        [new THREE.SphereGeometry(0.025, 6, 5), [-0.02, 0.17, 0]],
      ]),
      COLORS.white,
      { outline: 0, cast: false },
    );
    steam.position.set(mugAt[0], mugAt[1] + 0.2, mugAt[2]);
    root.add(steam);

    // Pencil cup (mascot) with a bunch of pencils (yellow, merged).
    const cupAt = [DESK_X + 0.3, DESK_TOP, -0.08];
    const cup = toonMesh(new THREE.CylinderGeometry(0.1, 0.085, 0.2, 10), COLORS.mascot, { outline: 0.02 });
    cup.position.set(cupAt[0], cupAt[1] + 0.1, cupAt[2]);
    const pen = new THREE.CylinderGeometry(0.014, 0.014, 0.3, 6);
    const pencils = toonMesh(
      merged([
        [pen, [-0.03, 0.23, 0], [0, 0, 0.22]],
        [pen, [0.03, 0.24, 0.01], [0.1, 0, -0.18]],
        [pen, [0, 0.25, -0.03], [-0.25, 0, 0.02]],
      ]),
      COLORS.yellow,
      { outline: 0, cast: false },
    );
    pencils.position.set(...cupAt);
    root.add(cup, pencils);

    // Idea bulb: yellow glass + black base, rays that flash on. Floats above the desk.
    bulb = new THREE.Group();
    bulb.position.set(...BULB_AT);
    bulbGlass = toonMesh(
      merged([
        [new THREE.SphereGeometry(0.13, 12, 10), [0, 0.04, 0]],
        [new THREE.CylinderGeometry(0.06, 0.07, 0.12, 8), [0, -0.1, 0]],
      ]),
      COLORS.yellow,
      { outline: 0.025 },
    );
    const rayParts = [];
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + ((k - 2) * Math.PI) / 4.2 + Math.PI;
      rayParts.push([new THREE.BoxGeometry(0.03, 0.1, 0.02), [Math.sin(a) * 0.27, 0.04 - Math.cos(a) * 0.27, 0], [0, 0, a]]);
    }
    rays = new THREE.Mesh(merged(rayParts), flatMaterial(COLORS.black));
    bulb.add(bulbGlass, rays);
    root.add(bulb);

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
      m.position.set(n.x + k * side * 0.3, n.y + k * 0.4, BOARD_FRONT + 0.0125 + k * 0.45);
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

    // Idle calm: the easel sways almost imperceptibly; focused yaw only on the easel pivot.
    easel.rotation.z = 0.006 * Math.sin(t * 1.1);
    this._pivot.rotation.y = f * Math.sin(t * 0.5) * YAW;

    // Steam: slow rising loop, stronger when someone is near.
    const sp = (t * 0.6) % 1;
    steam.position.y = DESK_TOP + 0.2 + sp * 0.08;
    steam.scale.setScalar(Math.max(0.001, (0.5 + 0.5 * e) * (1 - smooth(seg(sp, 0.6, 1))) * smooth(seg(sp, 0, 0.2))));

    // Idea bulb: bobs gently; pops bigger and flashes its rays when near, glows steadily when focused.
    bulb.position.y = BULB_AT[1] + 0.05 * Math.sin(t * 1.8);
    bulb.rotation.z = 0.08 * Math.sin(t * 1.3);
    bulb.scale.setScalar(0.85 + 0.2 * smooth(e) + 0.04 * f * Math.sin(t * 6));
    rays.visible = e > 0.3 && (f > 0.5 || Math.sin(t * 7) > -0.3);
  },

  focusPose: { height: 1.2, zoom: 3.2 },
};
