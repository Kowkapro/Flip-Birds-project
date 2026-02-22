'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────

const CANVAS_W      = 1280;
const CANVAS_H      = 480;
const GROUND_H      = 60;

const BIRD_X        = 200;
const BIRD_SIZE     = 40;
const HIT_INSET     = 5;

const GRAVITY       = 0.5;
const JUMP_VEL      = -9;

const PIPE_SPEED    = 3;
const PIPE_WIDTH    = 80;
const PIPE_SPACING  = 320;

const GAP_EPOCH1    = 200;
const GAP_EPOCH2    = 150;
const GAP_MARGIN    = 50;

const TOTAL_PIPES   = 50;
const EPOCH_CHANGE  = 30;
const MINISCENE_MS  = 3000;
const COUNTDOWN_MS  = 3000;

// Mute button: circle in top-left corner
const MUTE_BTN = { x: 10, y: 10, r: 20 }; // center at (30, 30)

// ─── Themes ──────────────────────────────────────────────────────────────────

const THEME = {
  1: {
    bg:         '#87CEEB',
    pipe:       '#2d8a2d',
    pipeBorder: '#1a5e1a',
    ground:     '#8B6914',
    groundTop:  '#5a8a00',
    hudColor:   '#ffffff',
    epochLabel: '#ffffff',
  },
  2: {
    bg:         '#0d001a',
    pipe:       '#cc2222',
    pipeBorder: '#880000',
    ground:     '#3a0000',
    groundTop:  '#660000',
    hudColor:   '#ffffff',
    epochLabel: '#ff88ff',
  },
};

// ─── Game state machine ───────────────────────────────────────────────────────

const S = { START: 0, PLAYING: 1, MINISCENE: 2, DEAD: 3, WIN: 4, INTRO: 5, WIN_VIDEO: 6, COUNTDOWN: 7 };

// ─── Game variables ───────────────────────────────────────────────────────────

let canvas, ctx;
let state;
let bird;
let pipes;
let clouds;
let score;
let bestScore;
let totalSpawned;
let miniscenePlayed;
let minisceneStart;
let countdownStart;
let lastTime;

// ─── Asset variables ──────────────────────────────────────────────────────────

let birdImg  = null;        // image/imageGG.png
let girlImgs = new Array(50).fill(null);  // image/girls/1.jpg … 50.jpg

// ─── Audio variables ──────────────────────────────────────────────────────────

let audioCtx   = null;
let isMuted    = false;  // persists across attempts within a session
let deathAudio = null;   // sounds/Звук смерти.MP3

let videoEl       = null;
let skipBtn       = null;
let playIntroNext = true; // intro plays on first start and after WIN
let sofikoVideo   = null; // animated character at pipe 50

const MUSIC_TRACKS = { 1: [], 2: [] };  // 5 Audio per epoch
let currentMusic = null;
let currentEpoch = 0;

// ─── Init ─────────────────────────────────────────────────────────────────────

window.addEventListener('load', () => {
  canvas = document.getElementById('gameCanvas');
  ctx    = canvas.getContext('2d');
  bestScore  = 0;
  deathAudio = new Audio('sounds/Звук смерти.MP3');
  deathAudio.preload = 'auto';

  videoEl = document.getElementById('gameVideo');
  skipBtn  = document.getElementById('skipBtn');
  videoEl.addEventListener('ended', onVideoEnd);
  skipBtn.addEventListener('click',  onVideoEnd);

  sofikoVideo = document.createElement('video');
  sofikoVideo.src      = 'video/hops/Privit Sofiko.mp4';
  sofikoVideo.loop     = true;
  sofikoVideo.muted    = isMuted;
  sofikoVideo.playsInline = true;
  sofikoVideo.preload  = 'auto';

  const trackCount = { 1: 5, 2: 10 };
  for (let ep = 1; ep <= 2; ep++) {
    for (let n = 1; n <= trackCount[ep]; n++) {
      const a = new Audio(`music/epoch${ep}-${n}.mp3`);
      a.preload = 'auto';
      a.volume  = 0.28;
      MUSIC_TRACKS[ep].push(a);
    }
  }

  setupInput();

  // Loading screen while assets load
  ctx.fillStyle = '#0d001a';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 30px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Загрузка...', CANVAS_W / 2, CANVAS_H / 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  loadAssets(() => startGame());
});

