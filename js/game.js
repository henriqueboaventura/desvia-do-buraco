'use strict';

// ─── Canvas setup ─────────────────────────────────────────────────────────────
const C  = document.getElementById('c');
const cx = C.getContext('2d');
cx.imageSmoothingEnabled = false;

// ─── Constants ────────────────────────────────────────────────────────────────
const W = 320, H = 480, W2 = W/2, H2 = H/2;

const CAM_DIST   = 30;   // perspective focal distance
const CAM_H      = 200;  // camera height above road
const SEG_SIZE   = 5;    // world units per road segment
const DRAW_DEPTH = 150;  // segments rendered ahead
const ROAD_LEN   = 2000; // total road segments (loops)
const STRIPE_N   = 4;    // segments per color stripe (dashed center line)
const SP_SCALE   = 1.5;  // sprite size multiplier
const MAX_POSX   = 125;  // player lateral limit (pixels)

// Two city lanes (road coords, positive = left of center)
const LANES = [0.16, -0.16];
const LANE_COOLDOWN_MIN = 20; // min segments between obstacles in same lane

const STREETS = [
  'Av. Getúlio Vargas', 'R. Borges de Medeiros', 'Av. 24 de Maio',
  'R. Júlio de Castilhos', 'R. Bento Gonçalves', 'R. Garibaldi',
  'Av. Brasil', 'R. Farroupilha', 'R. 7 de Setembro',
  'R. M. Floriano', 'Av. Osvaldo Aranha', 'R. 15 de Novembro',
  'Av. Dom Pedro II', 'R. Independência', 'R. Santos Dumont',
];

// ─── Sprite loading ───────────────────────────────────────────────────────────
const SP = {};

function mkFallbackSp(key, w, h, originY) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;

  if (key === 'player') {
    g.fillStyle = '#cc1111'; g.fillRect(7, 20, 42, 50);
    g.fillStyle = '#aa0000'; g.fillRect(12, 6, 32, 18);
    g.fillStyle = '#99ddff'; g.fillRect(15, 8, 26, 12);
    g.fillStyle = '#111';
    g.fillRect(0, 26, 8, 14); g.fillRect(w-8, 26, 8, 14);
    g.fillRect(0, 52, 8, 14); g.fillRect(w-8, 52, 8, 14);
    g.fillStyle = '#ff3333'; g.fillRect(9, 64, 14, 6); g.fillRect(w-23, 64, 14, 6);
  } else if (key.startsWith('car')) {
    const cols = ['#cc2211','#2255cc','#22aa44','#ccaa00','#cccccc'];
    const ci = parseInt(key.slice(3), 10) || 0;
    const col = cols[ci % cols.length];
    g.fillStyle = col; g.fillRect(6, 6, w-12, h-14);
    g.fillStyle = '#99ddff'; g.fillRect(12, 8, w-24, 10);
    g.fillStyle = '#111';
    g.fillRect(0, 12, 7, 12); g.fillRect(w-7, 12, 7, 12);
    g.fillRect(0, 28, 7, 12); g.fillRect(w-7, 28, 7, 12);
    g.fillStyle = '#ff3333'; g.fillRect(8, h-10, 14, 6); g.fillRect(w-22, h-10, 14, 6);
  } else if (key === 'bike') {
    g.strokeStyle = '#333'; g.lineWidth = 3;
    g.beginPath(); g.arc(w/2, h-12, 10, 0, Math.PI*2); g.stroke();
    g.fillStyle = '#ff6600'; g.fillRect(w/2-5, 14, 10, 28);
    g.fillStyle = '#cc2200'; g.beginPath(); g.arc(w/2, 8, 7, 0, Math.PI*2); g.fill();
  } else if (key === 'pothole') {
    g.fillStyle = '#181818';
    g.beginPath(); g.ellipse(w/2, h/2, w/2-4, h/2-2, 0, 0, Math.PI*2); g.fill();
    g.fillStyle = '#060606';
    g.beginPath(); g.ellipse(w/2, h/2, w/2-10, h/2-6, 0, 0, Math.PI*2); g.fill();
  }

  return { img: c, x: 0, y: 0, w, h, originY };
}

