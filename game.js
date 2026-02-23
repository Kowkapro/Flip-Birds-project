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
const MINISCENE_MS  = 5000; // text pause after pipe-30 video
const COUNTDOWN_MS  = 3000;

const STORY_CHARS_PER_SEC = 35;
const STORY_TEXT = 'Это история о парне, который прошёл долгий путь: получил звание юриста, отдал долг Родине, преодолел немало испытаний и добился успеха. Теперь, когда жизнь наконец-то вошла в ритм, перед ним стоит новое, самое трудное испытание — найти ту самую. Но, как всегда, всё оказывается не так просто...';

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

const S = { START: 0, PLAYING: 1, MINISCENE: 2, DEAD: 3, WIN: 4, INTRO: 5, WIN_VIDEO: 6, COUNTDOWN: 7, MINISCENE_TEXT: 8, STORY: 9, ENDING: 10 };

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
let endingStart;
let nearMissFlash;
let cheatMode = false;
let lastTime;

let storyLines      = null;
let storyFullText   = '';
let storyChars      = 0;
let storyStart      = 0;
let storyTypingDone = false;
let storyStars      = [];

// ─── Asset variables ──────────────────────────────────────────────────────────

let birdImg  = null;        // image/imageGG.png
let dieImg   = null;        // image/die.png
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
  ctx.font = 'bold 30px "BelweC AG"';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Загрузка...', CANVAS_W / 2, CANVAS_H / 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // Wait for Obelix Pro to load before starting (ensures correct canvas text rendering)
  document.fonts.load('bold 30px "BelweC AG"').catch(() => {}).then(() => {
    loadAssets(() => startGame());
  });
});

function loadAssets(callback) {
  const TOTAL = 52; // 1 bird + 1 die + 50 girls
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

  // Die image
  const di = new Image();
  di.onload  = () => { dieImg = di; onOne(); };
  di.onerror = () => {               onOne(); };
  di.src = 'image/die.png';

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
  bird            = { x: BIRD_X, y: CANVAS_H / 2 - BIRD_SIZE / 2, vy: 0, angle: 0, jumpStretch: 0 };
  pipes           = [];
  score           = 0;
  totalSpawned    = 0;
  nearMissFlash   = 0;
  cheatMode       = false;
  miniscenePlayed = false;
  lastTime        = null;
  state           = S.START;
  if (sofikoVideo) { sofikoVideo.pause(); sofikoVideo.currentTime = 0; }
  // isMuted is intentionally NOT reset — persists between attempts
}

function initStoryStars() {
  storyStars = [];
  for (let i = 0; i < 200; i++) {
    storyStars.push({
      x:     Math.random() * CANVAS_W,
      y:     Math.random() * CANVAS_H,
      r:     Math.random() * 1.5 + 0.4,
      phase: Math.random() * Math.PI * 2,
    });
  }
}

