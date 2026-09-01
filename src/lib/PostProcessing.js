import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export function setupPostProcessing(scene, camera, renderer) {
  const composer = new EffectComposer(renderer);

  // Base render pass
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // Calibrated bloom pass matching Image 2 reference:
  // High threshold (0.82) ensures only white wireframe lines & rim light glow,
  // preventing the ice dome body from turning into an overexposed white blob.
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.15, // strength
    0.25, // radius
    0.85  // threshold
  );
  composer.addPass(bloomPass);

  // Resize handler
  function handleResize(width, height) {
    composer.setSize(width, height);
    bloomPass.resolution.set(width, height);
  }

  return {
    composer,
    bloomPass,
    handleResize
  };
}
