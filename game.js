const video = document.getElementById("video");
const paintCanvas = document.getElementById("paintCanvas");
const fxCanvas = document.getElementById("fxCanvas");

const paintCtx = paintCanvas.getContext("2d");
const fxCtx = fxCanvas.getContext("2d");

const splash = document.getElementById("splash");
const game = document.getElementById("game");
const startBtn = document.getElementById("startBtn");
const cameraSelect = document.getElementById("cameraSelect");
const modeSelect = document.getElementById("modeSelect");
const instruction = document.getElementById("instruction");
const topTitle = document.getElementById("topTitle");

const clearBtn = document.getElementById("clearBtn");
const autoBtn = document.getElementById("autoBtn");
const soundBtn = document.getElementById("soundBtn");
const hideBtn = document.getElementById("hideBtn");
const logoBtn = document.getElementById("logoBtn");

const fadeSlider = document.getElementById("fadeSlider");
const dragSlider = document.getElementById("dragSlider");
const jumpSlider = document.getElementById("jumpSlider");
const smoothSlider = document.getElementById("smoothSlider");

const staffPanel = document.getElementById("staffPanel");
const modeBadge = document.getElementById("modeBadge");
const watermarkLogo = document.getElementById("watermarkLogo");

let detector = null;
let currentStream = null;
let running = false;

let currentMode = "paint";
let autoRotate = false;
let controlsHidden = false;
let soundEnabled = false;
let logoVisible = true;
let audioCtx = null;

let lastAutoRotateTime = 0;
const autoRotateInterval = 30000;

let lastLeftHand = null;
let lastRightHand = null;
let smoothLeftHand = null;
let smoothRightHand = null;

let particles = [];
let ribbons = [];
let handGlows = [];
let resetWipe = null;

let previousShoulderY = null;
let jumpCooldown = 0;
let noPoseFrames = 0;

let fadeAmount = 0.042;
let dragAmount = 0.97;
let jumpSensitivity = 34;
let smoothingAmount = 0.22;

const BRAND = {
  yellow: "#ffd100",
  orange: "#f26522",
  blue: "#00aeef",
  purple: "#3b2483",
  magenta: "#a6208f",
  green: "#39b54a",
  white: "#ffffff"
};

const colors = [
  BRAND.yellow,
  BRAND.orange,
  BRAND.blue,
  BRAND.purple,
  BRAND.magenta,
  BRAND.green
];

const modes = [
  { id: "glow", label: "Color Glow" },
  { id: "bubbles", label: "Bubbles" },
  { id: "stars", label: "Stars" },
  { id: "flowers", label: "Flowers" },
  { id: "mist", label: "Graffiti Mist" },
  { id: "waves", label: "Color Waves" }
];

function resizeCanvases() {
  const dpr = window.devicePixelRatio || 1;

  [paintCanvas, fxCanvas].forEach(canvas => {
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
  });

  [paintCtx, fxCtx].forEach(ctx => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  });
}

window.addEventListener("resize", resizeCanvases);
resizeCanvases();

fadeSlider.addEventListener("input", () => {
  fadeAmount = Number(fadeSlider.value) / 1000;
});

dragSlider.addEventListener("input", () => {
  dragAmount = Number(dragSlider.value) / 1000;
});

jumpSlider.addEventListener("input", () => {
  jumpSensitivity = Number(jumpSlider.value);
});

smoothSlider.addEventListener("input", () => {
  smoothingAmount = Number(smoothSlider.value) / 100;
});

async function loadCameras() {
  try {
    const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
    tempStream.getTracks().forEach(track => track.stop());

    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter(device => device.kind === "videoinput");

    cameraSelect.innerHTML = "";

    cameras.forEach((camera, index) => {
      const option = document.createElement("option");
      option.value = camera.deviceId;
      option.textContent = camera.label || `Camera ${index + 1}`;
      cameraSelect.appendChild(option);
    });
  } catch (err) {
    console.error("Camera list error:", err);
    cameraSelect.innerHTML = `<option>No camera found</option>`;
  }
}

