import * as THREE from 'three';

/**
 * Creates high-detail procedural rocky ice bump & roughness texture map.
 */
export function createProceduralIceTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');

  // Base cool slate ice gradient
  const grad = ctx.createLinearGradient(0, 0, 1024, 1024);
  grad.addColorStop(0, '#8aa0b3');
  grad.addColorStop(0.5, '#788d9f');
  grad.addColorStop(1, '#66798b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 1024);

  // Multi-frequency organic rocky noise
  const imgData = ctx.getImageData(0, 0, 1024, 1024);
  const data = imgData.data;

  for (let y = 0; y < 1024; y++) {
    for (let x = 0; x < 1024; x++) {
      const idx = (y * 1024 + x) * 4;
      const n1 = Math.sin(x * 0.015) * Math.cos(y * 0.015) * 28;
      const n2 = Math.sin(x * 0.06 + y * 0.04) * 16;
      const n3 = (Math.random() - 0.5) * 24;
      const noise = n1 + n2 + n3;

      data[idx + 0] = Math.min(255, Math.max(0, data[idx + 0] + noise));
      data[idx + 1] = Math.min(255, Math.max(0, data[idx + 1] + noise));
      data[idx + 2] = Math.min(255, Math.max(0, data[idx + 2] + noise));
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // Ice cracks & frost crinkles
  ctx.strokeStyle = 'rgba(235, 245, 255, 0.40)';
  ctx.lineWidth = 1.8;
  for (let i = 0; i < 65; i++) {
    ctx.beginPath();
    let x = Math.random() * 1024;
    let y = Math.random() * 1024;
    ctx.moveTo(x, y);
    const steps = 4 + Math.floor(Math.random() * 5);
    for (let s = 0; s < steps; s++) {
      x += (Math.random() - 0.5) * 75;
      y += (Math.random() - 0.5) * 75;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Organic frost mottling patches
  for (let i = 0; i < 45; i++) {
    const rx = Math.random() * 1024;
    const ry = Math.random() * 1024;
    const rw = 35 + Math.random() * 110;
    const g = ctx.createRadialGradient(rx, ry, 0, rx, ry, rw);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(rx, ry, rw, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);
  return texture;
}

/**
 * Generates 3D Volumetric Extruded Igloo Structure with Pillow-Rounded Ice Blocks.
 */
export function generateIglooStructure() {
  const domeRadius = 3.5;
  const numRings = 6;          // 6 dome layers
  const maxPhi = Math.PI * 0.50; // Full hemisphere
  const brickDepth = 0.58;     // Solid 3D block thickness

  // Per-vertex arrays for the solid mesh
  const meshPositions = [];
  const meshNormals = [];
  const meshUvs = [];
  const meshBlockIndices = [];

  // Per-vertex arrays for the wireframe lines
  const linePositions = [];
  const lineBlockIndices = [];

  // Per-block metadata
  const blockMeta = [];
  let currentBlockIndex = 0;
  const baseRimPositions = [];

  /**
   * Adds one extruded 3D ice brick with a Pillow-Rounded outer face.
   */
  function addExtrudedBlock(o0, o1, o2, o3, blockNormal, ringIndex) {
    const norm = blockNormal.clone().normalize();
    const offsetVec = norm.clone().multiplyScalar(-brickDepth);

    const i0 = o0.clone().add(offsetVec);
    const i1 = o1.clone().add(offsetVec);
    const i2 = o2.clone().add(offsetVec);
    const i3 = o3.clone().add(offsetVec);

    const center = new THREE.Vector3()
      .add(o0).add(o1).add(o2).add(o3)
      .add(i0).add(i1).add(i2).add(i3)
      .multiplyScalar(1 / 8);

    const bi = currentBlockIndex;
    blockMeta.push({ center: center.clone(), normal: norm.clone(), ringIndex: ringIndex });

    function addFace(pA, pB, pC, pD, faceNorm) {
      const verts = [pA, pB, pC, pA, pC, pD];
      const uvs = [
        { u: 0, v: 0 }, { u: 1, v: 0 }, { u: 1, v: 1 },
        { u: 0, v: 0 }, { u: 1, v: 1 }, { u: 0, v: 1 }
      ];
      for (let k = 0; k < 6; k++) {
        const v = verts[k];
        meshPositions.push(v.x, v.y, v.z);
        meshNormals.push(faceNorm.x, faceNorm.y, faceNorm.z);
        meshUvs.push(uvs[k].u, uvs[k].v);
        meshBlockIndices.push(bi);
      }
    }

    /**
     * Subdivides outer face into a 3x3 grid with sine-based pillow bulge
     * h(u,v) = sin(u*PI) * sin(v*PI) * 0.12 for rounded ice block faces & edges.
     */
    function addPillowOuterFace(p0, p1, p2, p3, normVec) {
      const segs = 3;
      const grid = [];

      for (let gy = 0; gy <= segs; gy++) {
        const v = gy / segs;
        const row = [];
        for (let gx = 0; gx <= segs; gx++) {
          const u = gx / segs;
          const pTop = new THREE.Vector3().lerpVectors(p0, p1, u);
          const pBot = new THREE.Vector3().lerpVectors(p3, p2, u);
          const pos = new THREE.Vector3().lerpVectors(pTop, pBot, v);

          // Pillow bulging height (max in center, zero at borders)
          const pillowFactor = Math.sin(u * Math.PI) * Math.sin(v * Math.PI);
          const bulge = normVec.clone().multiplyScalar(pillowFactor * 0.12);
          pos.add(bulge);

          // Smooth curved outward normal (tilts near edges for soft rounded corners)
          const pillowNorm = normVec.clone();
          if (pillowFactor > 0.001) {
            const dirFromCenter = pos.clone().sub(center).normalize();
            pillowNorm.lerp(dirFromCenter, 0.42).normalize();
          }

          row.push({ pos, norm: pillowNorm, u, v });
        }
        grid.push(row);
      }

      for (let gy = 0; gy < segs; gy++) {
        for (let gx = 0; gx < segs; gx++) {
          const pA = grid[gy][gx];
          const pB = grid[gy][gx + 1];
          const pC = grid[gy + 1][gx + 1];
          const pD = grid[gy + 1][gx];

          const quadVerts = [pA, pB, pC, pA, pC, pD];
          for (let k = 0; k < 6; k++) {
            const item = quadVerts[k];
            meshPositions.push(item.pos.x, item.pos.y, item.pos.z);
            meshNormals.push(item.norm.x, item.norm.y, item.norm.z);
            meshUvs.push(item.u, item.v);
            meshBlockIndices.push(bi);
          }
        }
      }
    }

    // Outer face with 3D Pillow Bulge
    addPillowOuterFace(o0, o1, o2, o3, norm);

    // Inner face
    addFace(i3, i2, i1, i0, norm.clone().negate());

    // Side faces
    const nTop = new THREE.Vector3().subVectors(o1, o0).cross(norm).normalize();
    const nRight = new THREE.Vector3().subVectors(o2, o1).cross(norm).normalize();
    const nBottom = new THREE.Vector3().subVectors(o3, o2).cross(norm).normalize();
    const nLeft = new THREE.Vector3().subVectors(o0, o3).cross(norm).normalize();

    addFace(o0, o1, i1, i0, nTop);
    addFace(o1, o2, i2, i1, nRight);
    addFace(o2, o3, i3, i2, nBottom);
    addFace(o3, o0, i0, i3, nLeft);

    // Outer front face edges ONLY
    const outerEdges = [[o0, o1], [o1, o2], [o2, o3], [o3, o0]];
    for (const [e1, e2] of outerEdges) {
      linePositions.push(e1.x, e1.y, e1.z, e2.x, e2.y, e2.z);
      lineBlockIndices.push(bi, bi);
    }

    currentBlockIndex++;
  }

  // --- DOME BRICKS (6 layers with subtle seam grooves) ---
  const blocksPerRing = [4, 8, 12, 14, 16, 16];

  for (let r = 0; r < numRings; r++) {
    const phi1 = (r / numRings) * maxPhi;
    const phi2 = ((r + 1) / numRings) * maxPhi;

    // Subtle seam gap for block boundary definition
    const ringGap = 0.008;
    const p1Eff = phi1 + ringGap;
    const p2Eff = phi2 - ringGap;

    const numBlocks = blocksPerRing[r];
    // Alternate ring offset for brick-laying pattern
    const offset = (r % 2 === 0) ? 0 : (Math.PI / numBlocks);
    const blockGapAngle = 0.008;

    for (let b = 0; b < numBlocks; b++) {
      const theta1 = (b / numBlocks) * Math.PI * 2 + offset + blockGapAngle;
      const theta2 = ((b + 1) / numBlocks) * Math.PI * 2 + offset - blockGapAngle;

      const o0 = new THREE.Vector3(domeRadius * Math.sin(p1Eff) * Math.cos(theta1), domeRadius * Math.cos(p1Eff), domeRadius * Math.sin(p1Eff) * Math.sin(theta1));
      const o1 = new THREE.Vector3(domeRadius * Math.sin(p1Eff) * Math.cos(theta2), domeRadius * Math.cos(p1Eff), domeRadius * Math.sin(p1Eff) * Math.sin(theta2));
      const o2 = new THREE.Vector3(domeRadius * Math.sin(p2Eff) * Math.cos(theta2), domeRadius * Math.cos(p2Eff), domeRadius * Math.sin(p2Eff) * Math.sin(theta2));
      const o3 = new THREE.Vector3(domeRadius * Math.sin(p2Eff) * Math.cos(theta1), domeRadius * Math.cos(p2Eff), domeRadius * Math.sin(p2Eff) * Math.sin(theta1));

      // Doorway cutout: remove front entrance blocks on ground ring only (r === numRings - 1)
      const midAngle = ((theta1 + theta2) / 2) % (Math.PI * 2);
      const angleFromFront = Math.abs(midAngle - Math.PI / 2);
      const isFront = angleFromFront < 0.30 || angleFromFront > (Math.PI * 2 - 0.30);
      if (r === numRings - 1 && isFront) {
        continue;
      }

      const blockNorm = new THREE.Vector3().addVectors(o0, o2).multiplyScalar(0.5).normalize();
      addExtrudedBlock(o0, o1, o2, o3, blockNorm, r);

      if (r === numRings - 1) {
        baseRimPositions.push(o3.x, 0.02, o3.z, o2.x, 0.02, o2.z);
      }
    }
  }

  // --- ARCHED ENTRANCE TUNNEL (Outside attached to front dome wall) ---
  const tunnelRadius = 1.35;
  const tunnelLength = 1.3;
  const tunnelStartZ = 3.2;
  const archRings = 3;
  const archSegments = 7;

  for (let a = 0; a < archRings; a++) {
    const z1 = tunnelStartZ + (a / archRings) * tunnelLength;
    const z2 = tunnelStartZ + ((a + 1) / archRings) * tunnelLength;

    for (let s = 0; s < archSegments; s++) {
      const u1 = (s / archSegments) * Math.PI;
      const u2 = ((s + 1) / archSegments) * Math.PI;

      const o0 = new THREE.Vector3(tunnelRadius * Math.cos(u1), tunnelRadius * Math.sin(u1), z1);
      const o1 = new THREE.Vector3(tunnelRadius * Math.cos(u2), tunnelRadius * Math.sin(u2), z1);
      const o2 = new THREE.Vector3(tunnelRadius * Math.cos(u2), tunnelRadius * Math.sin(u2), z2);
      const o3 = new THREE.Vector3(tunnelRadius * Math.cos(u1), tunnelRadius * Math.sin(u1), z2);

      const midU = (u1 + u2) / 2;
      const blockNorm = new THREE.Vector3(Math.cos(midU), Math.sin(midU), 0).normalize();
      addExtrudedBlock(o0, o1, o2, o3, blockNorm, numRings); // tunnel blocks

      if (s === 0 || s === archSegments - 1) {
        baseRimPositions.push(o0.x, 0.02, o0.z, o3.x, 0.02, o3.z);
      }
    }
  }

  // Build BufferGeometries (Clean geometry without inner sphere or inner lines)
  const iglooMeshGeometry = new THREE.BufferGeometry();
  iglooMeshGeometry.setAttribute('position', new THREE.Float32BufferAttribute(meshPositions, 3));
  iglooMeshGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(meshNormals, 3));
  iglooMeshGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(meshUvs, 2));
  iglooMeshGeometry.setAttribute('aBlockIndex', new THREE.Float32BufferAttribute(meshBlockIndices, 1));

  const iglooWireframeGeometry = new THREE.BufferGeometry();
  iglooWireframeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
  iglooWireframeGeometry.setAttribute('aBlockIndex', new THREE.Float32BufferAttribute(lineBlockIndices, 1));

  const baseRimGeometry = new THREE.BufferGeometry();
  baseRimGeometry.setAttribute('position', new THREE.Float32BufferAttribute(baseRimPositions, 3));

  // --- 3D SPATIAL WORLD CUBES ---
  const worldCubeVertices = [];
  const worldCubeFlickerData = [];
  const gridNodes = [];

  const cubeGridSizeX = 14;
  const cubeGridSizeY = 6;
  const cubeGridSizeZ = 14;
  const cubeSpacing = 3.2;

  const startX = -((cubeGridSizeX - 1) * cubeSpacing) / 2;
  const startY = -1.0;
  const startZ = -((cubeGridSizeZ - 1) * cubeSpacing) / 2;

  for (let ix = 0; ix < cubeGridSizeX; ix++) {
    for (let iy = 0; iy < cubeGridSizeY; iy++) {
      for (let iz = 0; iz < cubeGridSizeZ; iz++) {
        const x = startX + ix * cubeSpacing;
        const y = startY + iy * cubeSpacing;
        const z = startZ + iz * cubeSpacing;

        const distFromCenter = Math.sqrt(x * x + z * z);
        if (distFromCenter < 3.2 && y < 3.5) continue;

        if (ix < cubeGridSizeX - 1) {
          worldCubeVertices.push(x, y, z, x + cubeSpacing, y, z);
          const phase = Math.random() * 100, speed = 4.0 + Math.random() * 12.0;
          worldCubeFlickerData.push(phase, speed, phase, speed);
        }
        if (iy < cubeGridSizeY - 1) {
          worldCubeVertices.push(x, y, z, x, y + cubeSpacing, z);
          const phase = Math.random() * 100, speed = 4.0 + Math.random() * 12.0;
          worldCubeFlickerData.push(phase, speed, phase, speed);
        }
        if (iz < cubeGridSizeZ - 1) {
          worldCubeVertices.push(x, y, z, x, y, z + cubeSpacing);
          const phase = Math.random() * 100, speed = 4.0 + Math.random() * 12.0;
          worldCubeFlickerData.push(phase, speed, phase, speed);
        }

        if (Math.random() < 0.03) {
          gridNodes.push({
            position: new THREE.Vector3(x, y, z),
            number: Math.floor(10 + Math.random() * 85)
          });
        }
      }
    }
  }

  // Node callouts 18 & 19
  const node18Rest = new THREE.Vector3(-0.9, 2.1, 2.6);
  const node19Rest = new THREE.Vector3(0.7, 2.1, 2.6);
  gridNodes.push(
    { position: node18Rest, number: '18' },
    { position: node19Rest, number: '19' }
  );

  // Leader line 18 → 19
  const calloutLinesGeo = new THREE.BufferGeometry();
  calloutLinesGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    node18Rest.x, node18Rest.y, node18Rest.z,
    node19Rest.x, node19Rest.y, node19Rest.z
  ], 3));

  const terrainWireframeGeometry = new THREE.BufferGeometry();
  terrainWireframeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(worldCubeVertices, 3));
  terrainWireframeGeometry.setAttribute('aFlicker', new THREE.Float32BufferAttribute(worldCubeFlickerData, 2));

  return {
    iglooMeshGeometry,
    iglooWireframeGeometry,
    baseRimGeometry,
    terrainWireframeGeometry,
    calloutLinesGeo,
    gridNodes,
    node18Rest,
    node19Rest,
    blockMeta,          // Array of { center: Vector3, normal: Vector3 } per block
    totalBlockCount: currentBlockIndex,
    iceTexture: createProceduralIceTexture()
  };
}

