import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { generateIglooStructure, generateMountainTerrain } from './geometry/IglooGenerator.js';
import { setupPostProcessing } from './effects/PostProcessing.js';
import { HUDController } from './ui/HUDController.js';

class IglooApp {
  constructor() {
    this.container = document.getElementById('webgl-container');
    this.nodeLabelElements = [];
    this.scrollProgress = 0.0;
    this.loadStartTime = performance.now();

    // Mouse tracking & Raycaster
    this.mouse2D = new THREE.Vector2(-9999, -9999);
    this.mouseWorldHit = new THREE.Vector3(-9999, -9999, -9999);
    this.raycaster = new THREE.Raycaster();
    this.isHoveringIgloo = false;

    this.initScene();
    this.initLights();
    this.initStructure();
    this.initPostProcessing();
    this.initControls();
    this.initHUD();
    this.initEvents();

    this.clock = new THREE.Clock();
    this.animate();
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8da1b3);
    this.scene.fog = new THREE.FogExp2(0x8da1b3, 0.016);

    this.camera = new THREE.PerspectiveCamera(
      42,
      window.innerWidth / window.innerHeight,
      0.1,
      120
    );
    this.camera.position.set(0.0, 13.5, 12.0);

    this.renderer = new THREE.WebGLRenderer({
      powerPreference: 'high-performance',
      antialias: true,
      alpha: true
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.container.appendChild(this.renderer.domElement);
  }

  initLights() {
    // 1. Soft Hemisphere Light (lower ambient to allow high-contrast block shading)
    const hemiLight = new THREE.HemisphereLight(0xe8f2fa, 0x14202e, 0.65);
    this.scene.add(hemiLight);

    // 2. Strong Key Light from Top-Right (casts distinct highlights on top/right block edges)
    this.topLight = new THREE.DirectionalLight(0xffffff, 1.8);
    this.topLight.position.set(8, 12, 6);
    this.scene.add(this.topLight);

    // 3. Side Rim Light from Left-Back (highlights side block outlines)
    const rimLight = new THREE.DirectionalLight(0xaad0f0, 1.2);
    rimLight.position.set(-8, 8, -6);
    this.scene.add(rimLight);

    // 4. Top Apex Spotlight (shining brightly on top cap / keystone blocks)
    const apexPointLight = new THREE.PointLight(0xffffff, 2.2, 8.0);
    apexPointLight.position.set(0, 4.2, 0);
    this.scene.add(apexPointLight);

    // 5. INNER IGLOO LIGHT (positioned inside dome center to illuminate blocks from inside)
    this.innerIglooLight = new THREE.PointLight(0x8bc4f5, 3.5, 6.0);
    this.innerIglooLight.position.set(0.0, 1.5, 0.0);
    this.scene.add(this.innerIglooLight);
  }

  initStructure() {
    this.structureData = generateIglooStructure();

    // Store rest positions (never mutated)
    const meshGeo = this.structureData.iglooMeshGeometry;
    this.restMeshPos = meshGeo.attributes.position.array.slice();
    this.meshBlockIndexAttr = meshGeo.attributes.aBlockIndex.array;

    const lineGeo = this.structureData.iglooWireframeGeometry;
    this.restLinePos = lineGeo.attributes.position.array.slice();
    this.lineBlockIndexAttr = lineGeo.attributes.aBlockIndex.array;

    // Per-block rigid offset: current (smoothed) offset for each block
    this.blockMeta = this.structureData.blockMeta;
    this.totalBlocks = this.structureData.totalBlockCount;
    this.blockOffsets = new Array(this.totalBlocks);
    for (let i = 0; i < this.totalBlocks; i++) {
      this.blockOffsets[i] = new THREE.Vector3(0, 0, 0);
    }

    // Static invisible proxy sphere for stable raycasting (never displaced)
    const proxyGeo = new THREE.SphereGeometry(3.5, 48, 32, 0, Math.PI * 2, 0, Math.PI * 0.48);
    this.proxyMesh = new THREE.Mesh(proxyGeo, new THREE.MeshBasicMaterial({ visible: false }));
    this.scene.add(this.proxyMesh);

    // Smoothed hovered block tracking to prevent flicker
    this.smoothedHitPoint = new THREE.Vector3(-9999, -9999, -9999);
    this.activeHoveredBlockIdx = -1;

    // 1. Solid Physical Ice Material with High Roughness & Frosted Texture
    this.iceMat = new THREE.MeshPhysicalMaterial({
      color: 0x8498aa,                // Cool slate blue-gray ice matching reference
      roughness: 0.72,                // High frosted matte ice roughness
      roughnessMap: this.structureData.iceTexture,
      metalness: 0.02,
      clearcoat: 0.20,
      clearcoatRoughness: 0.50,       // Diffuse micro-crystal scattering
      transmission: 0.22,
      thickness: 0.7,
      ior: 1.31,
      bumpMap: this.structureData.iceTexture,
      bumpScale: 0.08,                // Increased bump scale for intense surface roughness relief
      transparent: true,
      depthWrite: true,
      opacity: 0.0,
      side: THREE.FrontSide
    });
    this.iglooMesh = new THREE.Mesh(meshGeo, this.iceMat);
    this.scene.add(this.iglooMesh);

    // 2. Block edge crease shadow lines
    this.seamLineMat = new THREE.LineBasicMaterial({
      color: 0x485c6d,
      transparent: true,
      opacity: 0.0,
      linewidth: 1.2
    });
    this.seamLines = new THREE.LineSegments(lineGeo, this.seamLineMat);
    this.scene.add(this.seamLines);

    // 4. Leader line 18 → 19
    this.calloutMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.0,
      linewidth: 1.8
    });
    this.calloutLinesMesh = new THREE.LineSegments(this.structureData.calloutLinesGeo, this.calloutMat);
    this.scene.add(this.calloutLinesMesh);