async function startCamera() {
  if (currentStream) {
    currentStream.getTracks().forEach(track => track.stop());
  }

  const selectedCameraId = cameraSelect.value;

  const constraints = {
    video: {
      deviceId: selectedCameraId ? { exact: selectedCameraId } : undefined,
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 }
    },
    audio: false
  };

  currentStream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = currentStream;

  return new Promise(resolve => {
    video.onloadedmetadata = () => {
      video.play();
      resolve();
    };
  });
}

async function setupPoseDetector() {
  await tf.setBackend("webgl");
  await tf.ready();

  detector = await poseDetection.createDetector(
    poseDetection.SupportedModels.MoveNet,
    {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
      enableSmoothing: true
    }
  );
}

function getKeypoint(pose, name) {
  return pose.keypoints.find(k => k.name === name);
}

function mirrorX(x) {
  return window.innerWidth - x;
}

function videoToCanvasPoint(point) {
  const videoRatio = video.videoWidth / video.videoHeight;
  const canvasRatio = window.innerWidth / window.innerHeight;

  let drawWidth;
  let drawHeight;
  let offsetX;
  let offsetY;

  if (canvasRatio > videoRatio) {
    drawWidth = window.innerWidth;
    drawHeight = window.innerWidth / videoRatio;
    offsetX = 0;
    offsetY = (window.innerHeight - drawHeight) / 2;
  } else {
    drawHeight = window.innerHeight;
    drawWidth = window.innerHeight * videoRatio;
    offsetX = (window.innerWidth - drawWidth) / 2;
    offsetY = 0;
  }

  const x = offsetX + (point.x / video.videoWidth) * drawWidth;
  const y = offsetY + (point.y / video.videoHeight) * drawHeight;

  return {
    x: mirrorX(x),
    y
  };
}

function smoothPoint(previous, current) {
  if (!previous) return current;

  return {
    x: previous.x + (current.x - previous.x) * smoothingAmount,
    y: previous.y + (current.y - previous.y) * smoothingAmount
  };
}

function randomColor() {
  return colors[Math.floor(Math.random() * colors.length)];
}

function finishClearScreen() {
  paintCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  fxCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  particles = [];
  ribbons = [];
  handGlows = [];
}

function clearScreenAnimated() {
  resetWipe = {
    radius: 0,
    alpha: 1,
    maxRadius: Math.hypot(window.innerWidth, window.innerHeight)
  };

  particles = [];
  ribbons = [];
  playChime(520, 0.08, "sine");
}

function fadePaintCanvas() {
  paintCtx.save();
  paintCtx.globalCompositeOperation = "source-over";
  paintCtx.fillStyle = `rgba(255, 255, 255, ${fadeAmount})`;
  paintCtx.fillRect(0, 0, window.innerWidth, window.innerHeight);
  paintCtx.restore();
}

function setMode(modeId) {
  currentMode = modeId;
  modeSelect.value = modeId;

  const mode = modes.find(m => m.id === modeId);
  modeBadge.textContent = mode ? mode.label : modeId;

  modeBadge.classList.remove("show");
  void modeBadge.offsetWidth;
  modeBadge.classList.add("show");

  setTimeout(() => {
    modeBadge.classList.remove("show");
  }, 1600);

  playChime(360 + modes.findIndex(m => m.id === modeId) * 45, 0.06, "triangle");
}

function nextMode() {
  const index = modes.findIndex(m => m.id === currentMode);
  const next = modes[(index + 1) % modes.length];
  setMode(next.id);
}

function drawHandEffect(current, last) {
  if (!last) return;

  if (currentMode === "glow") drawColorGlow(current, last);
  if (currentMode === "bubbles") drawBubbles(current);
  if (currentMode === "stars") drawStars(current);
  if (currentMode === "flowers") drawFlowers(current, last);
  if (currentMode === "mist") drawMist(current);
  if (currentMode === "waves") drawWaves(current, last);
}