function loadAssets(callback) {
  const TOTAL = 51; // 1 bird + 50 girls
  let loaded = 0;

  function onOne() {
    loaded++;
    if (loaded === TOTAL) callback();
  }

  // Bird
  const bi = new Image();
  bi.onload  = () => { birdImg = bi; onOne(); };
  bi.onerror = () => {               onOne(); };
  bi.src = 'image/imageGG.png';

  // Girls 1–50
  for (let i = 1; i <= 50; i++) {
    const gi  = new Image();
    const idx = i - 1;
    gi.onload  = () => { girlImgs[idx] = gi; onOne(); };
    gi.onerror = () => {                      onOne(); };
    gi.src = `image/girls/girls no back/${i}-removebg-preview.png`;
  }
}

function startGame() {
  initClouds();
  resetSession();
  requestAnimationFrame(gameLoop);
}

function initClouds() {
  clouds = [];
  for (let i = 0; i < 8; i++) {
    clouds.push({
      x:     Math.random() * CANVAS_W,
      y:     25 + Math.random() * 160,
      r:     22 + Math.random() * 28,
      speed: 0.38 + Math.random() * 0.42,
    });
  }
}

function resetSession() {
  bird            = { x: BIRD_X, y: CANVAS_H / 2 - BIRD_SIZE / 2, vy: 0 };
  pipes           = [];
  score           = 0;
  totalSpawned    = 0;
  miniscenePlayed = false;
  lastTime        = null;
  state           = S.START;
  if (sofikoVideo) { sofikoVideo.pause(); sofikoVideo.currentTime = 0; }
  // isMuted is intentionally NOT reset — persists between attempts
}

// ─── Audio ────────────────────────────────────────────────────────────────────

function ensureAudio() {
  try {
    if (!audioCtx) {
      const AudioCtx = window.AudioContext || window['webkitAudioContext'];
      audioCtx = new AudioCtx();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (_) { /* audio not available, game continues silently */ }
}

function toggleMute() {
  isMuted = !isMuted;
  if (currentMusic) {
    if (isMuted) currentMusic.pause();
    else currentMusic.play().catch(() => {});
  }
  if (videoEl)     videoEl.muted     = isMuted;
  if (sofikoVideo) sofikoVideo.muted = isMuted;
}

// Helper: play a single tone with frequency ramp
function tone(freq1, freq2, type, startTime, duration, volume) {
  if (!audioCtx) return;
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq1, startTime);
  if (freq2 !== freq1) {
    osc.frequency.exponentialRampToValueAtTime(freq2, startTime + duration);
  }
  gain.gain.setValueAtTime(volume, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.01);
}

function playJump() {
  if (isMuted || !audioCtx) return;
  tone(380, 580, 'sine', audioCtx.currentTime, 0.09, 0.22);
}

function playPass() {
  if (isMuted || !audioCtx) return;
  tone(880, 880, 'sine', audioCtx.currentTime, 0.055, 0.12);
}

function playDeath() {
  if (isMuted || !deathAudio) return;
  deathAudio.currentTime = 0;
  deathAudio.play().catch(() => {});
}

function playEpochChange() {
  if (isMuted || !audioCtx) return;
  const t = audioCtx.currentTime;
  [523, 659, 784].forEach((f, i) => tone(f, f, 'sine', t + i * 0.13, 0.14, 0.18));
}

function playWin() {
  if (isMuted || !audioCtx) return;
  const t = audioCtx.currentTime;
  [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 'sine', t + i * 0.16, 0.18, 0.22));
}

function stopMusic() {
  if (!currentMusic) return;
  currentMusic.onended = null;
  currentMusic.pause();
  currentMusic.currentTime = 0;
  currentMusic = null;
}

