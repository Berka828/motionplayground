const video = document.getElementById("video");
const paintCanvas = document.getElementById("paintCanvas");
const fxCanvas = document.getElementById("fxCanvas");
const paintCtx = paintCanvas.getContext("2d");
const fxCtx = fxCanvas.getContext("2d");

const splash = document.getElementById("splash");
const game = document.getElementById("game");
const startBtn = document.getElementById("startBtn");
const cameraSelect = document.getElementById("cameraSelect");
const instruction = document.getElementById("instruction");
const jumpText = document.getElementById("jumpText");

let detector = null;
let currentStream = null;
let running = false;

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
  "#ffffff"
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

function drawHandTrail(current, last, handType) {
  if (!last) return;

  const speed = Math.hypot(current.x - last.x, current.y - last.y);
  const width = Math.min(54, Math.max(16, speed * 0.35));
  const color = colors[Math.floor(Math.random() * colors.length)];

  paintCtx.save();
  paintCtx.globalCompositeOperation = "lighter";
  paintCtx.lineCap = "round";
  paintCtx.lineJoin = "round";
  paintCtx.shadowBlur = 30;
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

  ribbons.push({
    x: current.x,
    y: current.y,
    radius: width * 0.7,
    alpha: 0.8,
    color
  });

  if (speed > 35) {
    createSparkles(current.x, current.y, color, 8);
  }
}

function fadePaintCanvas() {
  paintCtx.save();
  paintCtx.globalCompositeOperation = "source-over";
  paintCtx.fillStyle = "rgba(6, 19, 38, 0.035)";
  paintCtx.fillRect(0, 0, paintCanvas.width, paintCanvas.height);
  paintCtx.restore();
}

function createSparkles(x, y, color, count = 12) {
  for (let i = 0; i < count; i++) {
    particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 8,
      vy: (Math.random() - 0.5) * 8,
      radius: Math.random() * 7 + 3,
      alpha: 1,
      decay: Math.random() * 0.025 + 0.015,
      color
    });
  }
}

function createSplashExplosion(x, y) {
  const splashColors = ["#ff6b35", "#ffd54f", "#00b2a9", "#f15bb5", "#ffffff"];

  for (let i = 0; i < 130; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 16 + 4;
    const color = splashColors[Math.floor(Math.random() * splashColors.length)];

    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: Math.random() * 14 + 6,
      alpha: 1,
      decay: Math.random() * 0.018 + 0.008,
      color
    });
  }

  paintCtx.save();
  paintCtx.globalCompositeOperation = "lighter";

  for (let i = 0; i < 12; i++) {
    const color = splashColors[Math.floor(Math.random() * splashColors.length)];
    paintCtx.beginPath();
    paintCtx.arc(
      x + (Math.random() - 0.5) * 260,
      y + (Math.random() - 0.5) * 180,
      Math.random() * 80 + 40,
      0,
      Math.PI * 2
    );
    paintCtx.fillStyle = color;
    paintCtx.globalAlpha = 0.45;
    paintCtx.fill();
  }

  paintCtx.restore();

  jumpText.classList.remove("show");
  void jumpText.offsetWidth;
  jumpText.classList.add("show");
}

function updateParticles() {
  fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];

    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.96;
    p.vy *= 0.96;
    p.alpha -= p.decay;

    fxCtx.save();
    fxCtx.globalCompositeOperation = "lighter";
    fxCtx.globalAlpha = Math.max(0, p.alpha);
    fxCtx.fillStyle = p.color;
    fxCtx.shadowBlur = 20;
    fxCtx.shadowColor = p.color;

    fxCtx.beginPath();
    fxCtx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    fxCtx.fill();
    fxCtx.restore();

    if (p.alpha <= 0) {
      particles.splice(i, 1);
    }
  }

  for (let i = ribbons.length - 1; i >= 0; i--) {
    const r = ribbons[i];

    r.alpha -= 0.018;
    r.radius += 1.2;

    fxCtx.save();
    fxCtx.globalCompositeOperation = "lighter";
    fxCtx.globalAlpha = Math.max(0, r.alpha);
    fxCtx.strokeStyle = r.color;
    fxCtx.lineWidth = 5;
    fxCtx.shadowBlur = 16;
    fxCtx.shadowColor = r.color;

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
  if (!leftShoulder || !rightShoulder) return;

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
    createSplashExplosion(window.innerWidth / 2, window.innerHeight * 0.55);
    instruction.textContent = "Big splash! Keep painting with your hands.";
    jumpCooldown = 60;
  }

  previousShoulderY = shoulderY;
}

function drawFloatingBrandShapes() {
  fxCtx.save();
  fxCtx.globalAlpha = 0.08;
  fxCtx.fillStyle = "#ffffff";

  for (let i = 0; i < 6; i++) {
    const t = Date.now() * 0.0004 + i;
    const x = window.innerWidth * (0.15 + i * 0.15);
    const y = window.innerHeight * (0.2 + Math.sin(t) * 0.08);

    fxCtx.beginPath();
    fxCtx.arc(x, y, 40 + Math.sin(t * 2) * 10, 0, Math.PI * 2);
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
      drawHandTrail(leftPoint, lastLeftHand, "left");
      lastLeftHand = leftPoint;
    } else {
      lastLeftHand = null;
    }

    if (rightWrist && rightWrist.score > 0.28) {
      const rightPoint = videoToCanvasPoint(rightWrist);
      drawHandTrail(rightPoint, lastRightHand, "right");
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
    instruction.textContent = "Step into view and raise your hands.";
  }

  updateParticles();
  drawFloatingBrandShapes();

  requestAnimationFrame(gameLoop);
}

startBtn.addEventListener("click", async () => {
  try {
    splash.style.display = "none";
    game.style.display = "block";

    await startCamera();
    await setupPoseDetector();

    running = true;
    instruction.textContent = "Move your hands to paint with light.";
    gameLoop();
  } catch (err) {
    console.error(err);
    alert("Camera or body tracking could not start. Try Chrome and allow camera access.");
    splash.style.display = "flex";
    game.style.display = "none";
  }
});

loadCameras();
