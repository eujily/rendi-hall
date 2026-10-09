// Orthographic true-isometric camera (docs/system-design.md §4–§5).
import * as THREE from 'three';
import gsap from 'gsap';
import { ROOM } from '../core/layout.js';
import { DUR, reducedMotion } from '../core/motion.js';

export const FRAME_H = 19; // world units visible vertically at zoom 1
export const MOBILE_MAX_W = 768; // viewport width below this uses the "top half" focus layout
const FOLLOW_LERP = 0.08; // per 1/60 s
export const FOLLOW_INSET = 6.5; // follow target stays this far inside ROOM, so the frame never drifts out
// Stand poses are authored against a 14-unit frame; scale them so framing survives FRAME_H changes.
const POSE_FRAME_H = 14;
const MIN_VISIBLE_W = 5; // on narrow screens zoom is capped so at least this many units are visible

// Camera basis (true isometric: looks along −(1,1,1)). Screen-right = (1,0,−1)/√2.
const DIR = new THREE.Vector3(1, 1, 1).normalize();
const ISO = DIR.clone().multiplyScalar(40);
const FWD = DIR.clone().negate();
const RIGHT = new THREE.Vector3().crossVectors(FWD, new THREE.Vector3(0, 1, 0)).normalize();
const UP = new THREE.Vector3().crossVectors(RIGHT, FWD).normalize();

export const isMobile = (vp) => vp.w < MOBILE_MAX_W;

/** Visible world size (screen units along camera right / up) of the frustum at `zoom`. */
export function viewSize(zoom, vp) {
  return { w: (FRAME_H * (vp.w / vp.h)) / zoom, h: FRAME_H / zoom };
}

/** Where the focused point must land on screen, in NDC: desktop (25%, 50%), mobile (50%, 30%). */
export function focusAnchorNdc(vp) {
  return isMobile(vp) ? { x: 0, y: 1 - 2 * 0.3 } : { x: 2 * 0.25 - 1, y: 0 };
}

/** Zoom actually used for a pose: pose zoom, capped on narrow viewports so the diorama is not clipped. */
export function focusZoom(poseZoom, vp) {
  if (!isMobile(vp)) return poseZoom;
  return Math.min(poseZoom, (FRAME_H * (vp.w / vp.h)) / MIN_VISIBLE_W);
}

/**
 * Camera look-at target that puts `worldPoint` at the focus anchor of the screen.
 * Screen offset of P from the look point is (P − look)·right = ndc.x · W/2 and
 * (P − look)·up = ndc.y · H/2 (W, H = zoomed frustum size), hence
 * look = P − right·(ndc.x·W/2) − up·(ndc.y·H/2).
 */
export function focusLookTarget(worldPoint, zoom, vp, out = new THREE.Vector3()) {
  const { w, h } = viewSize(zoom, vp);
  const a = focusAnchorNdc(vp);
  return out.copy(worldPoint).addScaledVector(RIGHT, -a.x * (w / 2)).addScaledVector(UP, -a.y * (h / 2));
}

const clampRange = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
const lerp = (a, b, t) => a + (b - a) * t;

export function createCameraRig() {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const look = new THREE.Vector3();
  const vp = {
    w: typeof innerWidth === 'number' ? innerWidth : 800,
    h: typeof innerHeight === 'number' ? innerHeight : 600,
  };
  let followed = null;
  let state = 'follow'; // 'follow' | 'focus' | 'release'
  const focus = { point: new THREE.Vector3(), zoom: 1, baseZoom: 1 };
  let tween = null;
  let pendingResolve = null;
  const tmp = new THREE.Vector3();

  const place = () => {
    camera.position.copy(look).add(ISO);
    camera.lookAt(look);
    camera.updateMatrixWorld(true); // keeps matrixWorldInverse fresh for toScreen() before render
  };
  const setZoom = (z) => {
    camera.zoom = z;
    camera.updateProjectionMatrix();
  };
  const frustum = () => {
    const a = vp.w / vp.h;
    camera.left = (-FRAME_H / 2) * a;
    camera.right = (FRAME_H / 2) * a;
    camera.top = FRAME_H / 2;
    camera.bottom = -FRAME_H / 2;
    camera.updateProjectionMatrix();
  };

  const followTarget = (out = new THREE.Vector3()) => {
    if (!followed) return out.copy(look);
    const p = followed.position;
    return out.set(
      clampRange(p.x, ROOM.minX + FOLLOW_INSET, ROOM.maxX - FOLLOW_INSET),
      0,
      clampRange(p.z, ROOM.minZ + FOLLOW_INSET, ROOM.maxZ - FOLLOW_INSET),
    );
  };
  // Where the camera wants to be right now (live: recomputed every tick so resize/movement are honoured).
  const goal = (out) => (state === 'focus' ? focusLookTarget(focus.point, focus.zoom, vp, out) : followTarget(out));
  const goalZoom = () => (state === 'focus' ? focus.zoom : 1);

  // Settle any running animation: the promise it owes is always resolved, never leaked.
  const cancel = () => {
    tween?.kill();
    tween = null;
    const r = pendingResolve;
    pendingResolve = null;
    r?.();
  };

  function animate(duration) {
    cancel();
    const fromLook = look.clone();
    const fromZoom = camera.zoom;
    const apply = (t) => {
      goal(tmp);
      look.lerpVectors(fromLook, tmp, t);
      setZoom(lerp(fromZoom, goalZoom(), t));
      place();
    };
    if (duration <= 0) {
      apply(1);
      if (state === 'release') state = 'follow';
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      pendingResolve = resolve;
      const proxy = { t: 0 };
      tween = gsap.to(proxy, {
        t: 1,
        duration,
        ease: 'power3.inOut',
        onUpdate: () => apply(proxy.t),
        onComplete: () => {
          apply(1);
          tween = null;
          if (state === 'release') state = 'follow';
          const r = pendingResolve;
          pendingResolve = null;
          r?.();
        },
      });
    });
  }

  frustum();
  place();

  return {
    camera,
    follow(obj) {
      followed = obj;
      if (state === 'follow') {
        followTarget(look);
        place();
      }
    },
    update(dt = 1 / 60) {
      if (state === 'follow' && followed) {
        const k = 1 - Math.pow(1 - FOLLOW_LERP, Math.min(Math.max(dt, 0), 0.1) * 60);
        look.lerp(followTarget(tmp), k);
      }
      place();
    },
    focus(worldPos, pose) {
      focus.point.copy(worldPos);
      focus.point.y += pose.height ?? 0;
      focus.baseZoom = (pose.zoom ?? 1) * (FRAME_H / POSE_FRAME_H);
      focus.zoom = focusZoom(focus.baseZoom, vp);
      state = 'focus';
      return animate(reducedMotion() ? 0 : DUR.focus);
    },
    release() {
      state = 'release';
      return animate(reducedMotion() ? 0 : DUR.close);
    },
    toScreen(v) {
      const p = tmp.copy(v).project(camera);
      return { x: ((p.x + 1) / 2) * vp.w, y: ((1 - p.y) / 2) * vp.h };
    },
    resize(w, h) {
      if (!(w > 0 && h > 0)) return;
      vp.w = w;
      vp.h = h;
      frustum();
      if (state === 'focus') {
        // Re-derive zoom + shift for the new viewport (zoom may change across the mobile breakpoint).
        // A running tween picks the new goal up on its next tick; a settled one is snapped here.
        focus.zoom = focusZoom(focus.baseZoom, vp);
        if (!tween) {
          focusLookTarget(focus.point, focus.zoom, vp, look);
          setZoom(focus.zoom);
        }
      }
      place();
    },
  };
}