function playMusic(epoch) {
  stopMusic();
  currentEpoch = epoch;
  const tracks = MUSIC_TRACKS[epoch];
  const track  = tracks[Math.floor(Math.random() * tracks.length)];
  currentMusic = track;
  currentMusic.currentTime = 0;
  if (!isMuted) currentMusic.play().catch(() => {});
  currentMusic.onended = () => {
    if (state === S.PLAYING) playMusic(epoch);
  };
}

function playVideo(src) {
  stopMusic();
  videoEl.src   = src;
  videoEl.muted = isMuted;
  videoEl.style.display = 'block';
  skipBtn.style.display  = 'block';
  videoEl.play().catch(() => {});
}

function onVideoEnd() {
  videoEl.pause();
  videoEl.src           = '';
  videoEl.style.display = 'none';
  skipBtn.style.display  = 'none';

  if (state === S.INTRO) {
    state = S.COUNTDOWN;
    countdownStart = Date.now();
    playMusic(1);
  } else if (state === S.MINISCENE) {
    state = S.PLAYING;
    playMusic(2);
  } else if (state === S.WIN_VIDEO) {
    state = S.WIN;
  }
}

// ─── Input ────────────────────────────────────────────────────────────────────

function getCanvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (CANVAS_W / rect.width),
    y: (e.clientY - rect.top)  * (CANVAS_H / rect.height),
  };
}

function setupInput() {
  document.addEventListener('keydown', e => {
    if (e.code === 'Space') { e.preventDefault(); ensureAudio(); onInput(); }
  });

  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    ensureAudio();

    // Check mute button hit (with a small tolerance on radius)
    const pos = getCanvasCoords(e);
    const cx  = MUTE_BTN.x + MUTE_BTN.r;
    const cy  = MUTE_BTN.y + MUTE_BTN.r;
    const dx  = pos.x - cx;
    const dy  = pos.y - cy;
    if (Math.sqrt(dx * dx + dy * dy) <= MUTE_BTN.r + 6) {
      toggleMute();
      return; // don't pass click through to game
    }

    onInput();
  }, { passive: false });
}

function onInput() {
  switch (state) {
    case S.START:
      if (playIntroNext) {
        playIntroNext = false;
        state = S.INTRO;
        playVideo('video/1.mp4');
      } else {
        state = S.PLAYING;
        playMusic(1);
      }
      break;
    case S.PLAYING:
      bird.vy = JUMP_VEL;
      playJump();
      break;
    case S.DEAD:
      resetSession();
      break;
    case S.WIN:
      playIntroNext = true;
      resetSession();
      break;
    case S.MINISCENE:
      break; // ignore during mini-scene
  }
}

// ─── Game loop ────────────────────────────────────────────────────────────────

function gameLoop(ts) {
  requestAnimationFrame(gameLoop);
  if (lastTime === null) { lastTime = ts; return; }
  const dt = Math.min((ts - lastTime) / 16.667, 3);
  lastTime = ts;
  update(dt);
  render();
}

// ─── Update ───────────────────────────────────────────────────────────────────

