// GLSL Shaders for GPU Particle Morphing & Organic Turbulence

export const particleVertexShader = `
uniform float uProgress;
uniform float uTime;
uniform float uSwirlAmount;
uniform float uPointSize;
uniform float uPixelRatio;
uniform vec3 uColorPrimary;
uniform vec3 uColorSecondary;
uniform vec3 uColorAccent;

attribute vec3 aTargetPosition;
attribute vec4 aRandom; // x: delay, y: speed, z: sizeMult, w: colorMix
attribute vec3 aColor;

varying vec3 vColor;
varying float vProgress;
varying float vAlpha;

// Simplex 3D Noise generator
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857; // 1.0/7.0
  vec3  ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

// 3D Curl Noise derived from Simplex noise derivatives
vec3 curlNoise(vec3 p) {
  const float e = 0.1;
  float dx = snoise(p + vec3(e, 0.0, 0.0)) - snoise(p - vec3(e, 0.0, 0.0));
  float dy = snoise(p + vec3(0.0, e, 0.0)) - snoise(p - vec3(0.0, e, 0.0));
  float dz = snoise(p + vec3(0.0, 0.0, e)) - snoise(p - vec3(0.0, 0.0, e));

  return vec3(dy - dz, dz - dx, dx - dy) / (2.0 * e);
}

// Smooth cubic easing for natural interpolation
float cubicEaseInOut(float t) {
  return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
}

void main() {
  // Staggered per-particle progress based on delay
  float delay = aRandom.x * 0.45; // Delay up to 45% of total progress
  float pNormalized = clamp((uProgress - delay) / (1.0 - delay), 0.0, 1.0);
  float easedProgress = cubicEaseInOut(pNormalized);

  // Compute base trajectory interpolation
  vec3 currentPos = mix(position, aTargetPosition, easedProgress);

  // Apply organic curl noise swirl during transition
  float noiseTime = uTime * 0.25 + aRandom.y * 5.0;
  vec3 noisePos = currentPos * 0.3 + vec3(noiseTime);
  vec3 curl = curlNoise(noisePos);

  // Swirl factor peaks in the middle of transition and fades out as particles reach target
  float transitionWeight = sin(easedProgress * 3.14159265);
  vec3 swirlDisplacement = curl * uSwirlAmount * transitionWeight * (1.0 + aRandom.z);

  // Subtle ambient breathing idle motion when formed
  vec3 idleOffset = vec3(
    snoise(aTargetPosition * 0.5 + vec3(uTime * 0.3)),
    snoise(aTargetPosition * 0.5 + vec3(uTime * 0.3 + 10.0)),
    snoise(aTargetPosition * 0.5 + vec3(uTime * 0.3 + 20.0))
  ) * 0.04 * easedProgress;

  vec3 finalPos = currentPos + swirlDisplacement + idleOffset;

  // Transform position to view space
  vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  // Particle size calculation with depth attenuation
  float sizeFactor = mix(0.7, 1.3, aRandom.z);
  float pulse = 1.0 + 0.15 * sin(uTime * 2.0 + aRandom.y * 10.0);
  gl_PointSize = uPointSize * sizeFactor * pulse * (300.0 / -mvPosition.z) * uPixelRatio;

  // Dynamic color interpolation across themes & morph progress
  vec3 themeColor = mix(uColorPrimary, uColorSecondary, aRandom.w);
  themeColor = mix(themeColor, uColorAccent, smoothstep(0.7, 1.0, aRandom.z) * 0.4);
  
  // Brighten particles when assembling
  vec3 assemblyGlow = vec3(0.3, 0.4, 0.6) * transitionWeight;
  vColor = themeColor + aColor * 0.2 + assemblyGlow;

  vProgress = easedProgress;
  vAlpha = mix(0.3, 0.95, smoothstep(0.0, 0.2, uProgress));
}
`;

export const particleFragmentShader = `
uniform float uTime;
varying vec3 vColor;
varying float vProgress;
varying float vAlpha;

void main() {
  // Distance from center of point sprite (0.0 at center to 0.5 at edge)
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord);

  // Circular clip
  if (dist > 0.5) discard;

  // Soft circular glow falloff
  float core = 1.0 - smoothstep(0.0, 0.2, dist);
  float halo = 1.0 - smoothstep(0.1, 0.5, dist);
  float alpha = (core * 0.8 + halo * 0.5) * vAlpha;

  // Soft radial glow color shift
  vec3 finalColor = vColor + vec3(0.2, 0.35, 0.5) * core * 0.5;

  gl_FragColor = vec4(finalColor, alpha);
}
`;
