import * as THREE from 'three';
import gsap from 'gsap';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS } from '../core/tokens.js';
import { toonMaterial } from '../kit/toon.js';
import { reducedMotion } from '../core/motion.js';

// Tiny toon beetle (~0.35 long). 3 draw calls: body (vertex-coloured), legs, marker sprite.

const WANDER_R = 0.6;
const BODY_Y = 0.02;

function paint(geo, color, m4) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (m4) g.applyMatrix4(m4);
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

const M = (x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );

let sharedBody = null;
let sharedLegs = null;
let bodyMat = null;
const markerTex = {};

function bodyGeometry(shell) {
  const parts = [];
  const sph = (r) => new THREE.SphereGeometry(r, 14, 10);
  parts.push(paint(sph(0.13), shell, M(0, 0.1, -0.02, 1, 0.75, 1.25)));
  // shell seam + dots
  parts.push(paint(new THREE.BoxGeometry(0.012, 0.012, 0.3), COLORS.black, M(0, 0.2, -0.02)));
  for (const [x, z] of [[-0.065, -0.07], [0.065, -0.07], [-0.06, 0.04], [0.06, 0.04]]) {
    parts.push(paint(sph(0.03), COLORS.black, M(x, 0.175, z, 1, 0.5, 1)));
  }
  // shell shine: a long soft glint + a dot on the upper-left, a faint one on the right shoulder
  parts.push(paint(sph(1), COLORS.white, M(-0.062, 0.188, -0.003, 0.014, 0.005, 0.055, 0, 0, 0.4)));
  parts.push(paint(sph(1), COLORS.white, M(-0.05, 0.178, 0.072, 0.009, 0.004, 0.012, 0, 0, 0.35)));
  parts.push(paint(sph(1), COLORS.white, M(0.07, 0.18, -0.07, 0.01, 0.004, 0.022, 0, 0, -0.5)));
  // wing-case rim line (dark band where the shell meets the body)
  parts.push(paint(new THREE.TorusGeometry(0.128, 0.006, 6, 24), COLORS.black, M(0, 0.078, 0.0, 1, 1.25, 1, Math.PI / 2, 0, 0)));
  // head
  parts.push(paint(sph(0.075), COLORS.black, M(0, 0.1, 0.17)));
  // googly eyes (white + pupil)
  for (const s of [-1, 1]) {
    parts.push(paint(sph(0.045), COLORS.white, M(s * 0.04, 0.17, 0.2)));
    parts.push(paint(sph(0.02), COLORS.black, M(s * 0.04, 0.178, 0.238)));
  }
  // antennae
  for (const s of [-1, 1]) {
    parts.push(paint(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 5), COLORS.black, M(s * 0.04, 0.17, 0.27, 1, 1, 1, 1.0, 0, -s * 0.5)));
    parts.push(paint(sph(0.016), COLORS.black, M(s * 0.075, 0.2, 0.32)));
  }
  const g = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return g;
}

// Six jointed legs: coxa → bent femur (knee up and out) → tibia down to a tiny foot.
function legsGeometry() {
  const parts = [];
  const UP = new THREE.Vector3(0, 1, 0);
  const seg = (a, b, r) => {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    const g = new THREE.CylinderGeometry(r, r * 0.8, len, 6);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, d.normalize());
    return paint(g, COLORS.black, new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  };
  for (const s of [-1, 1]) {
    for (const [z, sweep] of [[-0.09, -0.07], [0.0, 0.0], [0.09, 0.08]]) {
      const hip = new THREE.Vector3(s * 0.1, 0.07, z);
      const knee = new THREE.Vector3(s * 0.2, 0.14, z + sweep * 0.5);
      const foot = new THREE.Vector3(s * 0.25, 0.0, z + sweep);
      parts.push(seg(hip, knee, 0.0085), seg(knee, foot, 0.007));
      parts.push(paint(new THREE.SphereGeometry(0.0105, 7, 5), COLORS.black, M(knee.x, knee.y, knee.z)));
      parts.push(paint(new THREE.SphereGeometry(0.009, 7, 5), COLORS.black, M(foot.x, foot.y + 0.003, foot.z, 1, 0.7, 1.4)));
    }
  }
  const g = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return g;
}

function makeMarkerTexture(label, bg, fg) {
  const key = label + bg;
  if (markerTex[key]) return markerTex[key];
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 96;
  const x = c.getContext('2d');
  x.fillStyle = bg;
  x.strokeStyle = '#000';
  x.lineWidth = 6;
  x.beginPath();
  x.roundRect(8, 8, 112, 64, 18);
  x.fill();
  x.stroke();
  // tail
  x.beginPath();
  x.moveTo(52, 70);
  x.lineTo(64, 90);
  x.lineTo(76, 70);
  x.fillStyle = bg;
  x.fill();
  x.fillStyle = fg;
  x.font = '800 italic 40px Montserrat, system-ui, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(label, 64, 42);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  markerTex[key] = tex;
  return tex;
}