    // 5. Base rim
    this.baseRimMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.0,
      linewidth: 2.0
    });
    this.baseRimMesh = new THREE.LineSegments(this.structureData.baseRimGeometry, this.baseRimMat);
    this.scene.add(this.baseRimMesh);

    // 6. 3D Procedural Arctic Mountain Terrain Landscape
    const mountainGeo = generateMountainTerrain();
    this.mountainMat = new THREE.MeshStandardMaterial({
      color: 0x7c91a3,
      roughness: 0.85,
      metalness: 0.05,
      bumpMap: this.structureData.iceTexture,
      bumpScale: 0.06
    });
    this.mountainMesh = new THREE.Mesh(mountainGeo, this.mountainMat);
    this.mountainMesh.position.set(0, -0.15, 0);
    this.scene.add(this.mountainMesh);

    // 6. Spatial flickering cubes
    this.spatialCubeUniforms = {
      uTime: { value: 0.0 },
      uColor: { value: new THREE.Color(0xffffff) },
      uGlobalOpacity: { value: 0.75 }
    };

    const spatialCubeShaderMat = new THREE.ShaderMaterial({
      uniforms: this.spatialCubeUniforms,
      vertexShader: `
        attribute vec2 aFlicker;
        uniform float uTime;
        varying float vAlpha;
        void main() {
          float phase = aFlicker.x;
          float speed = aFlicker.y;
          float flicker = sin(uTime * speed + phase);
          vAlpha = flicker > 0.4 ? 0.95 : (flicker > -0.1 ? 0.25 : 0.02);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uGlobalOpacity;
        varying float vAlpha;
        void main() {
          gl_FragColor = vec4(uColor, vAlpha * uGlobalOpacity);
        }
      `,
      transparent: true,
      depthWrite: false
    });

    this.terrainMesh = new THREE.LineSegments(this.structureData.terrainWireframeGeometry, spatialCubeShaderMat);
    this.scene.add(this.terrainMesh);

    // 7. Node labels
    this.gridNodes = this.structureData.gridNodes;
    this.createNodeLabels();
  }

  createNodeLabels() {
    this.nodeLabelElements.forEach(el => el.remove());
    this.nodeLabelElements = [];

    this.gridNodes.forEach(node => {
      const el = document.createElement('div');
      el.className = 'floating-node-label';
      el.innerText = node.number;
      document.body.appendChild(el);
      this.nodeLabelElements.push({
        element: el,
        restPos: node.position,
        currentPos: node.position.clone()
      });
    });
  }

  updateNodeLabels(iglooRevealFactor) {
    const tempV = new THREE.Vector3();
    const halfW = window.innerWidth / 2;
    const halfH = window.innerHeight / 2;
    const p = this.scrollProgress;

    this.nodeLabelElements.forEach(item => {
      tempV.copy(item.currentPos);
      tempV.project(this.camera);

      if (tempV.z > 1.0) {
        item.element.style.opacity = 0;
        return;
      }

      const x = (tempV.x * halfW) + halfW;
      const y = -(tempV.y * halfH) + halfH;
      item.element.style.left = `${x}px`;
      item.element.style.top = `${y}px`;

      const labelText = item.element.innerText;
      const isCallout = ['18', '19'].includes(labelText);

      if (isCallout) {
        const hoverDist = item.restPos.distanceTo(this.mouseWorldHit);
        const nearHover = this.isHoveringIgloo && hoverDist < 3.2;
        item.element.style.opacity = nearHover ? Math.min(1.0, (3.2 - hoverDist) * 0.8) * iglooRevealFactor : 0;
      } else {
        const spatialFade = Math.max(0.0, 1.0 - p * 1.2);
        item.element.style.opacity = Math.max(0, (0.75 - Math.abs(tempV.x) * 0.25) * spatialFade * (1.0 - p * 0.8));
      }
    });
  }

  initPostProcessing() {
    const { composer, bloomPass, handleResize } = setupPostProcessing(
      this.scene,
      this.camera,
      this.renderer
    );
    this.composer = composer;
    this.bloomPass = bloomPass;
    this.postResizeHandler = handleResize;
  }

  initControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.01;
    this.controls.minDistance = 4.0;
    this.controls.maxDistance = 30.0;
    this.controls.target.set(0.0, 0.8, 1.2);
    this.controls.update();
  }

  initHUD() {
    this.hudController = new HUDController({
      onProgressChange: (p) => {
        this.scrollProgress = p;
        this.updateScrollCamera(p);
      }
    });
  }

  updateScrollCamera(p) {
    const camStart = new THREE.Vector3(0.0, 13.5, 12.0);
    const camEnd = new THREE.Vector3(-9.5, 7.5, 11.0);
    const lookStart = new THREE.Vector3(0.0, 0.8, 1.2);
    const lookEnd = new THREE.Vector3(0.0, 1.1, 0.6);

    const targetCamPos = new THREE.Vector3().lerpVectors(camStart, camEnd, p);
    const targetLook = new THREE.Vector3().lerpVectors(lookStart, lookEnd, p);

    this.camera.position.lerp(targetCamPos, 0.08);
    this.controls.target.lerp(targetLook, 0.08);
    this.controls.update();
  }

  initEvents() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.postResizeHandler(window.innerWidth, window.innerHeight);
    });

    const updateMouse = (clientX, clientY) => {
      this.mouse2D.x = (clientX / window.innerWidth) * 2 - 1;
      this.mouse2D.y = -(clientY / window.innerHeight) * 2 + 1;
    };

    window.addEventListener('mousemove', (e) => updateMouse(e.clientX, e.clientY));
    window.addEventListener('touchmove', (e) => {
      if (e.touches.length > 0) updateMouse(e.touches[0].clientX, e.touches[0].clientY);
    });
  }

  /**
   * RIGID BLOCK REPULSION — flicker-free:
   *  1. Raycast against STATIC proxy sphere (never displaced) for stable hit point
   *  2. Smoothly interpolate hit point to avoid jumps
   *  3. Find nearest block center to smoothed hit point → that's the hovered block
   *  4. Hovered block pushes out along its normal; neighbors repel away
   *  5. Gentle lerp (0.06) for silky smooth transitions
   */
  updateMouseHoverEffect() {
    if (!this.iglooMesh || !this.proxyMesh) return;

    // Raycast against the STATIC invisible proxy sphere (not the moving mesh)
    this.raycaster.setFromCamera(this.mouse2D, this.camera);
    const intersects = this.raycaster.intersectObject(this.proxyMesh);

    if (intersects.length > 0) {
      this.isHoveringIgloo = true;

      // Smoothly interpolate hit point to prevent jumps between frames
      const rawHit = intersects[0].point;
      this.smoothedHitPoint.lerp(rawHit, 0.25);

      // Find the nearest block center to the smoothed hit point
      let bestDist = Infinity;
      let bestIdx = -1;
      for (let bi = 0; bi < this.totalBlocks; bi++) {
        const c = this.blockMeta[bi].center;
        const d = this.smoothedHitPoint.distanceToSquared(c);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = bi;
        }
      }
      this.activeHoveredBlockIdx = bestIdx;
    } else {
      this.isHoveringIgloo = false;
      this.activeHoveredBlockIdx = -1;
    }

    const hoveredBlockIdx = this.activeHoveredBlockIdx;

    const effectRadius = 4.5;    // wider influence radius
    const selectedPush = 1.35;   // intensive outward push for hovered block
    const neighborPush = 1.10;   // wide repulsion spacing for neighbor blocks
    const liftAmount = 0.40;     // floating lift
    const lerpSpeed = 0.07;      // smooth lerp

    // Compute target offset per block based on mouse hover position
    for (let bi = 0; bi < this.totalBlocks; bi++) {
      const meta = this.blockMeta[bi];
      const offset = this.blockOffsets[bi];

      const numDomeRings = 6;
      const ri = meta.ringIndex !== undefined ? meta.ringIndex : numDomeRings;
      const ringNorm = Math.min(ri, numDomeRings) / numDomeRings; // 0 = top, 1 = bottom
      const ringIntensity = Math.max(0.1, 1.0 - ringNorm * ringNorm);

      let targetX = 0, targetY = 0, targetZ = 0;

      if (this.isHoveringIgloo && hoveredBlockIdx >= 0) {
        if (bi === hoveredBlockIdx) {
          targetX = meta.normal.x * selectedPush * ringIntensity;
          targetY = meta.normal.y * selectedPush * ringIntensity + liftAmount * ringIntensity;
          targetZ = meta.normal.z * selectedPush * ringIntensity;
        } else {
          const hovCenter = this.blockMeta[hoveredBlockIdx].center;
          const dx = meta.center.x - hovCenter.x;
          const dy = meta.center.y - hovCenter.y;
          const dz = meta.center.z - hovCenter.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (dist < effectRadius && dist > 0.001) {
            const t = 1.0 - dist / effectRadius;
            const weight = t * t * t;

            const invDist = 1.0 / dist;
            const dirX = dx * invDist;
            const dirY = dy * invDist;
            const dirZ = dz * invDist;

            targetX = dirX * weight * neighborPush * ringIntensity;
            targetY = dirY * weight * neighborPush * ringIntensity + weight * liftAmount * 0.4 * ringIntensity;
            targetZ = dirZ * weight * neighborPush * ringIntensity;
          }
        }
      }

      // Smooth lerp towards target
      offset.x += (targetX - offset.x) * lerpSpeed;
      offset.y += (targetY - offset.y) * lerpSpeed;
      offset.z += (targetZ - offset.z) * lerpSpeed;
    }

    // 2. Apply per-block rigid offset to mesh vertices
    const meshGeo = this.structureData.iglooMeshGeometry;
    const meshPosArr = meshGeo.attributes.position.array;

    for (let i = 0; i < meshPosArr.length / 3; i++) {
      const bi = this.meshBlockIndexAttr[i];
      const off = this.blockOffsets[bi];
      const idx = i * 3;

      meshPosArr[idx + 0] = this.restMeshPos[idx + 0] + off.x;
      meshPosArr[idx + 1] = this.restMeshPos[idx + 1] + off.y;
      meshPosArr[idx + 2] = this.restMeshPos[idx + 2] + off.z;
    }
    meshGeo.attributes.position.needsUpdate = true;

    // 3. Apply per-block rigid offset to wireframe vertices
    const lineGeo = this.structureData.iglooWireframeGeometry;
    const linePosArr = lineGeo.attributes.position.array;

    for (let i = 0; i < linePosArr.length / 3; i++) {
      const bi = this.lineBlockIndexAttr[i];
      const off = this.blockOffsets[bi];
      const idx = i * 3;

      linePosArr[idx + 0] = this.restLinePos[idx + 0] + off.x;
      linePosArr[idx + 1] = this.restLinePos[idx + 1] + off.y;
      linePosArr[idx + 2] = this.restLinePos[idx + 2] + off.z;
    }
    lineGeo.attributes.position.needsUpdate = true;
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const elapsedTime = this.clock.getElapsedTime();
    const deltaTime = this.clock.getDelta();

    this.updateMouseHoverEffect();

    if (this.spatialCubeUniforms) {
      this.spatialCubeUniforms.uTime.value = elapsedTime;
      const spatialOpacity = Math.max(0.0, (1.0 - this.scrollProgress * 1.15) * 0.75);
      this.spatialCubeUniforms.uGlobalOpacity.value = spatialOpacity;
    }

    // Intro reveal
    const elapsedLoadSec = (performance.now() - this.loadStartTime) / 1000;
    const revealFactor = Math.max(0.0, Math.min(1.0, (elapsedLoadSec - 0.4) / 1.4));

    if (this.iceMat) {
      this.iceMat.opacity = Math.min(1.0, revealFactor * 1.0);
      this.iceMat.transparent = true;
      this.iceMat.depthWrite = true;
    }
    if (this.seamLineMat) this.seamLineMat.opacity = revealFactor * 0.35; // clean, subtle block outline
    if (this.baseRimMat) this.baseRimMat.opacity = revealFactor * 0.8;
    if (this.calloutMat) this.calloutMat.opacity = this.isHoveringIgloo ? revealFactor * 0.95 : 0;

    this.hudController.update(deltaTime);
    this.updateNodeLabels(revealFactor);

    this.composer.render();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new IglooApp();
});
