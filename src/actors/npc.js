// NPC visitors: same species as Randy, brand colours, slightly different petals (seed).
// They walk their waypoints in a loop at 1.6 u/s, pause 2–4 s at each point and turn to
// look at the nearest stand while they wait.
import { createBlob } from './blob.js';
import { COLORS } from '../core/tokens.js';
import { STANDS } from '../core/layout.js';
import { mulberry32 } from './silhouette.js';

const SPEED = 1.6;
const ARRIVE = 0.08;

function nearestStand(x, z) {
  let best = null, bestD = Infinity;
  for (const s of STANDS) {
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

/**
 * @param {{ id: string, color: 'yellow'|'red'|'white', waypoints: {x:number,z:number}[] }} opts
 */
export function createNpc({ id, color, waypoints }) {
  const { object3d, rig } = createBlob({ color: COLORS[color] ?? COLORS.mascot, seed: id, scale: 0.9 });
  object3d.name = `npc-${id}`;
  const rnd = mulberry32([...id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7));
  const pausePick = () => 2 + 2 * rnd();

  const pos = object3d.position;
  pos.set(waypoints[0].x, 0, waypoints[0].z);
  let target = waypoints.length > 1 ? 1 : 0;
  let pause = pausePick(); // start resting at the first point
  let vx = 0, vz = 0;

  const startPause = () => {
    pause = pausePick();
    vx = vz = 0;
    const s = nearestStand(pos.x, pos.z);
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
