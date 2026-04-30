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
const promptText = document.getElementById("promptText");

let detector = null;
let currentStream = null;
let running = false;

let currentMode = "glow";
let currentPreset = "standard";
let autoRotate = false;
let controlsHidden = false;
let soundEnabled = false;
let logoVisible = true;
let audioCtx = null;

let lastAutoRotateTime = 0;
const autoRotateInterval = 30000;

let lastPromptTime = 0;
let lastCreatureSpawnTime = 0;

let lastLeftHand = null;
let lastRightHand = null;
let smoothLeftHand = null;
let smoothRightHand = null;

let particles = [];
let ribbons = [];
let handGlows = [];
let creatures = [];
let resetWipe = null;

let previousShoulderY = null;
let jumpCooldown = 0;
let noPoseFrames = 0;

let fadeAmount = 0.05;
let dragAmount = 0.97;
let jumpSensitivity = 34;
let smoothingAmount = 0.22;

let effectScale = 1;
let creatureRate = 1;
let soundScale = 1;

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

const prompts = [
  "Can you paint with both hands?",
  "Find a floating friend!",
  "Make a giant circle!",
  "Move slowly and see what follows you.",
  "Jump to make the wall bloom!",
  "Can you make colors dance?"
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

    if (cameras.length === 0) {
      const option = document.createElement("option");
      option.textContent = "No camera found";
      cameraSelect.appendChild(option);
      return;
    }

    cameras.forEach((camera, index) => {
      const option = document.createElement("option");
      option.value = camera.deviceId;
      option.textContent = camera.label || `Camera ${index + 1}`;
      cameraSelect.appendChild(option);
    });
  } catch (err) {
    console.error("Camera list error:", err);
    cameraSelect.innerHTML = `<option>Camera permission needed</option>`;
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

  return { x: mirrorX(x), y };
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

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
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

function applyPreset(name) {
  currentPreset = name;

  if (name === "sensory") {
    effectScale = 0.55;
    creatureRate = 0.55;
    soundScale = 0.55;

    fadeAmount = 0.068;
    dragAmount = 0.955;
    jumpSensitivity = 48;
    smoothingAmount = 0.16;

    fadeSlider.value = 68;
    dragSlider.value = 955;
    jumpSlider.value = 48;
    smoothSlider.value = 16;

    showPrompt("Sensory Friendly Mode");
  }

  if (name === "standard") {
    effectScale = 1;
    creatureRate = 1;
    soundScale = 1;

    fadeAmount = 0.05;
    dragAmount = 0.97;
    jumpSensitivity = 34;
    smoothingAmount = 0.22;

    fadeSlider.value = 50;
    dragSlider.value = 970;
    jumpSlider.value = 34;
    smoothSlider.value = 22;

    showPrompt("Standard Mode");
  }

  if (name === "party") {
    effectScale = 1.55;
    creatureRate = 1.4;
    soundScale = 1.15;

    fadeAmount = 0.034;
    dragAmount = 0.982;
    jumpSensitivity = 28;
    smoothingAmount = 0.28;

    fadeSlider.value = 34;
    dragSlider.value = 982;
    jumpSlider.value = 28;
    smoothSlider.value = 28;

    showPrompt("Party Mode");
  }
}

function showPrompt(text) {
  promptText.textContent = text;
  promptText.classList.add("show");

  setTimeout(() => {
    promptText.classList.remove("show");
  }, 2600);
}

function maybeShowPrompt() {
  const now = Date.now();

  if (now - lastPromptTime < 18000) return;
  if (Math.random() > 0.008) return;

  lastPromptTime = now;
  showPrompt(prompts[Math.floor(Math.random() * prompts.length)]);
}

function drawHandEffect(current, last) {
  if (!last) return;

  if (currentMode === "glow") drawColorGlow(current, last);
  if (currentMode === "bubbles") drawBubbles(current);
  if (currentMode === "stars") drawStars(current);
  if (currentMode === "flowers") drawFlowers(current, last);
  if (currentMode === "mist") drawMist(current);
  if (currentMode === "waves") drawWaves(current, last);

  attractCreaturesToHand(current);
}

function addHandGlow(point, color) {
  handGlows.push({
    x: point.x,
    y: point.y,
    radius: 42,
    alpha: 0.32 * effectScale,
    color
  });
}

function drawColorGlow(current, last) {
  const speed = Math.hypot(current.x - last.x, current.y - last.y);
  const color = randomColor();

  addHandGlow(current, color);

  const count = Math.round(4 * effectScale);
  for (let i = 0; i < count; i++) {
    particles.push({
      type: "mist",
      x: current.x + (Math.random() - 0.5) * 54,
      y: current.y + (Math.random() - 0.5) * 54,
      vx: (Math.random() - 0.5) * 1.1,
      vy: (Math.random() - 0.5) * 1.1,
      radius: Math.random() * 36 + 22,
      alpha: 0.16,
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

function drawBubbles(current) {
  const color = randomColor();
  addHandGlow(current, color);

  const count = Math.round(2 * effectScale);
  for (let i = 0; i < count; i++) {
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

  const count = Math.round(3 * effectScale);
  for (let i = 0; i < count; i++) {
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

  const count = Math.round(4 * effectScale);
  for (let i = 0; i < count; i++) {
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
  paintCtx.lineWidth = 12 * effectScale;
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
      alpha: 0.18,
      color,
      thickness: Math.random() * 2 + 1,
      speed: 0.55
    });
  }
}

function createOrganicBloom(x, y) {
  createSupportingRipples(x, y);

  if (currentMode === "glow") createGlowExplosion(x, y);
  if (currentMode === "bubbles") createBubbleMagicMoment(x, y);
  if (currentMode === "stars") createStarMagicMoment(x, y);
  if (currentMode === "flowers") createFlowerMagicMoment(x, y);
  if (currentMode === "mist") createMistMagicMoment(x, y);
  if (currentMode === "waves") createWaveMagicMoment(x, y);

  reactCreaturesToJump(x, y);
  playJumpSound();
}

function createSupportingRipples(x, y) {
  const count = Math.round(5 * effectScale);

  for (let i = 0; i < count; i++) {
    ribbons.push({
      x: x + (Math.random() - 0.5) * 360,
      y: y + (Math.random() - 0.5) * 240,
      radius: Math.random() * 42 + 32,
      alpha: 0.18,
      color: randomColor(),
      thickness: Math.random() * 3 + 1,
      speed: 0.7
    });
  }
}

function createGlowExplosion(x, y) {
  const count = Math.round(120 * effectScale);

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 7 + 1.5;
    const color = randomColor();

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

  showPrompt("Color bloom!");
}

function createBubbleMagicMoment(x, y) {
  const count = Math.round(135 * effectScale);

  for (let i = 0; i < count; i++) {
    const spread = window.innerWidth * 0.95;
    const bx = window.innerWidth * 0.5 + (Math.random() - 0.5) * spread;
    const by = window.innerHeight + Math.random() * 120;
    const color = randomColor();

    particles.push({
      type: "bubble",
      x: bx,
      y: by,
      vx: (Math.random() - 0.5) * 1.8,
      vy: -randomBetween(2.2, 7.2),
      radius: randomBetween(18, 70),
      alpha: 0.62,
      decay: 0.0046,
      color,
      rotation: 0,
      grow: 1
    });
  }

  for (let i = 0; i < Math.round(8 * effectScale); i++) {
    ribbons.push({
      x: x + (Math.random() - 0.5) * 500,
      y: y + (Math.random() - 0.5) * 240,
      radius: randomBetween(30, 80),
      alpha: 0.16,
      color: randomColor(),
      thickness: randomBetween(1, 3),
      speed: 0.9
    });
  }

  showPrompt("Bubble wave!");
}

function createStarMagicMoment(x, y) {
  const count = Math.round(120 * effectScale);

  for (let i = 0; i < count; i++) {
    const fromLeft = Math.random() > 0.5;
    const sx = fromLeft ? -80 : window.innerWidth + 80;
    const sy = randomBetween(60, window.innerHeight * 0.68);
    const angle = fromLeft ? randomBetween(-0.35, 0.35) : Math.PI + randomBetween(-0.35, 0.35);
    const speed = randomBetween(5, 14);
    const color = randomColor();

    particles.push({
      type: "shootingStar",
      x: sx,
      y: sy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed + randomBetween(-1, 2),
      radius: randomBetween(8, 24),
      alpha: 0.82,
      decay: 0.008,
      color,
      rotation: Math.random() * Math.PI,
      grow: 1,
      tail: randomBetween(40, 110)
    });
  }

  showPrompt("Shooting stars!");
}

function createFlowerMagicMoment(x, y) {
  const count = Math.round(130 * effectScale);

  for (let i = 0; i < count; i++) {
    const fx = randomBetween(0, window.innerWidth);
    const fy = randomBetween(window.innerHeight * 0.45, window.innerHeight * 0.95);
    const color = randomColor();

    particles.push({
      type: "flower",
      x: fx,
      y: fy,
      vx: randomBetween(-0.5, 0.5),
      vy: randomBetween(-2.2, -0.4),
      radius: randomBetween(16, 42),
      alpha: 0.86,
      decay: 0.0046,
      color,
      rotation: Math.random() * Math.PI,
      grow: 1.4
    });
  }

  showPrompt("Garden bloom!");
}

function createMistMagicMoment(x, y) {
  const count = Math.round(190 * effectScale);

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = randomBetween(0.6, 5.2);
    const color = randomColor();

    particles.push({
      type: "mist",
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: randomBetween(48, 120),
      alpha: 0.18,
      decay: 0.0032,
      color,
      rotation: Math.random() * Math.PI,
      grow: 1.1
    });
  }

  showPrompt("Color cloud!");
}

function createWaveMagicMoment(x, y) {
  const count = Math.round(34 * effectScale);

  for (let i = 0; i < count; i++) {
    ribbons.push({
      x: window.innerWidth * (i / count),
      y: window.innerHeight * randomBetween(0.25, 0.8),
      radius: randomBetween(36, 90),
      alpha: 0.3,
      color: randomColor(),
      thickness: randomBetween(2, 7),
      speed: randomBetween(0.8, 1.8)
    });
  }

  for (let i = 0; i < Math.round(30 * effectScale); i++) {
    particles.push({
      type: "waveDot",
      x: randomBetween(0, window.innerWidth),
      y: y + randomBetween(-240, 240),
      vx: randomBetween(-4, 4),
      vy: randomBetween(-1, 1),
      radius: randomBetween(8, 24),
      alpha: 0.44,
      decay: 0.008,
      color: randomColor(),
      rotation: 0,
      grow: 1
    });
  }

  showPrompt("Wall ripple!");
}

function maybeSpawnCreature(force = false) {
  const now = Date.now();
  const wait = currentPreset === "party" ? 1800 : currentPreset === "sensory" ? 6000 : 3500;

  if (!force && now - lastCreatureSpawnTime < wait) return;
  if (!force && Math.random() > 0.018 * creatureRate) return;

  lastCreatureSpawnTime = now;

  const type = ["butterfly", "bubbleFriend", "starFriend", "turtle"][Math.floor(Math.random() * 4)];

  creatures.push({
    type,
    x: randomBetween(80, window.innerWidth - 80),
    y: randomBetween(120, window.innerHeight - 160),
    vx: randomBetween(-0.8, 0.8),
    vy: randomBetween(-0.5, 0.5),
    size: randomBetween(22, 46),
    color: randomColor(),
    alpha: 0,
    life: randomBetween(480, 860),
    target: null,
    wiggle: Math.random() * 100
  });
}

function attractCreaturesToHand(hand) {
  for (const c of creatures) {
    const dx = hand.x - c.x;
    const dy = hand.y - c.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 220) {
      c.target = hand;
      c.vx += dx * 0.0009;
      c.vy += dy * 0.0009;
    }
  }
}

function reactCreaturesToJump(x, y) {
  for (const c of creatures) {
    const dx = c.x - x;
    const dy = c.y - y;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const force = 12 / dist;

    c.vx += dx * force;
    c.vy += dy * force;
    c.life += 120;

    particles.push({
      type: "spark",
      x: c.x,
      y: c.y,
      vx: randomBetween(-4, 4),
      vy: randomBetween(-4, 4),
      radius: randomBetween(5, 12),
      alpha: 0.7,
      decay: 0.018,
      color: c.color,
      rotation: 0,
      grow: 1
    });
  }
}

function updateCreatures() {
  maybeSpawnCreature(false);

  for (let i = creatures.length - 1; i >= 0; i--) {
    const c = creatures[i];

    c.life--;
    c.alpha = Math.min(0.78, c.alpha + 0.015);

    c.x += c.vx + Math.sin(Date.now() * 0.002 + c.wiggle) * 0.35;
    c.y += c.vy + Math.cos(Date.now() * 0.0017 + c.wiggle) * 0.28;

    c.vx *= 0.985;
    c.vy *= 0.985;

    if (c.x < 30 || c.x > window.innerWidth - 30) c.vx *= -1;
    if (c.y < 80 || c.y > window.innerHeight - 80) c.vy *= -1;

    drawCreature(c);

    if (c.life <= 0) {
      creatures.splice(i, 1);
    }
  }
}

function drawCreature(c) {
  fxCtx.save();
  fxCtx.globalAlpha = c.alpha;
  fxCtx.translate(c.x, c.y);

  if (c.type === "butterfly") {
    fxCtx.fillStyle = c.color;

    fxCtx.beginPath();
    fxCtx.ellipse(-c.size * 0.25, 0, c.size * 0.28, c.size * 0.42, Math.sin(Date.now() * 0.008) * 0.5, 0, Math.PI * 2);
    fxCtx.fill();

    fxCtx.beginPath();
    fxCtx.ellipse(c.size * 0.25, 0, c.size * 0.28, c.size * 0.42, -Math.sin(Date.now() * 0.008) * 0.5, 0, Math.PI * 2);
    fxCtx.fill();

    fxCtx.fillStyle = BRAND.purple;
    fxCtx.globalAlpha = c.alpha * 0.45;
    fxCtx.beginPath();
    fxCtx.arc(0, 0, c.size * 0.12, 0, Math.PI * 2);
    fxCtx.fill();
  }

  if (c.type === "bubbleFriend") {
    fxCtx.strokeStyle = c.color;
    fxCtx.lineWidth = 4;
    fxCtx.beginPath();
    fxCtx.arc(0, 0, c.size * 0.45, 0, Math.PI * 2);
    fxCtx.stroke();

    fxCtx.fillStyle = c.color;
    fxCtx.globalAlpha = c.alpha * 0.12;
    fxCtx.fill();

    fxCtx.globalAlpha = c.alpha * 0.5;
    fxCtx.fillStyle = BRAND.white;
    fxCtx.beginPath();
    fxCtx.arc(-c.size * 0.14, -c.size * 0.14, c.size * 0.08, 0, Math.PI * 2);
    fxCtx.fill();
  }

  if (c.type === "starFriend") {
    drawStarShape(fxCtx, 0, 0, c.size * 0.45, c.color, c.alpha, Date.now() * 0.001 + c.wiggle);
  }

  if (c.type === "turtle") {
    fxCtx.fillStyle = c.color;
    fxCtx.beginPath();
    fxCtx.ellipse(0, 0, c.size * 0.42, c.size * 0.3, 0, 0, Math.PI * 2);
    fxCtx.fill();

    fxCtx.fillStyle = BRAND.green;
    fxCtx.globalAlpha = c.alpha * 0.55;
    fxCtx.beginPath();
    fxCtx.arc(c.size * 0.42, 0, c.size * 0.15, 0, Math.PI * 2);
    fxCtx.fill();

    fxCtx.fillStyle = BRAND.white;
    fxCtx.globalAlpha = c.alpha * 0.8;
    fxCtx.beginPath();
    fxCtx.arc(c.size * 0.47, -c.size * 0.04, c.size * 0.035, 0, Math.PI * 2);
    fxCtx.fill();
  }

  fxCtx.restore();
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
    } else if (p.type === "shootingStar") {
      fxCtx.strokeStyle = p.color;
      fxCtx.lineWidth = Math.max(2, p.radius * 0.2);
      fxCtx.beginPath();
      fxCtx.moveTo(p.x, p.y);
      fxCtx.lineTo(p.x - p.vx * p.tail * 0.05, p.y - p.vy * p.tail * 0.05);
      fxCtx.stroke();
      drawStarShape(fxCtx, p.x, p.y, p.radius, p.color, p.alpha, p.rotation);
    } else if (p.type === "flower") {
      drawFlowerShape(fxCtx, p.x, p.y, p.radius, p.color, p.alpha, p.rotation);
    } else if (p.type === "mist") {
      fxCtx.fillStyle = p.color;
      fxCtx.globalAlpha = Math.max(0, p.alpha * 0.75);
      fxCtx.beginPath();
      fxCtx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
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
  updateCreatures();
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
    jumpCooldown = currentPreset === "party" ? 62 : currentPreset === "sensory" ? 120 : 85;
  }

  previousShoulderY = shoulderY;
}

function drawAttractMode() {
  maybeSpawnCreature(false);
  maybeShowPrompt();

  if (Math.random() > 0.965) {
    const color = randomColor();

    particles.push({
      type: "bubble",
      x: Math.random() * window.innerWidth,
      y: window.innerHeight + 40,
      vx: (Math.random() - 0.5) * 0.4,
      vy: -Math.random() * 0.8 - 0.25,
      radius: Math.random() * 22 + 14,
      alpha: 0.22,
      decay: 0.003,
      color,
      rotation: 0,
      grow: 1
    });
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

  const volume = 0.035 * soundScale;

  gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(volume, audioCtx.currentTime + 0.01);
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
    maybeSpawnCreature(true);
    maybeSpawnCreature(true);
    gameLoop();
  } catch (err) {
    console.error(err);
    alert("Camera or body tracking could not start. Try Chrome, allow camera access, and close OBS/Zoom if they are using the camera.");
    splash.style.display = "flex";
    game.style.display = "none";
  }
});

modeSelect.addEventListener("change", () => setMode(modeSelect.value));

document.querySelectorAll("#staffPanel button[data-mode]").forEach(button => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});

document.querySelectorAll("#staffPanel button[data-preset]").forEach(button => {
  button.addEventListener("click", () => applyPreset(button.dataset.preset));
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
