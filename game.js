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

const S = { START: 0, PLAYING: 1, MINISCENE: 2, DEAD: 3, WIN: 4 };

// ─── Game variables ───────────────────────────────────────────────────────────

let canvas, ctx;
let state;
let bird;
let pipes;
let score;
let bestScore;
let totalSpawned;
let miniscenePlayed;
let minisceneStart;
let lastTime;

// ─── Audio variables ──────────────────────────────────────────────────────────

let audioCtx = null;
let isMuted  = false;  // persists across attempts within a session

// ─── Init ─────────────────────────────────────────────────────────────────────

window.addEventListener('load', () => {
  canvas = document.getElementById('gameCanvas');
  ctx    = canvas.getContext('2d');
  bestScore = 0;
  setupInput();
  resetSession();
  requestAnimationFrame(gameLoop);
});

function resetSession() {
  bird            = { x: BIRD_X, y: CANVAS_H / 2 - BIRD_SIZE / 2, vy: 0 };
  pipes           = [];
  score           = 0;
  totalSpawned    = 0;
  miniscenePlayed = false;
  lastTime        = null;
  state           = S.START;
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
  if (isMuted || !audioCtx) return;
  const t = audioCtx.currentTime;
  tone(280, 45, 'sawtooth', t,        0.28, 0.35);
  tone(200, 30, 'square',   t + 0.05, 0.22, 0.15);
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
      state = S.PLAYING;
      break;
    case S.PLAYING:
      bird.vy = JUMP_VEL;
      playJump();
      break;
    case S.DEAD:
    case S.WIN:
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
  if (state === S.MINISCENE) {
    if (Date.now() - minisceneStart >= MINISCENE_MS) state = S.PLAYING;
    return;
  }
  if (state !== S.PLAYING) return;

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
        minisceneStart  = Date.now();
        state           = S.MINISCENE;
        playEpochChange();
      } else if (score >= TOTAL_PIPES) {
        state = S.WIN;
        playWin();
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
  pipes.push({ x: CANVAS_W + PIPE_WIDTH, gapY, gapSize, passed: false });
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
    case S.START: renderStart(theme); break;
    case S.WIN:   renderWin();        break;
    default:
      renderGame(theme);
      if (state === S.MINISCENE) renderMiniscene();
      if (state === S.DEAD)      renderDead();
      break;
  }

  renderMuteBtn(); // always on top of everything
}

// ── Game world ───────────────────────────────────────────────────────────────

function renderGame(theme) {
  if (getEpoch() === 2) renderStars();

  // Pipes
  ctx.lineWidth = 3;
  for (const p of pipes) {
    const bottomY = p.gapY + p.gapSize;
    const topH    = p.gapY;
    const botH    = CANVAS_H - GROUND_H - bottomY;

    ctx.fillStyle   = theme.pipe;
    ctx.strokeStyle = theme.pipeBorder;

    ctx.fillRect  (p.x, 0,       PIPE_WIDTH, topH);
    ctx.strokeRect(p.x, 0,       PIPE_WIDTH, topH);
    ctx.fillRect  (p.x, bottomY, PIPE_WIDTH, botH);
    ctx.strokeRect(p.x, bottomY, PIPE_WIDTH, botH);

    // Caps at gap edge
    const capW = PIPE_WIDTH + 10;
    const capH = 14;
    ctx.fillRect  (p.x - 5, topH - capH, capW, capH);
    ctx.strokeRect(p.x - 5, topH - capH, capW, capH);
    ctx.fillRect  (p.x - 5, bottomY,     capW, capH);
    ctx.strokeRect(p.x - 5, bottomY,     capW, capH);
  }

  // Ground
  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, CANVAS_H - GROUND_H, CANVAS_W, GROUND_H);
  ctx.fillStyle = theme.groundTop;
  ctx.fillRect(0, CANVAS_H - GROUND_H, CANVAS_W, 8);

  // Bird body
  ctx.fillStyle   = '#FFD700';
  ctx.strokeStyle = '#B8860B';
  ctx.lineWidth   = 2;
  ctx.fillRect  (bird.x, bird.y, BIRD_SIZE, BIRD_SIZE);
  ctx.strokeRect(bird.x, bird.y, BIRD_SIZE, BIRD_SIZE);

  // Beak
  ctx.fillStyle = '#FF8C00';
  ctx.beginPath();
  ctx.moveTo(bird.x + BIRD_SIZE,     bird.y + BIRD_SIZE * 0.4);
  ctx.lineTo(bird.x + BIRD_SIZE + 8, bird.y + BIRD_SIZE * 0.5);
  ctx.lineTo(bird.x + BIRD_SIZE,     bird.y + BIRD_SIZE * 0.6);
  ctx.fill();

  // Eye
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(bird.x + BIRD_SIZE - 9, bird.y + 12, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(bird.x + BIRD_SIZE - 8, bird.y + 11, 1.5, 0, Math.PI * 2);
  ctx.fill();

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

function renderDead() {
  ctx.fillStyle = 'rgba(0,0,0,0.68)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#ff4444';
  ctx.font      = 'bold 58px Arial';
  ctx.fillText('ВРЕЗАЛСЯ!', CANVAS_W / 2, CANVAS_H / 2 - 70);

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
