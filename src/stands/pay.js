// Rendi Pay — a diorama on a lavender counter: a giant coin standing on its edge, doubling as a piggy bank
// (slot on top, cute face). Small coins orbit it when idle, drop into the slot when someone is near, rain when focused.
// Props: coin piles, two little receipts, twinkling sparkles.
// Box: |x| <= ~1.6, |z| <= ~0.8, top y ~ 2.35 (a dropping coin at its start height).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMesh, flatMaterial } from '../kit/toon.js';
import { COLORS, mix } from '../core/tokens.js';

const damp = (dt, k) => 1 - Math.exp(-dt * k);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

const SLAB_H = 0.12;
const R0 = 0.65; // authored coin radius
const K = 1.1; // coin scale in the diorama
const R = R0 * K;
const T = 0.24; // authored thickness
const N = 3; // small coins
const SMALL_R = 0.14;
const Y_COIN = SLAB_H + R; // big coin centre
const Y_SLOT = SLAB_H + 2 * R + 0.04 + SMALL_R; // small coin centre when it sits in the slot
const Y_START = 2.2; // spawn height (coin top = 2.34 < 2.4)
const START_X = [-0.36, 0.3, 0.02];
const ORBIT_RX = 1.1;
const ORBIT_RZ = 0.38;
const ORBIT_Y = SLAB_H + 1.0;

// cylinder with its axis along Z (coin faces the camera)
const coinGeo = (r, h, seg) => new THREE.CylinderGeometry(r, r, h, seg).rotateX(Math.PI / 2);

function buildSlab() {
  const geo = new THREE.BoxGeometry(3.2, SLAB_H, 1.4).translate(0, SLAB_H / 2, 0);
  return toonMesh(geo, mix(COLORS.lavender, COLORS.purple, 0.5), { outline: 0.03, receive: true });
}

function buildBigCoin() {
  const coin = new THREE.Group();
  coin.position.y = Y_COIN;
  coin.scale.setScalar(K);

  const body = toonMesh(coinGeo(R0, T, 48), COLORS.yellow);
  // lighter inlay disc poking out of both faces
  const inlay = toonMesh(coinGeo(R0 * 0.76, T + 0.02, 48), mix(COLORS.yellow, COLORS.white, 0.3), { outline: 0, cast: false });

  // slot on the rim + face (two dots, smile) — all static, one flat black mesh
  const zFace = T / 2 + 0.006;
  const details = mergeGeometries([
    coinGeo(0.055, 0.02, 16).translate(-0.19, 0.1, zFace),
    coinGeo(0.055, 0.02, 16).translate(0.19, 0.1, zFace),
    new THREE.TorusGeometry(0.17, 0.022, 8, 24, Math.PI).rotateZ(Math.PI).translate(0, -0.02, zFace),
    new THREE.BoxGeometry(0.42, 0.08, T * 0.55).translate(0, R0, 0),
  ]);
  const face = new THREE.Mesh(details, flatMaterial(COLORS.black));
  face.castShadow = false;

  coin.add(body, inlay, face);
  return coin;
}

// two stacks of coins lying on the counter (one yellow mesh)
function buildPiles() {
  const parts = [];
  const stack = (x, z, n, r, twist) => {
    for (let i = 0; i < n; i++) {
      const g = new THREE.CylinderGeometry(r, r, 0.05, 20);
      g.rotateY(twist * i);
      g.translate(x + Math.sin(i * 2.1) * 0.012, SLAB_H + 0.026 + i * 0.058, z);
      parts.push(g);
    }
  };
  stack(-1.2, 0.0, 5, 0.17, 0.5);
  stack(-0.85, 0.2, 3, 0.15, 0.7);
  stack(-1.35, -0.3, 2, 0.14, 0.4);
  return toonMesh(mergeGeometries(parts), COLORS.yellow, { outline: 0.02 });
}

// two receipts leaning against nothing in particular: white paper + black text lines
function buildReceipts() {
  const group = new THREE.Group();
  group.position.set(1.12, SLAB_H - 0.01, -0.3);
  group.rotation.y = -0.35;
  const paper = [];
  const lines = [];
  const sheet = (x, w, h, lean, lineCount) => {
    const mk = (geo) => geo.rotateX(-lean).translate(x, 0, 0);
    paper.push(mk(new THREE.BoxGeometry(w, h, 0.018).translate(0, h / 2, 0)));
    for (let i = 0; i < lineCount; i++) {
      const lw = w * (i === 0 ? 0.6 : 0.78 - (i % 2) * 0.2);
      // sit just in front of the paper (z + 0.012), rotated with it
      lines.push(mk(new THREE.BoxGeometry(lw, 0.022, 0.006).translate((i === 0 ? 0 : -0.02), h - 0.09 - i * 0.06, 0.012)));
    }
  };
  sheet(0, 0.34, 0.5, 0.2, 5);
  sheet(-0.3, 0.28, 0.36, 0.38, 3);
  const pm = toonMesh(mergeGeometries(paper), COLORS.white, { outline: 0.015 });
  const lm = new THREE.Mesh(mergeGeometries(lines), flatMaterial(COLORS.black));
  lm.castShadow = false;
  group.add(pm, lm);
  return group;
}