function loadSprites(onDone) {
  //                  key       file         srcW srcH  originY  rs
  const specs = [
    ['player',  'player',     60, 42,  1,    1   ],
    ['car0',    'car_red',    60, 42,  1,    1.25],
    ['car1',    'car_blue',   60, 42,  1,    1.25],
    ['car2',    'car_green',  60, 42,  1,    1.25],
    ['car3',    'car_yellow', 60, 42,  1,    1.25],
    ['car4',    'car_white',  60, 42,  1,    1.25],
    ['bike',    'bike',       38, 56,  0.45, 1.8 ],
    ['pothole', 'pothole',    80, 44,  0.5,  1   ],
  ];
  let pending = specs.length;
  const done = () => { if (--pending === 0) onDone(); };

  for (const [key, file, w, h, originY, rs] of specs) {
    const img = new Image();
    img.onload  = () => { SP[key] = { img, x: 0, y: 0, w, h, originY, rs }; done(); };
    img.onerror = () => { SP[key] = { ...mkFallbackSp(key, w, h, originY), rs }; done(); };
    img.src = 'sprites/' + file + '.png';
  }
}

// ─── Sign sprite cache ────────────────────────────────────────────────────────
const signCache = {};
function getSign(text) {
  if (signCache[text]) return signCache[text];
  const sw = 96, sh = 38;
  const c = document.createElement('canvas'); c.width = sw; c.height = sh;
  const g = c.getContext('2d');
  // pole
  g.fillStyle = '#777'; g.fillRect(sw/2-1, sh-10, 3, 10);
  // board back
  g.fillStyle = '#003399'; g.fillRect(0, 0, sw, sh-10);
  // board face
  g.fillStyle = '#0044cc'; g.fillRect(3, 3, sw-6, sh-16);
  // border
  g.strokeStyle = '#fff'; g.lineWidth = 2; g.strokeRect(2, 2, sw-4, sh-14);
  // text
  g.font = 'bold 10px monospace';
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const label = text.length > 13 ? text.slice(0, 12) + '.' : text;
  g.fillText(label, sw/2, (sh-10)/2);
  const sp = { img: c, x: 0, y: 0, w: sw, h: sh, originY: 1 };
  signCache[text] = sp;
  return sp;
}

// ─── Wind turbine sprites ─────────────────────────────────────────────────────
const turbineFrames = [];

function initTurbines() {
  const tw = 30, th = 130;
  for (let f = 0; f < 8; f++) {
    const c = document.createElement('canvas'); c.width = tw; c.height = th;
    const g = c.getContext('2d');
    // Tower
    g.fillStyle = '#d8d8d8';
    g.fillRect(tw/2 - 2, th * 0.28, 4, th * 0.72);
    // Hub
    g.fillStyle = '#bbb';
    g.beginPath(); g.arc(tw/2, th * 0.28, 3.5, 0, Math.PI * 2); g.fill();
    // 3 blades
    const baseAngle = (f / 8) * Math.PI * 2;
    for (let b = 0; b < 3; b++) {
      const angle = baseAngle + (b / 3) * Math.PI * 2;
      g.save();
      g.translate(tw/2, th * 0.28);
      g.rotate(angle);
      g.fillStyle = '#e8e8e8';
      g.strokeStyle = '#999'; g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(-2.5, -th * 0.24);
      g.lineTo(0, -th * 0.27);
      g.lineTo(2.5, -th * 0.24);
      g.closePath();
      g.fill(); g.stroke();
      g.restore();
    }
    turbineFrames.push({ img: c, x: 0, y: 0, w: tw, h: th, originY: 1 });
  }
}

function getTurbine() {
  return turbineFrames[Math.floor(frame / 5) % 8];
}

// ─── Background ───────────────────────────────────────────────────────────────
let bgCanvas;

