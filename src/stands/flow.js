// Rendi Flow — a diorama on a lavender desk: a giant white mouse cursor clicking a yellow pill button (the apprendi.io CTA).
// Props: a "Click!" tooltip bubble that pops with each click, a progress bar that fills click by click,
// two little purple UI cards at the back (floating gently).
// idle: cursor hovers · near: it moves in, clicks, the button presses and a 3-line "click" burst pops
// · focused: same, plus a little purple tick appearing above the button after each click.
// Box: |x| <= ~1.55, |z| <= ~0.8, top y ~ 2.15 (cursor at rest).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMesh, flatMaterial } from '../kit/toon.js';
import { COLORS, mix } from '../core/tokens.js';

const css = (c) => `#${c.toString(16).padStart(6, '0')}`;
const damp = (dt, k) => 1 - Math.exp(-dt * k);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const elasticOut = (p) =>
  p <= 0 ? 0 : p >= 1 ? 1 : 2 ** (-10 * p) * Math.sin(((p * 10 - 0.75) * 2 * Math.PI) / 3) + 1;

const SLAB_H = 0.12;
const LEAN = -0.3; // plates lean back from the camera
const S = 1.25; // button scale
const BUTTON_POS = new THREE.Vector3(-0.3, 0, -0.1);
const BUTTON_W = 1.0;
const BUTTON_D = 0.5;
const BUTTON_H = 0.14; // extrude depth; bevel adds 2 × 0.04
const PRESS = 0.4; // how much the button squashes
const HOVER = new THREE.Vector3(0.4, 0.95, 0.15); // cursor tip at rest
const CLICK_MARKS = [110, 150, 190]; // degrees around the tip, fanning away from the cursor body
const BAR_W = 1.8;
const BAR_Z = 0.5;
const BAR_STEPS = 5;
const BUBBLE_POS = new THREE.Vector3(-0.95, 1.75, -0.1);

function pillShape(w, d) {
  const r = d / 2;
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -r);
  s.lineTo(w / 2 - r, -r);
  s.absarc(w / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(-w / 2 + r, r);
  s.absarc(-w / 2 + r, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false);
  return s;
}

// classic arrow cursor, tip at the origin, body extending up-right (so the tip points down at the button)
function cursorShape(scale) {
  const pts = [
    [0, 0], [0, 16], [4, 12.2], [7, 18.4], [9.4, 17.3], [6.5, 11.2], [11.6, 11.2],
  ];
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x * scale, y * scale) : s.moveTo(x * scale, y * scale)));
  s.closePath();
  return s;
}

// a thick check mark polygon (unit box), drawn counter-clockwise
function tickShape(scale) {
  const pts = [
    [-0.028, 0.472], [0.406, 0.038], [1.083, 0.828], [0.917, 0.972], [0.394, 0.362], [0.128, 0.628],
  ];
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => {
    const px = (x - 0.53) * scale;
    const py = (y - 0.5) * scale;
    i ? s.lineTo(px, py) : s.moveTo(px, py);
  });
  s.closePath();
  return s;
}

function labelTexture(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const font = 'italic 800 132px Montserrat, system-ui, sans-serif';
  const draw = () => {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 512, 256);
    ctx.fillStyle = css(COLORS.black);
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 136, 460);
    tex.needsUpdate = true;
  };
  draw();
  document.fonts?.load(font).then(draw).catch(() => {});
  return tex;
}

function buildSlab() {
  const geo = new THREE.BoxGeometry(3.2, SLAB_H, 1.5).translate(0, SLAB_H / 2, 0);
  return toonMesh(geo, mix(COLORS.lavender, COLORS.purple, 0.25), { outline: 0.03, receive: true });
}

function buildButton() {
  const group = new THREE.Group();
  group.position.copy(BUTTON_POS);
  group.scale.setScalar(S);

  const geo = new THREE.ExtrudeGeometry(pillShape(BUTTON_W, BUTTON_D), {
    depth: BUTTON_H,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.04,
    bevelSegments: 3,
  });
  geo.rotateX(-Math.PI / 2);
  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox.min.y, 0); // pivot at the bottom so pressing = scale.y
  const top = geo.boundingBox.max.y - geo.boundingBox.min.y;
  const pill = toonMesh(geo, COLORS.yellow, { outline: 0.04 });

  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(0.7, 0.35).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: labelTexture('Start'), transparent: true }),
  );
  label.position.y = top + 0.003;
  pill.add(label);

  // hard lavender-grey "socket" shadow under the button, like the mascot's offset shadow
  const socket = new THREE.Mesh(
    new THREE.ExtrudeGeometry(pillShape(BUTTON_W + 0.14, BUTTON_D + 0.14), { depth: 0.02, bevelEnabled: false }).rotateX(
      -Math.PI / 2,
    ),
    flatMaterial(COLORS.shadow),
  );
  socket.position.set(0.05, 0.004, 0.05);
  socket.castShadow = false;

  group.add(pill, socket);
  return { group, pill, top: top * S };
}

