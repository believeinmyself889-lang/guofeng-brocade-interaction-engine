export class HandController {
  constructor(video, element, callbacks = {}) {
    this.video = video;
    this.element = element;
    this.callbacks = callbacks;
    this.started = false;
    this.handReady = false;
    this.usingHand = false;
    this.progress = 0;
    this.lastPointerTime = 0;
    this.lastHandTime = 0;
    this.lastX = 0.5;
    this.lastY = 0.52;
    this.target = {
      x: 0.5,
      y: 0.52,
      pinch: false,
      confidence: 0,
      source: "pointer",
      movement: 0,
      rawDx: 0,
      rawDy: 0,
      rawTime: 0,
    };
    this.state = { ...this.target };
    this.bindPointerFallback();
  }

  bindPointerFallback() {
    const updatePointer = (event, pinch) => {
      const rect = this.element.getBoundingClientRect();
      const x = clamp01((event.clientX - rect.left) / Math.max(rect.width, 1));
      const y = clamp01((event.clientY - rect.top) / Math.max(rect.height, 1));
      const now = performance.now();
      this.recordTargetMotion(x, y, "pointer", now);
      this.lastPointerTime = now;
      this.target.x = x;
      this.target.y = y;
      this.target.pinch = pinch;
      this.target.confidence = 0.72;
      this.target.source = "pointer";
    };

    this.element.addEventListener("pointerdown", (event) => {
      this.element.setPointerCapture?.(event.pointerId);
      updatePointer(event, true);
    });

    this.element.addEventListener("pointermove", (event) => {
      if (event.buttons || performance.now() - this.lastPointerTime < 400) {
        updatePointer(event, Boolean(event.buttons));
      }
    });

    this.element.addEventListener("pointerup", (event) => {
      updatePointer(event, false);
      this.element.releasePointerCapture?.(event.pointerId);
    });

    this.element.addEventListener("pointercancel", () => {
      this.target.pinch = false;
    });
  }

  async start() {
    if (this.started) return;
    this.started = true;
    this.callbacks.onStatus?.("正在启用织梭手势");

    try {
      const vision = await import(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs"
      );
      const fileset = await vision.FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm",
      );
      this.handLandmarker = await vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numHands: 1,
      });

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 960 },
          height: { ideal: 540 },
        },
        audio: false,
      });

      this.video.srcObject = stream;
      await this.video.play();
      this.handReady = true;
      this.callbacks.onStatus?.("捏合织梭并移动");
      this.detectLoop();
    } catch (error) {
      console.warn("Hand tracking unavailable, pointer fallback is active.", error);
      this.callbacks.onStatus?.("可用鼠标或触控模拟织梭");
    }
  }

  detectLoop() {
    if (!this.handReady) return;

    const now = performance.now();
    const result = this.handLandmarker.detectForVideo(this.video, now);
    const hand = result.landmarks?.[0];

    if (hand) {
      const index = hand[8];
      const thumb = hand[4];
      const palm = hand[0];
      const middleBase = hand[9];
      const handScale = distance2d(palm, middleBase) || 0.1;
      const pinchDistance = distance2d(index, thumb) / handScale;
      const pinch = pinchDistance < 0.72;
      const x = clamp01(1 - index.x);
      const y = clamp01(index.y);

      this.lastHandTime = now;
      if (now - this.lastPointerTime > 600) {
        this.recordTargetMotion(x, y, "hand", now);
        this.target.x = x;
        this.target.y = y;
        this.target.pinch = pinch;
        this.target.confidence = 1;
        this.target.source = "hand";
        this.usingHand = true;
      }
    } else if (this.usingHand && now - this.lastHandTime > 300) {
      this.target.pinch = false;
      this.target.confidence = 0;
      this.usingHand = false;
    }

    requestAnimationFrame(() => this.detectLoop());
  }

  recordTargetMotion(x, y, source, now) {
    const sameSource = this.target.source === source;
    const previousTime = sameSource ? this.target.rawTime || now : now;
    const dt = Math.max((now - previousTime) / 1000, 0.001);
    this.target.rawDx = sameSource ? (x - this.target.x) / dt : 0;
    this.target.rawDy = sameSource ? (y - this.target.y) / dt : 0;
    this.target.rawTime = now;
  }

  update(delta) {
    const ease = 1 - Math.pow(0.0009, Math.min(delta, 0.05));
    const previousX = this.state.x;
    const previousY = this.state.y;
    const rawAge = performance.now() - (this.target.rawTime || 0);
    const rawHold = rawAge < 120 ? 1 - rawAge / 120 : 0;
    this.state.x += (this.target.x - this.state.x) * ease;
    this.state.y += (this.target.y - this.state.y) * ease;
    this.state.pinch = this.target.pinch;
    this.state.confidence += (this.target.confidence - this.state.confidence) * ease;
    this.state.source = this.target.source;
    this.state.progress = this.progress;
    this.state.movement = Math.hypot(this.state.x - previousX, this.state.y - previousY) / Math.max(delta, 0.001);
    this.state.rawDx = this.target.rawDx * rawHold;
    this.state.rawDy = this.target.rawDy * rawHold;
    this.state.rawMovement = Math.hypot(this.state.rawDx, this.state.rawDy);
    return { ...this.state };
  }

  setProgress(progress) {
    this.progress = progress;
  }
}

function distance2d(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}
