// Waitlist — a cute reception kiosk: mascot-purple desk, wooden counter, a yellow service bell
// and a "Join the waitlist" sign. Near: the bell hops and rings. Focused: an envelope pops out and floats.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMesh, flatMaterial } from '../kit/toon.js';
import { COLORS } from '../core/tokens.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const seg = (x, a, b) => clamp01((x - a) / (b - a));
const smooth = (x) => x * x * (3 - 2 * x);
const backOut = (x) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;
const approach = (v, to, dt, rate) => v + (to - v) * (1 - Math.exp(-rate * dt));
const YAW = THREE.MathUtils.degToRad(15);
const UP = new THREE.Vector3(0, 1, 0);
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

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

function heartShape(size) {
  const s = new THREE.Shape();
  s.moveTo(0, 0.35);
  s.bezierCurveTo(0, 0.6, -0.5, 0.6, -0.5, 0.25);
  s.bezierCurveTo(-0.5, -0.05, 0, -0.3, 0, -0.5);
  s.bezierCurveTo(0, -0.3, 0.5, -0.05, 0.5, 0.25);
  s.bezierCurveTo(0.5, 0.6, 0, 0.6, 0, 0.35);
  const g = new THREE.ShapeGeometry(s, 8);
  g.scale(size, size, size);
  return g;
}

// Transparent canvas with the sign text; redrawn once Montserrat is available.
function signTexture(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const font = 'italic 800 58px Montserrat, system-ui, sans-serif';
  const draw = () => {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 512, 192);
    ctx.fillStyle = hex(COLORS.black);
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 100, 470);
    tex.needsUpdate = true;
  };
  draw();
  document.fonts?.load(font).then(draw).catch(() => {});
  return tex;
}

const DESK_YAW = -0.35; // show the front and one side of the kiosk
const COUNTER_Y = 0.93; // top surface of the counter
const BELL_AT = new THREE.Vector3(-0.42, COUNTER_Y, 0.08);
const POST_AT = new THREE.Vector3(0.5, 0, -0.2);
const SIGN_Y = 1.7;

let dio, desk, bell, rings, plate, envelope;
let energy = 0, focus = 0;

