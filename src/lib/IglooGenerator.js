import * as THREE from 'three';

/**
 * Splits a Draco BufferGeometry with 'batchId' into sub-geometries per ice block.
 */
export function splitBatchedGeometry(geometry) {
  const batchIdAttr = geometry.getAttribute('batchId');
  const index = geometry.getIndex();
  if (!batchIdAttr || !index) return [geometry];

  const batchIds = new Set();
  const indexMap = new Map();
  const indicesMap = new Map();

  for (let i = 0; i < index.count; i++) {
    const oldIdx = index.array[i];
    const bId = batchIdAttr.array[oldIdx];
    batchIds.add(bId);

    if (!indexMap.has(bId)) indexMap.set(bId, new Map());
    if (!indicesMap.has(bId)) indicesMap.set(bId, []);

    const idMap = indexMap.get(bId);
    const idxList = indicesMap.get(bId);

    if (idMap.has(oldIdx)) {
      idxList.push(idMap.get(oldIdx));
    } else {
      const newIdx = idMap.size;
      idMap.set(oldIdx, newIdx);
      idxList.push(newIdx);
    }
  }

  const subGeometries = [];
  for (const bId of batchIds) {
    const subGeo = new THREE.BufferGeometry();
    const idMap = indexMap.get(bId);
    const idxList = indicesMap.get(bId);

    for (const attrName in geometry.attributes) {
      if (attrName === 'batchId') continue;
      const attr = geometry.getAttribute(attrName);
      const itemSize = attr.itemSize;
      const subArray = new attr.array.constructor(idMap.size * itemSize);

      idMap.forEach((newIdx, oldIdx) => {
        for (let s = 0; s < itemSize; s++) {
          subArray[newIdx * itemSize + s] = attr.array[oldIdx * itemSize + s];
        }
      });

      subGeo.setAttribute(attrName, new THREE.BufferAttribute(subArray, itemSize, attr.normalized));
    }

    const IndexArrayType = idxList.length > 65535 ? Uint32Array : Uint16Array;
    subGeo.setIndex(new THREE.BufferAttribute(new IndexArrayType(idxList), 1));
    subGeometries.push(subGeo);
  }

  return subGeometries;
}

/**
 * Converts split sub-geometries into block objects with centroids and initial transforms.
 */
export function processIglooBatchedBlocks(subGeometries, iceMaterial) {
  const blockObjects = [];
  const iglooGroup = new THREE.Group();
  const tempVec = new THREE.Vector3();

  subGeometries.forEach((geo, pieceIndex) => {
    const centrAttr = geo.getAttribute('centr');
    const randAttr = geo.getAttribute('rand');

    let centroid = new THREE.Vector3();
    if (centrAttr) {
      centroid.fromArray(centrAttr.array, 0);
    } else {
      geo.computeBoundingSphere();
      centroid.copy(geo.boundingSphere.center);
    }

    let rand = new THREE.Vector3(Math.random(), Math.random(), Math.random());
    if (randAttr) {
      rand.fromArray(randAttr.array, 0);
    }

    // Center subgeometry vertices around centroid
    const posAttr = geo.getAttribute('position');
    for (let p = 0; p < posAttr.count; p++) {
      tempVec.fromArray(posAttr.array, p * 3);
      tempVec.sub(centroid).toArray(posAttr.array, p * 3);
    }
    posAttr.needsUpdate = true;
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, iceMaterial);
    mesh.position.copy(centroid);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    iglooGroup.add(mesh);

    blockObjects.push({
      mesh: mesh,
      centroid: centroid.clone(),
      position: centroid.clone(),
      quaternion: new THREE.Quaternion(),
      rand: rand.clone(),
      displacement: 0,
      targetDisplacement1: 0,
      targetDisplacement2: 0,
      bounce: 0,
      targetBounce1: 0,
      targetBounce2: 0,
      scrollDisplacement1: 0,
      scrollDisplacement2: 0,
      pieceIndex: pieceIndex
    });
  });

  return { iglooGroup, blockObjects, totalBlocks: blockObjects.length };
}

/**
 * Creates high-detail procedural rocky ice bump & roughness texture map.
 */
