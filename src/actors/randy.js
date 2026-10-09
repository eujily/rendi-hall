// STUB — replaced by agent ② (plan Task 2).
import { createBlob } from './blob.js';
import { COLORS } from '../core/tokens.js';

export function createRandy() {
  const { object3d, rig } = createBlob({ color: COLORS.mascot });
  // Billboard-ish: the flat body always faces the isometric camera.
  object3d.rotation.y = Math.PI / 4;
  let speed = 0, t = 0;
  return {
    object3d,
    setVelocity(vx, vz) { speed = Math.hypot(vx, vz); },
    wave() {},
    update(dt) {
      t += dt;
      rig.body.position.y = 0.85 + (speed > 0.01 ? Math.abs(Math.sin(t * 10)) * 0.06 : 0);
    },
  };
}