function buildCursor() {
  const group = new THREE.Group(); // pivot = tip
  const geo = new THREE.ExtrudeGeometry(cursorShape(0.058), {
    depth: 0.1,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelSegments: 2,
  });
  geo.translate(0, 0, -0.05);
  const mesh = toonMesh(geo, COLORS.white, { outline: 0.04 });
  group.add(mesh);
  group.rotation.x = LEAN;
  return group;
}

function buildClickMarks() {
  const parts = CLICK_MARKS.map((deg) => {
    const a = (deg * Math.PI) / 180;
    const g = new THREE.BoxGeometry(0.035, 0.2, 0.025);
    g.rotateZ(a - Math.PI / 2);
    g.translate(Math.cos(a) * 0.34, Math.sin(a) * 0.34, 0.08);
    return g;
  });
  const mesh = new THREE.Mesh(mergeGeometries(parts), flatMaterial(COLORS.black));
  mesh.castShadow = false;
  const group = new THREE.Group();
  group.add(mesh);
  group.scale.setScalar(0);
  return group;
}

function buildTick() {
  const geo = new THREE.ExtrudeGeometry(tickShape(0.34), {
    depth: 0.06,
    bevelEnabled: true,
    bevelThickness: 0.01,
    bevelSize: 0.01,
    bevelSegments: 2,
  });
  geo.translate(0, 0, -0.03);
  const mesh = toonMesh(geo, COLORS.purple, { outline: 0.035 });
  const group = new THREE.Group();
  group.add(mesh);
  group.rotation.x = LEAN;
  group.scale.setScalar(0);
  return group;
}

// white speech bubble (pill + tail) with a "Click!" label; pops with each click
function buildBubble() {
  const group = new THREE.Group();
  group.position.copy(BUBBLE_POS);
  const opts = { depth: 0.06, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2 };
  const pill = new THREE.ExtrudeGeometry(pillShape(0.9, 0.38), opts).translate(0, 0, -0.03);
  const tail = new THREE.Shape();
  tail.moveTo(0.1, -0.16);
  tail.lineTo(0.34, -0.16);
  tail.lineTo(0.3, -0.38);
  tail.closePath();
  const tailGeo = new THREE.ExtrudeGeometry(tail, opts).translate(0, 0, -0.03);
  const body = toonMesh(mergeGeometries([pill, tailGeo]), COLORS.white, { outline: 0.03, cast: false });
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(0.62, 0.31),
    new THREE.MeshBasicMaterial({ map: labelTexture('Click!'), transparent: true }),
  );
  label.position.z = 0.08;
  group.add(body, label);
  return group;
}

// progress bar lying across the front of the desk: white track + purple fill (scaled from its left end)
function buildProgress() {
  const group = new THREE.Group();
  group.position.set(0, SLAB_H, BAR_Z);
  const track = toonMesh(new THREE.BoxGeometry(BAR_W, 0.1, 0.13).translate(0, 0.05, 0), COLORS.white, {
    outline: 0.025,
    cast: false,
  });
  const fillGeo = new THREE.BoxGeometry(BAR_W - 0.08, 0.075, 0.15).translate((BAR_W - 0.08) / 2, 0.05, 0.005);
  const fill = toonMesh(fillGeo, COLORS.purple, { outline: 0, cast: false });
  fill.position.x = -(BAR_W - 0.08) / 2;
  fill.scale.x = 0.001;
  group.add(track, fill);
  return { group, fill };
}