function update(dt) {
  if (state === S.INTRO || state === S.WIN_VIDEO) return;
  if (state === S.MINISCENE) return; // wait for video to end
  if (state === S.COUNTDOWN) {
    if (Date.now() - countdownStart >= COUNTDOWN_MS) state = S.PLAYING;
    return;
  }
  if (state !== S.PLAYING) return;

  // Switch music on epoch change
  const epoch = getEpoch();
  if (epoch !== currentEpoch) playMusic(epoch);

  // Manage Sofiko video: play when pipe 50 is on screen
  const sofikoPipe = pipes.find(p => p.imgIdx === 49);
  if (sofikoPipe && sofikoPipe.x < CANVAS_W && sofikoVideo.readyState >= 2) {
    if (sofikoVideo.paused) { sofikoVideo.muted = isMuted; sofikoVideo.play().catch(() => {}); }
  } else if (!sofikoPipe || sofikoPipe.x >= CANVAS_W) {
    if (!sofikoVideo.paused) sofikoVideo.pause();
  }

  // Move clouds (parallax, epoch 1 only)
  for (const c of clouds) {
    c.x -= c.speed * dt;
    if (c.x + c.r * 5 < 0) {
      c.x = CANVAS_W + c.r * 2;
      c.y = 25 + Math.random() * 160;
    }
  }

  // Bird physics
  bird.vy += GRAVITY * dt;
  bird.y  += bird.vy  * dt;

  // Spawn pipes
  if (totalSpawned < TOTAL_PIPES) {
    const last = pipes[pipes.length - 1];
    if (!last || last.x <= CANVAS_W - PIPE_SPACING) {
      spawnPipe();
    }
  }

  // Move pipes & detect passing
  for (const p of pipes) {
    p.x -= PIPE_SPEED * dt;

    if (!p.passed && p.x + PIPE_WIDTH < bird.x) {
      p.passed = true;
      score++;
      if (score > bestScore) bestScore = score;

      playPass();

      if (score === EPOCH_CHANGE && !miniscenePlayed) {
        miniscenePlayed = true;
        state           = S.MINISCENE;
        playVideo('video/2.mp4');
      } else if (score >= TOTAL_PIPES) {
        state = S.WIN_VIDEO;
        stopMusic();
        if (sofikoVideo) sofikoVideo.pause();
        playWin();
        playVideo('video/3.mp4');
      }
    }
  }

  if (state !== S.PLAYING) return;

  pipes = pipes.filter(p => p.x + PIPE_WIDTH > -10);
  checkCollisions();
}

function spawnPipe() {
  const gapSize = getEpoch() === 1 ? GAP_EPOCH1 : GAP_EPOCH2;
  const maxGapY = CANVAS_H - GROUND_H - gapSize - GAP_MARGIN;
  const gapY    = GAP_MARGIN + Math.random() * (maxGapY - GAP_MARGIN);
  const imgIdx  = totalSpawned; // 0-based → maps to girlImgs[0..49] → 1.jpg..50.jpg
  pipes.push({ x: CANVAS_W + PIPE_WIDTH, gapY, gapSize, passed: false, imgIdx });
  totalSpawned++;
}

function checkCollisions() {
  const bx1 = bird.x + HIT_INSET;
  const bx2 = bird.x + BIRD_SIZE - HIT_INSET;
  const by1 = bird.y + HIT_INSET;
  const by2 = bird.y + BIRD_SIZE - HIT_INSET;

  if (by2 >= CANVAS_H - GROUND_H || by1 <= 0) { die(); return; }

  for (const p of pipes) {
    if (bx2 <= p.x || bx1 >= p.x + PIPE_WIDTH) continue;
    if (by1 < p.gapY || by2 > p.gapY + p.gapSize) { die(); return; }
  }
}

