// Temporary placeholder used until a stand agent delivers the real diorama.
import * as THREE from 'three';
import { toonMesh } from '../kit/toon.js';
import { COLORS } from '../core/tokens.js';

export function stubStand(id, color = COLORS.purple) {
  let top;
  return {
    id,
    build() {
      const g = new THREE.Group();
      const pedestal = toonMesh(new THREE.CylinderGeometry(1.1, 1.1, 0.5, 8), COLORS.white);
      pedestal.position.y = 0.25;
      top = toonMesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), color);
      top.position.y = 1.1;
      g.add(pedestal, top);
      return g;
    },
    update(t, dt, state) {
      if (!top) return;
      top.rotation.y += dt * (state === 'idle' ? 0.4 : 1.6);
    },
    focusPose: { height: 1.0, zoom: 2.6 },
  };
}