const markerTextures = () => ({
  bang: makeMarkerTexture('!', '#f5d360', '#000'),
  code: makeMarkerTexture('</>', '#d63532', '#fff'),
  ok: makeMarkerTexture('✓', '#a9c79a', '#000'),
});

export function createBug({ variant = 0 } = {}) {
  const shell = variant % 2 ? COLORS.black : COLORS.red;
  if (!bodyMat) {
    bodyMat = toonMaterial(0xffffff).clone();
    bodyMat.vertexColors = true;
  }
  sharedBody ??= {};
  sharedBody[shell] ??= bodyGeometry(shell);
  sharedLegs ??= legsGeometry();

  const object3d = new THREE.Group();
  object3d.name = 'bug';
  const body = new THREE.Group();
  object3d.add(body);

  const bodyMesh = new THREE.Mesh(sharedBody[shell], bodyMat);
  bodyMesh.castShadow = true;
  const legs = new THREE.Mesh(sharedLegs, toonMaterial(COLORS.black));
  body.add(bodyMesh, legs);

  const tx = markerTextures();
  const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx.bang, depthTest: false, transparent: true }));
  marker.scale.set(0.5, 0.375, 1);
  marker.renderOrder = 50;
  object3d.add(marker);

  const phase = Math.random() * Math.PI * 2;
  const dir = Math.random() < 0.5 ? 1 : -1;
  const speed = 0.35 + Math.random() * 0.15; // rad/s on the circle
  let fixing = false;
  let gone = false;
  let glitchUntil = 0;
  let nextGlitch = 0.8 + Math.random();
  let lastSwap = 0;

  function update(t, dt) {
    if (gone) return;
    const wob = reducedMotion() ? 0 : 1;
    if (!fixing) {
      const a = phase + t * speed * dir * (wob ? 1 : 0.4);
      const r = WANDER_R * (0.85 + 0.15 * Math.sin(t * 0.7 + phase));
      body.position.set(Math.cos(a) * r - WANDER_R, BODY_Y, Math.sin(a) * r);
      // tangent heading
      body.rotation.y = Math.atan2(-Math.sin(a) * dir, Math.cos(a) * dir);
      body.rotation.z = Math.sin(t * 14 + phase) * 0.05 * wob;
      legs.rotation.y = Math.sin(t * 22 + phase) * 0.14 * wob;
      legs.scale.x = 1 + Math.sin(t * 22 + phase) * 0.06 * wob;
      // glitchy marker
      const bob = Math.sin(t * 3 + phase) * 0.06 * wob;
      marker.position.set(body.position.x, 0.62 + bob, body.position.z);
      if (wob && t > nextGlitch) {
        glitchUntil = t + 0.12;
        nextGlitch = t + 1.2 + Math.random() * 1.6;
        marker.material.map = marker.material.map === tx.bang ? tx.code : tx.bang;
        lastSwap = t;
      }
      if (t < glitchUntil) marker.position.x += (Math.random() - 0.5) * 0.08;
      else if (lastSwap && t - lastSwap > 0.01 && !wob) marker.material.map = tx.bang;
    }
  }

  function fix() {
    if (fixing) return Promise.resolve();
    fixing = true;
    return new Promise((resolve) => {
      const finish = () => {
        gone = true;
        object3d.visible = false;
        resolve();
      };
      marker.material.map = tx.ok;
      marker.material.needsUpdate = true;
      const tl = gsap.timeline({ onComplete: finish });
      if (reducedMotion()) {
        tl.to(marker.material, { opacity: 0, duration: 0.3, delay: 0.5 }).set(body, { visible: false }, 0);
        return;
      }
      tl.to(body.scale, { x: 1.5, y: 0.35, z: 1.5, duration: 0.12, ease: 'power2.out' })
        .to(body.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.28, ease: 'back.in(2)' })
        .fromTo(marker.scale, { x: 0.2, y: 0.15 }, { x: 0.7, y: 0.525, duration: 0.3, ease: 'back.out(3)' }, 0.1)
        .to(marker.position, { y: '+=0.5', duration: 0.7, ease: 'power2.out' }, 0.1)
        .to(marker.material, { opacity: 0, duration: 0.3, ease: 'power1.in' }, 0.65);
    });
  }

  return { object3d, update, fix };
}
