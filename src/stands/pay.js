// Rendi Pay — a giant coin standing on its edge, doubling as a piggy bank (slot on top, cute face).
// Small coins orbit it when idle, drop into the slot when someone is near, rain when focused.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMesh, flatMaterial } from '../kit/toon.js';
import { COLORS, mix } from '../core/tokens.js';
import { createPedestal, PEDESTAL_H } from './_pedestal.js';

const damp = (dt, k) => 1 - Math.exp(-dt * k);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

const R = 0.65; // big coin radius
const T = 0.24; // big coin thickness
const N = 4; // small coins
const SMALL_R = 0.13;
const Y_SLOT = 2 * R + 0.04 + SMALL_R; // small coin centre when it sits in the slot
const Y_START = 2.0; // spawn height (keeps the diorama under 2.2)
const START_X = [-0.34, 0.26, -0.14, 0.38];
const ORBIT_R = 1.0;

// cylinder with its axis along Z (coin faces the camera)
const coinGeo = (r, h, seg) => new THREE.CylinderGeometry(r, r, h, seg).rotateX(Math.PI / 2);

function buildBigCoin() {
  const coin = new THREE.Group();
  coin.position.y = R;

  const body = toonMesh(coinGeo(R, T, 48), COLORS.yellow);
  // lighter inlay disc poking out of both faces
  const inlay = toonMesh(coinGeo(R * 0.76, T + 0.02, 48), mix(COLORS.yellow, COLORS.white, 0.3), { outline: 0, cast: false });

  // slot on the rim + face (two dots, smile) — all static, one flat black mesh
  const zFace = T / 2 + 0.006;
  const details = mergeGeometries([
    coinGeo(0.055, 0.02, 16).translate(-0.19, 0.1, zFace),
    coinGeo(0.055, 0.02, 16).translate(0.19, 0.1, zFace),
    new THREE.TorusGeometry(0.17, 0.022, 8, 24, Math.PI).rotateZ(Math.PI).translate(0, -0.02, zFace),
    new THREE.BoxGeometry(0.42, 0.08, T * 0.55).translate(0, R, 0),
  ]);
  const face = new THREE.Mesh(details, flatMaterial(COLORS.black));
  face.castShadow = false;

  coin.add(body, inlay, face);
  return coin;
}

let dio = null;
let big = null;
let coins = [];
let energy = 0;
let focusE = 0;
let phase = 0;
let spin = 0;

export default {
  id: 'pay',
  build() {
    const root = new THREE.Group();
    root.add(createPedestal({ label: 'Rendi Pay', accent: COLORS.yellow }));

    dio = new THREE.Group();
    dio.position.y = PEDESTAL_H;
    root.add(dio);

    big = buildBigCoin();
    dio.add(big);

    coins = [];
    const smallGeo = coinGeo(SMALL_R, 0.045, 24);
    for (let i = 0; i < N; i++) {
      const c = toonMesh(smallGeo, COLORS.yellow, { outline: 0.02 });
      dio.add(c);
      coins.push(c);
    }
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
      // --- orbit pose (idle) ---
      const a = t * 0.55 + (i * Math.PI * 2) / N;
      const ox = Math.cos(a) * ORBIT_R;
      const oy = R + 0.1 + Math.sin(2 * a + i) * 0.12;
      const oz = Math.sin(a) * ORBIT_R;
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

    // big coin: wobble, a happy pulse when a coin lands, slow showcase spin when focused
    spin += dt * 0.8 * focusE;
    big.rotation.y = spin;
    big.rotation.z = Math.sin(t * 1.7) * 0.04 * (1 - 0.5 * energy) + Math.sin(t * 3.1) * 0.03 * energy;
    const pulse = 1 + 0.05 * landing * energy;
    big.scale.set(pulse, 1 - 0.04 * landing * energy, pulse);
    big.position.y = R + Math.sin(t * 2) * 0.015;

    dio.rotation.y = Math.sin(t * 0.45) * (Math.PI / 12) * focusE;
  },
  focusPose: { height: 1.5, zoom: 3.0 },
};
