// Shared pedestal + nameplate so all stands read as one exhibition system.
// Owned by the orchestrator; stand agents use it, don't fork it.
import * as THREE from 'three';
import { toonMesh } from '../kit/toon.js';
import { COLORS } from '../core/tokens.js';

export const PEDESTAL_H = 0.5;
export const PEDESTAL_R = 1.1;

function nameTexture(label) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const draw = () => {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = '#000';
    ctx.font = 'italic 800 64px Montserrat, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 256, 68, 480);
    tex.needsUpdate = true;
  };
  draw();
  document.fonts?.load('italic 800 64px Montserrat').then(draw).catch(() => {});
  return tex;
}

/**
 * @param {{ label: string, accent: number }} opts
 * @returns {THREE.Group} pedestal with its top surface at y = PEDESTAL_H; front = local +Z
 */
export function createPedestal({ label, accent }) {
  const g = new THREE.Group();

  const base = toonMesh(new THREE.CylinderGeometry(PEDESTAL_R, PEDESTAL_R * 1.04, PEDESTAL_H, 8), COLORS.white, { receive: true });
  base.position.y = PEDESTAL_H / 2;
  base.rotation.y = Math.PI / 8;

  const rim = toonMesh(new THREE.CylinderGeometry(PEDESTAL_R * 1.02, PEDESTAL_R * 1.02, 0.08, 8), accent, { outline: 0.03 });
  // Top of the rim sits 1 cm under the base top: coplanar caps z-fight (very visible with a black accent).
  rim.position.y = PEDESTAL_H - 0.05;
  rim.rotation.y = Math.PI / 8;

  const plate = toonMesh(new THREE.BoxGeometry(1.5, 0.38, 0.06), COLORS.white, { outline: 0.03, cast: false });
  plate.position.set(0, PEDESTAL_H * 0.48, PEDESTAL_R * 0.98);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.42, 0.355), new THREE.MeshBasicMaterial({ map: nameTexture(label) }));
  face.position.z = 0.031;
  plate.add(face);

  g.add(base, rim, plate);
  return g;
}

