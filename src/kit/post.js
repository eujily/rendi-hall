import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

// Gentle "illustrated" grade: warm lift, a touch of saturation, very soft vignette.
// Runs in linear space, before OutputPass (tone mapping + sRGB). No pixel effects.
const GradeShader = {
  name: 'RendiGrade',
  uniforms: {
    tDiffuse: { value: null },
    warm: { value: new THREE.Color(1.02, 1.0, 0.965) }, // gain: slightly warm
    lift: { value: new THREE.Color(0.012, 0.008, 0.02) }, // lifted blacks lean lavender (outlines stay black enough)
    saturation: { value: 1.07 },
    vignette: { value: 0.1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 warm, lift;
    uniform float saturation, vignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D( tDiffuse, vUv );
      float l = dot( c.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
      // lift only the non-black part so the black outlines keep their punch
      vec3 rgb = c.rgb * warm + lift * smoothstep( 0.0, 0.25, l );
      rgb = mix( vec3( dot( rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), rgb, saturation );
      vec2 d = vUv - 0.5;
      float v = smoothstep( 0.35, 0.95, length( d * vec2( 1.0, 0.9 ) ) );
      rgb *= mix( vec3( 1.0 ), vec3( 0.93, 0.88, 1.0 ), v * vignette * 5.0 ) * ( 1.0 - v * vignette );
      gl_FragColor = vec4( rgb, c.a );
    }`,
};

/**
 * Post chain: RenderPass (4x MSAA target, keeps outlines crisp) -> grade -> OutputPass -> optional FXAA
 * (off by default: MSAA handles edges and FXAA softens the outlines).
 */
export function createPost(renderer, scene, camera) {
  const pr = renderer.getPixelRatio();
  const size = renderer.getSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(pr);
  composer.setSize(size.x, size.y);

  composer.addPass(new RenderPass(scene, camera));
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  const fxaa = new ShaderPass(FXAAShader);
  composer.addPass(fxaa);

  let enabled = true;
  let fxaaOn = false; // MSAA already keeps the 1px outlines crisp; FXAA smears them, so it is opt-in
  const syncFxaa = () => {
    const p = renderer.getPixelRatio();
    fxaa.enabled = fxaaOn && p < 1.75;
    fxaa.uniforms.resolution.value.set(1 / (size.x * p), 1 / (size.y * p));
  };
  syncFxaa();

  return {
    composer,
    render() {
      if (enabled) composer.render();
      else renderer.render(scene, camera);
    },
    /** CSS pixels (same numbers as renderer.setSize). Re-reads the renderer's pixel ratio. */
    setSize(w, h) {
      size.set(w, h);
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
      syncFxaa();
    },
    setEnabled(v) { enabled = !!v; },
    setFXAA(v) { fxaaOn = !!v; syncFxaa(); },
  };
}
