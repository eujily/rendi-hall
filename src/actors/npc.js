// NPC visitors: same species as Randy, brand colours, slightly different petals (seed).
// They walk their waypoints in a loop at 1.6 u/s, pause 2–4 s at each point and turn to
// look at the nearest look-at point while they wait.
import { createBlob, ACCESSORIES } from './blob.js';
import { COLORS } from '../core/tokens.js';
import { mulberry32 } from './silhouette.js';

const SPEED = 1.6;

// Each villager gets a distinct accessory, chosen by a hash of its id (first free one if it collides).
const taken = new Map(); // id → accessory
function pickAccessory(id) {
  if (taken.has(id)) return taken.get(id);
  const h = [...id].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0, 7);
  const used = new Set(taken.values());
  let i = h % ACCESSORIES.length;
  for (let k = 0; k < ACCESSORIES.length && used.has(ACCESSORIES[i]); k++) i = (i + 1) % ACCESSORIES.length;
  taken.set(id, ACCESSORIES[i]);
  return ACCESSORIES[i];
}
const ARRIVE = 0.08;

function nearestPoint(points, x, z) {
  let best = null, bestD = Infinity;
  for (const s of points) {
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

/**
 * @param {{ id: string, color: 'yellow'|'red'|'white'|'purple', waypoints: {x:number,z:number}[], lookAt?: {x:number,z:number}[] }} opts
 */
export function createNpc({ id, color, waypoints, lookAt = [] }) {
  const rnd = mulberry32([...id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7));
  const size = 0.9 * (0.93 + 0.14 * rnd()); // slight size variation
  const { object3d, rig } = createBlob({
    color: color === 'purple' ? COLORS.purple : (COLORS[color] ?? COLORS.mascot),
    seed: id,
    scale: size,
    accessory: pickAccessory(id),
  });
  object3d.name = `npc-${id}`;
  const pausePick = () => 2 + 2 * rnd();

  const pos = object3d.position;
  pos.set(waypoints[0].x, 0, waypoints[0].z);
  let target = waypoints.length > 1 ? 1 : 0;
  let pause = pausePick(); // start resting at the first point
  let vx = 0, vz = 0;

  const startPause = () => {
    pause = pausePick();
    vx = vz = 0;
    const s = nearestPoint(lookAt, pos.x, pos.z);
    if (s) rig.lookAtWorld(s.x, s.z);
  };

  return {
    id,
    object3d,
    position: pos,
    rig,
    update(dt) {
      if (pause > 0) {
        pause -= dt;
        if (pause <= 0) { rig.setLook(null); vx = vz = 0; }
      } else {
        const wp = waypoints[target];
        const dx = wp.x - pos.x, dz = wp.z - pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= ARRIVE) {
          pos.x = wp.x; pos.z = wp.z;
          target = (target + 1) % waypoints.length;
          startPause();
        } else {
          const stepLen = Math.min(SPEED * dt, dist);
          vx = (dx / dist) * SPEED; vz = (dz / dist) * SPEED;
          pos.x += (dx / dist) * stepLen;
          pos.z += (dz / dist) * stepLen;
        }
      }
      rig.update(dt, vx, vz);
    },
  };
}