function drawFallbackBg(g) {
  const bands = ['#0d1e4a','#0d1e4a','#152f6e','#1a3d86','#2050a0','#2e64b4','#3c78c8','#4e8cd8'];
  const bh = Math.ceil(H2 / bands.length);
  bands.forEach((col, i) => { g.fillStyle = col; g.fillRect(0, i*bh, W*2, bh+1); });

  // Sun
  g.fillStyle = '#ffe855'; g.beginPath(); g.arc(W*1.55, 38, 24, 0, Math.PI*2); g.fill();
  g.fillStyle = '#ffcc33'; g.beginPath(); g.arc(W*1.55, 38, 18, 0, Math.PI*2); g.fill();

  // Morro da Borússia – far range
  g.fillStyle = '#1d4d1d';
  g.beginPath();
  g.moveTo(0, H2);
  g.lineTo(0, H2*0.75);
  g.bezierCurveTo(W*0.2, H2*0.55, W*0.5, H2*0.22, W*0.75, H2*0.14);
  g.bezierCurveTo(W*0.85, H2*0.10, W*1.05, H2*0.10, W*1.45, H2*0.38);
  g.bezierCurveTo(W*1.65, H2*0.55, W*1.82, H2*0.70, W*2, H2*0.80);
  g.lineTo(W*2, H2); g.closePath(); g.fill();

  // Morro da Borússia – near range
  g.fillStyle = '#163c16';
  g.beginPath();
  g.moveTo(0, H2);
  g.bezierCurveTo(W*0.15, H2*0.85, W*0.35, H2*0.65, W*0.55, H2*0.55);
  g.bezierCurveTo(W*0.70, H2*0.47, W*1.02, H2*0.46, W*1.55, H2*0.68);
  g.bezierCurveTo(W*1.75, H2*0.76, W*1.88, H2*0.82, W*2, H2*0.88);
  g.lineTo(W*2, H2); g.closePath(); g.fill();

  g.font = 'bold 8px monospace';
  g.fillStyle = 'rgba(255,255,180,0.75)';
  g.textAlign = 'center';
  g.fillText('Morro da Borússia', W, H2*0.18);
}

function initBg() {
  bgCanvas = document.createElement('canvas');
  bgCanvas.width = W*2; bgCanvas.height = H2;
  const g = bgCanvas.getContext('2d');
  // Draw fallback immediately
  drawFallbackBg(g);
  // Try loading SVG background (replaces fallback when loaded)
  const img = new Image();
  img.onload = () => {
    g.clearRect(0, 0, W*2, H2);
    g.drawImage(img, 0, 0, W*2, H2);
  };
  img.src = 'sprites/background.png';
}

// ─── Road generation (straight) ───────────────────────────────────────────────
const road = new Array(ROAD_LEN);
function generateRoad() {
  for (let i = 0; i < ROAD_LEN; i++) {
    road[i] = { height: 0, curve: 0 };
  }
}

// ─── Street ticker ────────────────────────────────────────────────────────────
let tickerTimeout = null;
function showStreetName(name) {
  const el = document.getElementById('street-ticker');
  if (!el) return;
  el.innerHTML = `<span class="icon">&#128739;</span><span class="name">${name}</span>`;
  el.style.opacity = '1';
  clearTimeout(tickerTimeout);
  tickerTimeout = setTimeout(() => { el.style.opacity = '0.35'; }, 4000);
}

// ─── Game state ───────────────────────────────────────────────────────────────
let player, obstacles, score, dist, lives, level, running;
let currentLane = 1; // 0 = left lane, 1 = right lane
let invincible = 0;
let nextSeg = 0;
let frame = 0;
let lastTs = 0;
let lvUpNotif = null;  // { text, timer }
let popups = [];       // { text, x, y, color, life }
let laneCooldown = [0, 0];      // per-lane min-segment gap tracker
let lastObstacleSeg = [-99, -99]; // last segment each lane had an obstacle
let shakeTimer = 0;   // pothole shake countdown
let hitType    = null; // 'pothole' | 'vehicle' – last collision type

function initGame() {
  currentLane = 1; // start in right lane
  player = {
    position: 10,
    speed: 0,
    maxSpeed: 10,
    posx: -LANES[currentLane] * W, // snap to starting lane immediately
  };
  obstacles = [];
  score = 0; dist = 0; lives = 3; level = 1;
  invincible = 0; frame = 0;
  lvUpNotif = null; popups = [];
  laneCooldown = [0, 0];
  lastObstacleSeg = [-99, -99];
  shakeTimer = 0; hitType = null;
  nextSeg = Math.floor(player.position / SEG_SIZE) + 8;
  fillAhead();
  updHUD();
}

