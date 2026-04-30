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

let detector = null;
let currentStream = null;
let running = false;
let currentMode = "paint";

let lastLeftHand = null;
let lastRightHand = null;
let particles = [];
let ribbons = [];
let previousShoulderY = null;
let jumpCooldown = 0;

const colors = [
  "#ff6b35",
  "#ffd54f",
  "#00b2a9",
  "#7bdff2",
  "#f15bb5",
  "#102f52"
];

function resizeCanvases() {
  paintCanvas.width = window.innerWidth;
  paintCanvas.height = window.innerHeight;
  fxCanvas.width = window.innerWidth;
  fxCanvas.height = window.innerHeight;
}

window.addEventListener("resize", resizeCanvases);
resizeCanvases();

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

function randomColor() {
  return colors[Math.floor(Math.random() * colors.length)];
}

function fadePaintCanvas() {
  paintCtx.save();
  paintCtx.globalCompositeOperation = "source-over";
  paintCtx.fillStyle = "rgba(246, 240, 229, 0.026)";
  paintCtx.fillRect(0, 0, paintCanvas.width, paintCanvas.height);
  paintCtx.restore();
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
  const width = Math.min(58, Math.max(16, speed * 0.35));
  const color = randomColor();

  paintCtx.save();
  paintCtx.globalCompositeOperation = "multiply";
  paintCtx.lineCap = "round";
  paintCtx.lineJoin = "round";
  paintCtx.shadowBlur = 26;
  paintCtx.shadowColor = color;
  paintCtx.strokeStyle = color;
  paintCtx.lineWidth = width;

  paintCtx.beginPath();
  paintCtx.moveTo(last.x, last.y);
  paintCtx.quadraticCurveTo(
    (last.x + current.x) / 2,
    (last.y + current.y) / 2 - 20,
    current.x,
    current.y
  );
  paintCtx.stroke();
  paintCtx.restore();

  createSparkles(current.x, current.y, color, speed > 35 ? 8 : 3);
}

function drawBubbles(current, last) {
  const color = randomColor();

  for (let i = 0; i < 3; i++) {
    particles.push({
      type: "bubble",
      x: current.x + (Math.random() - 0.5) * 40,
      y: current.y + (Math.random() - 0.5) * 40,
      vx: (Math.random() - 0.5) * 1.5,
      vy: -Math.random() * 2.2 - 0.5,
      radius: Math.random() * 24 + 12,
      alpha: 0.75,
      decay: 0.008,
      color
    });
  }
}

function drawStars(current, last) {
  const color = randomColor();

  for (let i = 0; i < 4; i++) {
    particles.push({
      type: "star",
      x: current.x + (Math.random() - 0.5) * 36,
      y: current.y + (Math.random() - 0.5) * 36,
      vx: (Math.random() - 0.5) * 4,
      vy: (Math.random() - 0.5) * 4,
      radius: Math.random() * 10 + 7,
      alpha: 1,
      decay: 0.018,
      color,
      rotation: Math.random() * Math.PI
    });
  }
}

function drawFlowers(current, last) {
  const speed = Math.hypot(current.x - last.x, current.y - last.y);

  if (speed < 10 && Math.random() > 0.35) return;

  const color = randomColor();

  particles.push({
    type: "flower",
    x: current.x,
    y: current.y,
    vx: 0,
    vy: 0,
    radius: Math.random() * 18 + 18,
    alpha: 0.95,
    decay: 0.006,
    color,
    rotation: Math.random() * Math.PI
  });
}

function drawMist(current, last) {
  const color = randomColor();

  for (let i = 0; i < 6; i++) {
    particles.push({
      type: "mist",
      x: current.x + (Math.random() - 0.5) * 60,
      y: current.y + (Math.random() - 0.5) * 60,
      vx: (Math.random() - 0.5) * 2.2,
      vy: (Math.random() - 0.5) * 2.2,
      radius: Math.random() * 34 + 20,
      alpha: 0.32,
      decay: 0.006,
      color
    });
  }
}

function drawWaves(current, last) {
  const color = randomColor();

  ribbons.push({
    x: current.x,
    y: current.y,
    radius: 18,
    alpha: 0.7,
    color,
    thickness: Math.random() * 5 + 3
  });

  paintCtx.save();
  paintCtx.globalCompositeOperation = "multiply";
  paintCtx.strokeStyle = color;
  paintCtx.lineWidth = 12;
  paintCtx.globalAlpha = 0.35;
  paintCtx.beginPath();
  paintCtx.moveTo(last.x, last.y);
  paintCtx.bezierCurveTo(
    last.x + 80,
    last.y - 80,
    current.x - 80,
    current.y + 80,
    current.x,
    current.y
  );
  paintCtx.stroke();
  paintCtx.restore();
}

function createSparkles(x, y, color, count = 8) {
  for (let i = 0; i < count; i++) {
    particles.push({
      type: "dot",
      x,
      y,
      vx: (Math.random() - 0.5) * 7,
      vy: (Math.random() - 0.5) * 7,
      radius: Math.random() * 7 + 3,
      alpha: 1,
      decay: Math.random() * 0.025 + 0.015,
      color
    });
  }
}

