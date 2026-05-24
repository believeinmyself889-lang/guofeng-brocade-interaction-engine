import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";

const SIM_VERTEX = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const NOISE_GLSL = `
float hash31(vec3 p) {
  p = fract(p * vec3(0.1031, 0.11369, 0.13787));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

float valueNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);

  float n000 = hash31(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(i + vec3(1.0, 1.0, 1.0));

  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  float nxy0 = mix(nx00, nx10, f.y);
  float nxy1 = mix(nx01, nx11, f.y);
  return mix(nxy0, nxy1, f.z);
}

vec3 curlNoise(vec3 p) {
  const float e = 0.085;
  float n1 = valueNoise(p + vec3(0.0, e, 0.0));
  float n2 = valueNoise(p - vec3(0.0, e, 0.0));
  float n3 = valueNoise(p + vec3(0.0, 0.0, e));
  float n4 = valueNoise(p - vec3(0.0, 0.0, e));
  float n5 = valueNoise(p + vec3(e, 0.0, 0.0));
  float n6 = valueNoise(p - vec3(e, 0.0, 0.0));
  vec3 c = vec3(n2 - n1, n4 - n3, n6 - n5);
  return normalize(c + vec3(0.0001));
}
`;

const VELOCITY_FRAGMENT = `
precision highp float;

uniform sampler2D uPosition;
uniform sampler2D uVelocity;
uniform sampler2D uTarget;
uniform vec3 uNeedle;
uniform vec3 uShuttle;
uniform float uProgress;
uniform float uDelta;
uniform float uTime;

varying vec2 vUv;

${NOISE_GLSL}

void main() {
  vec3 position = texture2D(uPosition, vUv).xyz;
  vec3 velocity = texture2D(uVelocity, vUv).xyz;
  vec4 targetPack = texture2D(uTarget, vUv);
  float order = targetPack.a;
  float enabled = step(order, 1.001);

  if (enabled < 0.5) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec3 target = targetPack.xyz;
  float isWarp = 1.0 - step(0.0, order);
  float motion = smoothstep(0.015, 0.72, uNeedle.z);
  float shuttleMotion = smoothstep(0.015, 0.72, uShuttle.z);
  float reveal = smoothstep(order - 0.018, order + 0.018, uProgress);
  float preReveal = smoothstep(order - 0.12, order + 0.015, uProgress) * (1.0 - reveal);
  float finalHold = smoothstep(0.985, 1.0, uProgress);

  vec3 needle = vec3(uNeedle.xy, 0.15 + 0.035 * sin(uTime * 5.0));
  vec3 toNeedle = needle - position;
  float dNeedle = max(length(toNeedle.xy), 0.001);
  vec3 tangent = vec3(-toNeedle.y, toNeedle.x, 0.0) / dNeedle;

  vec3 curl = curlNoise(vec3(position.xy * 2.8, uTime * 0.18 + order * 3.0));
  vec3 settle = (target - position) *
    (2.4 + reveal * 8.5 + finalHold * 10.0 + (1.0 - motion) * 3.2 + isWarp * (5.5 + (1.0 - shuttleMotion) * 13.0));
  vec3 follow = (needle - position) * motion * preReveal * 4.2;
  vec3 wrap = tangent * exp(-dNeedle * 3.2) * motion * preReveal * 1.8;
  vec3 wind = curl * motion * (0.72 * preReveal + 0.12 * (1.0 - reveal));
  vec2 toShuttle = position.xy - uShuttle.xy;
  float shuttleDx = abs(toShuttle.x);
  float shuttleDy = abs(toShuttle.y);
  float contact = exp(-shuttleDx * 8.2 - shuttleDy * 4.6) * shuttleMotion * isWarp;
  float spread = sin(length(toShuttle * vec2(1.1, 0.72)) * 42.0 - uTime * 18.0 + order * 31.0);
  float side = sign(toShuttle.x + 0.0001);
  vec3 warpImpulse = vec3(
    side * (0.62 + spread * 0.18),
    spread * 0.1,
    0.88 + spread * 0.18
  ) * contact * 14.0;

  velocity += (settle + follow + wrap + wind + warpImpulse) * min(uDelta, 0.033);
  velocity *= pow(mix(mix(0.0012, 0.24, max(motion, shuttleMotion)), 0.018, finalHold), min(uDelta, 0.033));
  velocity = clamp(velocity, vec3(-2.8), vec3(2.8));

  gl_FragColor = vec4(velocity, 1.0);
}
`;