function addHandGlow(point, color) {
  handGlows.push({
    x: point.x,
    y: point.y,
    radius: 42,
    alpha: 0.32,
    color
  });
}

function drawPaintTrail(current, last) {
  const speed = Math.hypot(current.x - last.x, current.y - last.y);
  const width = Math.min(66, Math.max(14, speed * 0.38));
  const color = randomColor();

  paintCtx.save();
  paintCtx.globalCompositeOperation = "source-over";
  paintCtx.lineCap = "round";
  paintCtx.lineJoin = "round";
  paintCtx.strokeStyle = color;
  paintCtx.globalAlpha = 0.48;
  paintCtx.lineWidth = width;

  paintCtx.beginPath();
  paintCtx.moveTo(last.x, last.y);
  paintCtx.quadraticCurveTo(
    last.x * 0.5 + current.x * 0.5,
    last.y * 0.5 + current.y * 0.5,
    current.x,
    current.y
  );
  paintCtx.stroke();
  paintCtx.restore();

  addHandGlow(current, color);

  if (speed > 22) {
    createSoftDots(current.x, current.y, color, 3);
    playMovementSound(speed);
  }
}

function drawColorGlow(current, last) {
  const speed = Math.hypot(current.x - last.x, current.y - last.y);
  const color = randomColor();

  addHandGlow(current, color);

  for (let i = 0; i < 4; i++) {
    particles.push({
      type: "mist",
      x: current.x + (Math.random() - 0.5) * 54,
      y: current.y + (Math.random() - 0.5) * 54,
      vx: (Math.random() - 0.5) * 1.1,
      vy: (Math.random() - 0.5) * 1.1,
      radius: Math.random() * 36 + 22,
      alpha: 0.18,
      decay: 0.008,
      color,
      rotation: Math.random() * Math.PI,
      grow: 1
    });
  }

  if (speed > 24) {
    maybeSmallRing(current.x, current.y, color);
    playMovementSound(speed);
  }
}

function createGlowExplosion(x, y, bloomColors) {
  for (let i = 0; i < 120; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 7 + 1.5;
    const color = bloomColors[Math.floor(Math.random() * bloomColors.length)];

    particles.push({
      type: "mist",
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: Math.random() * 70 + 30,
      alpha: 0.22,
      decay: 0.0045,
      color,
      rotation: Math.random() * Math.PI,
      grow: 1
    });
  }

  for (let i = 0; i < 5; i++) {
    ribbons.push({
      x: x + (Math.random() - 0.5) * 360,
      y: y + (Math.random() - 0.5) * 240,
      radius: Math.random() * 42 + 32,
      alpha: 0.24,
      color: bloomColors[Math.floor(Math.random() * bloomColors.length)],
      thickness: Math.random() * 4 + 1.5,
      speed: 0.75
    });
  }
}

function drawBubbles(current) {
  const color = randomColor();
  addHandGlow(current, color);

  for (let i = 0; i < 2; i++) {
    particles.push({
      type: "bubble",
      x: current.x + (Math.random() - 0.5) * 34,
      y: current.y + (Math.random() - 0.5) * 34,
      vx: (Math.random() - 0.5) * 0.8,
      vy: -Math.random() * 1.2 - 0.3,
      radius: Math.random() * 22 + 14,
      alpha: 0.62,
      decay: 0.0048,
      color,
      rotation: Math.random() * Math.PI,
      grow: 1
    });
  }

  maybeSmallRing(current.x, current.y, color);
}

function drawStars(current) {
  const color = randomColor();
  addHandGlow(current, color);

  for (let i = 0; i < 3; i++) {
    particles.push({
      type: "star",
      x: current.x + (Math.random() - 0.5) * 44,
      y: current.y + (Math.random() - 0.5) * 44,
      vx: (Math.random() - 0.5) * 2,
      vy: (Math.random() - 0.5) * 2,
      radius: Math.random() * 9 + 7,
      alpha: 0.8,
      decay: 0.01,
      color,
      rotation: Math.random() * Math.PI,
      grow: 1
    });
  }

  maybeSmallRing(current.x, current.y, color);
}