function createOrganicBloom(x, y) {
  const bloomColors = ["#ff6b35", "#ffd54f", "#00b2a9", "#f15bb5", "#7bdff2"];

  for (let i = 0; i < 90; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 10 + 2;
    const color = bloomColors[Math.floor(Math.random() * bloomColors.length)];

    particles.push({
      type: Math.random() > 0.5 ? "flower" : "mist",
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: Math.random() * 22 + 12,
      alpha: 0.85,
      decay: Math.random() * 0.012 + 0.006,
      color,
      rotation: Math.random() * Math.PI
    });
  }

  for (let i = 0; i < 10; i++) {
    ribbons.push({
      x: x + (Math.random() - 0.5) * 240,
      y: y + (Math.random() - 0.5) * 160,
      radius: Math.random() * 40 + 30,
      alpha: 0.75,
      color: bloomColors[Math.floor(Math.random() * bloomColors.length)],
      thickness: Math.random() * 8 + 4
    });
  }

  paintCtx.save();
  paintCtx.globalCompositeOperation = "multiply";

  for (let i = 0; i < 12; i++) {
    const color = bloomColors[Math.floor(Math.random() * bloomColors.length)];
    paintCtx.beginPath();
    paintCtx.arc(
      x + (Math.random() - 0.5) * 300,
      y + (Math.random() - 0.5) * 220,
      Math.random() * 70 + 30,
      0,
      Math.PI * 2
    );
    paintCtx.fillStyle = color;
    paintCtx.globalAlpha = 0.26;
    paintCtx.fill();
  }

  paintCtx.restore();
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
    ctx.ellipse(px, py, radius * 0.32, radius * 0.18, angle, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#fffaf0";
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.18, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function updateParticles() {
  fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];

    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.965;
    p.vy *= 0.965;
    p.alpha -= p.decay;

    fxCtx.save();
    fxCtx.globalCompositeOperation = "multiply";
    fxCtx.globalAlpha = Math.max(0, p.alpha);

    if (p.type === "bubble") {
      fxCtx.strokeStyle = p.color;
      fxCtx.lineWidth = 4;
      fxCtx.beginPath();
      fxCtx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      fxCtx.stroke();

      fxCtx.globalAlpha = Math.max(0, p.alpha * 0.25);
      fxCtx.fillStyle = p.color;
      fxCtx.fill();
    } else if (p.type === "star") {
      drawStarShape(fxCtx, p.x, p.y, p.radius, p.color, p.alpha, p.rotation);
    } else if (p.type === "flower") {
      drawFlowerShape(fxCtx, p.x, p.y, p.radius, p.color, p.alpha, p.rotation);
    } else if (p.type === "mist") {
      fxCtx.fillStyle = p.color;
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

    if (p.alpha <= 0) {
      particles.splice(i, 1);
    }
  }

  for (let i = ribbons.length - 1; i >= 0; i--) {
    const r = ribbons[i];

    r.alpha -= 0.014;
    r.radius += 2.4;

    fxCtx.save();
    fxCtx.globalCompositeOperation = "multiply";
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

  if (movement > 32 && jumpCooldown <= 0) {
    createOrganicBloom(window.innerWidth / 2, window.innerHeight * 0.55);
    jumpCooldown = 65;
  }

  previousShoulderY = shoulderY;
}

function drawSoftBackgroundMotion() {
  const time = Date.now() * 0.00035;

  fxCtx.save();
  fxCtx.globalCompositeOperation = "multiply";
  fxCtx.globalAlpha = 0.055;

  const bgColors = ["#ffd54f", "#00b2a9", "#ff6b35"];

  for (let i = 0; i < 5; i++) {
    const x = window.innerWidth * (0.12 + i * 0.2);
    const y = window.innerHeight * (0.22 + Math.sin(time + i) * 0.08);
    const radius = 70 + Math.sin(time * 2 + i) * 18;

    fxCtx.fillStyle = bgColors[i % bgColors.length];
    fxCtx.beginPath();
    fxCtx.arc(x, y, radius, 0, Math.PI * 2);
    fxCtx.fill();
  }

  fxCtx.restore();
}

async function gameLoop() {
  if (!running) return;

  fadePaintCanvas();

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

    if (leftWrist && leftWrist.score > 0.28) {
      const leftPoint = videoToCanvasPoint(leftWrist);
      drawHandEffect(leftPoint, lastLeftHand);
      lastLeftHand = leftPoint;
    } else {
      lastLeftHand = null;
    }

    if (rightWrist && rightWrist.score > 0.28) {
      const rightPoint = videoToCanvasPoint(rightWrist);
      drawHandEffect(rightPoint, lastRightHand);
      lastRightHand = rightPoint;
    } else {
      lastRightHand = null;
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
    }
  } else {
    lastLeftHand = null;
    lastRightHand = null;
  }

  updateParticles();
  drawSoftBackgroundMotion();

  requestAnimationFrame(gameLoop);
}

startBtn.addEventListener("click", async () => {
  try {
    currentMode = modeSelect.value;

    splash.style.display = "none";
    game.style.display = "block";

    await startCamera();
    await setupPoseDetector();

    running = true;

    setTimeout(() => {
      topTitle.classList.add("fadeOut");
      instruction.classList.add("fadeOut");
    }, 3500);

    gameLoop();
  } catch (err) {
    console.error(err);
    alert("Camera or body tracking could not start. Try Chrome and allow camera access.");
    splash.style.display = "flex";
    game.style.display = "none";
  }
});

modeSelect.addEventListener("change", () => {
  currentMode = modeSelect.value;
});

loadCameras();