// ─── Obstacle pool ────────────────────────────────────────────────────────────
function fillAhead() {
  const playerSeg = Math.floor(player.position / SEG_SIZE);
  // Density caps at 6% – stays comfortable even at higher levels
  const density = Math.min(0.06, 0.02 + level * 0.004);

  while (nextSeg < playerSeg + DRAW_DEPTH + 10) {
    // Decrement lane cooldowns one step per segment
    for (let i = 0; i < laneCooldown.length; i++) {
      if (laneCooldown[i] > 0) laneCooldown[i]--;
    }

    if (nextSeg > playerSeg + 10 && Math.random() < density) {
      // A lane is available only if:
      //   1. Its own cooldown has expired, AND
      //   2. The OTHER lane had an obstacle recently (within SAFE_GAP segments)
      //      → skip, so the player always has a clear escape lane
      const SAFE_GAP = 18;
      const available = LANES
        .map((pos, idx) => {
          if (laneCooldown[idx] > 0) return -1;
          const other = 1 - idx;
          if (nextSeg - lastObstacleSeg[other] < SAFE_GAP) return -1;
          return idx;
        })
        .filter(i => i >= 0);

      if (available.length > 0) {
        const laneIdx = available[Math.floor(Math.random() * available.length)];
        // Pothole density grows with distance: starts 3/6, reaches 5/6 by 1200 m
        const n = Math.min(2, Math.floor(dist / 600));
        const types = [
          ...Array(Math.max(0, 2 - n)).fill('car'),
          ...Array(3 + n).fill('pothole'),
          'bike',
        ];
        const type  = types[Math.floor(Math.random() * types.length)];
        obstacles.push({
          seg: nextSeg,
          pos: LANES[laneIdx],
          type,
          sn: type === 'car' ? 'car' + Math.floor(Math.random() * 5) : type,
          passed: false,
          dead: false,
        });
        laneCooldown[laneIdx]    = LANE_COOLDOWN_MIN + Math.floor(Math.random() * 12);
        lastObstacleSeg[laneIdx] = nextSeg;
      }
    }

    // Street sign every ~50 segments
    if (nextSeg > 8 && nextSeg % 50 === 0) {
      const name = STREETS[Math.floor(Math.random() * STREETS.length)];
      const side = Math.random() > 0.5 ? 0.55 : -0.55;
      obstacles.push({
        seg: nextSeg, pos: side, type: 'sign',
        sn: 'sign', signText: name, passed: false, dead: false,
      });
    }

    // Wind turbine cluster every ~80 segments
    if (nextSeg > 20 && nextSeg % 80 === 0) {
      const side = Math.random() > 0.5 ? 0.68 : -0.68;
      obstacles.push({ seg: nextSeg, pos: side, type: 'turbine', sn: 'turbine', passed: false, dead: false });
      if (Math.random() > 0.35) {
        const side2 = -side; // opposite side
        obstacles.push({ seg: nextSeg + 4, pos: side2, type: 'turbine', sn: 'turbine', passed: false, dead: false });
      }
      if (Math.random() > 0.55) {
        obstacles.push({ seg: nextSeg + 8, pos: side, type: 'turbine', sn: 'turbine', passed: false, dead: false });
      }
    }

    nextSeg++;
  }

  // Prune far-behind obstacles
  const cutoff = playerSeg - 8;
  for (let i = obstacles.length - 1; i >= 0; i--) {
    if (obstacles[i].seg < cutoff) obstacles.splice(i, 1);
  }
}

// ─── HUD ──────────────────────────────────────────────────────────────────────
function updHUD() {
  document.getElementById('hpts').textContent  = Math.floor(score);
  document.getElementById('hdist').textContent = Math.floor(dist) + 'm';
  document.getElementById('hliv').textContent  = '♥'.repeat(lives) + '♡'.repeat(3 - lives);
  document.getElementById('hlv').textContent   = level;
}

