// STUB — replaced by agent ⑤ (plan Task 5). Pure functions.
export function step(pos, vel, dt, colliders, bounds, radius = 0.45) {
  let x = pos.x + vel.x * dt;
  let z = pos.z + vel.z * dt;
  for (const c of colliders) {
    const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz), min = c.r + radius;
    if (d < min && d > 1e-6) { x = c.x + (dx / d) * min; z = c.z + (dz / d) * min; }
  }
  x = Math.min(bounds.maxX - radius, Math.max(bounds.minX + radius, x));
  z = Math.min(bounds.maxZ - radius, Math.max(bounds.minZ + radius, z));
  return { x, z };
}

export function velocityToward(pos, target, speed, arriveDist = 0.15) {
  const dx = target.x - pos.x, dz = target.z - pos.z, d = Math.hypot(dx, dz);
  if (d < arriveDist) return { x: 0, z: 0 };
  return { x: (dx / d) * speed, z: (dz / d) * speed };
}