function drawFlowers(current, last) {
  const speed = Math.hypot(current.x - last.x, current.y - last.y);
  if (speed < 8 && Math.random() > 0.3) return;

  const color = randomColor();
  addHandGlow(current, color);

  particles.push({
    type: "flower",
    x: current.x + (Math.random() - 0.5) * 20,
    y: current.y + (Math.random() - 0.5) * 20,
    vx: (Math.random() - 0.5) * 0.35,
    vy: (Math.random() - 0.5) * 0.35,
    radius: Math.random() * 16 + 17,
    alpha: 0.78,
    decay: 0.0038,
    color,
    rotation: Math.random() * Math.PI,
    grow: 1
  });

  maybeSmallRing(current.x, current.y, color);
}

function drawMist(current) {
  const color = randomColor();
  addHandGlow(current, color);

  for (let i = 0; i < 4; i++) {
    particles.push({
      type: "mist",
      x: current.x + (Math.random() - 0.5) * 80,
      y: current.y + (Math.random() - 0.5) * 80,
      vx: (Math.random() - 0.5) * 1.25,
      vy: (Math.random() - 0.5) * 1.25,
      radius: Math.random() * 42 + 30,
      alpha: 0.12,
      decay: 0.0035,
      color,
      rotation: Math.random() * Math.PI,
      grow: 1
    });
  }

  maybeSmallRing(current.x, current.y, color);
}

function drawWaves(current, last) {
  const color = randomColor();
  addHandGlow(current, color);

  ribbons.push({
    x: current.x,
    y: current.y,
    radius: 18,
    alpha: 0.28,
    color,
    thickness: Math.random() * 3 + 1.5,
    speed: 1
  });

  paintCtx.save();
  paintCtx.globalCompositeOperation = "source-over";
  paintCtx.strokeStyle = color;
  paintCtx.lineWidth = 12;
  paintCtx.globalAlpha = 0.22;
  paintCtx.lineCap = "round";

  paintCtx.beginPath();
  paintCtx.moveTo(last.x, last.y);
  paintCtx.bezierCurveTo(
    last.x + 90,
    last.y - 80,
    current.x - 90,
    current.y + 80,
    current.x,
    current.y
  );
  paintCtx.stroke();
  paintCtx.restore();
}

function maybeSmallRing(x, y, color) {
  if (Math.random() > 0.94) {
    ribbons.push({
      x,
      y,
      radius: Math.random() * 12 + 8,
      alpha: 0.22,
      color,
      thickness: Math.random() * 2 + 1,
      speed: 0.55
    });
  }
}

function createSoftDots(x, y, color, count = 4) {
  for (let i = 0; i < count; i++) {
    particles.push({
      type: "dot",
      x: x + (Math.random() - 0.5) * 42,
      y: y + (Math.random() - 0.5) * 42,
      vx: (Math.random() - 0.5) * 2.1,
      vy: (Math.random() - 0.5) * 2.1,
      radius: Math.random() * 7 + 4,
      alpha: 0.44,
      decay: 0.0125,
      color,
      rotation: Math.random() * Math.PI,
      grow: 1
    });
  }
}