const POSITION_FRAGMENT = `
precision highp float;

uniform sampler2D uPosition;
uniform sampler2D uVelocity;
uniform sampler2D uTarget;
uniform float uProgress;
uniform float uDelta;

varying vec2 vUv;

void main() {
  vec3 position = texture2D(uPosition, vUv).xyz;
  vec3 velocity = texture2D(uVelocity, vUv).xyz;
  vec4 targetPack = texture2D(uTarget, vUv);
  float enabled = step(targetPack.a, 1.001);

  if (enabled < 0.5) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec3 target = targetPack.xyz;
  position += velocity * min(uDelta, 0.033);
  position = mix(position, target, smoothstep(0.99, 1.0, uProgress) * min(uDelta * 12.0, 1.0));

  gl_FragColor = vec4(position, 1.0);
}
`;

const THREAD_VERTEX = `
precision highp float;

attribute vec2 simUv;

uniform sampler2D uPosition;
uniform sampler2D uTarget;
uniform sampler2D uColor;
uniform float uProgress;
uniform float uPixelRatio;
uniform float uPointScale;
uniform float uTime;
uniform float uShuttleMotion;
uniform vec3 uNeedle;

varying vec4 vColor;
varying float vAlpha;
varying float vReveal;
varying float vFiberSeed;
varying float vWarpWave;

void main() {
  vec4 targetPack = texture2D(uTarget, simUv);
  vec4 colorPack = texture2D(uColor, simUv);
  vec3 position = texture2D(uPosition, simUv).xyz;
  float order = targetPack.a;
  float fiberSeed = fract(order * 997.13);
  float isWarp = 1.0 - step(0.0, order);
  float enabled = step(order, 1.001) * colorPack.a;
  float reveal = smoothstep(order - 0.02, order + 0.02, uProgress);
  float nearby = smoothstep(order - 0.11, order + 0.012, uProgress) * (1.0 - reveal);
  float luma = dot(colorPack.rgb, vec3(0.299, 0.587, 0.114));
  float shuttleField = exp(-length(position.xy - uNeedle.xy) * 7.2) * uNeedle.z;
  float dShuttle = length(position.xy - uNeedle.xy);
  float motion = smoothstep(0.02, 0.72, max(uNeedle.z, uShuttleMotion));
  float verticalDistance = abs(position.y - uNeedle.y);
  float horizontalDistance = abs(position.x - uNeedle.x);
  float horizontalContact = exp(-horizontalDistance * 8.5);
  float verticalFalloff = exp(-verticalDistance * 4.15);
  float bilateralWave = sin(verticalDistance * 34.0 - uTime * 15.0 + fiberSeed * 6.283);
  float sidePhase = sin((position.x - uNeedle.x) * 18.0 + uTime * 5.5);
  float warpSway = isWarp * motion * horizontalContact * verticalFalloff * bilateralWave * 0.036;
  float ambientWave = sin(position.y * 28.0 + fiberSeed * 6.283 + uTime * 1.15) * 0.008;
  float diffuseWave = sin(dShuttle * 42.0 - uTime * 13.5 + fiberSeed * 2.0);
  float diffuseMask = exp(-dShuttle * 4.25) * motion;
  float warpWave = isWarp * (ambientWave + diffuseWave * diffuseMask * 0.055);
  float overShuttle = step(0.44, fract(fiberSeed * 15.37));
  position.x += warpSway + isWarp * sidePhase * horizontalContact * verticalFalloff * motion * 0.012;
  position.z += shuttleField * overShuttle * 0.12 + warpWave + abs(warpSway) * 0.45;

  vColor = colorPack;
  vReveal = reveal;
  vAlpha = enabled * (0.08 + reveal * 0.88 + nearby * 0.26 + shuttleField * overShuttle * 0.28 + isWarp * (diffuseMask + horizontalContact * verticalFalloff * motion) * 0.24);
  vFiberSeed = fiberSeed;
  vWarpWave = isWarp * (abs(ambientWave) * 34.0 + diffuseMask * 0.85 + abs(diffuseWave) * diffuseMask * 0.35 + abs(warpSway) * 27.0);

  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = (1.05 + (1.0 - luma) * 2.45 + reveal * 0.8 + shuttleField * 0.8 + isWarp * ((diffuseMask + horizontalContact * verticalFalloff * motion) * 0.95 + abs(ambientWave) * 16.0)) * uPixelRatio * uPointScale;
}
`;

