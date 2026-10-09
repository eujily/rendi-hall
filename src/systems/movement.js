// Pure movement helpers (docs/system-design.md §4). No globals, no allocation beyond the result.

const MAX_SUBSTEPS = 64;

// Push a point out of a circle collider (radial projection onto the inflated circle).
function resolve(p, colliders, radius, fallbackX, fallbackZ) {
  for (let pass = 0; pass < 2; pass++) {
    let moved = false;
    for (const c of colliders) {
      const dx = p.x - c.x, dz = p.z - c.z;
      const min = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2);
      let nx, nz;
      if (d > 1e-6) { nx = dx / d; nz = dz / d; }
      else { // dead centre: leave against the direction of travel
        const fl = Math.hypot(fallbackX, fallbackZ);
        nx = fl > 1e-6 ? -fallbackX / fl : 1;
        nz = fl > 1e-6 ? -fallbackZ / fl : 0;
      }
      p.x = c.x + nx * min;
      p.z = c.z + nz * min;
      moved = true;
    }
    if (!moved) break;
  }
}

/**
 * Advance `pos` by `vel * dt`. Circle colliders are slid around (the tangential part of the move
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
      const min = c.r + radius;
      const nx0 = p.x + mx - c.x, nz0 = p.z + mz - c.z;
      if (nx0 * nx0 + nz0 * nz0 >= min * min) continue;
      const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz);
      if (d < 1e-6) continue; // handled by resolve()
      const ux = dx / d, uz = dz / d;
      const into = mx * ux + mz * uz;
      if (into < 0) { mx -= into * ux; mz -= into * uz; }
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
