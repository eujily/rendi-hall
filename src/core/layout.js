// Single source of truth for positions (docs/spec.md §4).
export const ROOM = { minX: -12, maxX: 12, minZ: -9, maxZ: 9 };

export const STANDS = [
  { id: 'learn', x: -8, z: -5 },
  { id: 'pay', x: -3, z: -6.5 },
  { id: 'flow', x: 3, z: -6.5 },
  { id: 'care', x: 8, z: -5 },
  { id: 'home', x: -9, z: 2.5 },
  { id: 'studio', x: 9, z: 2.5 },
  { id: 'waitlist', x: 0, z: -1 },
];

export const STAND_COLLIDER_R = 1.3;
export const STAND_NEAR_R = 2.2;
export const NPC_NEAR_R = 1.6;
export const SPAWN = { x: 0, z: 6 };
export const PLAYER_SPEED = 4.2;

export const VISITORS = [
  { id: 'v1', color: 'yellow', waypoints: [{ x: -5.5, z: -3 }, { x: -6, z: 1 }, { x: -3, z: 3.5 }] },
  { id: 'v2', color: 'red', waypoints: [{ x: 5.5, z: -3 }, { x: 6.5, z: 0.5 }, { x: 3, z: 4 }] },
  { id: 'v3', color: 'white', waypoints: [{ x: -1.5, z: -4.2 }, { x: 2.5, z: -3.8 }, { x: 4, z: 1.5 }, { x: -3.5, z: 1.5 }] },
];
