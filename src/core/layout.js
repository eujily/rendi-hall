// Single source of truth for positions (docs/spec.md §4, docs/town-and-museum.md).
// Two zones share one scene: the TOWN (outdoor, Stardew-cozy) and the HALL (Products museum).
// Zones live side by side in world space; only the active one is visible.

// Colliders: circle {x, z, r}  |  box {type: 'box', minX, maxX, minZ, maxZ}
export const PLAYER_SPEED = 4.2;
export const NPC_NEAR_R = 1.6;

// ---------------------------------------------------------------- HALL (museum)
// The hall keeps its own coordinates around the origin.
export const ROOM = { minX: -12, maxX: 12, minZ: -9, maxZ: 9 }; // = HALL.bounds (legacy name)
export const HALL_WALL_H = 5.5;

// IT-style exhibit frames ("app windows" hung on the walls, a deep vitrine with a diorama inside).
// Frame local space: origin on the wall's inner face at floor level, front = local +Z, up = +Y.
export const FRAME = {
  outerW: 4.2, // bezel outer width
  depth: 2.2, // how far the vitrine sticks out of the wall
  bottomY: 1.0, // bottom of the window opening above the floor
  innerW: 3.6, // diorama box
  innerH: 2.6,
  innerD: 2.0,
  // Diorama origin: bottom-centre of the inner box, at local (0, bottomY, depth/2 + 0.1).
  // Diorama must fit |x| ≤ 1.7, 0 ≤ y ≤ 2.4, |z| ≤ 0.9 (including idle/near/focused animation).
};
// Exhibit anchor (x, z) is on the inner face of the wall; rotY turns local +Z into `normal`.
export const EXHIBITS = [
  { id: 'learn', wall: 'back', x: -7, z: -9, rotY: 0, normal: { x: 0, z: 1 } },
  { id: 'pay', wall: 'back', x: 0, z: -9, rotY: 0, normal: { x: 0, z: 1 } },
  { id: 'flow', wall: 'back', x: 7, z: -9, rotY: 0, normal: { x: 0, z: 1 } },
  { id: 'care', wall: 'left', x: -12, z: -4, rotY: Math.PI / 2, normal: { x: 1, z: 0 } },
  { id: 'home', wall: 'left', x: -12, z: 0.8, rotY: Math.PI / 2, normal: { x: 1, z: 0 } },
  { id: 'studio', wall: 'left', x: -12, z: 5.6, rotY: Math.PI / 2, normal: { x: 1, z: 0 } },
];
export const EXHIBIT_SPOT_DIST = 3.4; // from the wall along `normal`: where Randy stands to look
export const EXHIBIT_NEAR_R = 2.0;
/** Floor point in front of an exhibit (proximity centre). */
export const exhibitSpot = (e, d = EXHIBIT_SPOT_DIST) => ({ x: e.x + e.normal.x * d, z: e.z + e.normal.z * d });
/** Centre of the window opening in world space (camera focus point). */
export const exhibitCenter = (e) => ({
  x: e.x + e.normal.x * FRAME.depth,
  y: FRAME.bottomY + FRAME.innerH / 2,
  z: e.z + e.normal.z * FRAME.depth,
});

// Exit back to town: a door mat at the front edge of the hall (front walls are cut away).
export const HALL_EXIT = { x: 0, z: 8.4, r: 0.9 };
export const HALL_SPAWN = { x: 0, z: 6.2 }; // where Randy appears when entering from town
export const HALL_VISITORS = [
  { id: 'v1', color: 'yellow', waypoints: [{ x: -6, z: -4 }, { x: -6, z: 1 }, { x: -2, z: 3 }] },
  { id: 'v2', color: 'red', waypoints: [{ x: 5, z: -4 }, { x: 6, z: 2 }, { x: 2, z: 4 }] },
];

// ---------------------------------------------------------------- TOWN
// Offset of the town origin in world space (keeps it far from the hall; shadows/raycasts never mix).
export const TOWN_ORIGIN = { x: 200, z: 0 };
// Everything below is in TOWN-LOCAL coordinates; add TOWN_ORIGIN for world space.
export const TOWN = { minX: -22, maxX: 22, minZ: -17, maxZ: 17 };

// Buildings: footprint centre + size (w along x, d along z); doors face +Z (toward the camera).
export const BUILDINGS = [
  { id: 'products', x: 0, z: -10, w: 12, d: 7, door: { x: 0, z: -6.5 }, sign: 'PRODUCTS' },
  { id: 'about', x: -13, z: -7, w: 6, d: 5, door: { x: -13, z: -4.5 }, sign: 'About' },
  { id: 'how', x: 13, z: -7, w: 6, d: 5, door: { x: 13, z: -4.5 }, sign: 'How we work' },
  { id: 'news', x: -12, z: 8, w: 3.4, d: 2.4, door: { x: -12, z: 9.2 }, sign: 'News' },
  { id: 'post', x: 12, z: 8, w: 5, d: 4, door: { x: 12, z: 10 }, sign: 'Post' },
];
export const PLAZA = { x: 0, z: 2, r: 1.8 }; // fountain / deploy pad in the centre
export const TOWN_SPAWN = { x: 0, z: 12 }; // first spawn
export const TOWN_FROM_HALL = { x: 0, z: -4.2 }; // spawn after leaving the hall
export const PRODUCTS_DOOR = { x: 0, z: -5.7, r: 0.8 }; // walking into it enters the hall
// Chat places in town: proximity centre in front of the door. `chat` = content id ('post' opens the waitlist).
export const PLACES = [
  { id: 'about', x: -13, z: -3.2, chat: 'about' },
  { id: 'how', x: 13, z: -3.2, chat: 'how' },
  { id: 'news', x: -12, z: 10.4, chat: 'news' },
  { id: 'post', x: 12, z: 11.2, chat: 'waitlist' },
];
export const PLACE_NEAR_R = 1.9;
export const TOWN_VILLAGERS = [
  { id: 't1', color: 'yellow', waypoints: [{ x: -6, z: 5 }, { x: -8, z: 0 }, { x: -4, z: -2 }] },
  { id: 't2', color: 'red', waypoints: [{ x: 6, z: 5 }, { x: 8, z: 0 }, { x: 4, z: -3 }] },
  { id: 't3', color: 'white', waypoints: [{ x: -3, z: 9 }, { x: 4, z: 9 }, { x: 5, z: 13 }] },
  { id: 't4', color: 'white', waypoints: [{ x: 16, z: 2 }, { x: 18, z: 12 }, { x: 15, z: 14 }] },
];

// Bug Hunt: collectible bugs (zone + local x/z). Walk into one to fix it.
export const BUG_PICK_R = 0.9;
export const BUGS = [
  { id: 'b1', zone: 'town', x: -17, z: 3 },
  { id: 'b2', zone: 'town', x: 18, z: -1 },
  { id: 'b3', zone: 'town', x: -6, z: 14 },
  { id: 'b4', zone: 'town', x: 7, z: -2 },
  { id: 'b5', zone: 'town', x: -19, z: -13 },
  { id: 'b6', zone: 'hall', x: 9, z: -3 },
  { id: 'b7', zone: 'hall', x: -5, z: 6 },
  { id: 'b8', zone: 'hall', x: 8, z: 7 },
];

export const toWorld = (zone, p) => (zone === 'town' ? { x: p.x + TOWN_ORIGIN.x, z: p.z + TOWN_ORIGIN.z } : { x: p.x, z: p.z });