export default {
  id: 'waitlist',

  build() {
    const root = new THREE.Group();

    dio = new THREE.Group();
    root.add(dio);

    desk = new THREE.Group();
    desk.rotation.y = DESK_YAW;
    dio.add(desk);

    // Kiosk body in Randy's colour; wooden counter top with the sign post merged in.
    const body = toonMesh(new THREE.BoxGeometry(1.4, 0.85, 0.6), COLORS.mascot, { receive: true });
    body.position.y = 0.425;
    const counter = toonMesh(
      merged([
        [new THREE.BoxGeometry(1.56, 0.08, 0.76), [0, COUNTER_Y - 0.04, 0]],
        [new THREE.BoxGeometry(0.06, 0.95, 0.06), [POST_AT.x, COUNTER_Y + 0.475, POST_AT.z]],
        [new THREE.BoxGeometry(1.4, 0.05, 0.03), [0, 0.5, 0.31]], // front rail
      ]),
      COLORS.wood,
      { outline: 0.035 },
    );
    desk.add(body, counter);

    // Service bell: base disc + dome + button, one yellow mesh. Pivot at its foot for squash.
    bell = new THREE.Group();
    bell.position.copy(BELL_AT);
    const bellMesh = toonMesh(
      merged([
        [new THREE.CylinderGeometry(0.2, 0.22, 0.04, 14), [0, 0.02, 0]],
        [new THREE.SphereGeometry(0.17, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), [0, 0.04, 0]],
        [new THREE.CylinderGeometry(0.03, 0.03, 0.07, 8), [0, 0.235, 0]],
        [new THREE.SphereGeometry(0.04, 8, 6), [0, 0.28, 0]],
      ]),
      COLORS.yellow,
      { outline: 0.03 },
    );
    bell.add(bellMesh);
    // Three radiating "ring" lines above the button, one black mesh.
    const line = new THREE.BoxGeometry(0.02, 0.14, 0.02);
    rings = new THREE.Mesh(
      merged([
        [line, [0, 0.12, 0]],
        [line, [-Math.sin(0.7) * 0.15, Math.cos(0.7) * 0.13, 0], [0, 0, 0.7]],
        [line, [Math.sin(0.7) * 0.15, Math.cos(0.7) * 0.13, 0], [0, 0, -0.7]],
      ]),
      flatMaterial(COLORS.black),
    );
    rings.position.y = 0.36;
    rings.visible = false;
    bell.add(rings);
    desk.add(bell);

    // Sign plate: yellow pill-like plate facing the camera (outside the turned desk so the text stays readable).
    const postTop = POST_AT.clone().setY(SIGN_Y).applyAxisAngle(UP, DESK_YAW);
    plate = toonMesh(new THREE.BoxGeometry(1.1, 0.42, 0.05), COLORS.yellow, { outline: 0.03 });
    plate.position.copy(postTop).add(new THREE.Vector3(0, 0, 0.05));
    plate.rotation.y = -0.12;
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(1.04, 0.37),
      new THREE.MeshBasicMaterial({ map: signTexture('Join the waitlist'), transparent: true }),
    );
    face.position.z = 0.03;
    plate.add(face);
    dio.add(plate);

    // Envelope (focused): white outlined card with a red heart seal.
    envelope = new THREE.Group();
    const card = toonMesh(new THREE.BoxGeometry(0.36, 0.24, 0.03), COLORS.white, { outline: 0.02, cast: false });
    const seal = new THREE.Mesh(heartShape(0.08), flatMaterial(COLORS.red));
    seal.position.set(0, -0.01, 0.017);
    envelope.add(card, seal);
    envelope.visible = false;
    dio.add(envelope);

    this.update(0, 0, 'idle');
    return root;
  },

  update(t, dt, state) {
    if (!dio) return;
    energy = approach(energy, state === 'idle' ? 0 : 1, dt, 2.4);
    focus = approach(focus, state === 'focused' ? 1 : 0, dt, 2.4);
    const e = energy, f = focus;

    // Bell: a small inviting hop in idle, a full hop + landing squash + ring lines when near. Loop 1.5 s.
    const amp = 0.25 + 0.75 * e;
    const T = 1.5, ph = (t % T) / T;
    const hop = ph < 0.42 ? Math.sin((ph / 0.42) * Math.PI) : 0;
    const sq = ph >= 0.42 && ph < 0.62 ? Math.sin(((ph - 0.42) / 0.2) * Math.PI) : 0;
    bell.position.y = BELL_AT.y + 0.2 * amp * hop;
    bell.scale.set(1 + 0.18 * amp * sq, 1 - 0.25 * amp * sq, 1 + 0.18 * amp * sq);
    const rk = seg(ph, 0.44, 0.78);
    rings.visible = e > 0.45 && rk > 0 && rk < 1;
    rings.scale.setScalar(0.6 + 0.8 * rk);
    rings.position.y = 0.36 + 0.08 * rk;

    // Sign sways a touch in idle.
    plate.rotation.z = 0.02 * Math.sin(t * 1.1);

    // Envelope: pops out of the counter, floats up bobbing, shrinks away. Loop 3.6 s.
    const TE = 3.6, pe = (t % TE) / TE;
    const es = f * backOut(seg(pe, 0, 0.18)) * (1 - smooth(seg(pe, 0.78, 0.95)));
    envelope.visible = es > 0.01;
    envelope.scale.setScalar(Math.max(es, 0.001));
    envelope.position.set(
      0.05 + 0.08 * Math.sin(pe * 6),
      1.05 + smooth(seg(pe, 0, 0.5)) * 0.55 + 0.04 * Math.sin(t * 3),
      0.3,
    );
    envelope.rotation.set(0, 0.3 * Math.sin(pe * Math.PI * 2), 0.15 * Math.sin(t * 2.2));

    dio.rotation.y = f * Math.sin(t * 0.5) * YAW;
  },

  focusPose: { height: 1.15, zoom: 3.2 },
};