function die() {
  state = S.DEAD;
  stopMusic();
  if (sofikoVideo) sofikoVideo.pause();
  playDeath();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getEpoch() { return score >= EPOCH_CHANGE ? 2 : 1; }
function getTheme() { return THEME[getEpoch()]; }

// ─── Render ───────────────────────────────────────────────────────────────────

function render() {
  const theme = getTheme();
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  switch (state) {
    case S.START:    renderStart(theme); break;
    case S.WIN:      renderWin();        break;
    case S.INTRO:
    case S.WIN_VIDEO:
      break; // video element covers canvas
    default:
      renderGame(theme);
      if (state === S.MINISCENE) renderMiniscene();
      if (state === S.DEAD)      renderDead();
      if (state === S.COUNTDOWN) renderCountdown();
      break;
  }

  renderMuteBtn(); // always on top of everything
}

// ── Game world ───────────────────────────────────────────────────────────────

function renderClouds() {
  ctx.fillStyle = 'rgba(255,255,255,0.84)';
  for (const c of clouds) {
    ctx.beginPath();
    ctx.arc(c.x,             c.y,            c.r,       0, Math.PI * 2);
    ctx.arc(c.x + c.r,       c.y - c.r * 0.4, c.r * 1.1, 0, Math.PI * 2);
    ctx.arc(c.x + c.r * 2.3, c.y,            c.r * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

function renderGame(theme) {
  if (getEpoch() === 2) renderStars();
  if (getEpoch() === 1) renderClouds();

  // Pipes / girls
  for (const p of pipes) {
    const bottomY = p.gapY + p.gapSize;
    const topH    = p.gapY;
    const botH    = CANVAS_H - GROUND_H - bottomY;
    const girl    = girlImgs[p.imgIdx] ?? null;

    if (p.imgIdx === 49 && sofikoVideo && sofikoVideo.readyState >= 2) {
      // Pipe 50 — animated Sofiko video character (screen blend removes black bg)
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.drawImage(sofikoVideo, p.x, bottomY, PIPE_WIDTH, botH);
      ctx.restore();

      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.translate(p.x, p.gapY);
      ctx.scale(1, -1);
      ctx.drawImage(sofikoVideo, 0, 0, PIPE_WIDTH, topH);
      ctx.restore();

    } else if (girl) {
      // Bottom pipe: girl standing normally, feet at ground level
      ctx.drawImage(girl, p.x, bottomY, PIPE_WIDTH, botH);

      // Top pipe: same girl flipped vertically, feet at ceiling (gap edge)
      ctx.save();
      ctx.translate(p.x, p.gapY);
      ctx.scale(1, -1);
      ctx.drawImage(girl, 0, 0, PIPE_WIDTH, topH);
      ctx.restore();

    } else {
      // Fallback: colored rectangles + caps
      ctx.lineWidth   = 3;
      ctx.fillStyle   = theme.pipe;
      ctx.strokeStyle = theme.pipeBorder;
      ctx.fillRect  (p.x, 0,       PIPE_WIDTH, topH);
      ctx.strokeRect(p.x, 0,       PIPE_WIDTH, topH);
      ctx.fillRect  (p.x, bottomY, PIPE_WIDTH, botH);
      ctx.strokeRect(p.x, bottomY, PIPE_WIDTH, botH);

      const capW = PIPE_WIDTH + 10, capH = 14;
      ctx.fillRect  (p.x - 5, topH - capH, capW, capH);
      ctx.strokeRect(p.x - 5, topH - capH, capW, capH);
      ctx.fillRect  (p.x - 5, bottomY,     capW, capH);
      ctx.strokeRect(p.x - 5, bottomY,     capW, capH);
    }
  }

  // Ground
  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, CANVAS_H - GROUND_H, CANVAS_W, GROUND_H);
  ctx.fillStyle = theme.groundTop;
  ctx.fillRect(0, CANVAS_H - GROUND_H, CANVAS_W, 8);

  // Bird — image sprite (drawn slightly larger than hitbox, centered on it)
  const drawSize = 60;
  const drawX    = bird.x + BIRD_SIZE / 2 - drawSize / 2;
  const drawY    = bird.y + BIRD_SIZE / 2 - drawSize / 2;

  if (birdImg) {
    ctx.drawImage(birdImg, drawX, drawY, drawSize, drawSize);
  } else {
    // Fallback: yellow square if image failed to load
    ctx.fillStyle   = '#FFD700';
    ctx.strokeStyle = '#B8860B';
    ctx.lineWidth   = 2;
    ctx.fillRect  (bird.x, bird.y, BIRD_SIZE, BIRD_SIZE);
    ctx.strokeRect(bird.x, bird.y, BIRD_SIZE, BIRD_SIZE);
  }

  // HUD — score (shifted right to make room for mute button)
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle    = 'rgba(0,0,0,0.35)';
  ctx.fillRect(56, 12, 200, bestScore > 0 ? 58 : 36);

  ctx.fillStyle = theme.hudColor;
  ctx.font      = 'bold 24px Arial';
  ctx.fillText(`Труба: ${score} / ${TOTAL_PIPES}`, 64, 16);

  if (bestScore > 0) {
    ctx.font = '16px Arial';
    ctx.fillText(`Рекорд: ${bestScore}`, 64, 46);
  }

  // Epoch badge
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'top';
  ctx.fillStyle    = theme.epochLabel;
  ctx.font         = 'bold 16px Arial';
  ctx.fillText(`Эпоха ${getEpoch()}`, CANVAS_W - 16, 14);
  ctx.textAlign    = 'left';
}

function renderStars() {
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (let i = 0; i < 60; i++) {
    const sx = (i * 137 + 23) % CANVAS_W;
    const sy = (i *  89 + 17) % (CANVAS_H - GROUND_H - 20);
    ctx.fillRect(sx, sy, i % 3 === 0 ? 2 : 1, i % 3 === 0 ? 2 : 1);
  }
}

// ── Mute button ──────────────────────────────────────────────────────────────

function renderMuteBtn() {
  const cx = MUTE_BTN.x + MUTE_BTN.r;
  const cy = MUTE_BTN.y + MUTE_BTN.r;
  const r  = MUTE_BTN.r;
  const s  = r * 0.48; // icon scale

  // Background circle
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Border
  ctx.strokeStyle = isMuted ? '#ff5555' : 'rgba(255,255,255,0.35)';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // Speaker body (filled polygon)
  const iconColor = isMuted ? '#ff9999' : '#ffffff';
  ctx.fillStyle = iconColor;
  ctx.beginPath();
  ctx.moveTo(cx - s,        cy - s * 0.38);
  ctx.lineTo(cx - s * 0.28, cy - s * 0.38);
  ctx.lineTo(cx + s * 0.28, cy - s);
  ctx.lineTo(cx + s * 0.28, cy + s);
  ctx.lineTo(cx - s * 0.28, cy + s * 0.38);
  ctx.lineTo(cx - s,        cy + s * 0.38);
  ctx.closePath();
  ctx.fill();

  if (!isMuted) {
    // Sound waves
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.arc(cx + s * 0.28, cy, s * 0.6, -Math.PI / 3, Math.PI / 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + s * 0.28, cy, s * 1.1, -Math.PI / 3, Math.PI / 3);
    ctx.stroke();
  } else {
    // Red X — muted
    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.5,  cy - s * 0.9);
    ctx.lineTo(cx + s * 1.3,  cy + s * 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + s * 1.3,  cy - s * 0.9);
    ctx.lineTo(cx + s * 0.5,  cy + s * 0.5);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
}

// ── Screens ──────────────────────────────────────────────────────────────────

function renderStart(theme) {
  // Decorative background
  ctx.fillStyle   = theme.pipe;
  ctx.strokeStyle = theme.pipeBorder;
  ctx.lineWidth   = 3;
  [[400, 0, 80, 140], [400, 280, 80, 200], [800, 0, 80, 100], [800, 300, 80, 180]].forEach(([x, y, w, h]) => {
    ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
  });
  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, CANVAS_H - GROUND_H, CANVAS_W, GROUND_H);
  ctx.fillStyle = theme.groundTop;
  ctx.fillRect(0, CANVAS_H - GROUND_H, CANVAS_W, 8);

  renderClouds();

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#FFD700';
  ctx.font      = 'bold 76px Arial';
  ctx.fillText('FLIP-BIRDS', CANVAS_W / 2, CANVAS_H / 2 - 80);

  ctx.fillStyle = '#ffccaa';
  ctx.font      = '22px Arial';
  ctx.fillText('История мальчика-птицы в поисках любви', CANVAS_W / 2, CANVAS_H / 2 - 30);

  ctx.fillStyle = '#ffffff';
  ctx.font      = 'bold 28px Arial';
  ctx.fillText('Нажми Space, кликни или тапни чтобы начать', CANVAS_W / 2, CANVAS_H / 2 + 30);

  ctx.fillStyle = '#aaaaaa';
  ctx.font      = '18px Arial';
  ctx.fillText('Space / Клик / Тап — взлёт', CANVAS_W / 2, CANVAS_H / 2 + 68);

  if (bestScore > 0) {
    ctx.fillStyle = '#FFD700';
    ctx.font      = 'bold 20px Arial';
    ctx.fillText(`Рекорд сессии: ${bestScore}`, CANVAS_W / 2, CANVAS_H / 2 + 110);
  }

  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';
}

function renderMiniscene() {
  ctx.fillStyle = 'rgba(0,0,0,0.68)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#ffccff';
  ctx.font      = 'bold 40px Arial';
  ctx.fillText('Кто эта прекрасная девушка?', CANVAS_W / 2, CANVAS_H / 2 - 44);

  ctx.fillStyle = '#dddddd';
  ctx.font      = '24px Arial';
  ctx.fillText('Она исчезла так быстро...', CANVAS_W / 2, CANVAS_H / 2 + 4);

  ctx.fillStyle = '#999999';
  ctx.font      = 'italic 18px Arial';
  ctx.fillText('Лети дальше. Может встретишь снова.', CANVAS_W / 2, CANVAS_H / 2 + 38);

  // Progress bar
  const progress = Math.min((Date.now() - minisceneStart) / MINISCENE_MS, 1);
  const bw = 260, bx = CANVAS_W / 2 - 130, by = CANVAS_H / 2 + 75;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(bx, by, bw, 6);
  ctx.fillStyle = '#ffccff';
  ctx.fillRect(bx, by, bw * progress, 6);

  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';
}

function renderCountdown() {
  const progress = Math.min((Date.now() - countdownStart) / COUNTDOWN_MS, 1);
  const bw = 420, bh = 7;
  const bx = CANVAS_W / 2 - bw / 2;
  const by = CANVAS_H / 2 + 30;

  ctx.fillStyle = 'rgba(0,0,0,0.52)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font      = 'bold 50px Arial';
  ctx.fillText('Приготовься', CANVAS_W / 2, CANVAS_H / 2 - 16);

  // Track (background)
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(bx, by, bw, bh);

  // Blue fill
  ctx.fillStyle = '#4fc3f7';
  ctx.fillRect(bx, by, bw * progress, bh);

  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';
}

function renderDead() {
  ctx.fillStyle = 'rgba(0,0,0,0.68)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#ff4444';
  ctx.font      = 'bold 58px Arial';
  ctx.fillText('Это РПУ', CANVAS_W / 2, CANVAS_H / 2 - 70);

  ctx.fillStyle = '#ffffff';
  ctx.font      = '32px Arial';
  ctx.fillText(`Пройдено труб: ${score}`, CANVAS_W / 2, CANVAS_H / 2 - 10);

  ctx.fillStyle = '#FFD700';
  ctx.font      = 'bold 24px Arial';
  ctx.fillText(`Рекорд: ${bestScore}`, CANVAS_W / 2, CANVAS_H / 2 + 34);

  ctx.fillStyle = '#cccccc';
  ctx.font      = '22px Arial';
  ctx.fillText('Space / Клик — попробовать снова', CANVAS_W / 2, CANVAS_H / 2 + 85);

  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';
}

function renderWin() {
  ctx.fillStyle = '#0d001a';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  renderStars();

  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#FFD700';
  ctx.font      = 'bold 66px Arial';
  ctx.fillText('ТЫ ПРОШЁЛ!', CANVAS_W / 2, CANVAS_H / 2 - 80);

  ctx.fillStyle = '#ffccff';
  ctx.font      = '28px Arial';
  ctx.fillText('50 труб позади. Она ждёт тебя...', CANVAS_W / 2, CANVAS_H / 2 - 20);

  ctx.fillStyle = '#ffffff';
  ctx.font      = '22px Arial';
  ctx.fillText(`Рекорд: ${bestScore}`, CANVAS_W / 2, CANVAS_H / 2 + 24);

  ctx.fillStyle = '#aaaaaa';
  ctx.font      = '20px Arial';
  ctx.fillText('Space / Клик — сыграть снова', CANVAS_W / 2, CANVAS_H / 2 + 72);

  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';
}
