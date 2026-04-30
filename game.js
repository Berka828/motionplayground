const video = document.getElementById("video");

const paintCanvas = document.getElementById("paintCanvas");
const fxCanvas = document.getElementById("fxCanvas");
const uiCanvas = document.getElementById("uiCanvas");

const paintCtx = paintCanvas.getContext("2d");
const fxCtx = fxCanvas.getContext("2d");
const uiCtx = uiCanvas.getContext("2d");

const splash = document.getElementById("splash");
const game = document.getElementById("game");
const startBtn = document.getElementById("startBtn");
const cameraSelect = document.getElementById("cameraSelect");
const modeSelect = document.getElementById("modeSelect");
const instruction = document.getElementById("instruction");
const topTitle = document.getElementById("topTitle");
const clearBtn = document.getElementById("clearBtn");
const autoBtn = document.getElementById("autoBtn");
const modeBadge = document.getElementById("modeBadge");
const fadeSlider = document.getElementById("fadeSlider");
const dragSlider = document.getElementById("dragSlider");

let detector = null;
let currentStream = null;
let running = false;

let currentMode = "paint";
let autoRotate = false;
let lastAutoRotateTime = 0;
const autoRotateInterval = 30000;

let lastLeftHand = null;
let lastRightHand = null;
let smoothLeftHand = null;
let smoothRightHand = null;

let particles = [];
let ribbons = [];
let floatingLetters = [];

let previousShoulderY = null;
let jumpCooldown = 0;
let noPoseFrames = 0;

let fadeAmount = 0.012;
let dragAmount = 0.972;

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
  { id: "paint", label: "Paint Trails" },
  { id: "bubbles", label: "Bubbles" },
  { id: "stars", label: "Stars" },
  { id: "flowers", label: "Flowers" },
  { id: "mist", label: "Graffiti Mist" },
  { id: "waves", label: "Bronx Color Waves" }
];