function createOrganicBloom(x, y) {
  const bloomColors = colors;

  for (let i = 0; i < 5; i++) {
    ribbons.push({
      x: x + (Math.random() - 0.5) * 360,
      y: y + (Math.random() - 0.5) * 240,
      radius: Math.random() * 42 + 32,
      alpha: 0.28,
      color: bloomColors[Math.floor(Math.random() * bloomColors.length)],
      thickness: Math.random() * 4 + 1.5,
      speed: 0.75
    });
  }

  if (currentMode === "glow") createGlowExplosion(x, y, bloomColors);
  if (currentMode === "bubbles") createBubbleExplosion(x, y, bloomColors);
  if (currentMode === "stars") createStarExplosion(x, y, bloomColors);
  if (currentMode === "flowers") createFlowerExplosion(x, y, bloomColors);
  if (currentMode === "mist") createMistExplosion(x, y, bloomColors);
  if (currentMode === "waves") createWaveExplosion(x, y, bloomColors);

  playJumpSound();
}

function createPaintExplosion(x, y, bloomColors) {
  for (let i = 0; i < 30; i++) {
    const color = bloomColors[Math.floor(Math.random() * bloomColors.length)];

    particles.push({
      type: "splat",
      x: x + (Math.random() - 0.5) * 720,
      y: y + (Math.random() - 0.5) * 460,
      vx: (Math.random() - 0.5) * 2.5,
      vy: (Math.random() - 0.5) * 2.5,
      radius: Math.random() * 70 + 28,
      rx: Math.random() * 120 + 50,
      ry: Math.random() * 70 + 28,
      alpha: 0.28,
      decay: 0.01,
      color,
      rotation: Math.random() * Math.PI,
      grow: 0.3
    });
  }
}

function createBubbleExplosion(x, y, bloomColors) {
  for (let i = 0; i < 105; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 9 + 2;
    const color = bloomColors[Math.floor(Math.random() * bloomColors.length)];

    particles.push({
      type: "bubble",
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.5,
      radius: Math.random() * 42 + 16,
      alpha: 0.72,
      decay: 0.006,
      color,
      rotation: Math.random() * Math.PI,
      grow: 1
    });
  }
}

function createStarExplosion(x, y, bloomColors) {
  for (let i = 0; i < 115; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 11 + 3;
    const color = bloomColors[Math.floor(Math.random() * bloomColors.length)];

    particles.push({
      type: "star",
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: Math.random() * 17 + 8,
      alpha: 0.82,
      decay: 0.009,
      color,
      rotation: Math.random() * Math.PI,
      grow: 1
    });
  }
}

function createFlowerExplosion(x, y, bloomColors) {
  for (let i = 0; i < 95; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 7 + 2;
    const color = bloomColors[Math.floor(Math.random() * bloomColors.length)];

    particles.push({
      type: "flower",
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: Math.random() * 28 + 18,
      alpha: 0.82,
      decay: 0.006,
      color,
      rotation: Math.random() * Math.PI,
      grow: 1
    });
  }
}

function createMistExplosion(x, y, bloomColors) {
  for (let i = 0; i < 150; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 5.5 + 1.2;
    const color = bloomColors[Math.floor(Math.random() * bloomColors.length)];

    particles.push({
      type: "mist",
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: Math.random() * 78 + 34,
      alpha: 0.16,
      decay: 0.004,
      color,
      rotation: Math.random() * Math.PI,
      grow: 1
    });
  }
}

function createWaveExplosion(x, y, bloomColors) {
  for (let i = 0; i < 28; i++) {
    ribbons.push({
      x: x + (Math.random() - 0.5) * 760,
      y: y + (Math.random() - 0.5) * 520,
      radius: Math.random() * 58 + 34,
      alpha: 0.34,
      color: bloomColors[Math.floor(Math.random() * bloomColors.length)],
      thickness: Math.random() * 5 + 2,
      speed: 1
    });
  }
}

