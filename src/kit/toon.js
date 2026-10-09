import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS } from '../core/tokens.js';

// Rendi look: flat brand fills, 3-step toon shading, black inverted-hull outline,
// soft lavender shadows (never grey), warm sun + sky/ground hemisphere fill.
// Every styled mesh in the scene comes through here.

// Light budget (outdoors): lit faces = HEMI + SUN ~ 1 -> brand hex reads (almost) true;
// shade = HEMI only, pushed toward lavender by SHADOW_TINT.
const HEMI = 0.8;
const SUN = 0.3;
const SUN_COLOR = 0xfff0d2; // slightly warm
const SKY_COLOR = 0xf4effa; // lavender-white
const GROUND_COLOR = 0xb9cfa6; // sage bounce light
// Multiplies the non-sun light in shadow: shadows lean lavender/purple, not grey.
const SHADOW_TINT = [0.84, 0.77, 0.97];

/**
 * 3 steps: shadow / mid / lit. Sampled with dotNL*0.5+0.5, so the 40 texels put the shadow edge at
 * dotNL = 0 and the lit edge at dotNL ~ 0.45 (a thin warm "half-tone" band, not a hard 2-tone flip).
 * Only the red channel is used by three.
 */
export const gradientMap = (() => {
  const W = 40;
  const data = new Uint8Array(W);
  for (let i = 0; i < W; i++) data[i] = i < 20 ? 0 : i < 29 ? 150 : 255;
  const tex = new THREE.DataTexture(data, W, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
})();

const f = (n) => n.toFixed(3);
const SHADOW_TINT_GLSL = `vec3( ${f(SHADOW_TINT[0])}, ${f(SHADOW_TINT[1])}, ${f(SHADOW_TINT[2])} )`;
// luminance of the sun's best-case contribution; used to tell "in sun" from "in shadow".
const SUN_LUM = SUN * 0.95;

/**
 * Tint the non-sun light of a MeshToonMaterial toward lavender wherever the sun does not reach
 * (terminator step AND cast shadows). Lit areas are untouched, so brand colours stay true.
 * Idempotent; all toon materials share one compiled program.
 */
export function applyShadowTint(material) {
  if (material.userData.shadowTint) return material;
  material.userData.shadowTint = true;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
      /* glsl */ `
      float sunSeen = dot( reflectedLight.directDiffuse, vec3( 0.3333 ) ) / ( dot( diffuseColor.rgb, vec3( 0.3333 ) ) + 0.02 );
      float sunAmt = clamp( sunSeen / ${f(SUN_LUM * 0.5)}, 0.0, 1.0 );
      reflectedLight.indirectDiffuse *= mix( ${SHADOW_TINT_GLSL}, vec3( 1.0 ), sunAmt );
      vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;`,
    );
  };
  material.customProgramCacheKey = () => 'rendi-shadow-tint';
  return material;
}

const toonCache = new Map();
export function toonMaterial(color) {
  if (!toonCache.has(color)) {
    toonCache.set(color, applyShadowTint(new THREE.MeshToonMaterial({ color, gradientMap })));
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
  // Sky/ground hemisphere = the soft fill (scaled by PI: three's physical light units).
  const hemi = new THREE.HemisphereLight(SKY_COLOR, GROUND_COLOR, HEMI * Math.PI);
  const sun = new THREE.DirectionalLight(SUN_COLOR, SUN * Math.PI);
  // Front-right of the camera: faces toward the viewer stay in the lit step (brand colours read true);
  // the grounded "drop shadow" look comes from the flat decals under characters.
  sun.position.set(10, 16, 3);
  sun.castShadow = true;
  const MAP = 4096;
  sun.shadow.mapSize.set(MAP, MAP);
  sun.shadow.radius = 2.2; // soft PCF edge
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.035;
  const s = sun.shadow.camera;
  s.left = -16; s.right = 16; s.top = 16; s.bottom = -16; s.near = 1; s.far = 50;
  scene.add(hemi, sun, sun.target);

  // Shadow box follows the view, snapped to the shadow-map texel grid (in light space) -> no shimmer.
  const offset = sun.position.clone();
  const basis = new THREE.Matrix4().lookAt(offset, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
  const ax = new THREE.Vector3(), ay = new THREE.Vector3(), az = new THREE.Vector3();
  basis.extractBasis(ax, ay, az);
  const snapped = new THREE.Vector3();
  function followShadow(look) {
    const texel = (s.right - s.left) / MAP;
    const x = Math.round(look.dot(ax) / texel) * texel;
    const y = Math.round(look.dot(ay) / texel) * texel;
    const z = look.dot(az);
    snapped.set(0, 0, 0).addScaledVector(ax, x).addScaledVector(ay, y).addScaledVector(az, z);
    sun.target.position.copy(snapped);
    sun.position.copy(snapped).add(offset);
    sun.target.updateMatrixWorld();
  }

  // `ambient` kept for backward compatibility: the hemisphere light is the ambient fill now.
  return { sun, ambient: hemi, hemi, followShadow };
}