function initStory() {
  storyChars      = 0;
  storyTypingDone = false;
  storyStart      = Date.now();
  storyLines      = null; // recomputed in renderStory
  storyFullText   = '';
  skipBtn.style.display = 'none';
  if (storyStars.length === 0) initStoryStars();
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

function playVideo(src, vol = 1) {
  stopMusic();
  videoEl.src    = src;
  videoEl.volume = vol;
  videoEl.muted  = isMuted;
  videoEl.style.display = 'block';
  skipBtn.style.display  = 'block';
  videoEl.play().catch(() => {});
}

function onVideoEnd() {
  // Story screen skip (skip button also routes here via click listener)
  if (state === S.STORY) {
    skipBtn.style.display = 'none';
    state = S.INTRO;
    playVideo('video/1.mp4');
    return;
  }

  videoEl.pause();
  videoEl.src           = '';
  videoEl.style.display = 'none';
  skipBtn.style.display  = 'none';

  if (state === S.INTRO) {
    state = S.COUNTDOWN;
    countdownStart = Date.now();
    playMusic(1);
  } else if (state === S.MINISCENE) {
    // Video done — show text screen for 5 s before resuming play
    minisceneStart = Date.now();
    state = S.MINISCENE_TEXT;
    playMusic(2);
  } else if (state === S.WIN_VIDEO) {
    endingStart = Date.now();
    state = S.ENDING;
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
    if (e.key === 'F9') { e.preventDefault(); if (state === S.PLAYING) cheatMode = !cheatMode; }
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
        state = S.STORY;
        initStory();
      } else {
        state = S.PLAYING;
        playMusic(1);
      }
      break;
    case S.STORY:
      if (storyTypingDone) {
        skipBtn.style.display = 'none';
        state = S.INTRO;
        playVideo('video/1.mp4');
      }
      break;
    case S.PLAYING:
      bird.vy = JUMP_VEL;
      bird.jumpStretch = 1;
      playJump();
      break;
    case S.DEAD:
      resetSession();
      break;
    case S.ENDING:
      state = S.WIN;
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
  if (state === S.STORY) return;
  if (state === S.ENDING) return;
  if (state === S.MINISCENE) return; // wait for video to end
  if (state === S.MINISCENE_TEXT) {
    if (Date.now() - minisceneStart >= MINISCENE_MS) state = S.PLAYING;
    return;
  }
  if (state === S.COUNTDOWN) {
    if (Date.now() - countdownStart >= COUNTDOWN_MS) state = S.PLAYING;
    return;
  }
  if (state === S.DEAD) {
    // Continue bird physics for death spin animation
    bird.vy    += GRAVITY * dt;
    bird.y     += bird.vy  * dt;
    bird.angle += 0.12 * dt;
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
  if (cheatMode) {
    const nextPipe = pipes.find(p => !p.passed && p.x + PIPE_WIDTH > bird.x);
    const targetCy = nextPipe ? nextPipe.gapY + nextPipe.gapSize / 2 : CANVAS_H / 2;
    const currentCy = bird.y + BIRD_SIZE / 2;
    bird.vy = Math.max(-9, Math.min(9, (targetCy - currentCy) * 0.28));
    bird.y += bird.vy * dt;
  } else {
    bird.vy += GRAVITY * dt;
    bird.y  += bird.vy * dt;
  }
  bird.jumpStretch  = Math.max(0, bird.jumpStretch - 0.07 * dt);
  nearMissFlash     = Math.max(0, nearMissFlash - 0.04 * dt);

  // Spawn pipes
  if (totalSpawned < TOTAL_PIPES) {
    const last = pipes[pipes.length - 1];
    if (!last || last.x <= CANVAS_W - PIPE_SPACING) {
      spawnPipe();
    }
  }

  // Move pipes & detect passing
  for (const p of pipes) {
    p.x -= getPipeSpeed() * dt;

    if (!p.passed && p.x + PIPE_WIDTH < bird.x) {
      p.passed = true;
      score++;
      if (score > bestScore) bestScore = score;

      playPass();

      // Near-miss: glow if bird barely cleared the gap
      const by1 = bird.y + HIT_INSET;
      const by2 = bird.y + BIRD_SIZE - HIT_INSET;
      if (Math.min(by1 - p.gapY, (p.gapY + p.gapSize) - by2) < 25) {
        nearMissFlash = 1;
      }

      if (score === EPOCH_CHANGE && !miniscenePlayed) {
        miniscenePlayed = true;
        state           = S.MINISCENE;
        playVideo('video/2.mp4');
      } else if (score >= TOTAL_PIPES) {
        state = S.WIN_VIDEO;
        stopMusic();
        if (sofikoVideo) sofikoVideo.pause();
        playWin();
        playVideo('video/3.mp4', 0.5);
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
  bird.angle = Math.max(-0.4, Math.min(0.4, bird.vy * 0.035));
  state = S.DEAD;
  stopMusic();
  if (sofikoVideo) sofikoVideo.pause();
  playDeath();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getEpoch()     { return score >= EPOCH_CHANGE ? 2 : 1; }
function getTheme()     { return THEME[getEpoch()]; }
function getPipeSpeed() { return PIPE_SPEED + score * 0.01; }

// ─── Render ───────────────────────────────────────────────────────────────────

function render() {
  const theme = getTheme();
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  switch (state) {
    case S.START:    renderStart(theme); break;
    case S.STORY:    renderStory();      break;
    case S.ENDING:   renderEnding();     break;
    case S.WIN:      renderWin();        break;
    case S.INTRO:
    case S.WIN_VIDEO:
      break; // video element covers canvas
    default:
      renderGame(theme);
      if (state === S.MINISCENE || state === S.MINISCENE_TEXT) renderMiniscene();
      if (state === S.DEAD)      renderDead();
      if (state === S.COUNTDOWN) renderCountdown();
      break;
  }

  renderMuteBtn(); // always on top of everything
}

// ── Bird sprite ──────────────────────────────────────────────────────────────

function renderBirdSprite() {
  const drawSize = 60;
  const cx = bird.x + BIRD_SIZE / 2;
  const cy = bird.y + BIRD_SIZE / 2;

  // Alive: gentle pitch tilt by velocity; Dead: accumulated spin
  const angle = (state === S.DEAD)
    ? bird.angle
    : Math.max(-0.4, Math.min(0.4, bird.vy * 0.035));

  // Squash/stretch only while alive
  const sx = (state !== S.DEAD) ? (1 - 0.15 * bird.jumpStretch) : 1;
  const sy = (state !== S.DEAD) ? (1 + 0.25 * bird.jumpStretch) : 1;

  const img = (state === S.DEAD && dieImg) ? dieImg : birdImg;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.scale(sx, sy);
  if (img) {
    ctx.drawImage(img, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
  } else {
    ctx.fillStyle   = '#FFD700';
    ctx.strokeStyle = '#B8860B';
    ctx.lineWidth   = 2;
    ctx.fillRect  (-BIRD_SIZE / 2, -BIRD_SIZE / 2, BIRD_SIZE, BIRD_SIZE);
    ctx.strokeRect(-BIRD_SIZE / 2, -BIRD_SIZE / 2, BIRD_SIZE, BIRD_SIZE);
  }
  ctx.restore();

  // Near-miss glow
  if (nearMissFlash > 0) {
    ctx.save();
    ctx.globalAlpha = nearMissFlash * 0.55;
    ctx.fillStyle   = '#ffffa0';
    ctx.beginPath();
    ctx.arc(cx, cy, drawSize * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
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
      // Pipe 50 — animated Sofiko video (ctx.restore() always called so blend/transform don't leak)
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      try { ctx.drawImage(sofikoVideo, p.x, bottomY, PIPE_WIDTH, botH); } catch (_) {}
      ctx.restore();

      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.translate(p.x, p.gapY);
      ctx.scale(1, -1);
      try { ctx.drawImage(sofikoVideo, 0, 0, PIPE_WIDTH, topH); } catch (_) {}
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

  // Bird — skipped when dead (renderDead draws it on top of the overlay)
  if (state !== S.DEAD) {
    renderBirdSprite();
  }

  // HUD — score (shifted right to make room for mute button)
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle    = 'rgba(0,0,0,0.35)';
  ctx.fillRect(56, 12, 200, bestScore > 0 ? 58 : 36);

  ctx.fillStyle = theme.hudColor;
  ctx.font      = 'bold 24px "BelweC AG"';
  ctx.fillText(`Труба: ${score} / ${TOTAL_PIPES}`, 64, 16);

  if (bestScore > 0) {
    ctx.font = '16px "BelweC AG"';
    ctx.fillText(`Рекорд: ${bestScore}`, 64, 46);
  }

  // Cheat mode indicator
  if (cheatMode) {
    ctx.fillStyle = 'rgba(255,220,0,0.18)';
    ctx.fillRect(56, 76, 94, 26);
    ctx.fillStyle = '#FFD700';
    ctx.font      = 'bold 16px "BelweC AG"';
    ctx.fillText('⚡ АВТО', 64, 94);
  }

  // Epoch badge
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'top';
  ctx.fillStyle    = theme.epochLabel;
  ctx.font         = 'bold 16px "BelweC AG"';
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

  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2;

  // Helper: draw ════ ◆ ════ separator
  function drawSep(y, armW) {
    const gap = 16;
    ctx.strokeStyle = 'rgba(201,162,39,0.75)';
    ctx.lineWidth   = 1.5;
    ctx.beginPath(); ctx.moveTo(cx - gap - armW, y); ctx.lineTo(cx - gap, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + gap, y);         ctx.lineTo(cx + gap + armW, y); ctx.stroke();
    ctx.fillStyle = '#c9a227';
    ctx.save(); ctx.translate(cx, y); ctx.rotate(Math.PI / 4); ctx.fillRect(-5, -5, 10, 10); ctx.restore();
  }

  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  // ── Top separator ────────────────────────────────────────
  drawSep(cy - 110, 200);

  // ── Title "FLIP BOYS" (two-color glow) ───────────────────
  ctx.font = 'bold 84px "BelweC AG"';
  ctx.textAlign = 'left';

  const part1  = 'Flip ';
  const part2  = 'Boy';
  const totalW = ctx.measureText(part1 + part2).width;
  const p1w    = ctx.measureText(part1).width;
  const titleX = cx - totalW / 2;
  const titleY = cy - 68;

  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  ctx.shadowColor = '#FFD700';
  ctx.shadowBlur  = 28;
  ctx.fillStyle   = '#FFD700';
  ctx.fillText(part1, titleX, titleY);

  ctx.shadowColor = '#ff70c4';
  ctx.shadowBlur  = 28;
  ctx.fillStyle   = '#ff70c4';
  ctx.fillText(part2, titleX + p1w, titleY);

  ctx.shadowBlur  = 0;
  ctx.shadowColor = 'transparent';

  // ── Separator below title ────────────────────────────────
  drawSep(cy - 28, 150);

  // ── Subtitle ─────────────────────────────────────────────
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffccaa';
  ctx.font      = '22px "BelweC AG"';
  ctx.fillText('История мальчика-птицы в поисках любви', cx, cy - 6);

  // ── Thin divider before instructions ─────────────────────
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 260, cy + 18);
  ctx.lineTo(cx + 260, cy + 18);
  ctx.stroke();

  // ── Instructions ─────────────────────────────────────────
  ctx.fillStyle = '#ffffff';
  ctx.font      = 'bold 28px "BelweC AG"';
  ctx.fillText('Нажми Space, кликни или тапни чтобы начать', cx, cy + 42);

  ctx.fillStyle = '#aaaaaa';
  ctx.font      = '18px "BelweC AG"';
  ctx.fillText('Space / Клик / Тап — взлёт', cx, cy + 78);

  if (bestScore > 0) {
    ctx.fillStyle = '#FFD700';
    ctx.font      = 'bold 20px "BelweC AG"';
    ctx.fillText(`Рекорд сессии: ${bestScore}`, cx, cy + 114);
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
  ctx.font      = 'bold 40px "BelweC AG"';
  ctx.fillText('Кто эта прекрасная девушка?', CANVAS_W / 2, CANVAS_H / 2 - 44);

  ctx.fillStyle = '#dddddd';
  ctx.font      = '24px "BelweC AG"';
  ctx.fillText('Она исчезла так быстро...', CANVAS_W / 2, CANVAS_H / 2 + 4);

  ctx.fillStyle = '#999999';
  ctx.font      = 'italic 18px "BelweC AG"';
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
  ctx.font      = 'bold 50px "BelweC AG"';
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

  // Bird (die.png, spinning) visible on top of the overlay
  renderBirdSprite();

  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#ff4444';
  ctx.font      = 'bold 58px "BelweC AG"';
  ctx.fillText('Это РПУ', CANVAS_W / 2, CANVAS_H / 2 - 70);

  ctx.fillStyle = '#ffffff';
  ctx.font      = '32px "BelweC AG"';
  ctx.fillText(`Пройдено труб: ${score}`, CANVAS_W / 2, CANVAS_H / 2 - 10);

  ctx.fillStyle = '#FFD700';
  ctx.font      = 'bold 24px "BelweC AG"';
  ctx.fillText(`Рекорд: ${bestScore}`, CANVAS_W / 2, CANVAS_H / 2 + 34);

  ctx.fillStyle = '#cccccc';
  ctx.font      = '22px "BelweC AG"';
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
  ctx.font      = 'bold 66px "BelweC AG"';
  ctx.fillText('ТЫ ПРОШЁЛ!', CANVAS_W / 2, CANVAS_H / 2 - 80);

  ctx.fillStyle = '#ffccff';
  ctx.font      = '28px "BelweC AG"';
  ctx.fillText('50 труб позади. Она ждёт тебя...', CANVAS_W / 2, CANVAS_H / 2 - 20);

  ctx.fillStyle = '#ffffff';
  ctx.font      = '22px "BelweC AG"';
  ctx.fillText(`Рекорд: ${bestScore}`, CANVAS_W / 2, CANVAS_H / 2 + 24);

  ctx.fillStyle = '#aaaaaa';
  ctx.font      = '20px "BelweC AG"';
  ctx.fillText('Space / Клик — сыграть снова', CANVAS_W / 2, CANVAS_H / 2 + 72);

  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';
}

// ── Story screen ──────────────────────────────────────────────────────────────

function renderStory() {
  const now = Date.now();

  // ── Deep-space background ─────────────────────────────────────────────────
  ctx.fillStyle = '#030612';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Twinkling stars
  const t = now * 0.001;
  for (const star of storyStars) {
    const alpha = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 1.3 + star.phase));
    ctx.globalAlpha = alpha;
    ctx.fillStyle   = '#ffffff';
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Nebula colour washes
  const g1 = ctx.createRadialGradient(350, 180, 0, 350, 180, 380);
  g1.addColorStop(0, 'rgba(90,20,150,0.22)');
  g1.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const g2 = ctx.createRadialGradient(980, 320, 0, 980, 320, 300);
  g2.addColorStop(0, 'rgba(20,60,140,0.18)');
  g2.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // ── Text panel ────────────────────────────────────────────────────────────
  const panelW = 880;
  const panelH = 230;
  const panelX = (CANVAS_W - panelW) / 2;
  const panelY = CANVAS_H / 2 - panelH / 2 - 10;

  ctx.fillStyle = 'rgba(4,8,32,0.75)';
  ctx.beginPath();
  ctx.roundRect(panelX, panelY, panelW, panelH, 14);
  ctx.fill();

  ctx.strokeStyle = 'rgba(130,80,220,0.5)';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.roundRect(panelX, panelY, panelW, panelH, 14);
  ctx.stroke();

  // ── "История" header ──────────────────────────────────────────────────────
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.font         = 'bold 20px "BelweC AG"';
  ctx.fillStyle    = 'rgba(180,140,255,0.9)';
  ctx.shadowColor  = 'rgba(150,100,255,0.8)';
  ctx.shadowBlur   = 10;
  ctx.fillText('История', CANVAS_W / 2, panelY + 24);
  ctx.shadowBlur   = 0;
  ctx.shadowColor  = 'transparent';

  // Thin separator
  ctx.strokeStyle = 'rgba(130,80,220,0.4)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(panelX + 60, panelY + 42);
  ctx.lineTo(panelX + panelW - 60, panelY + 42);
  ctx.stroke();

  // ── Typewriter text ───────────────────────────────────────────────────────
  const storyFont = '21px "BelweC AG"';
  const maxTextW  = panelW - 80;

  // Pre-compute word-wrapped lines once
  if (!storyLines) {
    ctx.font = storyFont;
    const words    = STORY_TEXT.split(' ');
    const computed = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxTextW && line) {
        computed.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) computed.push(line);
    storyLines    = computed;
    storyFullText = storyLines.join('\n'); // '\n' marks line breaks for char counting
  }

  // Advance typewriter counter
  const elapsed = now - storyStart;
  storyChars = Math.min(Math.floor(elapsed / 1000 * STORY_CHARS_PER_SEC), storyFullText.length);
  if (storyChars >= storyFullText.length && !storyTypingDone) {
    storyTypingDone = true;
    skipBtn.style.display = 'block';
  }

  // Render revealed text line by line
  ctx.font         = storyFont;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle    = '#ddd8f0';

  const lineH  = 35;
  const textX  = panelX + 40;
  const textY  = panelY + 56;

  const visible      = storyFullText.slice(0, storyChars);
  const visibleLines = visible.split('\n');
  for (let i = 0; i < visibleLines.length; i++) {
    ctx.fillText(visibleLines[i], textX, textY + i * lineH);
  }

  // Blinking cursor (while typing is in progress)
  if (!storyTypingDone && Math.floor(now / 500) % 2 === 0) {
    const lastLine = visibleLines[visibleLines.length - 1];
    const li       = visibleLines.length - 1;
    ctx.font       = storyFont;
    const cursorX  = textX + ctx.measureText(lastLine).width + 3;
    const cursorY  = textY + li * lineH + 3;
    ctx.fillStyle  = 'rgba(200,180,255,0.9)';
    ctx.fillRect(cursorX, cursorY, 2, 21);
  }

  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';
}

// ── Ending screen ─────────────────────────────────────────────────────────────

const ENDING_TEXT = 'После всех испытаний, промахов и падений он наконец поймал не только удачу, но и любовь. Больше никаких гонок за успехом — лишь прогулки под звёздами, смех и простые моменты настоящего счастья. И впереди их ждал рассвет — начало новой истории. Полной любви заботы и прiвiтов софiйко це я зайчik Джудi Хопс из Зоотрополiса)';

function renderEnding() {
  const now     = Date.now();
  const elapsed = now - endingStart;

  // ── Warm night-sky background ─────────────────────────────────────────────
  ctx.fillStyle = '#080312';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Warm twinkling stars (reuse storyStars; generate if needed)
  if (storyStars.length === 0) initStoryStars();
  const t = now * 0.0008;
  for (const star of storyStars) {
    const alpha = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * 1.1 + star.phase));
    ctx.globalAlpha = alpha * 0.85;
    ctx.fillStyle   = star.r > 1.2 ? '#ffe8d0' : '#ffffff'; // warm tint for bigger stars
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Rose-pink nebula wash (centre)
  const g1 = ctx.createRadialGradient(CANVAS_W * 0.5, CANVAS_H * 0.4, 0, CANVAS_W * 0.5, CANVAS_H * 0.4, 480);
  g1.addColorStop(0, 'rgba(190,60,110,0.15)');
  g1.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Warm golden glow at the bottom (dawn)
  const g2 = ctx.createLinearGradient(0, CANVAS_H * 0.55, 0, CANVAS_H);
  g2.addColorStop(0, 'rgba(0,0,0,0)');
  g2.addColorStop(1, 'rgba(140,60,40,0.28)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // ── Text panel (fades in over 1.5 s) ─────────────────────────────────────
  const fadeAlpha = Math.min(elapsed / 1500, 1);
  ctx.globalAlpha = fadeAlpha;

  const panelW = 880;
  const panelH = 270;
  const panelX = (CANVAS_W - panelW) / 2;
  const panelY = CANVAS_H / 2 - panelH / 2 - 8;

  ctx.fillStyle = 'rgba(6,3,18,0.72)';
  ctx.beginPath();
  ctx.roundRect(panelX, panelY, panelW, panelH, 14);
  ctx.fill();

  ctx.strokeStyle = 'rgba(210,130,160,0.45)';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.roundRect(panelX, panelY, panelW, panelH, 14);
  ctx.stroke();

  // Decorative top ornament: ── ♡ ──
  const mx = CANVAS_W / 2;
  ctx.strokeStyle = 'rgba(200,120,150,0.5)';
  ctx.lineWidth   = 1;
  ctx.beginPath(); ctx.moveTo(mx - 80, panelY + 26); ctx.lineTo(mx - 14, panelY + 26); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(mx + 14, panelY + 26); ctx.lineTo(mx + 80, panelY + 26); ctx.stroke();
  ctx.fillStyle = 'rgba(230,150,170,0.85)';
  ctx.font      = '16px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('♡', mx, panelY + 26);

  // ── Word-wrapped text ─────────────────────────────────────────────────────
  const endingFont = '21px "BelweC AG"';
  const maxTextW   = panelW - 80;
  ctx.font         = endingFont;

  const words    = ENDING_TEXT.split(' ');
  const lines    = [];
  let   line     = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxTextW && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);

  const lineH  = 35;
  const totalH = lines.length * lineH;
  const textY  = panelY + (panelH - totalH) / 2 + 8;

  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle    = '#f0e8f8';
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], CANVAS_W / 2, textY + i * lineH);
  }

  // ── "Continue" hint (appears after 2 s, pulses) ───────────────────────────
  if (elapsed > 2000) {
    const pulse = 0.55 + 0.45 * Math.sin(now * 0.0028);
    ctx.globalAlpha = fadeAlpha * pulse;
    ctx.fillStyle   = 'rgba(220,190,210,0.75)';
    ctx.font        = '18px "BelweC AG"';
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Space / Клик — продолжить', CANVAS_W / 2, panelY + panelH - 18);
  }

  ctx.globalAlpha  = 1;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';
}
