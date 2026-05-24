import { EmbroideryRenderer } from "./renderer.js";
import { HandController } from "./interactive.js";

const PARTICLE_TEXTURE_SIZE = 320;
const PARTICLE_COUNT = PARTICLE_TEXTURE_SIZE * PARTICLE_TEXTURE_SIZE;
const MAX_IMAGE_DIMENSION = 448;
const WEAVE_FRONT_RATIO = 0.075;

const canvas = document.querySelector("#stage");
const video = document.querySelector("#handVideo");
const uploadButton = document.querySelector("#uploadButton");
const uploadInput = document.querySelector("#uploadInput");
const statusNode = document.querySelector("#status");
const progressFill = document.querySelector("#progressFill");

const renderer = new EmbroideryRenderer(canvas);
const capability = renderer.init();

const hand = new HandController(video, canvas, {
  onStatus: setStatus,
});

let progress = 0;
let hasDesign = false;
let lastTime = performance.now();
let lastWorld = null;
let wasPinching = false;
let statusMode = "idle";

if (!capability.webgl2 || !capability.floatTexture) {
  setStatus("当前浏览器会降低粒子精度");
}

uploadButton.addEventListener("click", () => uploadInput.click());
uploadInput.addEventListener("change", async () => {
  const file = uploadInput.files?.[0];
  if (!file) return;
  await loadImageAsEmbroidery(file);
  uploadInput.value = "";
});

requestAnimationFrame(tick);

async function loadImageAsEmbroidery(file) {
  setStatus("正在提取主色与经纬点阵");
  uploadButton.disabled = true;

  try {
    const image = await decodeImage(file);
    const embroideryData = await buildEmbroideryData(image);
    renderer.loadDesign(embroideryData);
    hasDesign = true;
    progress = 0;
    lastWorld = null;
    wasPinching = false;
    statusMode = "ready";
    progressFill.style.transform = "scaleX(0)";
    document.body.classList.add("has-design");
    setStatus("捏合织梭并移动");
    hand.start();
  } catch (error) {
    console.error(error);
    setStatus("图片处理失败");
  } finally {
    uploadButton.disabled = false;
  }
}

function tick(now) {
  const delta = Math.min((now - lastTime) / 1000, 0.033);
  lastTime = now;

  const input = hand.update(delta);
  const world = renderer.screenToWorld(input.x, input.y);
  const weave = evaluateWeaveDrive(input, world, delta);

  if (hasDesign && progress < 1 && weave.drive > 0) {
    progress = Math.min(1, progress + weave.drive * delta);
    if (progress > 0.995) progress = 1;
  }

  hand.setProgress(progress);
  progressFill.style.transform = `scaleX(${progress.toFixed(4)})`;
  updateStatus(input, weave);

  renderer.render(delta, progress, {
    world,
    pinch: input.pinch,
    weaveInfluence: weave.influence,
    shuttleMotion: weave.shuttleMotion,
  });

  requestAnimationFrame(tick);
}

