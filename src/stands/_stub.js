// Temporary placeholder used until a stand agent delivers the real diorama.
// Origin = bottom-centre of the frame's inner box (no pedestal).
import * as THREE from 'three';
import { toonMesh } from '../kit/toon.js';
import { COLORS } from '../core/tokens.js';

export function stubStand(id, color = COLORS.purple) {
  let cube;
  return {
    id,
    build() {
      const g = new THREE.Group();
      cube = toonMesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), color);
      cube.position.y = 0.8;
      g.add(cube);
      return g;
    },
    update(t, dt, state) {
      if (!cube) return;
      cube.rotation.y += dt * (state === 'idle' ? 0.4 : 1.6);
    },
    focusPose: { height: 1.0, zoom: 2.6 },
  };
}
