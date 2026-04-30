const video = document.getElementById("video");
const paintCanvas = document.getElementById("paintCanvas");
const fxCanvas = document.getElementById("fxCanvas");

const paintCtx = paintCanvas.getContext("2d");
const fxCtx = fxCanvas.getContext("2d");

const splash = document.getElementById("splash");
const game = document.getElementById("game");

const startBtn = document.getElementById("startBtn");
const clearBtn = document.getElementById("clearBtn");
const logoBtn = document.getElementById("logoBtn");
const hideBtn = document.getElementById("hideBtn");
const fadeSlider = document.getElementById("fadeSlider");

let showLogo = true;
let fadeAmount = 0.03;
let particles = [];

const colors = ["#ffd100","#f26522","#00aeef","#3b2483","#a6208f","#39b54a"];

function resize() {
  paintCanvas.width = innerWidth;
  paintCanvas.height = innerHeight;
  fxCanvas.width = innerWidth;
  fxCanvas.height = innerHeight;
}
resize();
addEventListener("resize", resize);

fadeSlider.oninput = () => fadeAmount = fadeSlider.value / 1000;

function fadeCanvas() {
  paintCtx.fillStyle = `rgba(255,255,255,${fadeAmount})`;
  paintCtx.fillRect(0,0,innerWidth,innerHeight);
}

function drawLogoBackground() {
  if (!showLogo) return;

  const img = new Image();
  img.src = "bxcm-logo.png";

  paintCtx.globalAlpha = 0.03;
  paintCtx.drawImage(
    img,
    innerWidth/2 - 300,
    innerHeight/2 - 150,
    600,
    300
  );
  paintCtx.globalAlpha = 1;
}

function drawTrail(x,y,px,py) {
  paintCtx.strokeStyle = colors[Math.floor(Math.random()*colors.length)];
  paintCtx.lineWidth = 20;
  paintCtx.lineCap = "round";

  paintCtx.beginPath();
  paintCtx.moveTo(px,py);
  paintCtx.lineTo(x,y);
  paintCtx.stroke();
}

function spawnParticles(x,y) {
  for(let i=0;i<4;i++){
    particles.push({
      x,y,
      vx:(Math.random()-0.5)*4,
      vy:(Math.random()-0.5)*4,
      life:1,
      color:colors[Math.floor(Math.random()*colors.length)]
    });
  }
}

function updateParticles() {
  fxCtx.clearRect(0,0,innerWidth,innerHeight);

  particles.forEach(p=>{
    p.x+=p.vx;
    p.y+=p.vy;
    p.life-=0.02;

    fxCtx.globalAlpha=p.life;
    fxCtx.fillStyle=p.color;
    fxCtx.beginPath();
    fxCtx.arc(p.x,p.y,8,0,Math.PI*2);
    fxCtx.fill();
  });

  particles = particles.filter(p=>p.life>0);
}

let lastX=null,lastY=null;

function loop() {
  fadeCanvas();
  drawLogoBackground();
  updateParticles();

  if(lastX){
    drawTrail(mouseX,mouseY,lastX,lastY);
    spawnParticles(mouseX,mouseY);
  }

  lastX=mouseX;
  lastY=mouseY;

  requestAnimationFrame(loop);
}

let mouseX=0,mouseY=0;
document.onmousemove=e=>{
  mouseX=e.clientX;
  mouseY=e.clientY;
};

clearBtn.onclick=()=>paintCtx.clearRect(0,0,innerWidth,innerHeight);

logoBtn.onclick=()=>{
  showLogo=!showLogo;
  logoBtn.innerText = showLogo ? "Logo: On" : "Logo: Off";
};

hideBtn.onclick=()=>{
  document.getElementById("staffPanel").classList.toggle("hidden");
};

startBtn.onclick=()=>{
  splash.style.display="none";
  game.style.display="block";
  loop();
};
