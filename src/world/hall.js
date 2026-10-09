// STUB — replaced by agent ① (plan Task 1).
import * as THREE from 'three';
import { toonMaterial } from '../kit/toon.js';
import { COLORS } from '../core/tokens.js';
import { ROOM } from '../core/layout.js';

export function createHall() {
  const g = new THREE.Group();
  const w = ROOM.maxX - ROOM.minX, d = ROOM.maxZ - ROOM.minZ;
  const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d), toonMaterial(COLORS.floorA));
  floor.position.y = -0.1;
  floor.receiveShadow = true;
  const wallX = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4, d), toonMaterial(COLORS.wall));
  wallX.position.set(ROOM.minX - 0.15, 2, 0);
  const wallZ = new THREE.Mesh(new THREE.BoxGeometry(w, 4, 0.3), toonMaterial(COLORS.wall));
  wallZ.position.set(0, 2, ROOM.minZ - 0.15);
  wallX.receiveShadow = wallZ.receiveShadow = true;
  g.add(floor, wallX, wallZ);
  return { object3d: g, colliders: [] };
}
