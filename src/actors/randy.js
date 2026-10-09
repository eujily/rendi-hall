// Randy — the player's mascot. Movement is driven by main.js (it sets object3d.position);
// this module only animates the rig from the velocity it is told about.
import { createBlob } from './blob.js';
import { COLORS } from '../core/tokens.js';

export function createRandy() {
  const { object3d, rig } = createBlob({ color: COLORS.mascot, seed: 0, scale: 1 });
  object3d.name = 'randy';
  let vx = 0, vz = 0;
  return {
    object3d,
    rig,
    setVelocity(x, z) { vx = x; vz = z; },
    wave() { rig.wave(); },
    update(dt) { rig.update(dt, vx, vz); },
  };
}