// ─── Rendering ────────────────────────────────────────────────────────────────
function drawBg() {
  const shift = Math.round(player.posx * 0.4 + W/2);
  const bw = bgCanvas.width; // 640
  const sx = ((shift % bw) + bw) % bw;
  if (sx + W <= bw) {
    cx.drawImage(bgCanvas, sx, 0, W, H2, 0, 0, W, H2);
  } else {
    const p1 = bw - sx;
    cx.drawImage(bgCanvas, sx, 0, p1, H2, 0, 0, p1, H2);
    cx.drawImage(bgCanvas, 0, 0, W - p1, H2, p1, 0, W - p1, H2);
  }
}

function drawTrap(y1, sc1, of1, y2, sc2, of2, d1, d2, color) {
  cx.fillStyle = color;
  cx.beginPath();
  cx.moveTo(W2 + d1*W*sc1 + of1, y1);
  cx.lineTo(W2 + d1*W*sc2 + of2, y2);
  cx.lineTo(W2 + d2*W*sc2 + of2, y2);
  cx.lineTo(W2 + d2*W*sc1 + of1, y1);
  cx.fill();
}

function drawSeg(y1, sc1, of1, y2, sc2, of2, alt) {
  // Sidewalks (grass)
  cx.fillStyle = alt ? '#3a9820' : '#2d7818';
  cx.fillRect(0, y2, W, y1 - y2);
  // Asphalt road (two lanes)
  drawTrap(y1, sc1, of1, y2, sc2, of2, -0.44,  0.44, alt ? '#686868' : '#5c5c5c');
  // White edge lines
  drawTrap(y1, sc1, of1, y2, sc2, of2, -0.44, -0.41, '#d8d8d8');
  drawTrap(y1, sc1, of1, y2, sc2, of2,  0.41,  0.44, '#d8d8d8');
  // Yellow dashed center divider (only on alt stripes = dashed effect)
  if (alt) {
    drawTrap(y1, sc1, of1, y2, sc2, of2, -0.018, 0.018, '#ffdd00');
  }
}

function blitSprite(sp, sx, sy, sc) {
  if (!sp) return;
  const s  = SP_SCALE * sc * (sp.rs || 1);
  const dw = Math.round(sp.w * s);
  const dh = Math.round(sp.h * s);
  if (dw < 1 || dh < 1) return;

  const dx      = Math.round(sx - dw / 2);
  const dy      = Math.round(sy - dh * sp.originY);

  // Clip to road area – never draw above the horizon
  const drawTop = Math.max(dy, H2);
  const drawBot = Math.min(dy + dh, H);
  if (drawTop >= drawBot) return;

  const scaleToSrc = sp.h / dh;
  const srcY0 = (drawTop - dy) * scaleToSrc;
  const srcH  = (drawBot - drawTop) * scaleToSrc;
  if (srcH < 1) return;

  cx.drawImage(sp.img, sp.x, sp.y + srcY0, sp.w, srcH, dx, drawTop, dw, drawBot - drawTop);
}