function drawStarShape(ctx, x, y, radius, color, alpha, rotation) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();

  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? radius : radius * 0.45;
    const angle = (Math.PI * 2 * i) / 10;
    ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
  }

  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawFlowerShape(ctx, x, y, radius, color, alpha, rotation) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;

  for (let i = 0; i < 7; i++) {
    const angle = (Math.PI * 2 * i) / 7;
    const px = Math.cos(angle) * radius * 0.45;
    const py = Math.sin(angle) * radius * 0.45;

    ctx.beginPath();
    ctx.ellipse(px, py, radius * 0.34, radius * 0.19, angle, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = BRAND.white;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function updateParticles() {
  fxCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];

    p.x += p.vx;
    p.y += p.vy;
    p.vx *= dragAmount;
    p.vy *= dragAmount;

    if (p.grow) p.radius += p.grow * 0.07;
    if (p.type === "bubble") p.y -= 0.18;

    p.alpha -= p.decay;

    fxCtx.save();
    fxCtx.globalCompositeOperation = "source-over";
    fxCtx.globalAlpha = Math.max(0, p.alpha);

    if (p.type === "bubble") {
      fxCtx.strokeStyle = p.color;
      fxCtx.lineWidth = 3;
      fxCtx.beginPath();
      fxCtx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      fxCtx.stroke();

      fxCtx.globalAlpha = Math.max(0, p.alpha * 0.08);
      fxCtx.fillStyle = p.color;
      fxCtx.fill();
    } else if (p.type === "star") {
      drawStarShape(fxCtx, p.x, p.y, p.radius, p.color, p.alpha, p.rotation);
    } else if (p.type === "flower") {
      drawFlowerShape(fxCtx, p.x, p.y, p.radius, p.color, p.alpha, p.rotation);
    } else if (p.type === "mist") {
      fxCtx.fillStyle = p.color;
      fxCtx.globalAlpha = Math.max(0, p.alpha * 0.75);
      fxCtx.beginPath();
      fxCtx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      fxCtx.fill();
    } else if (p.type === "splat") {
      fxCtx.fillStyle = p.color;
      fxCtx.beginPath();
      fxCtx.ellipse(p.x, p.y, p.rx, p.ry, p.rotation, 0, Math.PI * 2);
      fxCtx.fill();
    } else {
      fxCtx.fillStyle = p.color;
      fxCtx.beginPath();
      fxCtx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      fxCtx.fill();
    }

    fxCtx.restore();

    if (p.alpha <= 0) particles.splice(i, 1);
  }

  updateRibbons();
  updateHandGlows();
  updateResetWipe();
}

function updateRibbons() {
  for (let i = ribbons.length - 1; i >= 0; i--) {
    const r = ribbons[i];

    r.alpha -= 0.005;
    r.radius += r.speed || 1;

    fxCtx.save();
    fxCtx.globalCompositeOperation = "source-over";
    fxCtx.globalAlpha = Math.max(0, r.alpha);
    fxCtx.strokeStyle = r.color;
    fxCtx.lineWidth = r.thickness || 2;

    fxCtx.beginPath();
    fxCtx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
    fxCtx.stroke();
    fxCtx.restore();

    if (r.alpha <= 0) ribbons.splice(i, 1);
  }
}

function updateHandGlows() {
  for (let i = handGlows.length - 1; i >= 0; i--) {
    const g = handGlows[i];

    g.radius += 1.8;
    g.alpha -= 0.03;

    fxCtx.save();
    fxCtx.globalCompositeOperation = "source-over";

    const gradient = fxCtx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.radius);
    gradient.addColorStop(0, hexToRgba(g.color, g.alpha));
    gradient.addColorStop(1, hexToRgba(g.color, 0));

    fxCtx.fillStyle = gradient;
    fxCtx.beginPath();
    fxCtx.arc(g.x, g.y, g.radius, 0, Math.PI * 2);
    fxCtx.fill();
    fxCtx.restore();

    if (g.alpha <= 0) handGlows.splice(i, 1);
  }
}

function updateResetWipe() {
  if (!resetWipe) return;

  resetWipe.radius += 70;
  resetWipe.alpha -= 0.04;

  fxCtx.save();
  fxCtx.globalCompositeOperation = "source-over";
  fxCtx.globalAlpha = Math.max(0, resetWipe.alpha);
  fxCtx.fillStyle = BRAND.white;

  fxCtx.beginPath();
  fxCtx.arc(
    window.innerWidth / 2,
    window.innerHeight / 2,
    resetWipe.radius,
    0,
    Math.PI * 2
  );
  fxCtx.fill();
  fxCtx.restore();

  if (resetWipe.radius > resetWipe.maxRadius || resetWipe.alpha <= 0) {
    finishClearScreen();
    resetWipe = null;
  }
}

