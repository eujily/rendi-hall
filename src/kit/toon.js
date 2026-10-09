import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS } from '../core/tokens.js';

// Rendi look: flat brand fills, 2-step toon shading, black inverted-hull outline,
// hard lavender-grey shadows. Every styled mesh in the scene comes through here.

// Light budget: lit faces = AMBIENT + SUN ≈ 1 → brand hex reads exactly; shade = AMBIENT + SUN * SHADE_STEP.
const AMBIENT = 0.78;
const SUN = 0.22;
const SHADE_STEP = 0.35;

const gradientMap = (() => {
  const data = new Uint8Array([Math.round(SHADE_STEP * 255), 255]);
  const tex = new THREE.DataTexture(data, 2, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
})();

const toonCache = new Map();
export function toonMaterial(color) {
  if (!toonCache.has(color)) {
    toonCache.set(color, new THREE.MeshToonMaterial({ color, gradientMap }));
  }
  return toonCache.get(color);
}

const flatCache = new Map();
export function flatMaterial(color) {
  if (!flatCache.has(color)) flatCache.set(color, new THREE.MeshBasicMaterial({ color }));
  return flatCache.get(color);
}

const outlineCache = new Map();
function outlineMaterial(thickness) {
  if (!outlineCache.has(thickness)) {
    outlineCache.set(
      thickness,
      new THREE.ShaderMaterial({
        uniforms: { thickness: { value: thickness }, color: { value: new THREE.Color(COLORS.black) } },
        vertexShader: /* glsl */ `
          uniform float thickness;
          void main() {
            vec3 p = position + normal * thickness;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 color;
          void main() { gl_FragColor = vec4(color, 1.0); }`,
        side: THREE.BackSide,
      }),
    );
  }
  return outlineCache.get(thickness);
}

// Hull needs smooth normals, otherwise hard-edged shapes (boxes) crack at the corners.
const hullCache = new WeakMap();
function hullGeometry(geometry) {
  if (!hullCache.has(geometry)) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', geometry.getAttribute('position'));
    if (geometry.index) g.setIndex(geometry.index);
    const merged = mergeVertices(g, 1e-4);
    merged.computeVertexNormals();
    hullCache.set(geometry, merged);
  }
  return hullCache.get(geometry);
}

export function addOutline(mesh, thickness = 0.05) {
  const hull = new THREE.Mesh(hullGeometry(mesh.geometry), outlineMaterial(thickness));
  hull.name = 'outline';
  hull.castShadow = false;
  hull.receiveShadow = false;
  hull.raycast = () => {};
  mesh.add(hull);
  return mesh;
}

export function toonMesh(geometry, color, { outline = 0.05, cast = true, receive = false } = {}) {
  const mesh = new THREE.Mesh(geometry, toonMaterial(color));
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  if (outline) addOutline(mesh, outline);
  return mesh;
}

export function setupLights(scene) {
  const ambient = new THREE.AmbientLight(COLORS.white, AMBIENT * Math.PI);
  const sun = new THREE.DirectionalLight(COLORS.white, SUN * Math.PI);
  // From upper-right of the screen → shadows fall down-left, like the mascot's offset shadow.
  sun.position.set(6, 16, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 1;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.02;
  const s = sun.shadow.camera;
  s.left = -16; s.right = 16; s.top = 16; s.bottom = -16; s.near = 1; s.far = 50;
  scene.add(ambient, sun, sun.target);
  return { sun, ambient };
}