function evaluateWeaveDrive(input, world, delta) {
  const previous = lastWorld;
  const pinchStarted = input.pinch && !wasPinching;
  lastWorld = { x: world.x, y: world.y };
  wasPinching = input.pinch;

  const inactive = { drive: 0, influence: 0, shuttleMotion: 0, aligned: false };
  if (!hasDesign || !input.pinch || pinchStarted || !previous || !renderer.designBounds) {
    return inactive;
  }

  const bounds = renderer.designBounds;
  const halfW = bounds.width * 0.5;
  const halfH = bounds.height * 0.5;
  const frontT = clamp(progress / 0.985, 0, 1);
  const frontY = (0.5 - frontT) * bounds.height;
  const band = clamp(bounds.height * WEAVE_FRONT_RATIO, 0.055, 0.11);
  const distanceToFront = Math.abs(world.y - frontY);
  const boundaryGate = 1 - smoothstep(band * 0.32, band, distanceToFront);
  const inFabric =
    Math.abs(world.x) <= halfW + 0.08 &&
    world.y <= halfH + 0.1 &&
    world.y >= -halfH - 0.1;

  const horizontalSpeed = Math.abs(input.rawDx || 0) * (renderer.camera.right - renderer.camera.left);
  const verticalSpeed = Math.abs(input.rawDy || 0) * (renderer.camera.top - renderer.camera.bottom);
  const shuttleSpeed = Math.hypot(horizontalSpeed, verticalSpeed);
  const lateralRatio = horizontalSpeed / (horizontalSpeed + verticalSpeed + 0.001);
  const isActiveShuttle = horizontalSpeed > 0.075 && lateralRatio > 0.5;
  const shuttleMotion = inFabric
    ? smoothstep(0.055, 0.28, shuttleSpeed)
    : 0;
  const weaveMotion = isActiveShuttle
    ? smoothstep(0.075, 0.34, horizontalSpeed) * smoothstep(0.5, 0.74, lateralRatio)
    : 0;
  const motionGate = weaveMotion;
  const zoneGate = inFabric ? boundaryGate : 0;
  const influence = zoneGate * motionGate;
  const drive = progress < 1 ? influence * (0.035 + Math.min(horizontalSpeed, 2.4) * 0.048) : 0;

  return {
    drive,
    influence,
    shuttleMotion,
    aligned: zoneGate > 0.35,
  };
}

function updateStatus(input, weave) {
  if (!hasDesign) return;
  if (progress >= 1 && statusMode !== "done") {
    statusMode = "done";
    setStatus("织锦完成");
    return;
  }

  const nextMode = input.pinch ? (weave.drive > 0.0001 ? "stitching" : weave.aligned ? "sweep" : "front") : "ready";
  if (statusMode === nextMode || progress >= 1) return;
  statusMode = nextMode;
  if (nextMode === "stitching") setStatus("正在织锦");
  else if (nextMode === "sweep") setStatus("沿织造边界横向穿梭");
  else if (nextMode === "front") setStatus("对准已织与未织的边界");
  else setStatus("捏合织梭并移动");
}

function setStatus(text) {
  statusNode.textContent = text;
}