// two purple "app window" cards at the back, with raised dots + bars (same colour, merged → black outline relief)
function buildCards() {
  const m = new THREE.Matrix4();
  const parts = [];
  const card = (x, z, yaw, w, h) => {
    const bits = [
      new THREE.BoxGeometry(w, h, 0.07).translate(0, h / 2, 0),
      new THREE.BoxGeometry(0.06, 0.06, 0.05).translate(-w / 2 + 0.12, h - 0.1, 0.05),
      new THREE.BoxGeometry(0.06, 0.06, 0.05).translate(-w / 2 + 0.24, h - 0.1, 0.05),
      new THREE.BoxGeometry(w * 0.7, 0.07, 0.05).translate(0, h * 0.55, 0.05),
      new THREE.BoxGeometry(w * 0.5, 0.07, 0.05).translate(-w * 0.1, h * 0.38, 0.05),
      new THREE.BoxGeometry(w * 0.6, 0.07, 0.05).translate(-w * 0.05, h * 0.21, 0.05),
    ];
    m.makeTranslation(x, 0, z).multiply(new THREE.Matrix4().makeRotationY(yaw));
    for (const b of bits) parts.push(b.applyMatrix4(m));
  };
  card(-1.15, -0.2, 0.3, 0.7, 0.95);
  card(1.2, -0.22, -0.3, 0.56, 0.72);
  const mesh = toonMesh(mergeGeometries(parts), COLORS.purple, { outline: 0.025 });
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

let dio = null;
let cursor = null;
let button = null;
let marks = null;
let tick = null;
let bubble = null;
let progress = null;
let cards = null;
let energy = 0;
let focusE = 0;
let phase = 0;
let clicks = 0;

const tipCycle = new THREE.Vector3();
const ready = new THREE.Vector3();

export default {
  id: 'flow',
  build() {
    energy = 0;
    focusE = 0;
    phase = 0;
    clicks = 0;

    const root = new THREE.Group();
    root.add(buildSlab());

    dio = new THREE.Group(); // swayed ±15° when focused; sits on the desk
    dio.position.y = SLAB_H;
    root.add(dio);

    button = buildButton();
    cursor = buildCursor();
    marks = buildClickMarks();
    tick = buildTick();
    bubble = buildBubble();
    progress = buildProgress();
    progress.group.position.y = 0; // dio is already on the desk
    cards = buildCards();
    cursor.position.copy(HOVER);
    tick.position.set(BUTTON_POS.x, 0.75, BUTTON_POS.z + 0.1);
    dio.add(cards, button.group, progress.group, bubble, cursor, marks, tick);
    return root;
  },
  update(t, dt, state) {
    if (!dio) return;
    energy += ((state === 'idle' ? 0 : 1) - energy) * damp(dt, 4);
    focusE += ((state === 'focused' ? 1 : 0) - focusE) * damp(dt, 3);

    const period = lerp(2.6, 2.1, focusE);
    const next = phase + dt / period;
    if (next >= 1) clicks++;
    phase = next % 1;
    const u = phase;

    // --- click cycle (tip position + press amount + marks) ---
    ready.set(BUTTON_POS.x, button.top + 0.12, BUTTON_POS.z + 0.02); // hovering just above the button
    let press = 0;
    let dip = 0;
    if (u < 0.3) {
      tipCycle.lerpVectors(HOVER, ready, smooth(u / 0.3));
    } else if (u < 0.38) {
      press = smooth((u - 0.3) / 0.08);
      dip = press;
      tipCycle.copy(ready);
    } else if (u < 0.46) {
      press = 1;
      dip = 1;
      tipCycle.copy(ready);
    } else if (u < 0.62) {
      const q = (u - 0.46) / 0.16;
      press = 1 - elasticOut(q);
      dip = 1 - smooth(q * 1.6);
      tipCycle.copy(ready);
    } else {
      tipCycle.lerpVectors(ready, HOVER, smooth((u - 0.62) / 0.38));
    }
    tipCycle.y -= dip * (0.12 + button.top * PRESS);

    // cursor: blend between the resting hover (bobbing) and the click cycle
    const bobY = HOVER.y + Math.sin(t * 2) * 0.04;
    cursor.position.set(
      lerp(HOVER.x, tipCycle.x, energy),
      lerp(bobY, tipCycle.y, energy),
      lerp(HOVER.z, tipCycle.z, energy),
    );
    cursor.rotation.z = Math.sin(t * 1.4) * 0.04 * (1 - energy) - dip * energy * 0.08;
    cursor.rotation.x = LEAN;

    // button squashes under the tip
    const sq = press * energy * PRESS;
    button.pill.scale.set(1 + sq * 0.12, 1 - sq, 1 + sq * 0.12);

    // "click" burst: 3 lines pop out of the tip and vanish
    const m = (u - 0.36) / 0.24;
    const markScale = m > 0 && m < 1 ? Math.sqrt(Math.sin(m * Math.PI)) * (0.6 + 0.6 * m) : 0;
    marks.scale.setScalar(markScale * energy);
    marks.position.copy(cursor.position);

    // focused: a tick floats up above the button after the click
    const v = (u - 0.44) / 0.5;
    let tickScale = 0;
    if (v > 0 && v < 1) tickScale = elasticOut(Math.min(1, v * 2.5)) * (1 - smooth((v - 0.72) / 0.28));
    tick.scale.setScalar(tickScale * focusE);
    tick.position.y = button.top + 0.5 + Math.max(0, v) * 0.25;

    // tooltip bubble: bobs, and bounces on each click
    const bounce = m > 0 && m < 1 ? Math.sin(m * Math.PI) : 0;
    const bs = 1 + 0.18 * bounce * energy;
    bubble.scale.setScalar(bs);
    bubble.position.y = BUBBLE_POS.y + Math.sin(t * 1.6) * 0.04;
    bubble.rotation.z = Math.sin(t * 1.1) * 0.03;

    // progress bar: one step per click while someone is near, a resting 1/5 otherwise
    const done = (clicks % BAR_STEPS) + (u > 0.42 ? 1 : 0);
    const target = lerp(1, done, energy) / BAR_STEPS;
    const fx = progress.fill.scale.x;
    progress.fill.scale.x = Math.max(0.001, fx + (target - fx) * damp(dt, done === 0 ? 14 : 8));

    // UI cards float gently
    cards.position.y = Math.sin(t * 1.2) * 0.012 + 0.012;
    cards.rotation.y = Math.sin(t * 0.7) * 0.02;

    dio.rotation.y = Math.sin(t * 0.45) * (Math.PI / 12) * focusE;
  },
  focusPose: { height: 1.2, zoom: 3.2 },
};