function starGeo(r, inner) {
  const s = new THREE.Shape();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 + Math.PI / 2;
    const rr = i % 2 ? inner : r;
    i ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false }).translate(0, 0, -0.01);
}

let dio = null;
let big = null;
let coins = [];
let receipts = null;
let sparkles = [];
let energy = 0;
let focusE = 0;
let phase = 0;

export default {
  id: 'pay',
  build() {
    energy = 0;
    focusE = 0;
    phase = 0;

    const root = new THREE.Group();
    root.add(buildSlab());

    dio = new THREE.Group(); // swayed ±15° when focused
    root.add(dio);

    big = buildBigCoin();
    dio.add(big);
    dio.add(buildPiles());
    receipts = buildReceipts();
    dio.add(receipts);

    coins = [];
    const smallGeo = coinGeo(SMALL_R, 0.045, 24);
    for (let i = 0; i < N; i++) {
      const c = toonMesh(smallGeo, COLORS.yellow, { outline: 0.02 });
      dio.add(c);
      coins.push(c);
    }

    sparkles = [];
    const sg = starGeo(0.13, 0.035);
    [[-0.95, 1.55, 0.2, 0], [1.0, 1.7, 0.1, 2.1]].forEach(([x, y, z, ph]) => {
      const m = new THREE.Mesh(sg, flatMaterial(COLORS.purple));
      m.castShadow = false;
      m.position.set(x, y, z);
      m.userData.ph = ph;
      dio.add(m);
      sparkles.push(m);
    });
    return root;
  },
  update(t, dt, state) {
    if (!dio) return;
    energy += ((state === 'idle' ? 0 : 1) - energy) * damp(dt, 4);
    focusE += ((state === 'focused' ? 1 : 0) - focusE) * damp(dt, 3);

    // drop cycle: slower when near, a quick rain when focused
    const period = lerp(2.4, 1.3, focusE);
    phase = (phase + dt / period) % 1;

    let landing = 0;
    coins.forEach((c, i) => {
      // --- orbit pose (idle): a flat ellipse in front of / behind the big coin ---
      const a = t * 0.55 + (i * Math.PI * 2) / N;
      const ox = Math.cos(a) * ORBIT_RX;
      const oy = ORBIT_Y + Math.sin(2 * a + i) * 0.12;
      const oz = Math.sin(a) * ORBIT_RZ;
      const orot = t * 1.6 + i;

      // --- drop pose (near/focused) ---
      const u = (phase + i / N) % 1;
      let dx = START_X[i], dy = Y_START, dz = 0, sx = 1, sy = 1, drot = 0;
      if (u < 0.5) {
        const k = u / 0.5;
        dx = START_X[i] * (1 - smooth(k));
        dy = Y_START + (Y_SLOT - Y_START) * k * k;
        drot = k * Math.PI * 2;
      } else if (u < 0.6) {
        const q = (u - 0.5) / 0.1;
        dx = 0;
        dy = Y_SLOT;
        sx = 1 + 0.3 * Math.sin(q * Math.PI);
        sy = 1 - 0.3 * Math.sin(q * Math.PI);
        landing = Math.max(landing, Math.sin(q * Math.PI));
      } else if (u < 0.78) {
        const q = (u - 0.6) / 0.18;
        dx = 0;
        dy = Y_SLOT - 0.22 * q;
        sx = sy = 1 - q;
      } else {
        sx = sy = 0;
      }

      c.position.set(lerp(ox, dx, energy), lerp(oy, dy, energy), lerp(oz, dz, energy));
      c.rotation.y = lerp(orot, drot, energy);
      c.scale.set(lerp(1, sx, energy), lerp(1, sy, energy), 1);
      c.visible = c.scale.x > 0.01;
    });

    // big coin: wobble, a happy pulse when a coin lands, a gentle showcase turn when focused
    big.rotation.y = Math.sin(t * 0.8) * 0.3 * focusE;
    big.rotation.z = Math.sin(t * 1.7) * 0.04 * (1 - 0.5 * energy) + Math.sin(t * 3.1) * 0.03 * energy;
    const pulse = 1 + 0.05 * landing * energy;
    big.scale.set(K * pulse, K * (1 - 0.04 * landing * energy), K * pulse);
    big.position.y = Y_COIN + Math.sin(t * 2) * 0.015;

    // receipts flutter, sparkles twinkle (stronger when someone is near)
    receipts.rotation.z = Math.sin(t * 1.3) * 0.02 * (1 + 2 * energy);
    for (const s of sparkles) {
      const w = Math.abs(Math.sin(t * 2.2 + s.userData.ph));
      s.scale.setScalar((0.35 + 0.65 * w) * (0.6 + 0.4 * energy));
      s.rotation.z = t * 0.6 + s.userData.ph;
    }

    dio.rotation.y = Math.sin(t * 0.45) * (Math.PI / 12) * focusE;
  },
  focusPose: { height: 1.3, zoom: 3.2 },
};
