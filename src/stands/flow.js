// Rendi Flow — a giant white mouse cursor clicking a yellow pill button (the apprendi.io CTA).
// idle: cursor hovers · near: it moves in, clicks, the button presses and a 3-line "click" burst pops
// · focused: same, plus a little purple tick appearing above the button after each click.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMesh, flatMaterial } from '../kit/toon.js';
import { COLORS } from '../core/tokens.js';
import { createPedestal, PEDESTAL_H } from './_pedestal.js';

const css = (c) => `#${c.toString(16).padStart(6, '0')}`;
const damp = (dt, k) => 1 - Math.exp(-dt * k);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const elasticOut = (p) =>
  p <= 0 ? 0 : p >= 1 ? 1 : 2 ** (-10 * p) * Math.sin(((p * 10 - 0.75) * 2 * Math.PI) / 3) + 1;

const LEAN = -0.3; // plates lean back toward the camera
const BUTTON_POS = new THREE.Vector3(-0.12, 0, 0.12);
const BUTTON_W = 1.0;
const BUTTON_D = 0.5;
const BUTTON_H = 0.14; // extrude depth; bevel adds 2 × 0.04
const PRESS = 0.4; // how much the button squashes
const HOVER = new THREE.Vector3(0.4, 0.95, 0.2); // cursor tip at rest
const CLICK_MARKS = [110, 150, 190]; // degrees around the tip, fanning away from the cursor body

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

function buildButton() {
  const group = new THREE.Group();
  group.position.copy(BUTTON_POS);

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
  return { group, pill, top };
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

let dio = null;
let cursor = null;
let button = null;
let marks = null;
let tick = null;
let energy = 0;
let focusE = 0;
let phase = 0;

const tipCycle = new THREE.Vector3();
const ready = new THREE.Vector3();

export default {
  id: 'flow',
  build() {
    const root = new THREE.Group();
    root.add(createPedestal({ label: 'Rendi Flow', accent: COLORS.black }));

    dio = new THREE.Group();
    dio.position.y = PEDESTAL_H;
    root.add(dio);

    button = buildButton();
    cursor = buildCursor();
    marks = buildClickMarks();
    tick = buildTick();
    cursor.position.copy(HOVER);
    tick.position.set(BUTTON_POS.x, 0.75, BUTTON_POS.z + 0.1);
    dio.add(button.group, cursor, marks, tick);
    return root;
  },
  update(t, dt, state) {
    if (!dio) return;
    energy += ((state === 'idle' ? 0 : 1) - energy) * damp(dt, 4);
    focusE += ((state === 'focused' ? 1 : 0) - focusE) * damp(dt, 3);

    const period = lerp(2.6, 2.1, focusE);
    phase = (phase + dt / period) % 1;
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

    dio.rotation.y = Math.sin(t * 0.45) * (Math.PI / 12) * focusE;
  },
  focusPose: { height: 1.4, zoom: 3.0 },
};