/**
 * Generates 3D Procedural Arctic Mountain Terrain.
 * - Distant mountain peaks rising up to 30 units high in the background
 * - Rolling midground snow dunes
 * - Flat clearing at the center around the igloo base
 */
export function generateMountainTerrain() {
  const geo = new THREE.PlaneGeometry(180, 180, 180, 180);
  geo.rotateX(-Math.PI / 2);

  const posAttr = geo.attributes.position;
  const count = posAttr.count;

  for (let i = 0; i < count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);

    const distFromCenter = Math.sqrt(x * x + z * z);

    // Smooth transition: flat clearing near center around the igloo (R < 4.2)
    const centerFactor = THREE.MathUtils.smoothstep(distFromCenter, 4.0, 40.0);

    // Multi-octave mountain noise
    const nPeaks = (Math.sin(x * 0.035) * Math.cos(z * 0.03) * 16.0 + Math.sin(x * 0.07 + z * 0.06) * 8.0);
    const nDunes = Math.sin(x * 0.12) * Math.cos(z * 0.10) * 3.5 + Math.sin(x * 0.22 + z * 0.18) * 1.6;
    const nDetail = Math.sin(x * 0.4) * Math.cos(z * 0.4) * 0.5;

    // Height increases dramatically towards distant background (negative Z)
    const backHeightFactor = z < 0 ? Math.pow(Math.abs(z) / 90.0, 1.35) * 26.0 : Math.pow(z / 90.0, 1.2) * 8.0;

    let height = (nPeaks + nDunes + nDetail + backHeightFactor) * centerFactor;
    height = Math.max(-0.25, height);

    posAttr.setY(i, height);
  }

  geo.computeVertexNormals();
  return geo;
}
