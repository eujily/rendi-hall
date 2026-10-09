// STUB — replaced by agent ② (plan Task 2).
import { createBlob } from './blob.js';
import { COLORS } from '../core/tokens.js';

export function createNpc({ id, color, waypoints }) {
  const { object3d } = createBlob({ color: COLORS[color], scale: 0.9 });
  object3d.rotation.y = Math.PI / 4;
  const p = waypoints[0];
  object3d.position.set(p.x, 0, p.z);
  return { id, object3d, position: object3d.position, update() {} };
}