function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function detectJump(leftShoulder, rightShoulder) {
  const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;

  if (previousShoulderY === null) {
    previousShoulderY = shoulderY;
    return;
  }

  const movement = previousShoulderY - shoulderY;

  if (jumpCooldown > 0) jumpCooldown--;

  if (movement > jumpSensitivity && jumpCooldown <= 0) {
    createOrganicBloom(window.innerWidth / 2, window.innerHeight * 0.55);
    jumpCooldown = 85;
  }

  previousShoulderY = shoulderY;
}

function drawAttractMode() {
  if (Math.random() > 0.96) {
    const typeRoll = Math.random();
    const color = randomColor();

    if (typeRoll < 0.5) {
      particles.push({
        type: "bubble",
        x: Math.random() * window.innerWidth,
        y: window.innerHeight + 40,
        vx: (Math.random() - 0.5) * 0.4,
        vy: -Math.random() * 0.8 - 0.25,
        radius: Math.random() * 22 + 14,
        alpha: 0.24,
        decay: 0.003,
        color,
        rotation: 0,
        grow: 1
      });
    } else {
      ribbons.push({
        x: Math.random() * window.innerWidth,
        y: window.innerHeight * (0.35 + Math.random() * 0.4),
        radius: Math.random() * 32 + 20,
        alpha: 0.12,
        color,
        thickness: Math.random() * 2 + 1,
        speed: 0.35
      });
    }
  }
}

function handleAutoRotate() {
  if (!autoRotate) return;

  const now = Date.now();

  if (now - lastAutoRotateTime > autoRotateInterval) {
    nextMode();
    lastAutoRotateTime = now;
  }
}

async function gameLoop() {
  if (!running) return;

  fadePaintCanvas();
  handleAutoRotate();

  const poses = await detector.estimatePoses(video, {
    maxPoses: 1,
    flipHorizontal: false
  });

  if (poses.length > 0) {
    const pose = poses[0];

    const leftWrist = getKeypoint(pose, "left_wrist");
    const rightWrist = getKeypoint(pose, "right_wrist");
    const leftShoulder = getKeypoint(pose, "left_shoulder");
    const rightShoulder = getKeypoint(pose, "right_shoulder");

    let detected = false;

    if (leftWrist && leftWrist.score > 0.25) {
      const rawLeft = videoToCanvasPoint(leftWrist);
      smoothLeftHand = smoothPoint(smoothLeftHand, rawLeft);
      drawHandEffect(smoothLeftHand, lastLeftHand);
      lastLeftHand = smoothLeftHand;
      detected = true;
    } else {
      lastLeftHand = null;
      smoothLeftHand = null;
    }

    if (rightWrist && rightWrist.score > 0.25) {
      const rawRight = videoToCanvasPoint(rightWrist);
      smoothRightHand = smoothPoint(smoothRightHand, rawRight);
      drawHandEffect(smoothRightHand, lastRightHand);
      lastRightHand = smoothRightHand;
      detected = true;
    } else {
      lastRightHand = null;
      smoothRightHand = null;
    }

    if (
      leftShoulder &&
      rightShoulder &&
      leftShoulder.score > 0.25 &&
      rightShoulder.score > 0.25
    ) {
      const ls = videoToCanvasPoint(leftShoulder);
      const rs = videoToCanvasPoint(rightShoulder);
      detectJump(ls, rs);
      detected = true;
    }

    noPoseFrames = detected ? 0 : noPoseFrames + 1;
  } else {
    lastLeftHand = null;
    lastRightHand = null;
    smoothLeftHand = null;
    smoothRightHand = null;
    noPoseFrames++;
  }

  updateParticles();

  if (noPoseFrames > 45) drawAttractMode();

  requestAnimationFrame(gameLoop);
}

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function playChime(freq = 440, duration = 0.08, type = "sine") {
  if (!soundEnabled) return;
  initAudio();

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = type;
  osc.frequency.value = freq;

  gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.035, audioCtx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

let lastMoveSound = 0;

function playMovementSound(speed) {
  if (!soundEnabled) return;

  const now = Date.now();
  if (now - lastMoveSound < 180) return;

  const freq = Math.min(640, 260 + speed * 7);
  playChime(freq, 0.04, "sine");

  lastMoveSound = now;
}

function playJumpSound() {
  if (!soundEnabled) return;

  playChime(420, 0.1, "triangle");
  setTimeout(() => playChime(580, 0.12, "sine"), 90);
  setTimeout(() => playChime(720, 0.1, "sine"), 170);
}

startBtn.addEventListener("click", async () => {
  try {
    setMode(modeSelect.value);

    splash.style.display = "none";
    game.style.display = "block";

    await startCamera();
    await setupPoseDetector();

    running = true;
    lastAutoRotateTime = Date.now();

    setTimeout(() => {
      topTitle.classList.add("fadeOut");
      instruction.classList.add("fadeOut");
    }, 3500);

    finishClearScreen();
    gameLoop();
  } catch (err) {
    console.error(err);
    alert("Camera or body tracking could not start. Try Chrome and allow camera access.");
    splash.style.display = "flex";
    game.style.display = "none";
  }
});

modeSelect.addEventListener("change", () => setMode(modeSelect.value));

document.querySelectorAll("#staffPanel button[data-mode]").forEach(button => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});

