// Pure movement helpers (docs/system-design.md §4). No globals, no allocation beyond the result.

const MAX_SUBSTEPS = 64;

// Contact of a disc (radius r at x,z) with a collider: signed distance `d` (< 0 = penetrating) and
// the outward unit normal. Circle {x,z,r} and axis-aligned box {type:'box',minX,maxX,minZ,maxZ}
// (boxes behave as rounded boxes: the disc is kept `r` away from faces and corners).
// Returns null when the normal is undefined (dead centre of a circle).
function contact(c, x, z, r) {
  if (c.type === 'box') {
    const qx = Math.min(c.maxX, Math.max(c.minX, x)), qz = Math.min(c.maxZ, Math.max(c.minZ, z));
    const dx = x - qx, dz = z - qz, d = Math.hypot(dx, dz);
    if (d > 1e-9) return { nx: dx / d, nz: dz / d, d: d - r };
    // Centre inside the box: leave through the nearest face.
    const f = [[x - c.minX, -1, 0], [c.maxX - x, 1, 0], [z - c.minZ, 0, -1], [c.maxZ - z, 0, 1]].reduce((m, e) => (e[0] < m[0] ? e : m));
    return { nx: f[1], nz: f[2], d: -f[0] - r };
  }
  const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz);
  if (d < 1e-6) return null;
  return { nx: dx / d, nz: dz / d, d: d - (c.r + r) };
}

// Push a point out of every collider it penetrates (radial projection onto the inflated shape).
function resolve(p, colliders, radius, fallbackX, fallbackZ) {
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const c of colliders) {
      let k = contact(c, p.x, p.z, radius);
      if (k === null) { // dead centre of a circle: leave against the direction of travel
        const fl = Math.hypot(fallbackX, fallbackZ);
        k = { nx: fl > 1e-6 ? -fallbackX / fl : 1, nz: fl > 1e-6 ? -fallbackZ / fl : 0, d: -(c.r + radius) };
      }
      if (k.d >= 0) continue;
      p.x += k.nx * -k.d;
      p.z += k.nz * -k.d;
      moved = true;
    }
    if (!moved) break;
  }
}

/**
 * Advance `pos` by `vel * dt`. Circle and box colliders are slid around (the tangential part of the move
 * is kept, the part that would enter the circle is removed). Large dt is sub-stepped so a fast
 * mover cannot tunnel through a collider. Result is clamped to `bounds` shrunk by `radius`.
 */
export function step(pos, vel, dt, colliders, bounds, radius = 0.45) {
  const p = { x: pos.x, z: pos.z };
  const vx = vel.x, vz = vel.z;
  if (!(dt > 0) || !Number.isFinite(vx) || !Number.isFinite(vz)) {
    resolve(p, colliders, radius, 0, 0);
    return clampTo(p, bounds, radius);
  }

  const dist = Math.hypot(vx, vz) * dt;
  const maxStep = Math.max(radius * 0.5, 1e-3);
  const n = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dist / maxStep)));
  const h = dt / n;

  for (let i = 0; i < n; i++) {
    let mx = vx * h, mz = vz * h;
    // Slide: strip the into-collider component of the move for every collider we would enter.
    for (const c of colliders) {
      if ((contact(c, p.x + mx, p.z + mz, radius)?.d ?? 0) >= 0) continue;
      const k = contact(c, p.x, p.z, radius);
      if (!k) continue; // handled by resolve()
      const into = mx * k.nx + mz * k.nz;
      if (into < 0) { mx -= into * k.nx; mz -= into * k.nz; }
    }
    p.x += mx;
    p.z += mz;
    resolve(p, colliders, radius, vx, vz);
    clampTo(p, bounds, radius);
  }
  return p;
}

function clampTo(p, b, radius) {
  const loX = b.minX + radius, hiX = b.maxX - radius;
  const loZ = b.minZ + radius, hiZ = b.maxZ - radius;
  p.x = loX > hiX ? (b.minX + b.maxX) / 2 : Math.min(hiX, Math.max(loX, p.x));
  p.z = loZ > hiZ ? (b.minZ + b.maxZ) / 2 : Math.min(hiZ, Math.max(loZ, p.z));
  return p;
}

/** Velocity of magnitude `speed` towards `target`; {0,0} once within `arriveDist`. */
export function velocityToward(pos, target, speed, arriveDist = 0.15) {
  const dx = target.x - pos.x, dz = target.z - pos.z, d = Math.hypot(dx, dz);
  if (d < arriveDist || d < 1e-9) return { x: 0, z: 0 };
  return { x: (dx / d) * speed, z: (dz / d) * speed };
}
