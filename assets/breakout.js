/* Breakout — game logic and rendering for the instrument-panel play screen (3a).
   Depends on catalog.js/stats.js for the local score history. */
(() => {
  "use strict";

  // ---------- Field geometry ----------
  const W = 560, H = 420;
  const COLS = 12, ROWS = 4;              // 48 bricks, as the library blurb promises
  const WALL = 16;                        // margin before the first brick column
  const BRICK_TOP = 62;
  const BRICK_W = (W - WALL * 2) / COLS;  // 44
  const BRICK_H = 20;
  const BRICK_GAP = 4;

  const PADDLE_W = 96, PADDLE_WIDE = 148, PADDLE_H = 10;
  const PADDLE_Y = H - 30;
  const PADDLE_SPEED = 480;               // px/s under the keyboard
  const BALL_R = 5;
  const BASE_SPEED = 300;                 // px/s on stage 01
  const STAGE_SPEEDUP = 1.08;             // every cleared wall is 8% quicker
  const SLOW_FACTOR = 0.68;
  const MAX_BOUNCE = 1.05;                // ~60° off vertical at the paddle's edge
  const LAUNCH_ANGLE = 0.36;
  const SUB_STEP = 4;                     // px per collision sub-step
  const START_LIVES = 3, MAX_LIVES = 5, MAX_BALLS = 5;
  const MAX_COMBO = 4;
  const DROP_CHANCE = 0.14, DROP_SPEED = 132, DROP_R = 7;
  const STAGE_BONUS = 250;
  const FLASH_MS = 900;
  const MAX_FRAME_MS = 250;
  const LOG_LINES = 5;

  const INK_GROUND = "#0b0e1a";
  const INK_GRID = "#141829";
  const BALL_C = "#e8ecff";
  const PADDLE_C = "#4f7cff";
  const PADDLE_WIDE_C = "#b06bff";

  /* Row values and colours match the brick-value key in the left rail. The top
     row is reinforced: two hits, and it is the only brick worth 90.          */
  const ROW_SPECS = [
    { color: "#ff6b9d", value: 90, hp: 2 },
    { color: "#b06bff", value: 70, hp: 1 },
    { color: "#4f7cff", value: 50, hp: 1 },
    { color: "#66e0a3", value: 30, hp: 1 },
  ];

  const POWERS = {
    wide:  { label: "Wide paddle", ms: 12000, color: "#4f7cff" },
    slow:  { label: "Slow ball",   ms: 10000, color: "#66e0a3" },
    multi: { label: "Multiball",   ms: 0,     color: "#b06bff" },
    life:  { label: "Extra life",  ms: 0,     color: "#ffd166" },
  };
  const DROP_TABLE = ["wide", "wide", "slow", "slow", "multi", "life"];

  const GAME_KEYS = new Set([
    "ArrowLeft", "ArrowRight", "KeyA", "KeyD", "Space", "Enter", "KeyP",
  ]);

  // ---------- DOM ----------
  const byId = (id) => document.getElementById(id);
  const boardCv = byId("board"), ctx = boardCv.getContext("2d");
  const scoreEl = byId("score"), stageEl = byId("stage"), comboEl = byId("combo");
  const livesEl = byId("lives");
  const brickBar = byId("brickBar"), brickCount = byId("brickCount"), brickPct = byId("brickPct");
  const powersEl = byId("powers");
  const ballMeta = byId("ballMeta"), sessionMeta = byId("sessionMeta");
  const rallyLogEl = byId("rallyLog"), topScoresEl = byId("topScores");
  const overlay = byId("overlay"), ovTitle = byId("ovTitle"), ovMsg = byId("ovMsg");
  const startBtn = byId("startBtn"), pauseBtn = byId("pauseBtn");

  const stats = window.Arcade && window.Arcade.stats;
  const num = stats ? stats.num : String;

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const pad2 = (n) => String(n).padStart(2, "0");

  // ---------- Audio (Web Audio API, no files) ----------
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { audioCtx = null; }
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  }
  function beep(freq, dur, type = "square", vol = 0.06, when = 0) {
    if (!audioCtx) return;
    const t = audioCtx.currentTime + when;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
  const sfx = {
    wall:   () => beep(180, 0.035, "square", 0.025),
    paddle: () => beep(320, 0.05, "square", 0.04),
    brick:  (row) => beep(440 + (ROWS - row) * 90, 0.06, "square", 0.05),
    armour: () => beep(150, 0.07, "sawtooth", 0.035),
    power:  () => { beep(659, 0.07, "triangle", 0.05); beep(988, 0.1, "triangle", 0.05, 0.06); },
    lost:   () => { beep(330, 0.14, "sawtooth", 0.05); beep(220, 0.2, "sawtooth", 0.05, 0.14); },
    stage:  () => { beep(523, 0.09, "triangle", 0.05); beep(784, 0.09, "triangle", 0.05, 0.09);
                    beep(1046, 0.16, "triangle", 0.05, 0.18); },
    over:   () => { beep(392, 0.18, "sawtooth", 0.06); beep(311, 0.18, "sawtooth", 0.06, 0.18);
                    beep(233, 0.35, "sawtooth", 0.06, 0.36); },
  };

  // ---------- State ----------
  const state = {
    bricks: [], balls: [], drops: [],
    paddleX: W / 2,
    wideMs: 0, slowMs: 0,
    caught: { multi: 0, life: 0 },
    flash: { wide: 0, slow: 0, multi: 0, life: 0 },
    left: false, right: false,
    score: 0, stage: 1, lives: START_LIVES, slots: START_LIVES,
    chain: 0, rallyBricks: 0, rallyScore: 0, cleared: 0,
    running: false, paused: false, gameOver: false, interrupt: false,
    elapsedMs: 0, lastTime: 0, metaTimer: 0, rafId: 0,
    log: [],
  };

  const paddleWidth = () => (state.wideMs > 0 ? PADDLE_WIDE : PADDLE_W);
  const ballSpeed = () =>
    BASE_SPEED * Math.pow(STAGE_SPEEDUP, state.stage - 1) * (state.slowMs > 0 ? SLOW_FACTOR : 1);
  const liveBalls = () => state.balls.filter(b => b.alive);

  // ---------- Rally log ----------
  function log(text) {
    state.log.unshift({ t: state.elapsedMs, text });
    state.log = state.log.slice(0, LOG_LINES);
    renderLog();
  }

  function clock(ms) {
    const total = Math.floor(ms / 1000);
    return pad2(Math.floor(total / 60)) + ":" + pad2(total % 60);
  }

  function renderLog() {
    rallyLogEl.innerHTML = state.log.length
      ? state.log.map(e => `<span><time>${clock(e.t)}</time> ${e.text}</span>`).join("")
      : `<span class="idle">Awaiting first serve…</span>`;
  }

  // ---------- Readouts ----------
  function updateStats() {
    scoreEl.textContent = num(state.score);
    stageEl.textContent = pad2(state.stage);
    comboEl.textContent = "×" + Math.max(1, state.chain);

    const total = state.bricks.length || COLS * ROWS;
    const pct = Math.round((state.cleared / total) * 100);
    brickBar.style.width = pct + "%";
    brickCount.textContent = `${state.cleared} of ${total}`;
    brickPct.textContent = pct + "%";

    let pips = "";
    for (let i = 0; i < state.slots; i++) pips += `<i${i < state.lives ? "" : ' class="spent"'}></i>`;
    livesEl.innerHTML = pips;

    const inPlay = liveBalls().length;
    ballMeta.textContent = `Ball ${Math.round(ballSpeed())}px/s · ${inPlay} in play` +
      (state.slowMs > 0 ? " · slowed" : "");
  }

  function renderPowers() {
    for (const row of powersEl.querySelectorAll("[data-power]")) {
      const key = row.dataset.power;
      const value = row.querySelector("b");
      if (key === "wide" || key === "slow") {
        const left = key === "wide" ? state.wideMs : state.slowMs;
        row.classList.toggle("on", left > 0);
        value.textContent = left > 0
          ? Math.ceil(left / 1000) + "s"
          : Math.round(POWERS[key].ms / 1000) + "s";
      } else {
        row.classList.toggle("on", state.flash[key] > 0);
        value.textContent = "×" + state.caught[key];
      }
    }
  }

  function updateMeta() {
    sessionMeta.textContent = `BREAKOUT / BUILD 1.0 / SESSION ${clock(state.elapsedMs)}`;
  }

  function renderTopScores() {
    if (!stats) return;
    const runs = stats.all()
      .filter(r => r.game === "breakout")
      .sort((a, b) => b.score - a.score || b.ts - a.ts)
      .slice(0, 4);

    topScoresEl.innerHTML = runs.length
      ? runs.map((run, i) => `
          <div class="line${i === 0 ? " top" : ""}">
            <span>${pad2(i + 1)} · ${stats.ago(run.ts)}</span>
            <b>${stats.num(run.score)}</b>
          </div>`).join("")
      : `<div class="line"><span>No runs yet</span><b>—</b></div>`;
  }

  // ---------- Wall ----------
  function buildBricks() {
    const bricks = [];
    for (let row = 0; row < ROWS; row++) {
      const spec = ROW_SPECS[row];
      for (let col = 0; col < COLS; col++) {
        bricks.push({
          x: WALL + col * BRICK_W + BRICK_GAP / 2,
          y: BRICK_TOP + row * (BRICK_H + BRICK_GAP),
          w: BRICK_W - BRICK_GAP,
          h: BRICK_H,
          row,
          value: spec.value,
          maxHp: spec.hp,
          hp: spec.hp,
          alive: true,
        });
      }
    }
    state.bricks = bricks;
    state.cleared = 0;
  }

  // ---------- Balls ----------
  function newBall(stuck = true) {
    return { x: state.paddleX, y: PADDLE_Y - BALL_R - 1, dx: 0, dy: -1, stuck, alive: true };
  }

  /* Replacing the ball list invalidates whatever the update loop is holding,
     so flag the rest of this frame as void. */
  function serveBall() {
    state.balls = [newBall(true)];
    state.drops = [];
    state.interrupt = true;
  }

  function launch() {
    const stuck = state.balls.find(b => b.stuck && b.alive);
    if (!stuck) return;
    const angle = LAUNCH_ANGLE * (Math.random() < 0.5 ? -1 : 1);
    stuck.dx = Math.sin(angle);
    stuck.dy = -Math.cos(angle);
    stuck.stuck = false;
    sfx.paddle();
  }

  // ---------- Collision ----------
  function brickAt(x, y) {
    for (const b of state.bricks) {
      if (!b.alive) continue;
      if (x + BALL_R > b.x && x - BALL_R < b.x + b.w &&
          y + BALL_R > b.y && y - BALL_R < b.y + b.h) return b;
    }
    return null;
  }

  /** Push the ball back out of the brick along its shallowest overlap. */
  function bounceOffBrick(brick, ball, dx, dy) {
    const cx = brick.x + brick.w / 2, cy = brick.y + brick.h / 2;
    const ox = (brick.w / 2 + BALL_R) - Math.abs(ball.x - cx);
    const oy = (brick.h / 2 + BALL_R) - Math.abs(ball.y - cy);
    if (ox < oy) {
      ball.x += ball.x < cx ? -ox : ox;
      dx = -dx;
    } else {
      ball.y += ball.y < cy ? -oy : oy;
      dy = -dy;
    }
    return { dx, dy };
  }

  function hitBrick(brick) {
    brick.hp--;
    if (brick.hp > 0) {                       // reinforced brick, first hit
      sfx.armour();
      return;
    }
    brick.alive = false;
    state.cleared++;
    state.chain = Math.min(state.chain + 1, MAX_COMBO);
    const gained = brick.value * state.chain;
    state.score += gained;
    state.rallyBricks++;
    state.rallyScore += gained;
    sfx.brick(brick.row);
    maybeDrop(brick);
    if (state.cleared >= state.bricks.length) stageClear();
  }

  function paddleHit(ball) {
    const half = paddleWidth() / 2;
    return ball.y + BALL_R >= PADDLE_Y &&
           ball.y - BALL_R <= PADDLE_Y + PADDLE_H &&
           ball.x + BALL_R >= state.paddleX - half &&
           ball.x - BALL_R <= state.paddleX + half;
  }

  /** Bounce off the paddle. The hit offset picks the angle, so the player
      steers with the paddle rather than just returning the ball.            */
  function bounceOffPaddle(ball) {
    const half = paddleWidth() / 2;
    const offset = clamp((ball.x - state.paddleX) / half, -1, 1);
    const angle = offset * MAX_BOUNCE;
    ball.y = PADDLE_Y - BALL_R;
    sfx.paddle();
    if (state.rallyBricks) {
      log(`RALLY · ${state.rallyBricks} BRICK${state.rallyBricks > 1 ? "S" : ""} · +${num(state.rallyScore)}` +
          (state.chain > 1 ? ` · ×${state.chain}` : ""));
    }
    state.chain = 0;
    state.rallyBricks = 0;
    state.rallyScore = 0;
    return { dx: Math.sin(angle), dy: -Math.cos(angle) };
  }

  /** March the ball along its heading in short steps so it cannot tunnel
      through a brick at high stage speeds.                                  */
  function moveBall(ball, sec) {
    let remaining = ballSpeed() * sec;
    let { dx, dy } = ball;

    while (remaining > 0 && ball.alive) {
      const stepLen = Math.min(SUB_STEP, remaining);
      remaining -= stepLen;
      ball.x += dx * stepLen;
      ball.y += dy * stepLen;

      if (ball.x < BALL_R) { ball.x = BALL_R; dx = Math.abs(dx); sfx.wall(); }
      else if (ball.x > W - BALL_R) { ball.x = W - BALL_R; dx = -Math.abs(dx); sfx.wall(); }
      if (ball.y < BALL_R) { ball.y = BALL_R; dy = Math.abs(dy); sfx.wall(); }

      const brick = brickAt(ball.x, ball.y);
      if (brick) {
        ({ dx, dy } = bounceOffBrick(brick, ball, dx, dy));
        hitBrick(brick);
        if (state.interrupt) break;           // stage cleared or run ended mid-step
      }

      if (dy > 0 && paddleHit(ball)) ({ dx, dy } = bounceOffPaddle(ball));

      if (ball.y - BALL_R > H) { ball.alive = false; break; }
    }

    ball.dx = dx;
    ball.dy = dy;
  }

  // ---------- Power-ups ----------
  function maybeDrop(brick) {
    if (Math.random() > DROP_CHANCE) return;
    const type = DROP_TABLE[Math.floor(Math.random() * DROP_TABLE.length)];
    state.drops.push({ x: brick.x + brick.w / 2, y: brick.y + brick.h / 2, type });
  }

  function collectDrop(type) {
    sfx.power();
    state.flash[type] = FLASH_MS;
    if (type === "wide") {
      state.wideMs = POWERS.wide.ms;
      state.paddleX = clamp(state.paddleX, PADDLE_WIDE / 2, W - PADDLE_WIDE / 2);
    } else if (type === "slow") {
      state.slowMs = POWERS.slow.ms;
    } else if (type === "multi") {
      state.caught.multi++;
      splitBalls();
    } else {
      state.caught.life++;
      if (state.lives < MAX_LIVES) state.lives++;
      state.slots = Math.max(state.slots, state.lives);
    }
    log(`POWER-UP · ${POWERS[type].label.toUpperCase()}`);
  }

  function splitBalls() {
    const source = liveBalls()[0];
    if (!source) return;
    for (const spread of [-0.5, 0.5]) {
      if (state.balls.length >= MAX_BALLS) break;
      const cos = Math.cos(spread), sin = Math.sin(spread);
      state.balls.push({
        x: source.x,
        y: source.y,
        dx: source.dx * cos - source.dy * sin,
        dy: source.dx * sin + source.dy * cos,
        stuck: false,
        alive: true,
      });
    }
    if (source.stuck) launch();
  }

  function updateDrops(dt) {
    const sec = dt / 1000;
    const half = paddleWidth() / 2;
    const kept = [];
    for (const drop of state.drops) {
      drop.y += DROP_SPEED * sec;
      const caught = drop.y + DROP_R >= PADDLE_Y &&
                     drop.y - DROP_R <= PADDLE_Y + PADDLE_H &&
                     Math.abs(drop.x - state.paddleX) <= half + DROP_R;
      if (caught) { collectDrop(drop.type); continue; }
      if (drop.y - DROP_R > H) continue;
      kept.push(drop);
    }
    state.drops = kept;
  }

  // ---------- Flow ----------
  function stageClear() {
    const bonus = STAGE_BONUS * state.stage;
    state.score += bonus;
    log(`STAGE ${pad2(state.stage)} CLEARED · +${num(bonus)}`);
    state.stage++;
    state.chain = 0;
    state.rallyBricks = 0;
    state.rallyScore = 0;
    buildBricks();
    serveBall();
    sfx.stage();
    updateStats();
  }

  function loseLife() {
    state.lives--;
    state.chain = 0;
    state.rallyBricks = 0;
    state.rallyScore = 0;
    state.wideMs = 0;
    state.slowMs = 0;
    sfx.lost();
    if (state.lives <= 0) { log("BALL LOST · NO LIVES LEFT"); return endGame(); }
    log(`BALL LOST · ${state.lives} ${state.lives > 1 ? "LIVES" : "LIFE"} LEFT`);
    serveBall();
    updateStats();
    renderPowers();
  }

  function startGame() {
    cancelAnimationFrame(state.rafId);
    Object.assign(state, {
      drops: [],
      paddleX: W / 2,
      wideMs: 0, slowMs: 0,
      caught: { multi: 0, life: 0 },
      flash: { wide: 0, slow: 0, multi: 0, life: 0 },
      left: false, right: false,
      score: 0, stage: 1, lives: START_LIVES, slots: START_LIVES,
      chain: 0, rallyBricks: 0, rallyScore: 0,
      running: true, paused: false, gameOver: false, interrupt: false,
      elapsedMs: 0, lastTime: 0, metaTimer: 0,
      log: [],
    });
    buildBricks();
    serveBall();
    hideOverlay();
    pauseBtn.textContent = "Pause";
    updateStats();
    renderPowers();
    updateMeta();
    renderLog();
    draw();
    state.rafId = requestAnimationFrame(loop);
  }

  function endGame() {
    state.running = false;
    state.gameOver = true;
    state.paused = false;
    state.interrupt = true;
    cancelAnimationFrame(state.rafId);
    sfx.over();
    draw();

    if (stats) {
      stats.record("breakout", {
        score: state.score,
        level: state.stage,
        durationMs: state.elapsedMs,
      });
      renderTopScores();
    }
    showOverlay(
      "Game over",
      `Stage ${pad2(state.stage)} · ${num(state.score)} points`,
      "Play again"
    );
  }

  function setPaused(paused) {
    if (!state.running || state.gameOver || state.paused === paused) return;
    state.paused = paused;
    pauseBtn.textContent = paused ? "Resume" : "Pause";
    if (paused) {
      state.left = false;
      state.right = false;
      showOverlay("Paused", "Press P to resume", "Resume");
    } else {
      hideOverlay();
      state.lastTime = 0;
    }
  }
  const togglePause = () => setPaused(!state.paused);

  function showOverlay(title, message, buttonLabel) {
    ovTitle.textContent = title;
    ovMsg.textContent = message;
    startBtn.textContent = buttonLabel;
    overlay.classList.remove("hidden");
  }
  const hideOverlay = () => overlay.classList.add("hidden");

  // ---------- Rendering ----------
  function drawGround() {
    ctx.fillStyle = INK_GROUND;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = INK_GRID;
    for (let x = 0; x <= W; x += 28) ctx.fillRect(x, 0, 1, H);
    for (let y = 0; y <= H; y += 28) ctx.fillRect(0, y, W, 1);
  }

  function drawBricks() {
    for (const b of state.bricks) {
      if (!b.alive) continue;
      const spec = ROW_SPECS[b.row];
      const cracked = b.maxHp > 1 && b.hp < b.maxHp;

      ctx.globalAlpha = cracked ? 0.45 : 1;
      ctx.fillStyle = spec.color;
      ctx.fillRect(Math.round(b.x), Math.round(b.y), Math.round(b.w), b.h);
      ctx.globalAlpha = 1;

      if (b.maxHp > 1 && !cracked) {          // armour band on an intact hard brick
        ctx.strokeStyle = "rgba(11,14,26,.55)";
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(b.x) + 3.5, Math.round(b.y) + 3.5, Math.round(b.w) - 7, b.h - 7);
      }
      if (cracked) {                           // fracture line once the armour is off
        ctx.strokeStyle = spec.color;
        ctx.beginPath();
        ctx.moveTo(Math.round(b.x) + 6, Math.round(b.y) + b.h - 5.5);
        ctx.lineTo(Math.round(b.x) + b.w - 6, Math.round(b.y) + 5.5);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(11,14,26,.45)";    // 2px shadow edge for depth
      ctx.fillRect(Math.round(b.x), Math.round(b.y) + b.h - 2, Math.round(b.w), 2);
    }
  }

  function drawPaddle() {
    const half = paddleWidth() / 2;
    const x = Math.round(state.paddleX - half);
    const color = state.wideMs > 0 ? PADDLE_WIDE_C : PADDLE_C;
    ctx.save();
    ctx.shadowColor = state.wideMs > 0 ? "rgba(176,107,255,.45)" : "rgba(79,124,255,.45)";
    ctx.shadowBlur = 14;
    ctx.fillStyle = color;
    ctx.fillRect(x, PADDLE_Y, Math.round(half * 2), PADDLE_H);
    ctx.restore();
    ctx.fillStyle = "rgba(255,255,255,.5)";
    ctx.fillRect(x, PADDLE_Y, Math.round(half * 2), 2);

    // Centre notch — the dead-straight return, and a sight line for aiming.
    ctx.fillStyle = INK_GROUND;
    ctx.fillRect(Math.round(state.paddleX) - 1, PADDLE_Y + 3, 2, PADDLE_H - 6);
  }

  function drawBalls() {
    for (const ball of state.balls) {
      if (!ball.alive) continue;
      ctx.save();
      ctx.shadowColor = "rgba(232,236,255,.5)";
      ctx.shadowBlur = 12;
      ctx.fillStyle = BALL_C;
      ctx.fillRect(Math.round(ball.x - BALL_R), Math.round(ball.y - BALL_R), BALL_R * 2, BALL_R * 2);
      ctx.restore();

      if (ball.stuck) {
        ctx.save();
        ctx.strokeStyle = "rgba(232,236,255,.35)";
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(Math.round(ball.x) + 0.5, ball.y - BALL_R - 3);
        ctx.lineTo(Math.round(ball.x) + 0.5, ball.y - BALL_R - 28);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawDrops() {
    ctx.font = "600 10px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const drop of state.drops) {
      const x = Math.round(drop.x - DROP_R), y = Math.round(drop.y - DROP_R);
      ctx.fillStyle = POWERS[drop.type].color;
      ctx.fillRect(x, y, DROP_R * 2, DROP_R * 2);
      ctx.fillStyle = INK_GROUND;
      ctx.fillText(POWERS[drop.type].label[0].toUpperCase(), drop.x, drop.y + 0.5);
    }
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }

  function draw() {
    drawGround();
    drawBricks();
    drawDrops();
    drawPaddle();
    drawBalls();
  }

  // ---------- Main loop ----------
  function update(dt) {
    const sec = dt / 1000;
    state.interrupt = false;

    let move = 0;
    if (state.left) move -= 1;
    if (state.right) move += 1;
    if (move) {
      const half = paddleWidth() / 2;
      state.paddleX = clamp(state.paddleX + move * PADDLE_SPEED * sec, half, W - half);
    }

    if (state.wideMs > 0) {
      state.wideMs = Math.max(0, state.wideMs - dt);
      if (!state.wideMs) {
        state.paddleX = clamp(state.paddleX, PADDLE_W / 2, W - PADDLE_W / 2);
        log("WIDE PADDLE · EXPIRED");
      }
    }
    if (state.slowMs > 0) {
      state.slowMs = Math.max(0, state.slowMs - dt);
      if (!state.slowMs) log("SLOW BALL · EXPIRED");
    }
    for (const key of Object.keys(state.flash)) {
      if (state.flash[key] > 0) state.flash[key] = Math.max(0, state.flash[key] - dt);
    }

    for (const ball of state.balls) {
      if (!ball.alive) continue;
      if (ball.stuck) {
        ball.x = state.paddleX;
        ball.y = PADDLE_Y - BALL_R - 1;
        continue;
      }
      moveBall(ball, sec);
      if (state.interrupt) return;            // the wall or the run reset mid-step
    }

    updateDrops(dt);
    if (state.interrupt) return;

    state.balls = state.balls.filter(b => b.alive);
    if (!state.balls.length) loseLife();
  }

  function loop(time) {
    if (!state.running) return;
    state.rafId = requestAnimationFrame(loop);
    if (state.paused) return;

    if (!state.lastTime) state.lastTime = time;
    const dt = Math.min(time - state.lastTime, MAX_FRAME_MS);
    state.lastTime = time;

    state.elapsedMs += dt;
    state.metaTimer += dt;
    if (state.metaTimer >= 500) { state.metaTimer = 0; updateMeta(); }

    update(dt);
    updateStats();
    renderPowers();
    draw();
  }

  // ---------- Input ----------
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (!GAME_KEYS.has(e.code)) return;
    if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    ensureAudio();
    e.preventDefault();

    if (e.code === "ArrowLeft" || e.code === "KeyA") { state.left = true; return; }
    if (e.code === "ArrowRight" || e.code === "KeyD") { state.right = true; return; }
    if (e.repeat) return;

    if (e.code === "KeyP") { togglePause(); return; }
    if (e.code === "Enter" || e.code === "Space") {
      if (!state.running) startGame();
      else if (state.paused) setPaused(false);
      else launch();
    }
  });

  document.addEventListener("keyup", (e) => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") state.left = false;
    if (e.code === "ArrowRight" || e.code === "KeyD") state.right = false;
  });

  /** Pointer steering — the canvas scales on narrow screens, so map through
      the rendered width rather than assuming 1:1 pixels.                    */
  function steer(clientX) {
    if (!state.running || state.paused) return;
    const rect = boardCv.getBoundingClientRect();
    if (!rect.width) return;
    const half = paddleWidth() / 2;
    state.paddleX = clamp(((clientX - rect.left) / rect.width) * W, half, W - half);
  }

  boardCv.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") e.preventDefault();
    steer(e.clientX);
  });
  boardCv.addEventListener("pointerdown", (e) => {
    ensureAudio();
    steer(e.clientX);
    if (state.running && !state.paused) launch();
  });

  startBtn.addEventListener("click", () => {
    ensureAudio();
    startBtn.blur();
    if (state.paused) setPaused(false);
    else startGame();
  });

  pauseBtn.addEventListener("click", () => {
    pauseBtn.blur();
    if (state.running) togglePause();
    else startGame();
  });

  // Auto-pause when the player switches away (also drops any held key).
  window.addEventListener("blur", () => { state.left = state.right = false; setPaused(true); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { state.left = state.right = false; setPaused(true); }
  });

  // ---------- Initial idle render ----------
  buildBricks();
  serveBall();
  updateStats();
  renderPowers();
  updateMeta();
  renderLog();
  renderTopScores();
  draw();
})();