clearBtn.addEventListener("click", clearScreenAnimated);

autoBtn.addEventListener("click", () => {
  autoRotate = !autoRotate;
  autoBtn.textContent = autoRotate ? "Auto: On" : "Auto: Off";
  lastAutoRotateTime = Date.now();
});

soundBtn.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  soundBtn.textContent = soundEnabled ? "Sound: On" : "Sound: Off";

  if (soundEnabled) {
    initAudio();
    playChime(520, 0.08, "sine");
  }
});

hideBtn.addEventListener("click", () => {
  controlsHidden = !controlsHidden;
  staffPanel.classList.toggle("hidden", controlsHidden);
});

logoBtn.addEventListener("click", () => {
  logoVisible = !logoVisible;
  watermarkLogo.classList.toggle("off", !logoVisible);
  logoBtn.textContent = logoVisible ? "Logo: On" : "Logo: Off";
});

document.addEventListener("keydown", event => {
  const key = event.key.toLowerCase();

  if (key === "1") setMode("glow");
  if (key === "2") setMode("bubbles");
  if (key === "3") setMode("stars");
  if (key === "4") setMode("flowers");
  if (key === "5") setMode("mist");
  if (key === "6") setMode("waves");

  if (key === "c") clearScreenAnimated();

  if (key === "a") {
    autoRotate = !autoRotate;
    autoBtn.textContent = autoRotate ? "Auto: On" : "Auto: Off";
    lastAutoRotateTime = Date.now();
  }

  if (key === "s") {
    soundEnabled = !soundEnabled;
    soundBtn.textContent = soundEnabled ? "Sound: On" : "Sound: Off";
    if (soundEnabled) {
      initAudio();
      playChime(520, 0.08, "sine");
    }
  }

  if (key === "h") {
    controlsHidden = !controlsHidden;
    staffPanel.classList.toggle("hidden", controlsHidden);
  }

  if (key === "l") {
    logoVisible = !logoVisible;
    watermarkLogo.classList.toggle("off", !logoVisible);
    logoBtn.textContent = logoVisible ? "Logo: On" : "Logo: Off";
  }

  if (key === "f") {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }
});

loadCameras();
