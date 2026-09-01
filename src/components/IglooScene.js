'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { generateIglooStructure, generateIglooBlockObjects, generateMountainTerrain, splitBatchedGeometry, processIglooBatchedBlocks } from '@/lib/IglooGenerator.js';
import { setupPostProcessing } from '@/lib/PostProcessing.js';
import { HUDController } from '@/lib/HUDController.js';


// ─────────────────────────────────────────────
// IglooApp — ported from src/main.js
// Accepts a DOM container element instead of
// reading it from document.getElementById.
// ─────────────────────────────────────────────
class IglooApp {
  constructor(container) {
    this.container = container;
    this.nodeLabelElements = [];
    this.scrollProgress = 0.0;
    this.loadStartTime = performance.now();
    this._animFrameId = null;

    // Mouse tracking & Raycaster
    this.mouse2D = new THREE.Vector2(0, 0);
    this.mouseWorldHit = new THREE.Vector3(0, 0, 0);
    this.raycaster = new THREE.Raycaster();
    this.isHoveringIgloo = false;

    // Bound event handlers (stored for cleanup)
    this._onResize = () => this._handleResize();
    this._onMouseMove = (e) => this._updateMouse(e.clientX, e.clientY);
    this._onTouchMove = (e) => {
      if (e.touches.length > 0) {
        this._updateMouse(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    this.init();
  }

  async init() {
    this.initScene();
    this.initLights();
    this.initStructure();
    this.initPostProcessing();
    this.initControls();
    this.initHUD();
    this.initEvents();

    this.animate();
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#d1d6e3');
    this.scene.fog = new THREE.FogExp2('#afb6c7', 0.005);

    this.camera = new THREE.PerspectiveCamera(
      30,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(-13.5, 2.8, 13.5);

    this.clock = new THREE.Clock();

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0xd1d6e3, 1.0);
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.container.appendChild(this.renderer.domElement);
  }

  initLights() {
    // 1. Soft Hemisphere Light (softer ambient arctic sky light)
    const hemiLight = new THREE.HemisphereLight(0xbdcad8, 0x1f2d3c, 0.28);
    this.scene.add(hemiLight);

    // 2. Key Directional Light from Top-Right (subtle top highlights)
    this.topLight = new THREE.DirectionalLight(0xffffff, 0.40);
    this.topLight.position.set(8, 14, 6);
    this.scene.add(this.topLight);

    // 3. Side Rim Light from Left-Back (gentle icy rim reflection)
    const rimLight = new THREE.DirectionalLight(0xa5c6e2, 0.25);
    rimLight.position.set(-8, 10, -6);
    this.scene.add(rimLight);

    // 4. INNER IGLOO LIGHT (subtle glowing cyan-blue inside entrance arch)
    this.innerIglooLight = new THREE.PointLight(0x98d4ff, 1.5, 0.9);
    this.innerIglooLight.position.set(0.0, 0.85, 1.8);
    this.scene.add(this.innerIglooLight);
  }

  initStructure() {
    // Shared DRACOLoader instance for 3D Draco assets
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('/draco/');

    // Shared KTX2Loader instance for authentic GPU textures from www.igloo.inc
    const ktx2Loader = new KTX2Loader();
    ktx2Loader.setTranscoderPath('/basis/');
    ktx2Loader.detectSupport(this.renderer);

    this.totalBlocks = 0;
    this.blockObjects = [];

    // Static invisible proxy sphere for stable raycasting (never displaced)
    const proxyGeo = new THREE.SphereGeometry(3.5, 48, 32, 0, Math.PI * 2, 0, Math.PI * 0.48);
    this.proxyMesh = new THREE.Mesh(proxyGeo, new THREE.MeshBasicMaterial({ visible: false }));
    this.proxyMesh.position.y = 0.05;
    this.scene.add(this.proxyMesh);

    // Smoothed hovered block tracking to prevent flicker
    this.smoothedHitPoint = new THREE.Vector3(-9999, -9999, -9999);
    this.activeHoveredBlockIdx = -1;

    // 1. Igloo Block Custom GLSL Shader Material matching www.igloo.inc
    this.iceShaderUniforms = {
      tMap: { value: null },
      tMapExploded: { value: null },
      uTime: { value: 0.0 }
    };

    this.iceMat = new THREE.ShaderMaterial({
      uniforms: this.iceShaderUniforms,
      vertexShader: `
        attribute float emission;

        varying vec2 vUv;
        varying vec3 vPos;
        varying vec3 vWorldPos;
        varying float vEmission;

        void main() {
          vUv = uv;
          vEmission = emission;
          vPos = position;
          vec4 worldP = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldP.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldP;
        }
      `,
      fragmentShader: `
        uniform sampler2D tMap;
        uniform sampler2D tMapExploded;
        uniform float uTime;
        uniform float uDisplacement;
        uniform float uBounce;

        varying vec2 vUv;
        varying vec3 vPos;
        varying vec3 vWorldPos;
        varying float vEmission;

        void main() {
          vec3 baseColor = texture2D(tMap, vUv).rgb * 0.85;
          vec3 exploded = texture2D(tMapExploded, vUv).rgb * 0.90 + 0.02;
          vec3 blue = vec3(0.5, 0.75, 1.0);

          // Fade between 'together' lightmap and 'exploded' lightmap based on displacement
          float textureMix = clamp(5.0 * uDisplacement, 0.0, 1.0);
          vec3 color = mix(baseColor, exploded, textureMix);

          // Displacement emission (only when block is displaced)
          color += pow(max(0.0, vEmission), 2.0) * clamp(1.0 * uDisplacement, 0.0, 1.0) * blue * 0.7;

          // Seam emission glow (power 8.0 matching www.igloo.inc)
          vec3 powEmission = pow(max(0.0, vEmission), 8.0) * blue * 0.35;
          color += powEmission * (sin(vWorldPos.x - uTime * 1.0 + 3.2) * 0.5 + 0.5);

          // Inner dome glow on faces furthest from camera
          color += max(0.0, smoothstep(0.0, 2.0, vPos.x * 0.5 - vPos.z * 0.5)) * powEmission;

          // Fake SSS sunlight gradient
          color += (vPos.x * 0.1 + 0.4) * 0.10 * min(vPos.y + 0.5, 1.0) * 0.5;

          // Ground bounce
          float verticalGrad = (1.0 - smoothstep(-1.5, 1.0, vPos.y));
          color += verticalGrad * uBounce * vec3(0.8, 0.9, 1.0) * 0.15;

          gl_FragColor = vec4(clamp(color, vec3(0.0), vec3(1.0)), 1.0);
        }
      `,
      side: THREE.FrontSide
    });

    ktx2Loader.load('/assets/images/igloo/igloo_color.ktx2', (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      this.iceShaderUniforms.tMap.value = texture;
    });

    ktx2Loader.load('/assets/images/igloo/igloo_exploded_color.ktx2', (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      this.iceShaderUniforms.tMapExploded.value = texture;
    });

    // 2. Base Ground Custom Shader Material with Ground Glow (ground.drc)
    this.groundUniforms = {
      tMap: { value: null },
      tGroundGlow: { value: null },
      tWind: { value: null },
      uMousePos: { value: this.mouseWorldHit },
      uTime: { value: 0.0 }
    };

    this.baseGroundMat = new THREE.ShaderMaterial({
      uniforms: this.groundUniforms,
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vPos;
        varying vec3 vWorldPos;
        varying vec3 vMouseGlow;

        uniform vec3 uMousePos;

        void main() {
          vUv = uv;
          vPos = position;
          vec4 worldP = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldP.xyz;

          vMouseGlow = (1.0 - clamp(distance(uMousePos, vWorldPos * vec3(1.0, 0.0, 1.0)), 0.0, 5.0) / 5.0) * vec3(0.5, 0.75, 1.0) * smoothstep(-0.5, 2.0, uMousePos.y);
          vMouseGlow *= 1.0 - clamp(length(vWorldPos), 0.0, 9.0) / 9.0;

          gl_Position = projectionMatrix * viewMatrix * worldP;
        }
      `,
      fragmentShader: `
        uniform sampler2D tMap;
        uniform sampler2D tGroundGlow;
        uniform sampler2D tWind;
        uniform float uTime;

        varying vec2 vUv;
        varying vec3 vPos;
        varying vec3 vWorldPos;
        varying vec3 vMouseGlow;

        void main() {
          vec3 terrainColor = texture2D(tMap, vUv).rgb;

          // Ground glow under base & around igloo matching www.igloo.inc
          vec3 glow = texture2D(tGroundGlow, vUv).rgb;
          float glowStrength = (sin(vPos.x - uTime * 1.0 + 3.2) * 0.5 + 0.5);
          terrainColor += glow * glowStrength * terrainColor.r * 1.2;
          terrainColor += vMouseGlow * terrainColor.r;

          // Blowing snow wind
          float t = uTime * 0.15;
          float verticalGrad = (1.0 - clamp(vPos.y * 0.3 + 1.1, 0.0, 1.0));
          float wind = texture2D(tWind, vWorldPos.xz * 0.15 + vUv * 0.1 + vec2(-t, -t)).r;
          wind *= texture2D(tWind, vWorldPos.xz * 0.17 + vUv * 0.1 + vec2(-t, -t)).r;
          wind *= verticalGrad;
          terrainColor = mix(terrainColor, vec3(1.0), wind * 0.5);

          gl_FragColor = vec4(clamp(terrainColor, vec3(0.0), vec3(1.0)), 1.0);
        }
      `
    });

    ktx2Loader.load('/assets/images/igloo/ground_color.ktx2', (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      this.groundUniforms.tMap.value = texture;
    });

    ktx2Loader.load('/assets/images/igloo/ground_glow.ktx2', (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      this.groundUniforms.tGroundGlow.value = texture;
    });

    ktx2Loader.load('/assets/images/wind_noise.ktx2', (texture) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      this.groundUniforms.tWind.value = texture;
    });

    // 3. Surrounding Terrain & Patch Material (ground_sansigloo_color.ktx2)
    this.terrainUniforms = {
      tMap: { value: null },
      tWind: { value: null },
      uTime: { value: 0.0 }
    };

    this.terrainMat = new THREE.ShaderMaterial({
      uniforms: this.terrainUniforms,
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vPos;
        varying vec3 vWorldPos;

        void main() {
          vUv = uv;
          vPos = position;
          vec4 worldP = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldP.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldP;
        }
      `,
      fragmentShader: `
        uniform sampler2D tMap;
        uniform sampler2D tWind;
        uniform float uTime;

        varying vec2 vUv;
        varying vec3 vPos;
        varying vec3 vWorldPos;

        void main() {
          vec3 color = texture2D(tMap, vUv).rgb;
          float t = uTime * 0.15;
          float verticalGrad = (1.0 - clamp(vPos.y * 0.3 + 1.1, 0.0, 1.0));
          float wind = texture2D(tWind, vWorldPos.xz * 0.15 + vUv * 0.1 + vec2(-t, -t)).r;
          color = mix(color, vec3(1.0), wind * verticalGrad * 0.5);

          gl_FragColor = vec4(clamp(color, vec3(0.0), vec3(1.0)), 1.0);
        }
      `
    });

    ktx2Loader.load('/assets/images/igloo/ground_sansigloo_color.ktx2', (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      this.terrainUniforms.tMap.value = texture;
    });

    ktx2Loader.load('/assets/images/wind_noise.ktx2', (texture) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      this.terrainUniforms.tWind.value = texture;
    });

    // 4. Horizon Mountain Peak Material (mountain_color.ktx2)
    this.mountainUniforms = {
      tMap: { value: null },
      uColor1: { value: new THREE.Color('#d1d6e3') },
      uColor2: { value: new THREE.Color('#afb6c7') }
    };

    this.mountainMat = new THREE.ShaderMaterial({
      uniforms: this.mountainUniforms,
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vPos;
        varying vec3 vWorldPos;
        varying vec4 vMvPos;

        void main() {
          vUv = uv;
          vPos = position;
          vMvPos = modelViewMatrix * vec4(position, 1.0);
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * vMvPos;
        }
      `,
      fragmentShader: `
        uniform sampler2D tMap;
        uniform vec3 uColor1;
        uniform vec3 uColor2;

        varying vec2 vUv;
        varying vec3 vPos;
        varying vec3 vWorldPos;
        varying vec4 vMvPos;

        void main() {
          vec2 screenUv = gl_FragCoord.xy / vec2(1920.0, 1080.0);
          float grad = pow((screenUv.x + screenUv.y) * 0.5, 2.0);
          vec3 fogColor = mix(uColor2, uColor1, grad);

          vec3 color = texture2D(tMap, vUv).rgb;

          float distanceFog = clamp(-vMvPos.z * 0.005, 0.0, 1.0);
          float fog = clamp(1.0 - vWorldPos.y * 0.05 - 0.5, 0.0, 1.0);
          fog += distanceFog * 0.75;

          color = mix(color, fogColor * 1.1 + smoothstep(0.5, 1.0, color.r), fog);

          gl_FragColor = vec4(clamp(color, vec3(0.0), vec3(1.0)), 1.0);
        }
      `
    });

    ktx2Loader.load('/assets/images/igloo/mountain_color.ktx2', (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      this.mountainUniforms.tMap.value = texture;
    });

    // Load authentic batched 3D Igloo model from www.igloo.inc
    const fileLoader = new THREE.FileLoader();
    fileLoader.setResponseType('arraybuffer');
    fileLoader.load('/assets/geometries/igloo.drc', (buffer) => {
      const attributeIDs = {
        position: 0,
        normal: 1,
        uv: 2,
        centr: 3,
        rand: 4,
        emission: 5,
        batchId: 6
      };
      const attributeTypes = {
        position: 'Float32Array',
        normal: 'Float32Array',
        uv: 'Float32Array',
        centr: 'Float32Array',
        rand: 'Float32Array',
        emission: 'Float32Array',
        batchId: 'Uint16Array'
      };

      dracoLoader.decodeDracoFile(buffer, (dracoGeo) => {
        const subGeometries = splitBatchedGeometry(dracoGeo);

        // Clone ice material per block so each block gets individual uDisplacement & uBounce
        const blockMaterials = subGeometries.map(() => {
          const mat = this.iceMat.clone();
          mat.uniforms = {
            tMap: this.iceShaderUniforms.tMap,
            tMapExploded: this.iceShaderUniforms.tMapExploded,
            uTime: this.iceShaderUniforms.uTime,
            uDisplacement: { value: 0 },
            uBounce: { value: 0 }
          };
          return mat;
        });

        const { iglooGroup, blockObjects, totalBlocks } = processIglooBatchedBlocks(subGeometries, blockMaterials[0]);

        // Reassign individual material clones
        blockObjects.forEach((b, idx) => {
          b.mesh.material = blockMaterials[idx];
          b.customMaterial = blockMaterials[idx];
          b.blockNumber = [45, 49, 48, 25, 12, 18, 19, 33, 27, 14][idx % 10];
        });

        this.iglooGroup = iglooGroup;
        this.iglooGroup.position.y = 0.05;
        this.scene.add(this.iglooGroup);

        this.blockObjects = blockObjects;
        this.totalBlocks = totalBlocks;
        this.createNodeLabels();
      }, attributeIDs, attributeTypes);
    }, undefined, (err) => {
      console.warn('Falling back to procedural block generator:', err);
      const { iglooGroup, blockObjects, totalBlocks } = generateIglooBlockObjects(this.iceMat);
      this.iglooGroup = iglooGroup;
      this.iglooGroup.position.y = 0.05;
      this.scene.add(this.iglooGroup);
      this.blockObjects = blockObjects;
      this.totalBlocks = totalBlocks;
      this.createNodeLabels();
    });

    // 3. Authentic 3D Surface, Ground, Patches & Mountain Landscape
    // A. Igloo Base Ground (ground.drc)
    dracoLoader.load('/assets/geometries/ground.drc', (geo) => {
      geo.computeVertexNormals();

      const baseGroundMesh = new THREE.Mesh(geo, this.baseGroundMat);
      baseGroundMesh.position.set(0, 0, 0);
      baseGroundMesh.name = 'igloo_base_ground';
      this.scene.add(baseGroundMesh);

      // Surrounding Terrain Instances
      const terrainInstances = [
        { pos: [-3.76, -0.58, 12.5], scale: [0.6, 0.6, 0.6], rot: [-5.1, 0, 0] },
        { pos: [-17.63, -0.01, 2], scale: [1, 1, 1], rot: [2.7, 0.8, 0] },
        { pos: [3.12, -0.75, -1.02], scale: [1.5, 0.66, 1.5], rot: [0, 0, 0] },
        { pos: [6, 0.16, 15.78], scale: [1, 1, 1], rot: [1.1, 0, 7] },
        { pos: [16.06, 0.34, 4], scale: [1, 1, 1], rot: [0, 0, 0] }
      ];

      terrainInstances.forEach((inst, idx) => {
        const m = new THREE.Mesh(geo, this.terrainMat);
        m.position.set(inst.pos[0], inst.pos[1], inst.pos[2]);
        m.scale.set(inst.scale[0], inst.scale[1], inst.scale[2]);
        m.rotation.set(inst.rot[0] * Math.PI / 180, inst.rot[1] * Math.PI / 180, inst.rot[2] * Math.PI / 180);
        m.name = `terrain_${idx + 1}`;
        this.scene.add(m);
      });
    });

    // B. Terrain Seamless Patches (patch.drc)
    dracoLoader.load('/assets/geometries/igloo/patch.drc', (geo) => {
      geo.computeVertexNormals();
      const patchInstances = [
        { pos: [-9.34, -1.77, 6.96], scale: [7, 7, 7], rot: [0, 0, 0] },
        { pos: [-8.82, -1.35, 11.69], scale: [8, 8, 8], rot: [-5.5, -25.6, 0] }
      ];

      patchInstances.forEach((inst, idx) => {
        const m = new THREE.Mesh(geo, this.terrainMat);
        m.position.set(inst.pos[0], inst.pos[1], inst.pos[2]);
        m.scale.set(inst.scale[0], inst.scale[1], inst.scale[2]);
        m.rotation.set(inst.rot[0] * Math.PI / 180, inst.rot[1] * Math.PI / 180, inst.rot[2] * Math.PI / 180);
        m.name = `terrain_patch_${idx + 1}`;
        this.scene.add(m);
      });
    });

    // C. 5 Horizon Mountain Peak Instances (mountain.drc)
    dracoLoader.load('/assets/geometries/mountain.drc', (geo) => {
      geo.computeVertexNormals();
      const mountainInstances = [
        { pos: [59.53, -1, -11.84], scale: [4, 3.14, 4], rot: [4.1, -42.8, 5] },
        { pos: [1, -2.21, -23], scale: [2, 2, 2], rot: [3.5, 30, 0] },
        { pos: [75, 0, -90], scale: [8, 8, 8], rot: [3.2, -16.7, -2.6] },
        { pos: [-25.22, -1.59, -53.05], scale: [2.5, 2.5, 2.5], rot: [3.5, 25, 0] }
      ];

      mountainInstances.forEach((inst, idx) => {
        const m = new THREE.Mesh(geo, this.mountainMat);
        m.position.set(inst.pos[0], inst.pos[1], inst.pos[2]);
        m.scale.set(inst.scale[0], inst.scale[1], inst.scale[2]);
        m.rotation.set(inst.rot[0] * Math.PI / 180, inst.rot[1] * Math.PI / 180, inst.rot[2] * Math.PI / 180);
        m.name = `mountain_${idx + 1}`;
        this.scene.add(m);
      });
    });

    // 4. Additional 3D WebGL Effects from www.igloo.inc
    this.initWindSmokeSheets(ktx2Loader);
    this.initSnowParticles();
    this.initPlexusNetwork();
  }

  initWindSmokeSheets(ktx2Loader) {
    const smokeGeo = new THREE.PlaneGeometry(20, 5);
    const smokeMat = new THREE.ShaderMaterial({
      uniforms: {
        tWind: { value: null },
        uTime: { value: 0 },
        uAlpha: { value: 0.75 }
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        uniform sampler2D tWind;
        uniform float uTime;
        uniform float uAlpha;
        void main() {
          vec2 uv = vUv;
          uv.x *= 2.0;
          float t = uTime * 0.15;
          if (vWorldPos.x > 6.0) t += 0.914;
          float wind = texture2D(tWind, uv + vec2(-t, t * 0.4)).r;
          wind *= texture2D(tWind, uv * 1.25 + vec2(-t, 0.75)).r;
          wind *= texture2D(tWind, uv * 0.5 + vec2(-t, -t * 0.35)).r;
          wind *= 8.0;
          float alpha = wind;
          alpha *= 1.0 - vUv.y;
          alpha *= smoothstep(0.0, 0.1, vUv.y);
          alpha *= smoothstep(0.0, 0.5, vUv.x);
          alpha *= smoothstep(1.0, 0.8, vUv.x);
          alpha *= uAlpha;
          gl_FragColor = vec4(vec3(1.0), alpha);
        }
      `,
      transparent: true,
      depthWrite: false
    });

    this.windSmokeMat = smokeMat;

    ktx2Loader.load('/assets/images/wind_noise.ktx2', (texture) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.needsUpdate = true;
      smokeMat.uniforms.tWind.value = texture;
    });

    const smoke1 = new THREE.Mesh(smokeGeo, smokeMat);
    smoke1.position.set(-5, 1.25, -10);
    smoke1.renderOrder = 2;
    this.scene.add(smoke1);

    const smoke2 = new THREE.Mesh(smokeGeo, smokeMat);
    smoke2.position.set(13.45, 3, -4);
    smoke2.rotation.y = -10 * Math.PI / 180;
    smoke2.renderOrder = 2;
    this.scene.add(smoke2);
  }

  initSnowParticles() {
    const particleCount = 800;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const randomSeeds = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 50;
      positions[i * 3 + 1] = Math.random() * 20;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 50;

      randomSeeds[i * 3 + 0] = Math.random();
      randomSeeds[i * 3 + 1] = Math.random();
      randomSeeds[i * 3 + 2] = Math.random();
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(randomSeeds, 3));

    const snowMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }
      },
      vertexShader: `
        attribute vec3 aSeed;
        uniform float uTime;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec3 pos = position;
          float t = uTime * 0.35 + aSeed.x * 12.0;
          pos.x += sin(t + aSeed.y * 6.28) * 0.6;
          pos.y = mod(pos.y - uTime * (0.3 + aSeed.z * 0.4), 20.0);
          pos.z += cos(t + aSeed.z * 6.28) * 0.6;
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_PointSize = (2.0 + aSeed.x * 3.0) * (12.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
          vColor = mix(vec3(0.95, 0.97, 1.0), vec3(0.80, 0.63, 0.37), aSeed.y);
          vAlpha = 0.5 + 0.5 * sin(t * 2.0 + aSeed.x * 10.0);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          float alpha = (1.0 - smoothstep(0.2, 0.5, dist)) * 0.75 * vAlpha;
          gl_FragColor = vec4(vColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false
    });

    this.snowMat = snowMat;
    this.snowParticlesMesh = new THREE.Points(geometry, snowMat);
    this.scene.add(this.snowParticlesMesh);
  }

  initPlexusNetwork() {
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(5 * 4 * 3), 3)
    );
    this.plexusLineMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.0,
      linewidth: 1.5,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending
    });
    this.plexusLineMesh = new THREE.LineSegments(lineGeo, this.plexusLineMat);
    this.plexusLineMesh.renderOrder = 999;
    this.scene.add(this.plexusLineMesh);
  }

  createNodeLabels() {
    if (this.nodeLabelPool) {
      this.nodeLabelPool.forEach(el => el.remove());
    }
    this.nodeLabelPool = [];

    // Pre-create a pool of 5 floating HTML label callouts matching www.igloo.inc
    for (let i = 0; i < 5; i++) {
      const el = document.createElement('div');
      el.className = 'floating-node-label';
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      el.style.transition = 'opacity 0.15s ease-out';
      document.body.appendChild(el);
      this.nodeLabelPool.push(el);
    }
  }

  updateNodeLabels(iglooRevealFactor) {
    if (!this.blockObjects || this.blockObjects.length === 0 || !this.nodeLabelPool) return;

    const iglooCenter = new THREE.Vector3(0.0, 1.0, 0.0);
    const distToIgloo = this.mouseWorldHit.distanceTo(iglooCenter);
    const tempV = new THREE.Vector3();
    const halfW = window.innerWidth / 2;
    const halfH = window.innerHeight / 2;

    // 1. Pointer is NOT hovering over the igloo dome (distance > 3.8) -> Hide all lines and labels!
    if (distToIgloo > 3.8) {
      this.nodeLabelPool.forEach(el => {
        el.style.opacity = '0';
      });
      if (this.plexusLineMat) {
        this.plexusLineMat.opacity = Math.max(0.0, this.plexusLineMat.opacity - 0.05);
      }
      return;
    }

    // 2. Pointer IS hovering on the igloo -> Find closest displaced blocks to mouse point
    const hoveredBlocks = this.blockObjects
      .map(b => {
        const p = b.mesh.position;
        const dist = p.distanceTo(this.mouseWorldHit);
        return { block: b, dist: dist };
      })
      .filter(item => item.dist < 3.2 && (item.block.displacement > 0.02 || item.dist < 2.2))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 5);

    // If fewer than 2 active displaced blocks are close to pointer, fade out
    if (hoveredBlocks.length < 2) {
      this.nodeLabelPool.forEach(el => {
        el.style.opacity = '0';
      });
      if (this.plexusLineMat) {
        this.plexusLineMat.opacity = Math.max(0.0, this.plexusLineMat.opacity - 0.05);
      }
      return;
    }

    // 3. Update dynamic callout number labels for active hovered blocks
    hoveredBlocks.forEach((item, i) => {
      const el = this.nodeLabelPool[i];
      if (!el) return;

      const pieceIdx = item.block.index !== undefined ? item.block.index : (i * 11 + 8);
      const dynamicNum = Math.min(99, Math.max(10, Math.floor(pieceIdx * 1.45 + 12)));

      el.innerHTML = `<span class="crosshair">+</span> <span>${dynamicNum}</span>`;

      tempV.copy(item.block.mesh.position);
      if (this.iglooGroup) tempV.add(this.iglooGroup.position);
      tempV.project(this.camera);

      if (tempV.z > 1.0) {
        el.style.opacity = '0';
        return;
      }

      const x = (tempV.x * halfW) + halfW;
      const y = -(tempV.y * halfH) + halfH;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;

      const closeness = Math.max(0.0, 1.0 - item.dist / 3.2);
      const targetOpacity = (closeness * 0.85 + 0.15) * iglooRevealFactor;
      el.style.opacity = targetOpacity.toFixed(2);
    });

    // Hide any unused pooled label elements
    for (let i = hoveredBlocks.length; i < 5; i++) {
      if (this.nodeLabelPool[i]) {
        this.nodeLabelPool[i].style.opacity = '0';
      }
    }

    // 4. Update 3D Plexus Connecting Lines Network between hovered blocks
    const linePositions = [];
    for (let i = 0; i < hoveredBlocks.length - 1; i++) {
      const p1 = hoveredBlocks[i].block.mesh.position;
      const p2 = hoveredBlocks[i + 1].block.mesh.position;
      linePositions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }
    if (hoveredBlocks.length >= 3) {
      const p0 = hoveredBlocks[0].block.mesh.position;
      const p2 = hoveredBlocks[2].block.mesh.position;
      linePositions.push(p0.x, p0.y, p0.z, p2.x, p2.y, p2.z);
    }

    if (this.plexusLineMesh) {
      this.plexusLineMesh.geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(linePositions, 3)
      );
      this.plexusLineMesh.geometry.attributes.position.needsUpdate = true;
      this.plexusLineMat.opacity = Math.min(0.45, this.plexusLineMat.opacity + 0.08);
    }
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
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.minDistance = 4.0;
    this.controls.maxDistance = 35.0;
    this.controls.target.set(0.0, 1.0, 0.0);
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
    const camStart = new THREE.Vector3(-13.5, 2.8, 13.5);
    const camEnd = new THREE.Vector3(-9.5, 5.2, 11.0);
    const lookStart = new THREE.Vector3(0.0, 1.0, 0.0);
    const lookEnd = new THREE.Vector3(0.0, 1.1, 0.6);

    const targetCamPos = new THREE.Vector3().lerpVectors(camStart, camEnd, p);
    const targetLook = new THREE.Vector3().lerpVectors(lookStart, lookEnd, p);

    this.camera.position.lerp(targetCamPos, 0.08);
    this.controls.target.lerp(targetLook, 0.08);
    this.controls.update();
  }

  _handleResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.postResizeHandler(window.innerWidth, window.innerHeight);
  }

  _updateMouse(clientX, clientY) {
    this.mouse2D.x = (clientX / window.innerWidth) * 2 - 1;
    this.mouse2D.y = -(clientY / window.innerHeight) * 2 + 1;
  }

  initEvents() {
    window.addEventListener('resize', this._onResize);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('touchmove', this._onTouchMove);
  }

  /**
   * AUTHENTIC IGLOO BLOCK MOVEMENT PHYSICS (EXACTLY MATCHING www.igloo.inc)
   * Calculates idle wave floating, mouse proximity push, spring bounce, and multi-axis quaternion rotations.
   */
  updateMouseHoverEffect() {
    if (!this.blockObjects || this.blockObjects.length === 0) return;

    // Raycast onto plane for mouse hit point calculation
    this.raycaster.setFromCamera(this.mouse2D, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -1.2);
    const hitPoint = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(plane, hitPoint)) {
      this.mouseWorldHit.lerp(hitPoint, 0.1);
    }

    const time = this.clock.getElapsedTime();
    const vecX = new THREE.Vector3(1, 0, 0);
    const vecY = new THREE.Vector3(0, 1, 0);
    const vecZ = new THREE.Vector3(0, 0, 1);
    const qTmp = new THREE.Quaternion();
    const tmpPos = new THREE.Vector3();

    this.blockObjects.forEach((a) => {
      if (!a.centroid || !a.rand) return;

      // 1. Ambient Floating Wave
      let l = 0.4;
      l *= Math.sin(-time * 2 + a.centroid.x) * 0.5 + 0.5;
      l *= Math.cos(-time) * 0.5 + 0.5;
      l *= THREE.MathUtils.lerp(0.5, 2.0, a.rand.z);
      l *= 0.5;

      // 2. Mouse Proximity Push
      tmpPos.copy(a.centroid);
      if (this.iglooGroup) {
        tmpPos.add(this.iglooGroup.position);
      }
      const distToMouse = tmpPos.distanceTo(this.mouseWorldHit);
      const cNoise = Math.sin(time + a.rand.x * 12.342) * a.rand.y;
      const hDist = THREE.MathUtils.clamp((distToMouse - 1.0) / 2.0, 0, 1);
      const proximityPush = (1.0 - hDist) * (0.6 + 0.3 * cNoise);

      l = Math.max(l, proximityPush);

      // Spring bounce lerp
      a.targetBounce1 = l;
      a.targetBounce2 = a.targetBounce2 !== undefined ? a.targetBounce2 + (a.targetBounce1 - a.targetBounce2) * 0.05 : a.targetBounce1;
      a.bounce = a.bounce !== undefined ? a.bounce + (a.targetBounce2 - a.bounce) * 0.05 : a.targetBounce2;

      // Height modulation (higher blocks displace more)
      const heightFactor = THREE.MathUtils.smoothstep(a.centroid.y, 0.45, 0.7);
      l *= heightFactor;
      l = Math.max(0, l);

      // Dual-stage displacement lerping
      a.targetDisplacement1 = l;
      a.targetDisplacement2 = a.targetDisplacement2 !== undefined ? a.targetDisplacement2 + (a.targetDisplacement1 - a.targetDisplacement2) * 0.06 : a.targetDisplacement1;
      a.displacement = a.displacement !== undefined ? a.displacement + (a.targetDisplacement2 - a.displacement) * 0.06 : a.targetDisplacement2;

      // Position update (outward radial vector from centroid)
      a.position.copy(a.centroid).addScaledVector(a.centroid, a.displacement);

      // 3. Multi-Axis Quaternion Rotations
      const rotY = Math.cos(a.displacement * 2 + a.rand.z * 30) * a.displacement * 0.5;
      const rotZ = Math.cos(a.displacement * 2 + a.rand.x * 30) * a.displacement * 0.5;
      const rotX = Math.cos(a.displacement * 2 + a.rand.y * 30) * a.displacement * 0.5;

      a.quaternion.identity();
      a.quaternion.multiply(qTmp.setFromAxisAngle(vecY, rotY));
      a.quaternion.multiply(qTmp.setFromAxisAngle(vecZ, rotZ));
      a.quaternion.multiply(qTmp.setFromAxisAngle(vecX, rotX));

      // Apply transform to mesh without breaking geometry
      a.mesh.position.copy(a.position);
      a.mesh.quaternion.copy(a.quaternion);

      // Update block shader uniforms for exploded lightmap mix & emission
      if (a.customMaterial && a.customMaterial.uniforms) {
        a.customMaterial.uniforms.uDisplacement.value = a.displacement;
        a.customMaterial.uniforms.uBounce.value = a.bounce;
      }
    });
  }

  animate() {
    this._animFrameId = requestAnimationFrame(() => this.animate());

    const elapsedTime = this.clock.getElapsedTime();
    const deltaTime = this.clock.getDelta();

    this.updateMouseHoverEffect();

    if (this.bgUniforms) {
      this.bgUniforms.uTime.value = elapsedTime;
    }
    if (this.groundUniforms) {
      this.groundUniforms.uTime.value = elapsedTime;
    }
    if (this.terrainUniforms) {
      this.terrainUniforms.uTime.value = elapsedTime;
    }
    if (this.iceShaderUniforms) {
      this.iceShaderUniforms.uTime.value = elapsedTime;
    }
    if (this.windSmokeMat) {
      this.windSmokeMat.uniforms.uTime.value = elapsedTime;
    }
    if (this.snowMat) {
      this.snowMat.uniforms.uTime.value = elapsedTime;
    }

    if (this.spatialCubeUniforms) {
      this.spatialCubeUniforms.uTime.value = elapsedTime;
      const spatialOpacity = Math.max(0.0, (1.0 - this.scrollProgress * 1.15) * 0.75);
      this.spatialCubeUniforms.uGlobalOpacity.value = spatialOpacity;
    }

    // Intro reveal
    const elapsedLoadSec = (performance.now() - this.loadStartTime) / 1000;
    const revealFactor = Math.max(0.0, Math.min(1.0, (elapsedLoadSec - 0.4) / 1.4));

    if (this.iceMat) {
      this.iceMat.opacity = 1.0;
      this.iceMat.transparent = false;
      this.iceMat.depthWrite = true;
    }

    this.hudController.update(deltaTime);
    this.updateNodeLabels(revealFactor);

    this.composer.render();
  }

  /** Clean up all Three.js resources and event listeners on unmount */
  dispose() {
    if (this._animFrameId !== null) {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }

    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('touchmove', this._onTouchMove);

    // Remove injected node label divs
    this.nodeLabelElements.forEach(item => item.element && item.element.remove());
    this.nodeLabelElements = [];

    this.renderer.dispose();
    if (this.container.contains(this.renderer.domElement)) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}

// ─────────────────────────────────────────────
// React component — mounts IglooApp on client
// ─────────────────────────────────────────────
export default function IglooScene() {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const app = new IglooApp(containerRef.current);
    return () => app.dispose();
  }, []);

  return (
    <div
      ref={containerRef}
      id="webgl-container"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 1,
        pointerEvents: 'auto',
        background: 'transparent',
      }}
    />
  );
}