function resizeCanvases() {
  const dpr = window.devicePixelRatio || 1;

  [paintCanvas, fxCanvas, uiCanvas].forEach(canvas => {
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
  });

  [paintCtx, fxCtx, uiCtx].forEach(ctx => {
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

function smoothPoint(previous, current, amount = 0.22) {
  if (!previous) return current;

  return {
    x: previous.x + (current.x - previous.x) * amount,
    y: previous.y + (current.y - previous.y) * amount
  };
}

function randomColor() {
  return colors[Math.floor(Math.random() * colors.length)];
}

function clearScreen() {
  paintCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  fxCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  uiCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  particles = [];
  ribbons = [];
  floatingLetters = [];
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
  modeBadge.classList.add("show");

  setTimeout(() => {
    modeBadge.classList.remove("show");
  }, 1400);
}

function nextMode() {
  const index = modes.findIndex(m => m.id === currentMode);
  const next = modes[(index + 1) % modes.length];
  setMode(next.id);
}

function drawHandEffect(current, last) {
  if (!last) return;

  if (currentMode === "paint") drawPaintTrail(current, last);
  if (currentMode === "bubbles") drawBubbles(current, last);
  if (currentMode === "stars") drawStars(current, last);
  if (currentMode === "flowers") drawFlowers(current, last);
  if (currentMode === "mist") drawMist(current, last);
  if (currentMode === "waves") drawWaves(current, last);
}

function drawPaintTrail(current, last) {
  const speed = Math.hypot(current.x - last.x, current.y - last.y);
  const width = Math.min(72, Math.max(18, speed * 0.45));
  const color = randomColor();

  paintCtx.save();
  paintCtx.globalCompositeOperation = "source-over";
  paintCtx.lineCap = "round";
  paintCtx.lineJoin = "round";
  paintCtx.shadowBlur = 0;
  paintCtx.strokeStyle = color;
  paintCtx.globalAlpha = 0.62;
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

  if (speed > 22) {
    createSoftDots(current.x, current.y, color, 4);
  }
}

function drawBubbles(current, last) {
  const color = randomColor();

  for (let i = 0; i < 2; i++) {
    particles.push({
      type: "bubble",
      x: current.x + (Math.random() - 0.5) * 34,
      y: current.y + (Math.random() - 0.5) * 34,
      vx: (Math.random() - 0.5) * 0.9,
      vy: -Math.random() * 1.3 - 0.3,
      radius: Math.random() * 22 + 14,
      alpha: 0.7,
      decay: 0.0048,
      color,
      rotation: Math.random() * Math.PI,
      grow: 1
    });
  }

  maybeSmallRing(current.x, current.y, color);
}

function drawStars(current, last) {
  const color = randomColor();

  for (let i = 0; i < 3; i++) {
    particles.push({
      type: "star",
      x: current.x + (Math.random() - 0.5) * 44,
      y: current.y + (Math.random() - 0.5) * 44,
      vx: (Math.random() - 0.5) * 2.2,
      vy: (Math.random() - 0.5) * 2.2,
      radius: Math.random() * 10 + 8,
      alpha: 0.9,
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

  particles.push({
    type: "flower",
    x: current.x + (Math.random() - 0.5) * 20,
    y: current.y + (Math.random() - 0.5) * 20,
    vx: (Math.random() - 0.5) * 0.4,
    vy: (Math.random() - 0.5) * 0.4,
    radius: Math.random() * 18 + 18,
    alpha: 0.86,
    decay: 0.0035,
    color,
    rotation: Math.random() * Math.PI,
    grow: 1
  });

  maybeSmallRing(current.x, current.y, color);
}

function drawMist(current, last) {
  const color = randomColor();

  for (let i = 0; i < 4; i++) {
    particles.push({
      type: "mist",
      x: current.x + (Math.random() - 0.5) * 80,
      y: current.y + (Math.random() - 0.5) * 80,
      vx: (Math.random() - 0.5) * 1.4,
      vy: (Math.random() - 0.5) * 1.4,
      radius: Math.random() * 42 + 30,
      alpha: 0.18,
      decay: 0.0032,
      color,
      rotation: Math.random() * Math.PI,
      grow: 1
    });
  }

  maybeSmallRing(current.x, current.y, color);
}

function drawWaves(current, last) {
  const color = randomColor();

  ribbons.push({
    x: current.x,
    y: current.y,
    radius: 18,
    alpha: 0.68,
    color,
    thickness: Math.random() * 5 + 3,
    speed: 1.25
  });

  paintCtx.save();
  paintCtx.globalCompositeOperation = "source-over";
  paintCtx.strokeStyle = color;
  paintCtx.lineWidth = 13;
  paintCtx.globalAlpha = 0.32;
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
  if (Math.random() > 0.88) {
    ribbons.push({
      x,
      y,
      radius: Math.random() * 16 + 8,
      alpha: 0.48,
      color,
      thickness: Math.random() * 4 + 2,
      speed: 0.9
    });
  }
}

function createSoftDots(x, y, color, count = 6) {
  for (let i = 0; i < count; i++) {
    particles.push({
      type: "dot",
      x: x + (Math.random() - 0.5) * 42,
      y: y + (Math.random() - 0.5) * 42,
      vx: (Math.random() - 0.5) * 2.4,
      vy: (Math.random() - 0.5) * 2.4,
      radius: Math.random() * 8 + 4,
      alpha: 0.62,
      decay: 0.012,
      color,
      rotation: Math.random() * Math.PI,
      grow: 1
    });
  }
}

function createOrganicBloom(x, y) {
  const bloomColors = colors;

  for (let i = 0; i < 10; i++) {
    ribbons.push({
      x: x + (Math.random() - 0.5) * 360,
      y: y + (Math.random() - 0.5) * 240,
      radius: Math.random() * 42 + 32,
      alpha: 0.82,
      color: bloomColors[Math.floor(Math.random() * bloomColors.length)],
      thickness: Math.random() * 10 + 4,
      speed: 1.15
    });
  }

  if (currentMode === "paint") createPaintExplosion(x, y, bloomColors);
  if (currentMode === "bubbles") createBubbleExplosion(x, y, bloomColors);
  if (currentMode === "stars") createStarExplosion(x, y, bloomColors);
  if (currentMode === "flowers") createFlowerExplosion(x, y, bloomColors);
  if (currentMode === "mist") createMistExplosion(x, y, bloomColors);
  if (currentMode === "waves") createWaveExplosion(x, y, bloomColors);
}

function createPaintExplosion(x, y, bloomColors) {
  for (let i = 0; i < 34; i++) {
    const color = bloomColors[Math.floor(Math.random() * bloomColors.length)];

    paintCtx.save();
    paintCtx.globalCompositeOperation = "source-over";
    paintCtx.globalAlpha = 0.26;
    paintCtx.fillStyle = color;

    paintCtx.beginPath();
    paintCtx.ellipse(
      x + (Math.random() - 0.5) * 720,
      y + (Math.random() - 0.5) * 460,
      Math.random() * 120 + 50,
      Math.random() * 70 + 28,
      Math.random() * Math.PI,
      0,
      Math.PI * 2
    );
    paintCtx.fill();

    paintCtx.restore();
  }

  createBrandLetters(x, y, 16);
}

function createBubbleExplosion(x, y, bloomColors) {
  for (let i = 0; i < 120; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 10 + 2;
    const color = bloomColors[Math.floor(Math.random() * bloomColors.length)];

    particles.push({
      type: "bubble",
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.5,
      radius: Math.random() * 48 + 18,
      alpha: 0.86,
      decay: 0.0048,
      color,
      rotation: Math.random() * Math.PI,
      grow: 1
    });
  }
}

function createStarExplosion(x, y, bloomColors) {
  for (let i = 0; i < 130; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 12 + 3.5;
    const color = bloomColors[Math.floor(Math.random() * bloomColors.length)];

    particles.push({
      type: "star",
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: Math.random() * 18 + 9,
      alpha: 0.92,
      decay: 0.008,
      color,
      rotation: Math.random() * Math.PI,
      grow: 1
    });
  }
}

function createFlowerExplosion(x, y, bloomColors) {
  for (let i = 0; i < 110; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 8 + 2;
    const color = bloomColors[Math.floor(Math.random() * bloomColors.length)];

    particles.push({
      type: "flower",
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: Math.random() * 30 + 20,
      alpha: 0.92,
      decay: 0.0048,
      color,
      rotation: Math.random() * Math.PI,
      grow: 1
    });
  }
}

function createMistExplosion(x, y, bloomColors) {
  for (let i = 0; i < 170; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 6 + 1.3;
    const color = bloomColors[Math.floor(Math.random() * bloomColors.length)];

    particles.push({
      type: "mist",
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: Math.random() * 82 + 38,
      alpha: 0.24,
      decay: 0.0028,
      color,
      rotation: Math.random() * Math.PI,
      grow: 1
    });
  }

  createBrandLetters(x, y, 12);
}

function createWaveExplosion(x, y, bloomColors) {
  for (let i = 0; i < 34; i++) {
    ribbons.push({
      x: x + (Math.random() - 0.5) * 760,
      y: y + (Math.random() - 0.5) * 520,
      radius: Math.random() * 58 + 34,
      alpha: 0.85,
      color: bloomColors[Math.floor(Math.random() * bloomColors.length)],
      thickness: Math.random() * 13 + 5,
      speed: 1.45
    });
  }

  createBrandLetters(x, y, 22);
}

function createBrandLetters(x, y, count) {
  const letters = ["B", "R", "O", "N", "X"];

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 15 + 8;

    particles.push({
      type: "letter",
      letter: letters[Math.floor(Math.random() * letters.length)],
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: Math.random() * 36 + 34,
      maxRadius: Math.random() * 95 + 80,
      alpha: 0.92,
      decay: 0.0042,
      color: randomColor(),
      rotation: (Math.random() - 0.5) * 1.6,
      rotationSpeed: (Math.random() - 0.5) * 0.03,
      grow: Math.random() * 1.8 + 1.2
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

function drawLetter(ctx, p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rotation);
  ctx.globalAlpha = p.alpha;
  ctx.fillStyle = p.color;
  ctx.font = `900 ${p.radius * 2}px Arial Black, Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(p.letter, 0, 0);
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

    if (p.grow) {
      if (p.type === "letter") {
        p.radius = Math.min(p.maxRadius, p.radius + p.grow);
      } else {
        p.radius += p.grow * 0.08;
      }
    }

    if (p.rotationSpeed) {
      p.rotation += p.rotationSpeed;
    }

    p.alpha -= p.decay;

    if (p.type === "bubble") {
      p.y -= 0.18;
    }

    fxCtx.save();
    fxCtx.globalCompositeOperation = "source-over";
    fxCtx.globalAlpha = Math.max(0, p.alpha);

    if (p.type === "bubble") {
      fxCtx.strokeStyle = p.color;
      fxCtx.lineWidth = 4;
      fxCtx.beginPath();
      fxCtx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      fxCtx.stroke();

      fxCtx.globalAlpha = Math.max(0, p.alpha * 0.12);
      fxCtx.fillStyle = p.color;
      fxCtx.fill();
    } else if (p.type === "star") {
      drawStarShape(fxCtx, p.x, p.y, p.radius, p.color, p.alpha, p.rotation);
    } else if (p.type === "flower") {
      drawFlowerShape(fxCtx, p.x, p.y, p.radius, p.color, p.alpha, p.rotation);
    } else if (p.type === "mist") {
      fxCtx.fillStyle = p.color;
      fxCtx.globalAlpha = Math.max(0, p.alpha * 0.85);
      fxCtx.beginPath();
      fxCtx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      fxCtx.fill();
    } else if (p.type === "letter") {
      drawLetter(fxCtx, p);
    } else {
      fxCtx.fillStyle = p.color;
      fxCtx.beginPath();
      fxCtx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      fxCtx.fill();
    }

    fxCtx.restore();

    if (p.alpha <= 0) {
      particles.splice(i, 1);
    }
  }

  updateRibbons();
}

function updateRibbons() {
  for (let i = ribbons.length - 1; i >= 0; i--) {
    const r = ribbons[i];

    r.alpha -= 0.0042;
    r.radius += r.speed || 1.2;

    fxCtx.save();
    fxCtx.globalCompositeOperation = "source-over";
    fxCtx.globalAlpha = Math.max(0, r.alpha);
    fxCtx.strokeStyle = r.color;
    fxCtx.lineWidth = r.thickness || 4;

    fxCtx.beginPath();
    fxCtx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
    fxCtx.stroke();

    fxCtx.restore();

    if (r.alpha <= 0) {
      ribbons.splice(i, 1);
    }
  }
}

function detectJump(leftShoulder, rightShoulder) {
  const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;

  if (previousShoulderY === null) {
    previousShoulderY = shoulderY;
    return;
  }

  const movement = previousShoulderY - shoulderY;

  if (jumpCooldown > 0) {
    jumpCooldown--;
  }

  if (movement > 30 && jumpCooldown <= 0) {
    createOrganicBloom(window.innerWidth / 2, window.innerHeight * 0.55);
    jumpCooldown = 70;
  }

  previousShoulderY = shoulderY;
}

function drawAttractMode() {
  const t = Date.now() * 0.001;

  if (Math.random() > 0.94) {
    floatingLetters.push({
      letter: ["B", "R", "O", "N", "X"][Math.floor(Math.random() * 5)],
      x: Math.random() * window.innerWidth,
      y: window.innerHeight + 90,
      vx: (Math.random() - 0.5) * 0.8,
      vy: -Math.random() * 1.2 - 0.4,
      size: Math.random() * 52 + 42,
      color: randomColor(),
      alpha: 0.5,
      rotation: (Math.random() - 0.5) * 0.8
    });
  }

  for (let i = floatingLetters.length - 1; i >= 0; i--) {
    const l = floatingLetters[i];

    l.x += l.vx + Math.sin(t + i) * 0.22;
    l.y += l.vy;
    l.size += 0.04;
    l.alpha -= 0.0012;

    uiCtx.save();
    uiCtx.translate(l.x, l.y);
    uiCtx.rotate(l.rotation + Math.sin(t + i) * 0.1);
    uiCtx.globalAlpha = Math.max(0, l.alpha);
    uiCtx.fillStyle = l.color;
    uiCtx.font = `900 ${l.size}px Arial Black, Arial`;
    uiCtx.textAlign = "center";
    uiCtx.textBaseline = "middle";
    uiCtx.fillText(l.letter, 0, 0);
    uiCtx.restore();

    if (l.alpha <= 0 || l.y < -130) {
      floatingLetters.splice(i, 1);
    }
  }
}

function drawSoftBackgroundMotion() {
  const time = Date.now() * 0.00035;

  uiCtx.save();
  uiCtx.globalCompositeOperation = "source-over";
  uiCtx.globalAlpha = noPoseFrames > 40 ? 0.018 : 0.022;

  for (let i = 0; i < 5; i++) {
    uiCtx.fillStyle = colors[i % colors.length];
    uiCtx.beginPath();
    uiCtx.arc(
      window.innerWidth * (0.12 + i * 0.2),
      window.innerHeight * (0.22 + Math.sin(time + i) * 0.08),
      70 + Math.sin(time * 2 + i) * 18,
      0,
      Math.PI * 2
    );
    uiCtx.fill();
  }

  uiCtx.restore();
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

  uiCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);

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
      smoothLeftHand = smoothPoint(smoothLeftHand, rawLeft, 0.22);
      drawHandEffect(smoothLeftHand, lastLeftHand);
      lastLeftHand = smoothLeftHand;
      detected = true;
    } else {
      lastLeftHand = null;
      smoothLeftHand = null;
    }

    if (rightWrist && rightWrist.score > 0.25) {
      const rawRight = videoToCanvasPoint(rightWrist);
      smoothRightHand = smoothPoint(smoothRightHand, rawRight, 0.22);
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
  drawSoftBackgroundMotion();

  if (noPoseFrames > 40) {
    drawAttractMode();
  }

  requestAnimationFrame(gameLoop);
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

    clearScreen();
    gameLoop();
  } catch (err) {
    console.error(err);
    alert("Camera or body tracking could not start. Try Chrome and allow camera access.");
    splash.style.display = "flex";
    game.style.display = "none";
  }
});

modeSelect.addEventListener("change", () => {
  setMode(modeSelect.value);
});

document.querySelectorAll("#staffPanel button[data-mode]").forEach(button => {
  button.addEventListener("click", () => {
    setMode(button.dataset.mode);
  });
});

clearBtn.addEventListener("click", clearScreen);

autoBtn.addEventListener("click", () => {
  autoRotate = !autoRotate;
  autoBtn.textContent = autoRotate ? "Auto: On" : "Auto: Off";
  lastAutoRotateTime = Date.now();
});

document.addEventListener("keydown", event => {
  const key = event.key.toLowerCase();

  if (key === "1") setMode("paint");
  if (key === "2") setMode("bubbles");
  if (key === "3") setMode("stars");
  if (key === "4") setMode("flowers");
  if (key === "5") setMode("mist");
  if (key === "6") setMode("waves");

  if (key === "c") clearScreen();

  if (key === "a") {
    autoRotate = !autoRotate;
    autoBtn.textContent = autoRotate ? "Auto: On" : "Auto: Off";
    lastAutoRotateTime = Date.now();
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
