// STUB — replaced by agent ⑤ (plan Task 5).
import * as THREE from 'three';
import gsap from 'gsap';
import { ROOM } from '../core/layout.js';
import { DUR, reducedMotion } from '../core/motion.js';

const FRAME_H = 14;
const ISO = new THREE.Vector3(1, 1, 1).normalize().multiplyScalar(40);

export function createCameraRig() {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const look = new THREE.Vector3();
  let followed = null, focusing = false, tl = null;
  let w = innerWidth, h = innerHeight;

  const place = () => { camera.position.copy(look).add(ISO); camera.lookAt(look); };
  const resize = (nw, nh) => {
    w = nw; h = nh;
    const a = w / h;
    camera.left = (-FRAME_H / 2) * a; camera.right = (FRAME_H / 2) * a;
    camera.top = FRAME_H / 2; camera.bottom = -FRAME_H / 2;
    camera.updateProjectionMatrix();
  };
  resize(w, h);

  const followTarget = () => {
    const p = followed.position;
    return new THREE.Vector3(
      THREE.MathUtils.clamp(p.x, ROOM.minX + 4, ROOM.maxX - 4), 0,
      THREE.MathUtils.clamp(p.z, ROOM.minZ + 4, ROOM.maxZ - 4));
  };

  return {
    camera,
    follow(obj) { followed = obj; look.copy(followTarget()); place(); },
    update() {
      if (!focusing && followed) look.lerp(followTarget(), 0.08);
      place();
    },
    focus(worldPos, pose) {
      focusing = true; tl?.kill();
      // screen-right vector projected on the ground, so the diorama lands in the left half
      const right = new THREE.Vector3(1, 0, -1).normalize();
      const shift = (FRAME_H * (w / h)) / pose.zoom / 4;
      const to = worldPos.clone().add(new THREE.Vector3(0, pose.height, 0)).addScaledVector(right, shift);
      const d = reducedMotion() ? 0 : DUR.focus;
      return new Promise((resolve) => {
        tl = gsap.timeline({ onComplete: resolve, onInterrupt: resolve });
        tl.to(look, { x: to.x, y: to.y, z: to.z, duration: d, ease: 'power3.inOut' }, 0)
          .to(camera, { zoom: pose.zoom, duration: d, ease: 'power3.inOut', onUpdate: () => camera.updateProjectionMatrix() }, 0);
      });
    },
    release() {
      tl?.kill();
      const to = followTarget();
      const d = reducedMotion() ? 0 : DUR.close;
      return new Promise((resolve) => {
        const done = () => { focusing = false; resolve(); };
        tl = gsap.timeline({ onComplete: done, onInterrupt: done });
        tl.to(look, { x: to.x, y: 0, z: to.z, duration: d, ease: 'power3.inOut' }, 0)
          .to(camera, { zoom: 1, duration: d, ease: 'power3.inOut', onUpdate: () => camera.updateProjectionMatrix() }, 0);
      });
    },
    toScreen(v) {
      const p = v.clone().project(camera);
      return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h };
    },
    resize,
  };
}