const THREAD_FRAGMENT = `
precision highp float;

varying vec4 vColor;
varying float vAlpha;
varying float vReveal;
varying float vFiberSeed;
varying float vWarpWave;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float strand = smoothstep(1.0, 0.16, abs(p.y + 0.18 * sin(p.x * 2.2 + vFiberSeed * 6.283)));
  float cap = smoothstep(1.0, 0.32, length(p));
  float alpha = strand * cap * vAlpha;
  if (alpha < 0.012) discard;

  float fiber = 0.82 + 0.18 * sin((p.x + p.y) * 18.0 + vFiberSeed * 18.0);
  vec3 color = vColor.rgb * fiber;
  color = mix(color * 1.08, color + vec3(0.035), vReveal * 0.22);
  color += vec3(0.08, 0.065, 0.035) * clamp(vWarpWave, 0.0, 1.0);

  gl_FragColor = vec4(color, alpha);
}
`;

const FABRIC_VERTEX = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FABRIC_FRAGMENT = `
precision highp float;

uniform float uTime;
uniform vec3 uNeedleUv;

varying vec2 vUv;

void main() {
  vec2 centered = vUv - 0.5;
  float vignette = smoothstep(0.88, 0.18, length(centered));
  float warp = sin(vUv.x * 720.0) * 0.5 + 0.5;
  float weft = sin(vUv.y * 680.0) * 0.5 + 0.5;
  float cross = warp * 0.012 + weft * 0.011;
  float broad = sin((vUv.x + vUv.y) * 36.0) * 0.004;
  float clothBreath = sin(vUv.x * 21.0 + uTime * 0.42) * sin(vUv.y * 17.0 - uTime * 0.34) * 0.006;
  float dNeedle = length((vUv - uNeedleUv.xy) * vec2(1.5, 1.0));
  float pressure = exp(-dNeedle * 9.0) * uNeedleUv.z;
  float ripple = sin(dNeedle * 58.0 - uTime * 14.0) * exp(-dNeedle * 5.4) * uNeedleUv.z;
  float relief = clothBreath + pressure * 0.012 + ripple * 0.024;
  vec3 base = vec3(0.982, 0.981, 0.972);
  vec3 color = base - cross + broad + vignette * 0.018;
  color += vec3(0.62, 0.55, 0.36) * max(relief, 0.0);
  color -= vec3(0.18, 0.16, 0.1) * max(-relief, 0.0);
  gl_FragColor = vec4(color, 1.0);
}
`;

const LOOM_VERTEX = `
attribute float weaveAxis;
attribute float weaveOrder;

uniform float uProgress;
uniform float uTime;

varying float vAxis;
varying float vAlpha;
varying float vGlow;
varying float vOrder;

void main() {
  float reveal = smoothstep(weaveOrder - 0.055, weaveOrder + 0.045, uProgress);
  float pass = smoothstep(weaveOrder - 0.06, weaveOrder + 0.012, uProgress) *
    (1.0 - smoothstep(weaveOrder + 0.03, weaveOrder + 0.16, uProgress));
  vec3 pos = position;
  pos.z += pass * 0.004;

  vAxis = weaveAxis;
  vAlpha = 0.055 + reveal * 0.24 + pass * 0.18;
  vGlow = pass;
  vOrder = weaveOrder;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const LOOM_FRAGMENT = `
precision highp float;

varying float vAxis;
varying float vAlpha;
varying float vGlow;
varying float vOrder;