export function createProceduralIceTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');

  // Base slate stone gradient matching user's texture image
  const grad = ctx.createLinearGradient(0, 0, 1024, 1024);
  grad.addColorStop(0, '#506072');
  grad.addColorStop(0.5, '#405060');
  grad.addColorStop(1, '#324050');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 1024);

  // Multi-frequency organic mottled slate rock noise
  const imgData = ctx.getImageData(0, 0, 1024, 1024);
  const data = imgData.data;

  for (let y = 0; y < 1024; y++) {
    for (let x = 0; x < 1024; x++) {
      const idx = (y * 1024 + x) * 4;

      // Organic mottled granite noise layers
      const n1 = Math.sin(x * 0.025 + y * 0.015) * Math.cos(x * 0.015 - y * 0.025) * 35;
      const n2 = Math.sin(x * 0.08 + y * 0.06) * 22;
      const n3 = Math.sin(x * 0.20 + y * 0.18) * 14;
      const n4 = (Math.random() - 0.5) * 32;

      const noise = n1 + n2 + n3 + n4;

      // Dark slate crevices and bright mineral speckles
      data[idx + 0] = Math.min(255, Math.max(0, data[idx + 0] + noise));
      data[idx + 1] = Math.min(255, Math.max(0, data[idx + 1] + noise + 2));
      data[idx + 2] = Math.min(255, Math.max(0, data[idx + 2] + noise + 5));
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // Organic dark slate crack veins
  ctx.strokeStyle = 'rgba(25, 35, 46, 0.55)';
  ctx.lineWidth = 2.2;
  for (let i = 0; i < 90; i++) {
    ctx.beginPath();
    let x = Math.random() * 1024;
    let y = Math.random() * 1024;
    ctx.moveTo(x, y);
    const steps = 4 + Math.floor(Math.random() * 6);
    for (let s = 0; s < steps; s++) {
      x += (Math.random() - 0.5) * 60;
      y += (Math.random() - 0.5) * 60;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Soft frosty mottling patches (light slate ice veins)
  for (let i = 0; i < 60; i++) {
    const rx = Math.random() * 1024;
    const ry = Math.random() * 1024;
    const rw = 25 + Math.random() * 90;
    const g = ctx.createRadialGradient(rx, ry, 0, rx, ry, rw);
    g.addColorStop(0, 'rgba(200, 220, 240, 0.28)');
    g.addColorStop(1, 'rgba(200, 220, 240, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(rx, ry, rw, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  return texture;
}

/**
 * Helper function to build a 3D rounded box (rock brick) with smooth bevelled edges and rounded corners.
 */
function createRoundedBoxData(width, height, depth, radius) {
  const hw = width / 2;
  const hh = height / 2;
  const hd = depth / 2;
  const r = Math.min(radius, hw * 0.35, hh * 0.35, hd * 0.35);

  function getRoundedPoint(x, y, z) {
    const cx = Math.max(-hw + r, Math.min(hw - r, x));
    const cy = Math.max(-hh + r, Math.min(hh - r, y));
    const cz = Math.max(-hd + r, Math.min(hd - r, z));

    const dx = x - cx;
    const dy = y - cy;
    const dz = z - cz;

    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let normX = 0, normY = 0, normZ = 0;

    if (len > 0.00001) {
      normX = dx / len;
      normY = dy / len;
      normZ = dz / len;
    } else {
      normX = x !== 0 ? Math.sign(x) : 0;
      normY = y !== 0 ? Math.sign(y) : 0;
      normZ = z !== 0 ? Math.sign(z) : 1;
    }

    const pos = new THREE.Vector3(
      cx + normX * r,
      cy + normY * r,
      cz + normZ * r
    );
    const norm = new THREE.Vector3(normX, normY, normZ);

    return { pos, norm };
  }

  const vertices = [];
  const normals = [];
  const uvs = [];

  function addSubdividedFace(uDir, vDir, normalDir, uLen, vLen, nOffset) {
    const segU = 5;
    const segV = 5;

    for (let i = 0; i < segU; i++) {
      for (let j = 0; j < segV; j++) {
        const u0 = (i / segU - 0.5) * uLen;
        const u1 = ((i + 1) / segU - 0.5) * uLen;
        const v0 = (j / segV - 0.5) * vLen;
        const v1 = ((j + 1) / segV - 0.5) * vLen;

        const p00 = uDir.clone().multiplyScalar(u0).add(vDir.clone().multiplyScalar(v0)).add(normalDir.clone().multiplyScalar(nOffset));
        const p10 = uDir.clone().multiplyScalar(u1).add(vDir.clone().multiplyScalar(v0)).add(normalDir.clone().multiplyScalar(nOffset));
        const p11 = uDir.clone().multiplyScalar(u1).add(vDir.clone().multiplyScalar(v1)).add(normalDir.clone().multiplyScalar(nOffset));
        const p01 = uDir.clone().multiplyScalar(u0).add(vDir.clone().multiplyScalar(v1)).add(normalDir.clone().multiplyScalar(nOffset));

        const r00 = getRoundedPoint(p00.x, p00.y, p00.z);
        const r10 = getRoundedPoint(p10.x, p10.y, p10.z);
        const r11 = getRoundedPoint(p11.x, p11.y, p11.z);
        const r01 = getRoundedPoint(p01.x, p01.y, p01.z);

        const quad = [r00, r10, r11, r00, r11, r01];
        const quadUVs = [
          [i / segU, j / segV],
          [(i + 1) / segU, j / segV],
          [(i + 1) / segU, (j + 1) / segV],
          [i / segU, j / segV],
          [(i + 1) / segU, (j + 1) / segV],
          [i / segU, (j + 1) / segV]
        ];

        for (let k = 0; k < 6; k++) {
          vertices.push(quad[k].pos);
          normals.push(quad[k].norm);
          uvs.push(quadUVs[k]);
        }
      }
    }
  }

  const X = new THREE.Vector3(1, 0, 0);
  const Y = new THREE.Vector3(0, 1, 0);
  const Z = new THREE.Vector3(0, 0, 1);

  // Front (+Z)
  addSubdividedFace(X, Y, Z, width, height, hd);
  // Back (-Z)
  addSubdividedFace(X.clone().negate(), Y, Z.clone().negate(), width, height, hd);
  // Top (+Y)
  addSubdividedFace(X, Z.clone().negate(), Y, width, depth, hh);
  // Bottom (-Y)
  addSubdividedFace(X, Z, Y.clone().negate(), width, depth, hh);
  // Right (+X)
  addSubdividedFace(Z.clone().negate(), Y, X, depth, height, hw);
  // Left (-X)
  addSubdividedFace(Z, Y, X.clone().negate(), depth, height, hw);

  const frontEdge00 = getRoundedPoint(hw, hh, hd).pos;
  const frontEdge10 = getRoundedPoint(-hw, hh, hd).pos;
  const frontEdge11 = getRoundedPoint(-hw, -hh, hd).pos;
  const frontEdge01 = getRoundedPoint(hw, -hh, hd).pos;

  const edges = [
    [frontEdge00, frontEdge10],
    [frontEdge10, frontEdge11],
    [frontEdge11, frontEdge01],
    [frontEdge01, frontEdge00]
  ];

  return { vertices, normals, uvs, edges };
}

/**
 * Generates individual solid 3D rounded rock block meshes for rigid non-tearing transforms.
 */
export function generateIglooBlockObjects(iceMat) {
  const domeRadius = 3.5;
  const numRings = 6;
  const maxPhi = Math.PI * 0.50;

  const blockObjects = [];
  const iglooGroup = new THREE.Group();

  function addBlockMesh(o0, o1, o2, o3, blockNormal, ringIndex) {
    const width = (o0.distanceTo(o1) + o3.distanceTo(o2)) / 2;
    const height = (o0.distanceTo(o3) + o1.distanceTo(o2)) / 2;
    const depth = 0.65;

    const norm = blockNormal.clone().normalize();
    const tangent = new THREE.Vector3().subVectors(o1, o0).normalize();
    const up = new THREE.Vector3().crossVectors(norm, tangent).normalize();
    const tangentFixed = new THREE.Vector3().crossVectors(up, norm).normalize();

    const outerCenter = new THREE.Vector3()
      .add(o0).add(o1).add(o2).add(o3)
      .multiplyScalar(0.25);

    const center = outerCenter.clone().sub(norm.clone().multiplyScalar(depth / 2));

    const boxData = createRoundedBoxData(width, height, depth, 0.10);

    const count = boxData.vertices.length;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);

    for (let i = 0; i < count; i++) {
      const v = boxData.vertices[i];
      const n = boxData.normals[i];
      const uv = boxData.uvs[i];

      positions[i * 3 + 0] = v.x;
      positions[i * 3 + 1] = v.y;
      positions[i * 3 + 2] = v.z;

      normals[i * 3 + 0] = n.x;
      normals[i * 3 + 1] = n.y;
      normals[i * 3 + 2] = n.z;

      uvs[i * 2 + 0] = uv[0];
      uvs[i * 2 + 1] = uv[1];
    }

    const blockGeo = new THREE.BufferGeometry();
    blockGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    blockGeo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    blockGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    const blockMesh = new THREE.Mesh(blockGeo, iceMat);

    const rotMatrix = new THREE.Matrix4().makeBasis(tangentFixed, up, norm);
    const restQuat = new THREE.Quaternion().setFromRotationMatrix(rotMatrix);

    blockMesh.position.copy(center);
    blockMesh.quaternion.copy(restQuat);

    iglooGroup.add(blockMesh);

    blockObjects.push({
      mesh: blockMesh,
      restPosition: center.clone(),
      restQuaternion: restQuat.clone(),
      centroid: center.clone(),
      normal: norm.clone(),
      ringIndex: ringIndex,
      currentPush: 0,
      currentRotX: 0,
      currentRotY: 0,
      currentRotZ: 0
    });
  }

  // --- DOME BRICKS ---
  const blocksPerRing = [4, 8, 12, 14, 16, 16];
  for (let r = 0; r < numRings; r++) {
    const phi1 = (r / numRings) * maxPhi;
    const phi2 = ((r + 1) / numRings) * maxPhi;

    const ringGap = 0.008;
    const p1Eff = phi1 + ringGap;
    const p2Eff = phi2 - ringGap;

    const numBlocks = blocksPerRing[r];
    const offset = (r % 2 === 0) ? 0 : (Math.PI / numBlocks);
    const blockGapAngle = 0.008;

    for (let b = 0; b < numBlocks; b++) {
      const theta1 = (b / numBlocks) * Math.PI * 2 + offset + blockGapAngle;
      const theta2 = ((b + 1) / numBlocks) * Math.PI * 2 + offset - blockGapAngle;

      const o0 = new THREE.Vector3(domeRadius * Math.sin(p1Eff) * Math.cos(theta1), domeRadius * Math.cos(p1Eff), domeRadius * Math.sin(p1Eff) * Math.sin(theta1));
      const o1 = new THREE.Vector3(domeRadius * Math.sin(p1Eff) * Math.cos(theta2), domeRadius * Math.cos(p1Eff), domeRadius * Math.sin(p1Eff) * Math.sin(theta2));
      const o2 = new THREE.Vector3(domeRadius * Math.sin(p2Eff) * Math.cos(theta2), domeRadius * Math.cos(p2Eff), domeRadius * Math.sin(p2Eff) * Math.sin(theta2));
      const o3 = new THREE.Vector3(domeRadius * Math.sin(p2Eff) * Math.cos(theta1), domeRadius * Math.cos(p2Eff), domeRadius * Math.sin(p2Eff) * Math.sin(theta1));

      const midAngle = ((theta1 + theta2) / 2) % (Math.PI * 2);
      const angleFromFront = Math.abs(midAngle - Math.PI / 2);
      const isFront = angleFromFront < 0.30 || angleFromFront > (Math.PI * 2 - 0.30);
      if (r === numRings - 1 && isFront) continue;

      const blockNorm = new THREE.Vector3().addVectors(o0, o2).multiplyScalar(0.5).normalize();
      addBlockMesh(o0, o1, o2, o3, blockNorm, r);
    }
  }

  // --- ENTRANCE ARCH TUNNEL ---
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
      addBlockMesh(o0, o1, o2, o3, blockNorm, numRings);
    }
  }

  return { iglooGroup, blockObjects, totalBlocks: blockObjects.length };
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
   * Adds one solid 3D rounded rock block to the igloo.
   */
  function addExtrudedBlock(o0, o1, o2, o3, blockNormal, ringIndex) {
    const width = (o0.distanceTo(o1) + o3.distanceTo(o2)) / 2;
    const height = (o0.distanceTo(o3) + o1.distanceTo(o2)) / 2;
    const depth = 0.65; // solid rock block thickness

    const norm = blockNormal.clone().normalize();
    const tangent = new THREE.Vector3().subVectors(o1, o0).normalize();
    const up = new THREE.Vector3().crossVectors(norm, tangent).normalize();
    const tangentFixed = new THREE.Vector3().crossVectors(up, norm).normalize();

    const outerCenter = new THREE.Vector3()
      .add(o0).add(o1).add(o2).add(o3)
      .multiplyScalar(0.25);

    const center = outerCenter.clone().sub(norm.clone().multiplyScalar(depth / 2));

    const bi = currentBlockIndex;
    blockMeta.push({
      center: center.clone(),
      normal: norm.clone(),
      ringIndex: ringIndex
    });

    const boxData = createRoundedBoxData(width, height, depth, 0.10);

    for (let i = 0; i < boxData.vertices.length; i++) {
      const v = boxData.vertices[i];
      const n = boxData.normals[i];
      const uv = boxData.uvs[i];

      const worldP = center.clone()
        .add(tangentFixed.clone().multiplyScalar(v.x))
        .add(up.clone().multiplyScalar(v.y))
        .add(norm.clone().multiplyScalar(v.z));

      const worldN = tangentFixed.clone().multiplyScalar(n.x)
        .add(up.clone().multiplyScalar(n.y))
        .add(norm.clone().multiplyScalar(n.z))
        .normalize();

      meshPositions.push(worldP.x, worldP.y, worldP.z);
      meshNormals.push(worldN.x, worldN.y, worldN.z);
      meshUvs.push(uv[0], uv[1]);
      meshBlockIndices.push(bi);
    }

    for (let i = 0; i < boxData.edges.length; i++) {
      const e = boxData.edges[i];
      const e1 = center.clone()
        .add(tangentFixed.clone().multiplyScalar(e[0].x))
        .add(up.clone().multiplyScalar(e[0].y))
        .add(norm.clone().multiplyScalar(e[0].z));
      const e2 = center.clone()
        .add(tangentFixed.clone().multiplyScalar(e[1].x))
        .add(up.clone().multiplyScalar(e[1].y))
        .add(norm.clone().multiplyScalar(e[1].z));

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

    // 1. Central Elevated Igloo Mound Plateau matching reference image
    let mound = 0.0;
    if (distFromCenter < 4.0) {
      mound = 0.85 + Math.cos((distFromCenter / 4.0) * Math.PI) * 0.10;
    } else if (distFromCenter < 7.5) {
      const t = (distFromCenter - 4.0) / 3.5;
      mound = 0.85 * (1.0 - THREE.MathUtils.smoothstep(t, 0.0, 1.0));
    }

    // 2. Surrounding Mountain & Dune Noise (starts beyond R > 6.0)
    const mountainFactor = THREE.MathUtils.smoothstep(distFromCenter, 6.0, 35.0);

    const nPeaks = Math.sin(x * 0.04) * Math.cos(z * 0.035) * 14.0 + Math.sin(x * 0.08 + z * 0.07) * 7.0;
    const nDunes = Math.sin(x * 0.12) * Math.cos(z * 0.10) * 3.2 + Math.sin(x * 0.22 + z * 0.18) * 1.5;
    const nDetail = Math.sin(x * 0.4) * Math.cos(z * 0.4) * 0.4;

    // Background peaks behind igloo (z < -2)
    const backHeight = z < -2 ? Math.pow(Math.abs(z + 2) / 80.0, 1.25) * 28.0 : 0.0;

    // Side mountain slopes (left and right flanks)
    const sideHeight = Math.pow(Math.abs(x) / 75.0, 1.35) * 18.0;

    let height = mound + (nPeaks + nDunes + nDetail + backHeight + sideHeight) * mountainFactor;
    height = Math.max(0.0, height);

    posAttr.setY(i, height);
  }

  geo.computeVertexNormals();
  return geo;
}