async function decodeImage(file) {
  if ("createImageBitmap" in window) {
    return createImageBitmap(file, { colorSpaceConversion: "default" });
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

async function buildEmbroideryData(image) {
  await yieldFrame();

  const aspect = image.width / image.height || 1;
  const width = aspect >= 1 ? MAX_IMAGE_DIMENSION : Math.max(96, Math.round(MAX_IMAGE_DIMENSION * aspect));
  const height = aspect >= 1 ? Math.max(96, Math.round(MAX_IMAGE_DIMENSION / aspect)) : MAX_IMAGE_DIMENSION;
  const canvas2d = document.createElement("canvas");
  canvas2d.width = width;
  canvas2d.height = height;
  const ctx = canvas2d.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);

  const pixels = ctx.getImageData(0, 0, width, height).data;
  const luminance = new Float32Array(width * height);
  for (let i = 0, p = 0; i < luminance.length; i += 1, p += 4) {
    const alpha = pixels[p + 3] / 255;
    const luma = (pixels[p] * 0.299 + pixels[p + 1] * 0.587 + pixels[p + 2] * 0.114) / 255;
    luminance[i] = alpha > 0.04 ? luma : 1;
  }

  const dominantColor = extractDominantColor(pixels);
  return packWeaveTextures(pixels, luminance, width, height, aspect, dominantColor);
}

function packWeaveTextures(pixels, luminance, imageWidth, imageHeight, imageAspect, dominantColor) {
  const total = PARTICLE_COUNT;
  const target = new Float32Array(total * 4);
  const color = new Float32Array(total * 4);
  const position = new Float32Array(total * 4);
  const velocity = new Float32Array(total * 4);
  const random = mulberry32(7331);

  const samplesPerLine = PARTICLE_TEXTURE_SIZE;
  const lanesPerAxis = PARTICLE_TEXTURE_SIZE / 2;
  const warpCount = samplesPerLine * lanesPerAxis;
  const maxW = 2.22;
  const maxH = 1.68;
  const bounds =
    imageAspect >= maxW / maxH
      ? { width: maxW, height: maxW / imageAspect }
      : { width: maxH * imageAspect, height: maxH };
  const warpBase = makeWarpBaseColor(dominantColor);

  for (let i = 0; i < total; i += 1) {
    const isWeft = i >= warpCount;
    const local = isWeft ? i - warpCount : i;
    const lane = Math.floor(local / samplesPerLine);
    const sample = local % samplesPerLine;
    const laneT = lane / Math.max(1, lanesPerAxis - 1);
    const sampleT = sample / Math.max(1, samplesPerLine - 1);
    const u = isWeft ? sampleT : laneT;
    const v = isWeft ? laneT : sampleT;
    const px = clamp(Math.round(u * (imageWidth - 1)), 0, imageWidth - 1);
    const py = clamp(Math.round(v * (imageHeight - 1)), 0, imageHeight - 1);
    const p = (py * imageWidth + px) * 4;
    const alpha = pixels[p + 3] / 255;
    const r = pixels[p] / 255;
    const g = pixels[p + 1] / 255;
    const b = pixels[p + 2] / 255;
    const l = luminance[py * imageWidth + px];
    const edge = estimateEdge(luminance, imageWidth, imageHeight, px, py);
    const saturation = Math.max(r, g, b) - Math.min(r, g, b);
    const motif = clamp(alpha * (saturation * 1.75 + (1 - l) * 0.86 + edge * 0.48), 0, 1);
    const idx = i * 4;
    const x = (u - 0.5) * bounds.width + (random() - 0.5) * 0.0012;
    const y = (0.5 - v) * bounds.height + (random() - 0.5) * 0.0012;
    const interlace = (lane + sample) % 2;
    const overUnder = motif > 0.18 || interlace === 0 ? 0.038 : 0.012;
    const warpLift = 0.015 + interlace * 0.006;
    const z = isWeft
      ? 0.016 + overUnder + edge * 0.026 + motif * 0.025
      : 0.01 + warpLift + edge * 0.002;
    const order = isWeft
      ? clamp(0.075 + v * 0.905 + (random() - 0.5) * 0.006, 0, 1)
      : -0.06 + sampleT * 0.012 + laneT * 0.004 + random() * 0.003;
    const thread = isWeft ? tuneThreadColor(r, g, b, l, motif, true) : warpBase;

    target[idx] = x;
    target[idx + 1] = y;
    target[idx + 2] = z;
    target[idx + 3] = order;

    color[idx] = thread.r;
    color[idx + 1] = thread.g;
    color[idx + 2] = thread.b;
    color[idx + 3] = isWeft ? 0.66 + motif * 0.34 : 0.46;

    position[idx] = isWeft ? x + (random() - 0.5) * 0.42 : x;
    position[idx + 1] = isWeft ? bounds.height * 0.66 + random() * 0.5 : y;
    position[idx + 2] = isWeft ? 0.12 + random() * 0.24 : z;
    position[idx + 3] = 1;

    velocity[idx] = isWeft ? (random() - 0.5) * 0.035 : 0;
    velocity[idx + 1] = isWeft ? -0.08 - random() * 0.08 : 0;
    velocity[idx + 2] = isWeft ? (random() - 0.5) * 0.04 : 0;
    velocity[idx + 3] = 1;
  }

  return {
    textureSize: PARTICLE_TEXTURE_SIZE,
    count: total,
    bounds,
    target,
    color,
    position,
    velocity,
  };
}

function estimateEdge(luminance, width, height, x, y) {
  const left = luminance[y * width + Math.max(0, x - 1)];
  const right = luminance[y * width + Math.min(width - 1, x + 1)];
  const top = luminance[Math.max(0, y - 1) * width + x];
  const bottom = luminance[Math.min(height - 1, y + 1) * width + x];
  return Math.min(1, Math.hypot(right - left, bottom - top) * 2.4);
}

function extractDominantColor(pixels) {
  const buckets = new Map();
  let fallback = { count: 0, r: 0.74, g: 0.77, b: 0.78 };

  for (let p = 0; p < pixels.length; p += 4) {
    const alpha = pixels[p + 3] / 255;
    if (alpha <= 0.04) continue;

    const r = pixels[p];
    const g = pixels[p + 1];
    const b = pixels[p + 2];
    const key = `${r >> 4},${g >> 4},${b >> 4}`;
    const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += alpha;
    bucket.r += r * alpha;
    bucket.g += g * alpha;
    bucket.b += b * alpha;
    buckets.set(key, bucket);
  }

  for (const bucket of buckets.values()) {
    if (bucket.count > fallback.count) {
      fallback = {
        count: bucket.count,
        r: bucket.r / bucket.count / 255,
        g: bucket.g / bucket.count / 255,
        b: bucket.b / bucket.count / 255,
      };
    }
  }

  return fallback;
}

function makeWarpBaseColor(color) {
  const luma = color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
  const targetLuma = clamp(luma * 1.08 + 0.04, 0.22, 0.9);
  const lumaScale = targetLuma / Math.max(luma, 0.001);
  return {
    r: clamp(color.r * lumaScale, 0.025, 0.96),
    g: clamp(color.g * lumaScale, 0.025, 0.96),
    b: clamp(color.b * lumaScale, 0.025, 0.96),
  };
}

function selectTrajectory(candidates, width, height) {
  if (!candidates.length) return makeFallbackTrajectory(width, height);

  candidates.sort((a, b) => b.score - a.score);
  const selected = candidates.slice(0, Math.min(candidates.length, PARTICLE_COUNT));

  if (selected.length < PARTICLE_COUNT) {
    const random = mulberry32(4027);
    const sourceLength = selected.length;
    for (let i = selected.length; i < PARTICLE_COUNT; i += 1) {
      const base = selected[Math.floor(random() * sourceLength)];
      selected.push({
        ...base,
        x: clamp(base.x + (random() - 0.5) * 1.6, 1, width - 2),
        y: clamp(base.y + (random() - 0.5) * 1.6, 1, height - 2),
        score: base.score * 0.92,
      });
    }
  }

  selected.sort((a, b) => {
    const aContour = a.edge > 0.12 ? 0 : 1;
    const bContour = b.edge > 0.12 ? 0 : 1;
    if (aContour !== bContour) return aContour - bContour;
    if (aContour === 0) return a.angle + a.ring * 1.7 - (b.angle + b.ring * 1.7);
    return b.score - a.score || a.y - b.y || a.x - b.x;
  });

  return selected.slice(0, PARTICLE_COUNT);
}

function packTextures(points, imageWidth, imageHeight, imageAspect) {
  const total = PARTICLE_COUNT;
  const target = new Float32Array(total * 4);
  const color = new Float32Array(total * 4);
  const position = new Float32Array(total * 4);
  const velocity = new Float32Array(total * 4);
  const random = mulberry32(7331);

  const maxW = 1.72;
  const maxH = 1.58;
  const bounds =
    imageAspect >= maxW / maxH
      ? { width: maxW, height: maxW / imageAspect }
      : { width: maxH * imageAspect, height: maxH };

  for (let i = 0; i < total; i += 1) {
    const p = points[i];
    const u = p.x / Math.max(1, imageWidth - 1);
    const v = p.y / Math.max(1, imageHeight - 1);
    const order = i / Math.max(1, total - 1);
    const jitter = (random() - 0.5) * 0.0035;
    const x = (u - 0.5) * bounds.width + jitter;
    const y = (0.5 - v) * bounds.height + jitter;
    const z = 0.015 + (1 - p.l) * 0.022 + p.edge * 0.014;
    const idx = i * 4;
    const thread = tuneThreadColor(p.r, p.g, p.b, p.l);

    target[idx] = x;
    target[idx + 1] = y;
    target[idx + 2] = z;
    target[idx + 3] = order;

    color[idx] = thread.r;
    color[idx + 1] = thread.g;
    color[idx + 2] = thread.b;
    color[idx + 3] = 1;

    const theta = random() * Math.PI * 2;
    const radius = 0.12 + random() * 0.38;
    position[idx] = x + Math.cos(theta) * radius;
    position[idx + 1] = y + Math.sin(theta) * radius;
    position[idx + 2] = 0.16 + random() * 0.28;
    position[idx + 3] = 1;

    velocity[idx] = (random() - 0.5) * 0.04;
    velocity[idx + 1] = (random() - 0.5) * 0.04;
    velocity[idx + 2] = (random() - 0.5) * 0.025;
    velocity[idx + 3] = 1;
  }

  return {
    textureSize: PARTICLE_TEXTURE_SIZE,
    count: total,
    bounds,
    target,
    color,
    position,
    velocity,
  };
}

function tuneThreadColor(r, g, b, luma, motif = 1, isWeft = false) {
  const lift = isWeft ? 0.018 : 0.04;
  const contrast = isWeft ? 1.42 : 1.04;
  const neutral = isWeft ? { r: 0.82, g: 0.66, b: 0.38 } : { r: 0.74, g: 0.77, b: 0.78 };
  let picked = {
    r: clamp((r - 0.5) * contrast + 0.5 + lift * (1 - luma), 0.02, 1),
    g: clamp((g - 0.5) * contrast + 0.5 + lift * (1 - luma), 0.02, 1),
    b: clamp((b - 0.5) * contrast + 0.5 + lift * (1 - luma), 0.02, 1),
  };
  const gray = picked.r * 0.299 + picked.g * 0.587 + picked.b * 0.114;
  const saturationBoost = isWeft ? 1.32 + motif * 0.24 : 1.05;
  picked = {
    r: clamp(gray + (picked.r - gray) * saturationBoost, 0.02, 1),
    g: clamp(gray + (picked.g - gray) * saturationBoost, 0.02, 1),
    b: clamp(gray + (picked.b - gray) * saturationBoost, 0.02, 1),
  };
  const mixAmount = isWeft ? clamp(0.82 + motif * 0.18, 0, 1) : clamp(0.28 + motif * 0.48, 0, 1);
  return {
    r: clamp(neutral.r * (1 - mixAmount) + picked.r * mixAmount, 0.02, 1),
    g: clamp(neutral.g * (1 - mixAmount) + picked.g * mixAmount, 0.02, 1),
    b: clamp(neutral.b * (1 - mixAmount) + picked.b * mixAmount, 0.02, 1),
  };
}

function makeFallbackTrajectory(width, height) {
  const random = mulberry32(1069);
  const points = [];
  for (let i = 0; i < PARTICLE_COUNT; i += 1) {
    const t = i / PARTICLE_COUNT;
    const a = t * Math.PI * 18;
    const r = Math.sqrt(t) * 0.46;
    points.push({
      x: width * (0.5 + Math.cos(a) * r * 0.8 + (random() - 0.5) * 0.018),
      y: height * (0.5 + Math.sin(a) * r + (random() - 0.5) * 0.018),
      l: 0.38 + random() * 0.34,
      edge: 0.3,
      score: 0.5,
      angle: a,
      ring: r,
      r: 0.18,
      g: 0.18,
      b: 0.19,
    });
  }
  return points;
}

function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function yieldFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}
