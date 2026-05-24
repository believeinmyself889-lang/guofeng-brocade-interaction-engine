import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";
import {
  createFabricMaterial,
  createLoomMaterial,
  createNeedleMaterial,
  createPostMaterial,
  createSimulationMaterial,
  createThreadMaterial,
} from "./effect.js";

export class EmbroideryRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.clock = new THREE.Clock();
    this.viewHeight = 1.78;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.needle = new THREE.Vector3(0, 0, 0);
    this.visualNeedle = new THREE.Vector3(0, 0, 0);
    this.progress = 0;
    this.writeIndex = 0;
    this.textureSize = 0;
    this.motionEnergy = 0;
    this.shuttleMotionEnergy = 0;
    this.hasDesign = false;
  }

  init() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
    this.renderer.setClearColor(0xfbfbfd, 1);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xfbfbfd);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
    this.camera.position.set(0, 0, 3);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.75));
    const key = new THREE.RectAreaLight(0xffffff, 3.5, 4.2, 3.2);
    key.position.set(-0.2, 1.2, 1.9);
    key.lookAt(0, 0, 0);
    this.scene.add(key);

    this.fabric = new THREE.Mesh(
      new THREE.PlaneGeometry(1.84, 1.28, 1, 1),
      createFabricMaterial(),
    );
    this.fabric.position.z = -0.04;
    this.fabric.renderOrder = 0;
    this.fabric.visible = false;
    this.scene.add(this.fabric);

    this.loomLines = this.createLoomLines();
    this.scene.add(this.loomLines);

    this.needleGroup = this.createNeedle();
    this.needleGroup.traverse((child) => {
      child.renderOrder = 2;
    });
    this.needleGroup.visible = false;
    this.scene.add(this.needleGroup);

    this.simScene = new THREE.Scene();
    this.simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.simQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.simScene.add(this.simQuad);
    this.velocityMaterial = createSimulationMaterial("velocity");
    this.positionMaterial = createSimulationMaterial("position");

    this.postScene = new THREE.Scene();
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.postMaterial = createPostMaterial();
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMaterial));

    this.resize();
    window.addEventListener("resize", () => this.resize(), { passive: true });

    return {
      webgl2: this.renderer.capabilities.isWebGL2,
      floatTexture: this.supportsFloatTargets(),
    };
  }

  createNeedle() {
    const group = new THREE.Group();
    const material = createNeedleMaterial();
    const bodyShape = new THREE.Shape();
    bodyShape.moveTo(-0.32, 0);
    bodyShape.bezierCurveTo(-0.22, 0.09, 0.22, 0.09, 0.32, 0);
    bodyShape.bezierCurveTo(0.22, -0.09, -0.22, -0.09, -0.32, 0);

    const bodyGeometry = new THREE.ExtrudeGeometry(bodyShape, {
      depth: 0.038,
      bevelEnabled: true,
      bevelSize: 0.012,
      bevelThickness: 0.014,
      bevelSegments: 5,
    });
    bodyGeometry.center();
    const body = new THREE.Mesh(bodyGeometry, material);
    body.castShadow = true;
    group.add(body);

    const slotShape = new THREE.Shape();
    slotShape.moveTo(-0.104, 0);
    slotShape.quadraticCurveTo(-0.104, 0.028, -0.074, 0.028);
    slotShape.lineTo(0.074, 0.028);
    slotShape.quadraticCurveTo(0.104, 0.028, 0.104, 0);
    slotShape.quadraticCurveTo(0.104, -0.028, 0.074, -0.028);
    slotShape.lineTo(-0.074, -0.028);
    slotShape.quadraticCurveTo(-0.104, -0.028, -0.104, 0);

    const slot = new THREE.Mesh(
      new THREE.ShapeGeometry(slotShape),
      new THREE.MeshBasicMaterial({ color: 0x2b160b, transparent: true, opacity: 0.66 }),
    );
    slot.position.z = 0.035;
    group.add(slot);

    const silkRoll = new THREE.Mesh(
      new THREE.TorusGeometry(0.054, 0.0065, 8, 36),
      new THREE.MeshBasicMaterial({ color: 0xd7ac54, transparent: true, opacity: 0.86 }),
    );
    silkRoll.position.z = 0.039;
    group.add(silkRoll);

    group.scale.setScalar(0.92);
    group.position.set(0, 0, 0.1);
    return group;
  }

  createLoomLines() {
    const width = 1.84;
    const height = 1.28;
    const columns = 180;
    const rows = 124;
    const vertices = [];
    const axes = [];
    const orders = [];

    for (let i = 0; i < columns; i += 1) {
      const t = i / Math.max(columns - 1, 1);
      const x = (t - 0.5) * width;
      const order = 0.04 + t * 0.58;
      vertices.push(x, -height * 0.5, 0.006, x, height * 0.5, 0.006);
      axes.push(0, 0);
      orders.push(order, order);
    }

    for (let i = 0; i < rows; i += 1) {
      const t = i / Math.max(rows - 1, 1);
      const y = (0.5 - t) * height;
      const order = 0.18 + t * 0.8;
      vertices.push(-width * 0.5, y, 0.026, width * 0.5, y, 0.026);
      axes.push(1, 1);
      orders.push(order, order);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute("weaveAxis", new THREE.Float32BufferAttribute(axes, 1));
    geometry.setAttribute("weaveOrder", new THREE.Float32BufferAttribute(orders, 1));

    const lines = new THREE.LineSegments(geometry, createLoomMaterial());
    lines.frustumCulled = false;
    lines.visible = false;
    return lines;
  }

  supportsFloatTargets() {
    const gl = this.renderer.getContext();
    return Boolean(
      this.renderer.capabilities.isWebGL2
        ? gl.getExtension("EXT_color_buffer_float")
        : gl.getExtension("WEBGL_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"),
    );
  }

  createRenderTarget(size) {
    return new THREE.WebGLRenderTarget(size, size, {
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
  }

  makeDataTexture(data, size) {
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    return texture;
  }

  loadDesign(data) {
    this.disposeDesign();

    this.textureSize = data.textureSize;
    this.designBounds = data.bounds;
    this.targetTexture = this.makeDataTexture(data.target, data.textureSize);
    this.colorTexture = this.makeDataTexture(data.color, data.textureSize);
    this.currentPosition = this.makeDataTexture(data.position, data.textureSize);
    this.currentVelocity = this.makeDataTexture(data.velocity, data.textureSize);
    this.positionTargets = [this.createRenderTarget(data.textureSize), this.createRenderTarget(data.textureSize)];
    this.velocityTargets = [this.createRenderTarget(data.textureSize), this.createRenderTarget(data.textureSize)];
    this.writeIndex = 0;

    this.threadMaterial = createThreadMaterial();
    this.threadMaterial.uniforms.uTarget.value = this.targetTexture;
    this.threadMaterial.uniforms.uColor.value = this.colorTexture;
    this.threadMaterial.uniforms.uPosition.value = this.currentPosition;

    const total = data.textureSize * data.textureSize;
    const simUvs = new Float32Array(total * 2);
    const positions = new Float32Array(total * 3);
    let ptr = 0;
    for (let y = 0; y < data.textureSize; y += 1) {
      for (let x = 0; x < data.textureSize; x += 1) {
        simUvs[ptr * 2] = (x + 0.5) / data.textureSize;
        simUvs[ptr * 2 + 1] = (y + 0.5) / data.textureSize;
        ptr += 1;
      }
    }

    this.threadGeometry = new THREE.BufferGeometry();
    this.threadGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.threadGeometry.setAttribute("simUv", new THREE.BufferAttribute(simUvs, 2));

    this.threads = new THREE.Points(this.threadGeometry, this.threadMaterial);
    this.threads.frustumCulled = false;
    this.threads.renderOrder = 3;
    this.scene.add(this.threads);

    const weaveScaleX = data.bounds.width / 1.84 + 0.08;
    const weaveScaleY = data.bounds.height / 1.28 + 0.08;
    this.fabric.scale.set(weaveScaleX, weaveScaleY, 1);
    this.loomLines.scale.set(weaveScaleX, weaveScaleY, 1);
    this.loomLines.visible = false;
    this.fabric.visible = true;
    this.needleGroup.visible = true;
    this.hasDesign = true;
    this.progress = 0;
    this.motionEnergy = 0;
    this.shuttleMotionEnergy = 0;
  }

  disposeDesign() {
    if (this.threads) {
      this.scene.remove(this.threads);
      this.threadGeometry.dispose();
      this.threadMaterial.dispose();
      this.threads = null;
    }

    const disposable = [
      this.targetTexture,
      this.colorTexture,
      this.currentPosition,
      this.currentVelocity,
      ...(this.positionTargets || []),
      ...(this.velocityTargets || []),
    ];
    disposable.forEach((item) => item?.dispose?.());

    this.targetTexture = null;
    this.colorTexture = null;
    this.currentPosition = null;
    this.currentVelocity = null;
    this.positionTargets = null;
    this.velocityTargets = null;
    if (this.fabric) this.fabric.visible = false;
    if (this.needleGroup) this.needleGroup.visible = false;
    if (this.loomLines) this.loomLines.visible = false;
    this.hasDesign = false;
  }

  resize() {
    const width = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const height = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const aspect = width / height;
    const halfH = this.viewHeight * 0.5;
    const halfW = halfH * aspect;

    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height, false);
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.pixelRatio);

    this.sceneTarget?.dispose?.();
    this.sceneTarget = new THREE.WebGLRenderTarget(
      Math.max(1, Math.floor(width * this.pixelRatio)),
      Math.max(1, Math.floor(height * this.pixelRatio)),
      {
        format: THREE.RGBAFormat,
        type: THREE.HalfFloatType,
        depthBuffer: true,
        stencilBuffer: false,
      },
    );
    this.postMaterial.uniforms.uResolution.value.set(width * this.pixelRatio, height * this.pixelRatio);
  }

  screenToWorld(x, y) {
    return {
      x: THREE.MathUtils.lerp(this.camera.left, this.camera.right, x),
      y: THREE.MathUtils.lerp(this.camera.top, this.camera.bottom, y),
    };
  }

  setNeedle(world, pinch, weaveEnergy = 0, shuttleEnergy = 0) {
    const weaveInfluence = pinch ? THREE.MathUtils.clamp(weaveEnergy, 0, 1) : 0;
    const shuttleInfluence = pinch ? THREE.MathUtils.clamp(shuttleEnergy, 0, 1) : 0;
    this.needle.set(world.x, world.y, weaveInfluence);
    this.visualNeedle.set(world.x, world.y, shuttleInfluence);
    this.needleGroup.position.x += (world.x - this.needleGroup.position.x) * 0.36;
    this.needleGroup.position.y += (world.y - this.needleGroup.position.y) * 0.36;
    this.needleGroup.position.z = pinch ? 0.064 + (1 - shuttleInfluence) * 0.018 : 0.12;
    this.needleGroup.rotation.z = pinch
      ? 0.04 + Math.sin(this.clock.elapsedTime * 5.2) * 0.05 * shuttleInfluence
      : 0.04;
  }

  simulate(delta, elapsed) {
    if (!this.hasDesign) return;

    const target = this.writeIndex;
    this.velocityMaterial.uniforms.uPosition.value = this.currentPosition;
    this.velocityMaterial.uniforms.uVelocity.value = this.currentVelocity;
    this.velocityMaterial.uniforms.uTarget.value = this.targetTexture;
    this.velocityMaterial.uniforms.uNeedle.value.copy(this.needle);
    this.velocityMaterial.uniforms.uShuttle.value.copy(this.visualNeedle);
    this.velocityMaterial.uniforms.uProgress.value = this.progress;
    this.velocityMaterial.uniforms.uDelta.value = delta;
    this.velocityMaterial.uniforms.uTime.value = elapsed;

    this.simQuad.material = this.velocityMaterial;
    this.renderer.setRenderTarget(this.velocityTargets[target]);
    this.renderer.render(this.simScene, this.simCamera);

    this.positionMaterial.uniforms.uPosition.value = this.currentPosition;
    this.positionMaterial.uniforms.uVelocity.value = this.velocityTargets[target].texture;
    this.positionMaterial.uniforms.uTarget.value = this.targetTexture;
    this.positionMaterial.uniforms.uProgress.value = this.progress;
    this.positionMaterial.uniforms.uDelta.value = delta;

    this.simQuad.material = this.positionMaterial;
    this.renderer.setRenderTarget(this.positionTargets[target]);
    this.renderer.render(this.simScene, this.simCamera);

    this.currentVelocity = this.velocityTargets[target].texture;
    this.currentPosition = this.positionTargets[target].texture;
    this.writeIndex = 1 - this.writeIndex;
  }

  render(delta, progress, input) {
    const elapsed = this.clock.elapsedTime;
    this.progress = progress;
    const targetMotion = input.pinch ? THREE.MathUtils.clamp(input.weaveInfluence || 0, 0, 1) : 0;
    const targetShuttleMotion = input.pinch ? THREE.MathUtils.clamp(input.shuttleMotion || 0, 0, 1) : 0;
    const motionRate = targetMotion > this.motionEnergy ? 22 : 3.6;
    const shuttleMotionRate = targetShuttleMotion > this.shuttleMotionEnergy ? 24 : 6.0;
    this.motionEnergy += (targetMotion - this.motionEnergy) * (1 - Math.exp(-motionRate * Math.min(delta, 0.033)));
    this.shuttleMotionEnergy +=
      (targetShuttleMotion - this.shuttleMotionEnergy) *
      (1 - Math.exp(-shuttleMotionRate * Math.min(delta, 0.033)));
    if (this.motionEnergy < 0.001) this.motionEnergy = 0;
    if (this.shuttleMotionEnergy < 0.001) this.shuttleMotionEnergy = 0;
    this.setNeedle(input.world, input.pinch, this.motionEnergy, this.shuttleMotionEnergy);
    this.simulate(Math.min(delta, 0.033), elapsed);

    if (this.fabric?.material?.uniforms) {
      const fabricWidth = 1.84 * this.fabric.scale.x;
      const fabricHeight = 1.28 * this.fabric.scale.y;
      const u = THREE.MathUtils.clamp(input.world.x / Math.max(fabricWidth, 0.001) + 0.5, 0, 1);
      const v = THREE.MathUtils.clamp(input.world.y / Math.max(fabricHeight, 0.001) + 0.5, 0, 1);
      this.fabric.material.uniforms.uTime.value = elapsed;
      this.fabric.material.uniforms.uNeedleUv.value.set(u, v, this.shuttleMotionEnergy);
    }

    if (this.threadMaterial) {
      this.threadMaterial.uniforms.uPosition.value = this.currentPosition;
      this.threadMaterial.uniforms.uProgress.value = this.progress;
      this.threadMaterial.uniforms.uPixelRatio.value = this.pixelRatio;
      this.threadMaterial.uniforms.uPointScale.value = Math.max(0.92, Math.min(1.72, window.innerHeight / 760));
      this.threadMaterial.uniforms.uTime.value = elapsed;
      this.threadMaterial.uniforms.uShuttleMotion.value = this.shuttleMotionEnergy;
      this.threadMaterial.uniforms.uNeedle.value.copy(this.visualNeedle);
    }

    if (this.loomLines) {
      this.loomLines.material.uniforms.uProgress.value = this.progress;
      this.loomLines.material.uniforms.uTime.value = elapsed;
    }

    this.renderer.setRenderTarget(this.sceneTarget);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);

    this.postMaterial.uniforms.tDiffuse.value = this.sceneTarget.texture;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCamera);
  }
}
