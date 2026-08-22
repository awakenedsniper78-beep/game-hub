/* Snake — game logic and rendering for the instrument-panel play screen (2a).
   Depends on catalog.js/stats.js for the local score history. */
(() => {
  "use strict";

  // ---------- Constants ----------
  const COLS = 20, ROWS = 20, CELL = 22;
  const FIELD_W = COLS * CELL, FIELD_H = ROWS * CELL;   // logical drawing size
  const BODY_W = 14;             // ribbon thickness, matching the mockup
  const HEAD_W = 18;
  const TAIL_W = 6;

  const BASE_TICK = 180;         // tier 01
  const TIER_STEP = 20;          // each tier is 20ms quicker
  const MIN_TICK = 80;
  const APPLES_PER_TIER = 5;
  const SPRINT_FACTOR = 0.55;
  const START_LENGTH = 4;
  const GROWTH_PER_APPLE = 2;
  const APPLE_POINTS = 8;
  const SPRINT_BONUS = 1;        // eating mid-sprint is worth a little more
  const NEAR_MISS_COOLDOWN = 2500;
  const MAX_FRAME_MS = 250;
  const LOG_LINES = 5;

  const INK_GROUND = "#0b0e1a";
  const INK_GRID = "#141829";
  const HEAD_C = "#66e0a3";
  const BODY_C = "#3f9d74";
  const TAIL_C = "#255c44";
  const APPLE_C = "#ff6b9d";

  const MODES = {
    classic:  { label: "Classic walls", note: "Walls are fatal." },
    wrap:     { label: "Wrap edges",    note: "Edges wrap — only your own tail can end the run." },
    nobrakes: { label: "No brakes",     note: "Walls are fatal and every apple speeds you up. No plateau." },
  };

  const DIRS = {
    up:    { x: 0, y: -1, letter: "N" },
    down:  { x: 0, y: 1,  letter: "S" },
    left:  { x: -1, y: 0, letter: "W" },
    right: { x: 1, y: 0,  letter: "E" },
  };
  const KEY_DIRS = {
    ArrowUp: "up", KeyW: "up",
    ArrowDown: "down", KeyS: "down",
    ArrowLeft: "left", KeyA: "left",
    ArrowRight: "right", KeyD: "right",
  };
  const GAME_KEYS = new Set([...Object.keys(KEY_DIRS), "KeyP", "Enter", "Space", "ShiftLeft", "ShiftRight"]);

  // ---------- DOM ----------
  const byId = (id) => document.getElementById(id);
  const boardCv = byId("board"), ctx = boardCv.getContext("2d");
  const scoreEl = byId("score"), lengthEl = byId("length"), applesEl = byId("apples");
  const tierLabel = byId("tierLabel"), tierBar = byId("tierBar");
  const tierToGo = byId("tierToGo"), tierMs = byId("tierMs");
  const tickMeta = byId("tickMeta"), sessionMeta = byId("sessionMeta");
  const runLogEl = byId("runLog"), topScoresEl = byId("topScores"), modeNote = byId("modeNote");
  const overlay = byId("overlay"), ovTitle = byId("ovTitle"), ovMsg = byId("ovMsg");
  const startBtn = byId("startBtn"), pauseBtn = byId("pauseBtn"), modesEl = byId("modes");

  const stats = window.Arcade && window.Arcade.stats;
  const num = stats ? stats.num : String;

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
    turn:  () => beep(240, 0.04, "square", 0.025),
    apple: () => { beep(587, 0.07, "square", 0.05); beep(880, 0.09, "square", 0.05, 0.06); },
    tier:  () => { beep(659, 0.08, "triangle", 0.05); beep(988, 0.12, "triangle", 0.05, 0.08); },
    over:  () => { beep(392, 0.18, "sawtooth", 0.06); beep(311, 0.18, "sawtooth", 0.06, 0.18); beep(233, 0.35, "sawtooth", 0.06, 0.36); },
  };

  // ---------- State ----------
  const state = {
    snake: [], dir: DIRS.right, turnQueue: [], apple: null,
    score: 0, apples: 0, grow: 0, tier: 1, tickMs: BASE_TICK,
    mode: "classic", pendingMode: "classic",
    sprinting: false, running: false, paused: false, gameOver: false,
    elapsedMs: 0, acc: 0, lastTime: 0, metaTimer: 0, rafId: 0,
    lastNearMiss: -Infinity, log: [],
  };

  const cellsEqual = (a, b) => a.x === b.x && a.y === b.y;
  const inBody = (cell, from = 0) => state.snake.slice(from).some(s => cellsEqual(s, cell));

  // ---------- Speed tiers ----------
  function tickForApples(apples) {
    if (state.mode === "nobrakes") return Math.max(60, BASE_TICK - apples * 6);
    const tier = Math.floor(apples / APPLES_PER_TIER) + 1;
    return Math.max(MIN_TICK, BASE_TICK - (tier - 1) * TIER_STEP);
  }
  const effectiveTick = () => (state.sprinting ? state.tickMs * SPRINT_FACTOR : state.tickMs);

  // ---------- Run log ----------
  function log(text) {
    state.log.unshift({ t: state.elapsedMs, text });
    state.log = state.log.slice(0, LOG_LINES);
    renderLog();
  }

  function clock(ms) {
    const total = Math.floor(ms / 1000);
    return String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
  }

  function renderLog() {
    runLogEl.innerHTML = state.log.length
      ? state.log.map(e => `<span><time>${clock(e.t)}</time> ${e.text}</span>`).join("")
      : `<span class="idle">Awaiting first run…</span>`;
  }

  // ---------- Readouts ----------
  function updateStats() {
    scoreEl.textContent = num(state.score);
    lengthEl.textContent = state.snake.length;
    applesEl.textContent = state.apples;

    const tier = state.tier;
    const into = state.apples % APPLES_PER_TIER;
    tierLabel.textContent = `Speed tier ${String(tier).padStart(2, "0")}`;
    tierBar.style.width = Math.round((into / APPLES_PER_TIER) * 100) + "%";
    tierToGo.textContent = `${APPLES_PER_TIER - into} apples to tier ${String(tier + 1).padStart(2, "0")}`;
    tierMs.textContent = Math.round(state.tickMs) + "ms";
    tickMeta.textContent = `Tick ${Math.round(effectiveTick())}ms · heading ${state.dir.letter}` +
      (state.sprinting ? " · sprint" : "");
  }

  function updateMeta() {
    sessionMeta.textContent = `SNAKE / BUILD 1.0 / SESSION ${clock(state.elapsedMs)}`;
  }

  function renderTopScores() {
    if (!stats) return;
    const runs = stats.all()
      .filter(r => r.game === "snake")
      .sort((a, b) => b.score - a.score || b.ts - a.ts)
      .slice(0, 4);

    topScoresEl.innerHTML = runs.length
      ? runs.map((run, i) => `
          <div class="line${i === 0 ? " top" : ""}">
            <span>${String(i + 1).padStart(2, "0")} · ${stats.ago(run.ts)}</span>
            <b>${stats.num(run.score)}</b>
          </div>`).join("")
      : `<div class="line"><span>No runs yet</span><b>—</b></div>`;
  }

  // ---------- Apples ----------
  function placeApple() {
    const free = [];
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++)
        if (!inBody({ x, y })) free.push({ x, y });
    state.apple = free.length ? free[Math.floor(Math.random() * free.length)] : null;
  }

  // ---------- Stepping ----------
  function step() {
    // One queued turn per tick, so a fast double-tap cannot fold the snake back
    // into its own neck.
    while (state.turnQueue.length) {
      const next = DIRS[state.turnQueue.shift()];
      if (next.x === -state.dir.x && next.y === -state.dir.y) continue;   // no reversing
      if (next.x === state.dir.x && next.y === state.dir.y) continue;
      state.dir = next;
      sfx.turn();
      break;
    }

    const head = state.snake[0];
    let nx = head.x + state.dir.x;
    let ny = head.y + state.dir.y;

    const offGrid = nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS;
    if (offGrid) {
      if (state.mode === "wrap") {
        nx = (nx + COLS) % COLS;
        ny = (ny + ROWS) % ROWS;
      } else {
        return endGame("wall");
      }
    }

    const next = { x: nx, y: ny };
    const eating = state.apple && cellsEqual(next, state.apple);

    // The tail cell frees up on this tick unless we are growing into it.
    const growing = eating || state.grow > 0;
    const body = growing ? state.snake : state.snake.slice(0, -1);
    if (body.some(s => cellsEqual(s, next))) return endGame("tail");

    state.snake.unshift(next);
    if (eating) {
      state.apples++;
      state.grow += GROWTH_PER_APPLE;
      const gained = APPLE_POINTS + (state.sprinting ? SPRINT_BONUS : 0);
      state.score += gained;

      const previousTier = state.tier;
      state.tier = Math.floor(state.apples / APPLES_PER_TIER) + 1;
      state.tickMs = tickForApples(state.apples);

      let line = `APPLE +${gained}`;
      if (state.sprinting) line += " · SPRINT";
      if (state.tier !== previousTier) {
        line += ` · TIER ${String(state.tier).padStart(2, "0")}`;
        sfx.tier();
      } else {
        sfx.apple();
      }
      log(line);
      placeApple();
    }

    if (state.grow > 0) state.grow--;
    else state.snake.pop();

    checkNearMiss();
    updateStats();
  }

  /** Log a near miss when the head squeezes past its own body or a wall. */
  function checkNearMiss() {
    if (state.elapsedMs - state.lastNearMiss < NEAR_MISS_COOLDOWN) return;
    const head = state.snake[0];
    const ahead = { x: head.x + state.dir.x, y: head.y + state.dir.y };

    // Ignore the neck and the two segments behind it — those are always adjacent.
    const tailBrush = inBody(ahead, 3) ||
      state.snake.slice(3).some(s => Math.abs(s.x - head.x) + Math.abs(s.y - head.y) === 1);
    const wallBrush = state.mode !== "wrap" &&
      (head.x === 0 || head.y === 0 || head.x === COLS - 1 || head.y === ROWS - 1);

    if (!tailBrush && !wallBrush) return;
    state.lastNearMiss = state.elapsedMs;
    log(`NEAR MISS · ${tailBrush ? "TAIL" : "WALL"}`);
  }

  // ---------- Rendering ----------
  const center = (n) => n * CELL + CELL / 2;

  function lerpColor(from, to, t) {
    const parse = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const [r1, g1, b1] = parse(from);
    const [r2, g2, b2] = parse(to);
    const mix = (a, b) => Math.round(a + (b - a) * t);
    return `rgb(${mix(r1, r2)},${mix(g1, g2)},${mix(b1, b2)})`;
  }

  function drawGrid() {
    ctx.fillStyle = INK_GROUND;
    ctx.fillRect(0, 0, FIELD_W, FIELD_H);
    ctx.fillStyle = INK_GRID;
    for (let x = 0; x <= COLS; x++) ctx.fillRect(x * CELL, 0, 1, FIELD_H);
    for (let y = 0; y <= ROWS; y++) ctx.fillRect(0, y * CELL, FIELD_W, 1);
  }

  /** Bar joining two neighbouring cell centres — the ribbon body. */
  function drawLink(a, b, width, color) {
    // Skip the join when a wrap teleports the snake across the field.
    if (Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1) return;
    const x1 = center(a.x), y1 = center(a.y), x2 = center(b.x), y2 = center(b.y);
    const left = Math.min(x1, x2) - width / 2;
    const top = Math.min(y1, y2) - width / 2;
    const w = Math.abs(x2 - x1) + width;
    const h = Math.abs(y2 - y1) + width;
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(left), Math.round(top), Math.round(w), Math.round(h));
  }

  function drawSnake() {
    const n = state.snake.length;
    for (let i = n - 1; i >= 0; i--) {
      const seg = state.snake[i];
      const t = n === 1 ? 1 : 1 - i / (n - 1);          // 0 at the tail, 1 at the head
      const color = lerpColor(TAIL_C, BODY_C, Math.min(1, t * 1.15));
      const width = i === n - 1 ? TAIL_W : BODY_W;
      drawLink(seg, seg, width, color);
      if (i < n - 1) drawLink(seg, state.snake[i + 1], Math.min(width, BODY_W), color);
    }

    // Head: glowing block, eyes turned the way it is travelling, sight line ahead.
    const head = state.snake[0];
    const hx = center(head.x), hy = center(head.y);
    ctx.save();
    ctx.shadowColor = "rgba(102,224,163,.45)";
    ctx.shadowBlur = 14;
    ctx.fillStyle = HEAD_C;
    ctx.fillRect(Math.round(hx - HEAD_W / 2), Math.round(hy - HEAD_W / 2), HEAD_W, HEAD_W);
    ctx.restore();

    const d = state.dir;
    const across = { x: -d.y, y: d.x };                  // perpendicular to travel
    ctx.fillStyle = INK_GROUND;
    for (const side of [-1, 1]) {
      const ex = hx + d.x * 4 + across.x * side * 4;
      const ey = hy + d.y * 4 + across.y * side * 4;
      ctx.fillRect(Math.round(ex - 1.5), Math.round(ey - 1.5), 3, 3);
    }

    ctx.save();
    ctx.strokeStyle = "rgba(102,224,163,.4)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(hx + d.x * (HEAD_W / 2 + 3), hy + d.y * (HEAD_W / 2 + 3));
    ctx.lineTo(hx + d.x * (HEAD_W / 2 + 25), hy + d.y * (HEAD_W / 2 + 25));
    ctx.stroke();
    ctx.restore();
  }

  function drawApple() {
    if (!state.apple) return;
    const ax = center(state.apple.x), ay = center(state.apple.y);
    ctx.save();
    ctx.strokeStyle = "rgba(255,107,157,.35)";
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(Math.round(ax - 13) + 0.5, Math.round(ay - 13) + 0.5, 26, 26);
    ctx.restore();

    ctx.save();
    ctx.shadowColor = "rgba(255,107,157,.4)";
    ctx.shadowBlur = 14;
    ctx.fillStyle = APPLE_C;
    ctx.fillRect(Math.round(ax - 7), Math.round(ay - 7), 14, 14);
    ctx.restore();

    ctx.fillStyle = "rgba(255,255,255,.55)";
    ctx.fillRect(Math.round(ax - 4), Math.round(ay - 4), 3, 3);
  }

  function draw() {
    drawGrid();
    drawApple();
    if (state.snake.length) drawSnake();
  }

  // ---------- Overlay ----------
  function showOverlay(title, message, buttonLabel) {
    ovTitle.textContent = title;
    ovMsg.textContent = message;
    startBtn.textContent = buttonLabel;
    overlay.classList.remove("hidden");
  }
  const hideOverlay = () => overlay.classList.add("hidden");

  // ---------- Game flow ----------
  function startGame() {
    cancelAnimationFrame(state.rafId);
    const midY = Math.floor(ROWS / 2);
    const snake = [];
    for (let i = 0; i < START_LENGTH; i++) snake.push({ x: Math.floor(COLS / 3) - i, y: midY });

    Object.assign(state, {
      snake,
      dir: DIRS.right,
      turnQueue: [],
      score: 0, apples: 0, grow: 0, tier: 1,
      mode: state.pendingMode,
      tickMs: BASE_TICK,
      sprinting: false, running: true, paused: false, gameOver: false,
      elapsedMs: 0, acc: 0, lastTime: 0, metaTimer: 0,
      lastNearMiss: -Infinity, log: [],
    });
    state.tickMs = tickForApples(0);
    placeApple();
    syncModeUI();
    updateStats();
    updateMeta();
    renderLog();
    hideOverlay();
    pauseBtn.textContent = "Pause";
    draw();
    state.rafId = requestAnimationFrame(loop);
  }

  function endGame(cause) {
    state.running = false;
    state.gameOver = true;
    state.paused = false;
    cancelAnimationFrame(state.rafId);
    sfx.over();
    draw();
    log(`RUN ENDED · ${cause === "wall" ? "WALL" : "TAIL"}`);

    if (stats) {
      stats.record("snake", {
        score: state.score,
        apples: state.apples,
        level: state.tier,
        durationMs: state.elapsedMs,
      });
      renderTopScores();
    }
    showOverlay(
      "Game over",
      `${cause === "wall" ? "Into the wall" : "Into your own tail"} · ${num(state.score)} points · ${state.apples} apples`,
      "Play again"
    );
    syncModeUI();
  }

  function setPaused(paused) {
    if (!state.running || state.gameOver || state.paused === paused) return;
    state.paused = paused;
    pauseBtn.textContent = paused ? "Resume" : "Pause";
    if (paused) {
      state.sprinting = false;
      showOverlay("Paused", "Press P to resume", "Resume");
    } else {
      hideOverlay();
      state.lastTime = 0;
    }
  }
  const togglePause = () => setPaused(!state.paused);

  // ---------- Mode picker ----------
  function syncModeUI() {
    for (const button of modesEl.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(button.dataset.mode === state.pendingMode));
    }
    const changedMidRun = state.running && state.pendingMode !== state.mode;
    modeNote.textContent = changedMidRun
      ? `${MODES[state.pendingMode].label} applies on the next run.`
      : MODES[state.pendingMode].note;
  }

  modesEl.addEventListener("click", (e) => {
    const button = e.target.closest("button[data-mode]");
    if (!button) return;
    state.pendingMode = button.dataset.mode;
    if (!state.running) state.mode = state.pendingMode;   // takes effect immediately when idle
    syncModeUI();
  });

  // ---------- Main loop ----------
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

    state.acc += dt;
    let steps = 0;
    while (state.running && state.acc >= effectiveTick() && steps < 4) {
      state.acc -= effectiveTick();
      steps++;
      step();
    }
    if (steps) draw();
  }

  // ---------- Input ----------
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (!GAME_KEYS.has(e.code)) return;
    if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    ensureAudio();
    e.preventDefault();

    if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
      state.sprinting = true;
      updateStats();
      return;
    }
    if (e.repeat && (e.code === "KeyP" || e.code === "Enter" || e.code === "Space")) return;

    if (e.code === "Enter" || e.code === "Space") {
      if (!state.running) startGame();
      else togglePause();
      return;
    }
    if (e.code === "KeyP") { togglePause(); return; }

    if (!state.running || state.paused) return;
    const dir = KEY_DIRS[e.code];
    if (dir && state.turnQueue.length < 2) state.turnQueue.push(dir);
  });

  document.addEventListener("keyup", (e) => {
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
      state.sprinting = false;
      updateStats();
    }
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

  // Auto-pause when the player switches away (also drops any held sprint).
  window.addEventListener("blur", () => { state.sprinting = false; setPaused(true); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { state.sprinting = false; setPaused(true); }
  });

  // ---------- Initial idle render ----------
  const midY = Math.floor(ROWS / 2);
  state.snake = Array.from({ length: START_LENGTH }, (_, i) => ({ x: Math.floor(COLS / 3) - i, y: midY }));
  state.apple = { x: Math.floor(COLS * 0.7), y: midY };
  syncModeUI();
  updateStats();
  updateMeta();
  renderLog();
  renderTopScores();
  if (window.Arcade && window.Arcade.fitCanvas) window.Arcade.fitCanvas(boardCv, FIELD_W, FIELD_H, draw);
  else draw();
})();