void main() {
  vec3 warp = vec3(0.72, 0.75, 0.77);
  vec3 weft = vec3(0.82, 0.62, 0.32);
  vec3 silk = mix(warp, weft, vAxis);
  silk += vec3(0.09, 0.07, 0.03) * vGlow;
  silk *= 0.94 + 0.06 * sin(vOrder * 80.0);
  gl_FragColor = vec4(silk, vAlpha);
}
`;

const NEEDLE_VERTEX = `
varying vec3 vNormal;
varying vec3 vWorld;

void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const NEEDLE_FRAGMENT = `
precision highp float;

varying vec3 vNormal;
varying vec3 vWorld;

void main() {
  vec3 n = normalize(vNormal);
  vec3 light = normalize(vec3(-0.35, 0.55, 0.74));
  float diffuse = max(dot(n, light), 0.0);
  float rim = pow(1.0 - max(dot(n, vec3(0.0, 0.0, 1.0)), 0.0), 2.0);
  float grain = sin(vWorld.x * 42.0 + vWorld.y * 13.0) * 0.035;
  vec3 wood = mix(vec3(0.42, 0.23, 0.12), vec3(0.9, 0.64, 0.34), diffuse);
  wood += vec3(0.12, 0.08, 0.03) * rim + grain;
  gl_FragColor = vec4(wood, 1.0);
}
`;

const POST_VERTEX = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const POST_FRAGMENT = `
precision highp float;

uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform float uBloomStrength;

varying vec2 vUv;

vec3 aces(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec2 px = 1.0 / max(uResolution, vec2(1.0));
  vec3 color = texture2D(tDiffuse, vUv).rgb;
  vec3 bloom = vec3(0.0);
  bloom += max(texture2D(tDiffuse, vUv + px * vec2( 1.5,  0.0)).rgb - 0.72, 0.0);
  bloom += max(texture2D(tDiffuse, vUv + px * vec2(-1.5,  0.0)).rgb - 0.72, 0.0);
  bloom += max(texture2D(tDiffuse, vUv + px * vec2( 0.0,  1.5)).rgb - 0.72, 0.0);
  bloom += max(texture2D(tDiffuse, vUv + px * vec2( 0.0, -1.5)).rgb - 0.72, 0.0);
  bloom *= 0.25;
  color += bloom * uBloomStrength;
  color = aces(color);
  color = pow(color, vec3(1.0 / 2.2));
  gl_FragColor = vec4(color, 1.0);
}
`;

export function createSimulationMaterial(kind) {
  return new THREE.ShaderMaterial({
    vertexShader: SIM_VERTEX,
    fragmentShader: kind === "velocity" ? VELOCITY_FRAGMENT : POSITION_FRAGMENT,
    uniforms: {
      uPosition: { value: null },
      uVelocity: { value: null },
      uTarget: { value: null },
      uNeedle: { value: new THREE.Vector3(0, 0, 0) },
      uShuttle: { value: new THREE.Vector3(0, 0, 0) },
      uProgress: { value: 0 },
      uDelta: { value: 0.016 },
      uTime: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
  });
}

export function createThreadMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: THREAD_VERTEX,
    fragmentShader: THREAD_FRAGMENT,
    uniforms: {
      uPosition: { value: null },
      uTarget: { value: null },
      uColor: { value: null },
      uProgress: { value: 0 },
      uPixelRatio: { value: 1 },
      uPointScale: { value: 1 },
      uTime: { value: 0 },
      uShuttleMotion: { value: 0 },
      uNeedle: { value: new THREE.Vector3(0, 0, 0) },
    },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
}

export function createFabricMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: FABRIC_VERTEX,
    fragmentShader: FABRIC_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uNeedleUv: { value: new THREE.Vector3(0.5, 0.5, 0) },
    },
    depthTest: true,
    depthWrite: false,
  });
}

export function createLoomMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: LOOM_VERTEX,
    fragmentShader: LOOM_FRAGMENT,
    uniforms: {
      uProgress: { value: 0 },
      uTime: { value: 0 },
    },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
}

export function createNeedleMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: NEEDLE_VERTEX,
    fragmentShader: NEEDLE_FRAGMENT,
  });
}

export function createPostMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: POST_VERTEX,
    fragmentShader: POST_FRAGMENT,
    uniforms: {
      tDiffuse: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uBloomStrength: { value: 0.16 },
    },
    depthTest: false,
    depthWrite: false,
  });
}
