// STUB — replaced by agent ② (plan Task 2).
import * as THREE from 'three';
import { toonMesh, flatMaterial } from '../kit/toon.js';
import { COLORS } from '../core/tokens.js';

export function createBlob({ color = COLORS.mascot, scale = 1 } = {}) {
  const object3d = new THREE.Group();
  const body = toonMesh(new THREE.SphereGeometry(0.55, 24, 16), color);
  body.scale.set(1, 1, 0.45);
  body.position.y = 0.85;
  const eye = new THREE.Mesh(new THREE.CircleGeometry(0.12, 16), flatMaterial(COLORS.white));
  eye.position.set(0, 0.95, 0.26);
  object3d.add(body, eye);
  object3d.scale.setScalar(scale);
  return { object3d, rig: { body } };
}