function doRender() {
  cx.clearRect(0, 0, W, H);

  // 1. Sky + mountains
  drawBg();
  // Seal the horizon seam with grass colour
  cx.fillStyle = '#2d7818';
  cx.fillRect(0, H2 - 1, W, 6);

  // 2. Road + sprites
  const absIdx   = Math.floor(player.position / SEG_SIZE);
  const startSeg = absIdx - 2;

  const curSeg  = road[((absIdx)   % ROAD_LEN + ROAD_LEN) % ROAD_LEN];
  const nxtSeg_ = road[((absIdx+1) % ROAD_LEN + ROAD_LEN) % ROAD_LEN];
  const relPos  = (player.position % SEG_SIZE) / SEG_SIZE;
  const camH    = CAM_H + curSeg.height + (nxtSeg_.height - curSeg.height) * relPos;
  const baseSeg = road[((startSeg) % ROAD_LEN + ROAD_LEN) % ROAD_LEN];
  const baseOff = baseSeg.curve + (road[((startSeg+1) % ROAD_LEN + ROAD_LEN) % ROAD_LEN].curve - baseSeg.curve) * relPos;
  const lastDelta = player.posx - baseOff * 2;

  let lastProjH = Number.POSITIVE_INFINITY;
  let counter   = absIdx % (2 * STRIPE_N);
  const spBuf   = [];

  for (let i = 0; i < DRAW_DEPTH; i++) {
    const absI   = startSeg + i;
    const segI   = ((absI     % ROAD_LEN) + ROAD_LEN) % ROAD_LEN;
    const segI1  = (((absI+1) % ROAD_LEN) + ROAD_LEN) % ROAD_LEN;
    const seg     = road[segI];
    const segNext = road[segI1];

    const segPos  = absI * SEG_SIZE - player.position;
    const segPos1 = segPos + SEG_SIZE;

    const d1 = CAM_DIST + segPos;
    const d2 = CAM_DIST + segPos1;

    const ph1 = Math.floor((camH - seg.height)      * CAM_DIST / d1);
    const ph2 = Math.floor((camH - segNext.height)   * CAM_DIST / d2);
    const sc1 = CAM_DIST / d1;
    const sc2 = CAM_DIST / d2;

    const of1 = seg.curve     - baseOff - lastDelta * sc1;
    const of2 = segNext.curve - baseOff - lastDelta * sc2;

    const y1 = H2 + Math.min(lastProjH, ph1);
    const y2 = H2 + ph2;

    if (y1 > y2 && y2 < H) {
      drawSeg(y1, sc1, of1, y2, sc2, of2, counter < STRIPE_N);
    }

    // Collect sprites on this segment (will be drawn far→near via pop)
    for (const obs of obstacles) {
      if (obs.dead) continue;
      if (obs.seg === absI) {
        const spx = W2 - obs.pos * W * sc1 + of1;
        const sp  = obs.type === 'sign' ? getSign(obs.signText)
                  : obs.type === 'turbine' ? getTurbine()
                  : SP[obs.sn];
        spBuf.push({ sp, sx: spx, sy: H2 + Math.min(lastProjH, ph1), sc: sc1, type: obs.type });
      }
    }

    lastProjH = Math.min(lastProjH, ph1);
    counter   = (counter + 1) % (2 * STRIPE_N);
  }

  // Draw sprites far→near (painter's algorithm via pop)
  while (spBuf.length) {
    const b = spBuf.pop();
    if (b.type === 'car' || b.type === 'bike') {
      const sp = b.sp;
      const s  = SP_SCALE * b.sc * (sp?.rs || 1);
      const dh = sp ? Math.round(sp.h * s) : 0;
      // Shadow sits at the rendered sprite's bottom edge (wheel contact point)
      const shadowY = Math.round(b.sy + dh * (1 - (sp?.originY || 1)));
      const rx = Math.round((b.type === 'bike' ? 10 : 20) * s);
      const ry = Math.round((b.type === 'bike' ?  4 :  7) * s);
      if (rx > 0 && ry > 0) {
        cx.save();
        cx.globalAlpha = 0.35;
        cx.fillStyle = '#000';
        cx.beginPath();
        cx.ellipse(Math.round(b.sx), shadowY, rx, ry, 0, 0, Math.PI * 2);
        cx.fill();
        cx.restore();
      }
    }
    blitSprite(b.sp, b.sx, b.sy, b.sc);
  }

  // 3. Player car
  const psp = SP.player;
  if (psp) {
    // Vehicles flash; potholes shake instead
    const flash = invincible > 0 && hitType !== 'pothole' && Math.floor(invincible / 5) % 2 === 0;
    if (!flash) {
      const targetPosx_ = -LANES[currentLane] * W;
      const lean = Math.sign(targetPosx_ - player.posx)
                 * Math.min(1, Math.abs(targetPosx_ - player.posx) / 40) * 0.08;
      const frac   = shakeTimer / 55;
      const shakeX = shakeTimer > 0 ? (Math.random() - 0.5) * 12 * frac : 0;
      const shakeY = shakeTimer > 0 ? (Math.random() - 0.5) *  7 * frac : 0;
      cx.save();
      cx.translate(W2 + shakeX, H - 18 + shakeY);
      cx.rotate(lean);
      const ps = 1.35;
      const pw = Math.round(psp.w * ps), ph = Math.round(psp.h * ps);
      // Shadow
      cx.globalAlpha = 0.4;
      cx.fillStyle = '#000';
      cx.beginPath();
      cx.ellipse(0, -5, pw * 0.44, 9, 0, 0, Math.PI * 2);
      cx.fill();
      cx.globalAlpha = 1;
      // Car
      cx.drawImage(psp.img, 0, 0, psp.w, psp.h, -pw/2, -ph, pw, ph);
      cx.restore();
    }
  }

  // 4. Speedometer (top-left in km/h)
  const kmh = Math.floor(player.speed / player.maxSpeed * 120);
  cx.font = 'bold 9px monospace';
  cx.fillStyle = '#ffee00';
  cx.textAlign = 'right';
  cx.fillText(kmh + ' km/h', W - 4, H - 5);

  const bw2 = 36, bx = W - 4 - bw2;
  cx.fillStyle = '#333'; cx.fillRect(bx, H - 16, bw2, 5);
  const barFill = Math.round((player.speed / player.maxSpeed) * bw2);
  const bc = player.speed < player.maxSpeed * 0.5 ? '#44ff44'
           : player.speed < player.maxSpeed * 0.8 ? '#ffaa00' : '#ff3333';
  cx.fillStyle = bc; cx.fillRect(bx, H - 16, barFill, 5);

  // 5. Score popups
  for (const p of popups) {
    cx.globalAlpha = Math.min(1, p.life / 30);
    cx.font = 'bold 11px monospace';
    cx.fillStyle = p.color;
    cx.textAlign = 'center';
    cx.fillText(p.text, p.x, p.y);
  }
  cx.globalAlpha = 1;

  // 6. Level-up notification
  if (lvUpNotif && lvUpNotif.timer > 0) {
    cx.globalAlpha = Math.min(1, lvUpNotif.timer / 20);
    cx.font = 'bold 22px monospace';
    cx.textAlign = 'center';
    cx.fillStyle = '#ffdd00';
    cx.fillText(lvUpNotif.text, W2, H2 - 20);
    cx.font = 'bold 12px monospace';
    cx.fillStyle = '#fff';
    cx.fillText('MAIS RÁPIDO!', W2, H2 + 4);
    cx.globalAlpha = 1;
  }
}

