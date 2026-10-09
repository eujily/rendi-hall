import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { ROOM } from '../src/core/layout.js';

vi.mock('../src/core/motion.js', () => ({
  DUR: { fast: 0.2, base: 0.3, focus: 0.9, close: 0.6 },
  reducedMotion: () => globalThis.__reduced !== false, // default instant: deterministic, no GSAP clock
}));

const { createCameraRig, focusLookTarget, focusZoom, FRAME_H, FOLLOW_INSET } = await import('../src/systems/cameraRig.js');

// Independent camera, built the same way the rig does, to check the pure helper against real projection.
function project(point, look, zoom, vp) {
  const a = vp.w / vp.h;
  const cam = new THREE.OrthographicCamera((-FRAME_H / 2) * a, (FRAME_H / 2) * a, FRAME_H / 2, -FRAME_H / 2, 0.1, 200);
  cam.zoom = zoom;
  cam.updateProjectionMatrix();
  cam.position.copy(look).add(new THREE.Vector3(1, 1, 1).normalize().multiplyScalar(40));
  cam.lookAt(look);
  cam.updateMatrixWorld(true);
  const p = point.clone().project(cam);
  return { x: ((p.x + 1) / 2) * vp.w, y: ((1 - p.y) / 2) * vp.h };
}

const stand = new THREE.Vector3(-3, 0, -6.5); // 'pay'
const pose = { height: 1.0, zoom: 2.6 };
const point = stand.clone().setY(pose.height);

describe('focusLookTarget', () => {
  it('desktop: focused point lands at (25% w, 50% h) — 800x600', () => {
    const vp = { w: 800, h: 600 };
    const look = focusLookTarget(point, pose.zoom, vp);
    const s = project(point, look, pose.zoom, vp);
    expect(Math.abs(s.x - 200)).toBeLessThan(2);
    expect(Math.abs(s.y - 300)).toBeLessThan(2);
  });

  it('desktop: other sizes and zooms (1440x900, 768x1024 boundary)', () => {
    for (const vp of [{ w: 1440, h: 900 }, { w: 768, h: 1024 }, { w: 1920, h: 1080 }]) {
      for (const zoom of [1.5, 2.6, 3.2]) {
        const look = focusLookTarget(point, zoom, vp);
        const s = project(point, look, zoom, vp);
        expect(Math.abs(s.x - vp.w * 0.25)).toBeLessThan(2);
        expect(Math.abs(s.y - vp.h * 0.5)).toBeLessThan(2);
      }
    }
  });

  it('mobile (<768): focused point lands at (50% w, 30% h) — 375x812', () => {
    const vp = { w: 375, h: 812 };
    const zoom = focusZoom(pose.zoom, vp);
    const look = focusLookTarget(point, zoom, vp);
    const s = project(point, look, zoom, vp);
    expect(Math.abs(s.x - 187.5)).toBeLessThan(2);
    expect(Math.abs(s.y - 812 * 0.3)).toBeLessThan(2);
  });

  it('mobile zoom is capped so the stand is not clipped, desktop zoom is untouched', () => {
    expect(focusZoom(2.6, { w: 1440, h: 900 })).toBe(2.6);
    const z = focusZoom(2.6, { w: 375, h: 812 });
    expect(z).toBeLessThan(2.6);
    expect((FRAME_H * (375 / 812)) / z).toBeGreaterThanOrEqual(5 - 1e-9);
  });
});

describe('createCameraRig', () => {
  const follower = { position: new THREE.Vector3(0, 0, 3) }; // inside the follow clamp

  it('focus() puts the point at the anchor; toScreen agrees (desktop, 800x600)', async () => {
    const rig = createCameraRig();
    rig.resize(800, 600);
    rig.follow(follower);
    await rig.focus(stand, pose);
    const s = rig.toScreen(point);
    expect(Math.abs(s.x - 200)).toBeLessThan(2);
    expect(Math.abs(s.y - 300)).toBeLessThan(2);
  });

  it('resize while focused recomputes the shift (desktop -> other desktop -> mobile)', async () => {
    const rig = createCameraRig();
    rig.resize(800, 600);
    rig.follow(follower);
    await rig.focus(stand, pose);
    rig.resize(1440, 900);
    let s = rig.toScreen(point);
    expect(Math.abs(s.x - 360)).toBeLessThan(2);
    expect(Math.abs(s.y - 450)).toBeLessThan(2);
    rig.resize(375, 812);
    s = rig.toScreen(point);
    expect(Math.abs(s.x - 187.5)).toBeLessThan(2);
    expect(Math.abs(s.y - 812 * 0.3)).toBeLessThan(2);
  });

  it('release() returns to the followed target at zoom 1', async () => {
    const rig = createCameraRig();
    rig.resize(800, 600);
    rig.follow(follower);
    await rig.focus(stand, pose);
    await rig.release();
    expect(rig.camera.zoom).toBe(1);
    const s = rig.toScreen(new THREE.Vector3(0, 0, Math.min(3, ROOM.maxZ - FOLLOW_INSET)));
    expect(Math.abs(s.x - 400)).toBeLessThan(2);
    expect(Math.abs(s.y - 300)).toBeLessThan(2);
  });

  it('interrupted focus/release promises always resolve', async () => {
    const rig = createCameraRig();
    rig.resize(800, 600);
    rig.follow(follower);
    globalThis.__reduced = false; // real GSAP tweens
    try {
      const p1 = rig.focus(stand, pose);
      const p2 = rig.release(); // kills p1's tween
      await p1;
      globalThis.__reduced = true;
      await rig.focus(stand, pose); // kills p2's tween
      await p2;
    } finally {
      delete globalThis.__reduced;
    }
    const s = rig.toScreen(point);
    expect(Math.abs(s.x - 200)).toBeLessThan(2);
  });

  it('follow target is clamped inside the room', () => {
    const rig = createCameraRig();
    rig.resize(800, 600);
    const far = { position: new THREE.Vector3(100, 0, -100) };
    rig.follow(far);
    const s = rig.toScreen(new THREE.Vector3(ROOM.maxX - FOLLOW_INSET, 0, ROOM.minZ + FOLLOW_INSET));
    expect(Math.abs(s.x - 400)).toBeLessThan(2);
    expect(Math.abs(s.y - 300)).toBeLessThan(2);
  });
});