// ─── Collision ────────────────────────────────────────────────────────────────
function checkCollisions() {
  if (invincible > 0) return;
  const playerSeg = Math.floor(player.position / SEG_SIZE);

  for (const obs of obstacles) {
    if (obs.dead || obs.type === 'sign' || obs.type === 'turbine') continue;

    const diff = obs.seg - playerSeg;

    // Award +15 when an obstacle is safely passed
    if (diff < -1 && !obs.passed) {
      obs.passed = true;
      score += 15;
      const px = W2 + (Math.random() - 0.5) * 60;
      popups.push({ text: '+15', x: px, y: H - 100, color: '#88ff88', life: 50 });
    }

    // Collision zone: 0–2 segments ahead, same lane only
    if (diff >= 0 && diff <= 2) {
      if (obs.pos === LANES[currentLane]) {
        obs.dead = true;
        onHit(obs.type);
      }
    }
  }
}

function onHit(type) {
  lives--;
  hitType = type;
  if (type === 'pothole') {
    // Pothole: shake the car, short invincibility, no speed penalty
    shakeTimer = 55;
    invincible  = 80;
  } else {
    // Car or bike: full stop, shake harder, longer invincibility, speed ramps back up
    player.speed = 0;
    shakeTimer   = 90;
    invincible   = 150;
  }
  if (lives <= 0) {
    running = false;
    showOver(true);
  } else {
    score = Math.max(0, score - 50);
    updHUD();
  }
}

// ─── Game loop ────────────────────────────────────────────────────────────────
function tick(ts) {
  requestAnimationFrame(tick);
  if (!running) return;

  const dt = Math.min((ts - lastTs) / 16.67, 3);
  lastTs = ts;
  frame++;

  // Speed: gentle ramp-up; city streets feel slower
  const target = Math.min(1.5 + (level - 1) * 0.35 + dist * 0.0003, player.maxSpeed);
  player.speed = Math.min(player.speed + 0.03 * dt, target);

  // Level up every 800 m
  const newLv = Math.floor(dist / 800) + 1;
  if (newLv > level) {
    level = newLv;
    lvUpNotif = { text: `NÍVEL ${level}!`, timer: 80 };
  }
  if (lvUpNotif && lvUpNotif.timer > 0) lvUpNotif.timer -= dt;

  // Advance road position
  player.position += player.speed * dt;
  dist = player.position * SEG_SIZE * 0.12;

  // Slide player.posx toward the target lane (smooth transition)
  const targetPosx = -LANES[currentLane] * W;
  const laneSlide  = (targetPosx - player.posx) * 0.18 * dt;
  player.posx += laneSlide;

  // Score from driving
  score += player.speed * dt * 0.25;

  if (invincible  > 0) invincible  -= dt;
  if (shakeTimer  > 0) shakeTimer  -= dt;

  // Update score popups
  for (let i = popups.length - 1; i >= 0; i--) {
    popups[i].y    -= 0.8 * dt;
    popups[i].life -= dt;
    if (popups[i].life <= 0) popups.splice(i, 1);
  }

  fillAhead();
  checkCollisions();

  // Street ticker: show name when player passes a sign
  const playerSeg = Math.floor(player.position / SEG_SIZE);
  for (const obs of obstacles) {
    if (obs.type === 'sign' && !obs.passed && obs.seg - playerSeg < -1) {
      obs.passed = true;
      showStreetName(obs.signText);
    }
  }

  doRender();
  updHUD();
}

// ─── Input ────────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft'  || e.key === 'a') { currentLane = 0; e.preventDefault(); }
  if (e.key === 'ArrowRight' || e.key === 'd') { currentLane = 1; e.preventDefault(); }
});

function setupBtn(id, lane) {
  const b      = document.getElementById(id);
  const press  = () => { currentLane = lane; b.classList.add('on'); };
  const release = () => b.classList.remove('on');
  b.addEventListener('touchstart', e => { e.preventDefault(); press(); },   { passive: false });
  b.addEventListener('touchend',   e => { e.preventDefault(); release(); }, { passive: false });
  b.addEventListener('mousedown',  press);
  b.addEventListener('mouseup',    release);
  b.addEventListener('mouseleave', release);
}
setupBtn('bl', 0); // left lane
setupBtn('br', 1); // right lane

// Swipe on canvas
let tx0 = 0;
C.addEventListener('touchstart', e => { tx0 = e.touches[0].clientX; }, { passive: true });
C.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - tx0;
  if (Math.abs(dx) > 28) currentLane = dx < 0 ? 0 : 1;
}, { passive: true });

// ─── Overlay ──────────────────────────────────────────────────────────────────
function showOver(isOver) {
  const ov   = document.getElementById('ov');
  const h1   = ov.querySelector('h1');
  const sub  = ov.querySelector('.sub');
  const info = ov.querySelector('.info');
  const go   = document.getElementById('go');
  const btn  = document.getElementById('pbtn');

  if (isOver) {
    h1.innerHTML   = 'FIM DE JOGO';
    h1.style.color = '#f44';
    sub.textContent = 'Osório venceu desta vez…';
    info.innerHTML  = `Você rodou <b>${Math.floor(dist)}m</b> pelas ruas de Osório!<br>Nível <b>${level}</b> alcançado`;
    document.getElementById('gpts').textContent = Math.floor(score);
    go.style.display = 'block';
    btn.textContent  = 'TENTAR NOVAMENTE';
  } else {
    h1.innerHTML    = 'DESVIA DO<br>BURACO!';
    h1.style.color  = '#ffdd00';
    sub.textContent = 'Osório / Rio Grande do Sul';
    info.innerHTML  = '<b>◀ ▶</b> para desviar<br>Evite <b>carros</b>, <b>buracos</b> e <b>bikes</b><br>Velocidade aumenta com a distância';
    go.style.display = 'none';
    btn.textContent  = 'INICIAR';
  }
  ov.style.display = 'flex';
}

document.getElementById('pbtn').addEventListener('click', () => {
  document.getElementById('ov').style.display = 'none';
  initGame();
  running = true;
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
generateRoad();
initBg();
initTurbines();
loadSprites(() => {
  running = false;
  initGame();
  doRender(); // preview before game starts
  requestAnimationFrame(ts => { lastTs = ts; requestAnimationFrame(tick); });
});
