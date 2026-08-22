/* Tetris — game logic and rendering for the instrument-panel play screen.
   Depends on catalog.js/stats.js for the local score history. */
(() => {
  "use strict";

  // ---------- Constants ----------
  const COLS = 10, ROWS = 20, CELL = 24, GAP = 1;
  const FIELD_W = COLS * CELL, FIELD_H = ROWS * CELL;   // logical drawing size
  const BASE_DROP_MS = 800;
  const MIN_DROP_MS = 100;
  const DROP_STEP_MS = 70;
  const MAX_FRAME_MS = 100;      // clamp dt so a backgrounded tab cannot dump many drops at once
  const LINES_PER_LEVEL = 10;

  const INK_GAP = "#141829";     // grid gutter colour from the design
  const INK_EMPTY = "#0b0e1a";

  const SHAPES = {
    I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
    O: [[1,1],[1,1]],
    T: [[0,1,0],[1,1,1],[0,0,0]],
    S: [[0,1,1],[1,1,0],[0,0,0]],
    Z: [[1,1,0],[0,1,1],[0,0,0]],
    J: [[1,0,0],[1,1,1],[0,0,0]],
    L: [[0,0,1],[1,1,1],[0,0,0]],
  };
  // Palette from the mockup's field: blue / gold / violet / green / pink,
  // extended with two neighbouring hues for J and L.
  const COLORS = {
    I: "#4f7cff", O: "#ffd166", T: "#b06bff",
    S: "#66e0a3", Z: "#ff6b9d", J: "#5ad1e6", L: "#ff9f57",
  };
  const LINE_SCORES = [0, 100, 300, 500, 800];
  const GAME_KEYS = new Set([
    "ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp",
    "KeyX", "KeyZ", "Space", "KeyC", "KeyP", "Enter",
  ]);

  // ---------- DOM ----------
  const byId = (id) => document.getElementById(id);
  const boardCv = byId("board"), bctx = boardCv.getContext("2d");
  const holdCv = byId("hold"), hctx = holdCv.getContext("2d");
  const queueCvs = ["next1", "next2", "next3"].map(byId);
  const queueCtxs = queueCvs.map(cv => cv.getContext("2d"));
  const scoreEl = byId("score"), linesEl = byId("lines"), levelEl = byId("level");
  const levelBar = byId("levelBar"), levelToGo = byId("levelToGo"), levelPct = byId("levelPct");
  const gravityEl = byId("gravity"), sessionMeta = byId("sessionMeta"), topScoresEl = byId("topScores");
  const overlay = byId("overlay"), ovTitle = byId("ovTitle"), ovMsg = byId("ovMsg");
  const startBtn = byId("startBtn"), pauseBtn = byId("pauseBtn");

  const stats = window.Arcade && window.Arcade.stats;

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
    move:   () => beep(220, 0.05, "square", 0.03),
    rotate: () => beep(330, 0.06, "square", 0.04),
    soft:   () => beep(180, 0.04, "square", 0.03),
    hard:   () => { beep(120, 0.12, "triangle", 0.10); beep(80, 0.15, "triangle", 0.08, 0.02); },
    hold:   () => beep(440, 0.07, "sine", 0.05),
    clear:  () => { beep(523, 0.09, "square", 0.06); beep(659, 0.09, "square", 0.06, 0.08); beep(784, 0.14, "square", 0.06, 0.16); },
    over:   () => { beep(392, 0.18, "sawtooth", 0.06); beep(311, 0.18, "sawtooth", 0.06, 0.18); beep(233, 0.35, "sawtooth", 0.06, 0.36); },
  };

  // ---------- State ----------
  const state = {
    grid: [], piece: null, bag: [], holdType: null,
    score: 0, lines: 0, level: 1,
    canHold: true, paused: false, gameOver: false, running: false,
    dropInterval: BASE_DROP_MS, dropTimer: 0, lastTime: 0, rafId: 0,
    elapsedMs: 0, metaTimer: 0,
  };

  const emptyGrid = () => Array.from({ length: ROWS }, () => Array(COLS).fill(null));

  // ---------- Piece queue (7-bag randomizer) ----------
  function refillBag() {
    const types = Object.keys(SHAPES);
    for (let i = types.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [types[i], types[j]] = [types[j], types[i]];
    }
    state.bag.push(...types);
  }
  /** The next `n` types, keeping the bag long enough to preview them. */
  function peekQueue(n = 3) {
    while (state.bag.length < n) refillBag();
    return state.bag.slice(0, n);
  }
  function takeNext() {
    const type = peekQueue(1)[0];
    state.bag.shift();
    peekQueue(3);                 // keep the three preview slots populated
    return type;
  }

  function spawnPiece(type) {
    const shape = SHAPES[type].map(row => row.slice());
    return {
      type,
      shape,
      x: Math.floor((COLS - shape[0].length) / 2),
      y: type === "I" ? -1 : 0,
    };
  }

  // ---------- Collision / rotation ----------
  function collides(p, ox = 0, oy = 0, shape = p.shape) {
    for (let y = 0; y < shape.length; y++) {
      for (let x = 0; x < shape[y].length; x++) {
        if (!shape[y][x]) continue;
        const nx = p.x + x + ox;
        const ny = p.y + y + oy;
        if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
        if (ny >= 0 && state.grid[ny][nx]) return true;
      }
    }
    return false;
  }

  function rotateMatrix(m, dir) {
    const n = m.length;
    const res = Array.from({ length: n }, () => Array(n).fill(0));
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        res[dir > 0 ? x : n - 1 - x][dir > 0 ? n - 1 - y : y] = m[y][x];
    return res;
  }

  function tryRotate(dir) {
    const rotated = rotateMatrix(state.piece.shape, dir);
    for (const kick of [0, -1, 1, -2, 2]) {
      if (!collides(state.piece, kick, 0, rotated)) {
        state.piece.shape = rotated;
        state.piece.x += kick;
        sfx.rotate();
        return true;
      }
    }
    return false;
  }

  // ---------- Piece lifecycle ----------
  function forEachPieceCell(piece, fn) {
    for (let y = 0; y < piece.shape.length; y++)
      for (let x = 0; x < piece.shape[y].length; x++)
        if (piece.shape[y][x]) fn(piece.x + x, piece.y + y);
  }

  function lockPiece() {
    const piece = state.piece;

    // Top-out check first, so the grid is never left half-written on game over.
    let toppedOut = false;
    forEachPieceCell(piece, (gx, gy) => { if (gy < 0) toppedOut = true; });
    if (toppedOut) { endGame(); return; }

    forEachPieceCell(piece, (gx, gy) => { state.grid[gy][gx] = piece.type; });

    clearLines();
    state.canHold = true;
    state.dropTimer = 0;
    state.piece = spawnPiece(takeNext());
    if (collides(state.piece)) { endGame(); return; }
    updateStats();
    drawQueue();
    draw();
  }

  function clearLines() {
    let cleared = 0;

    // Full rows (classic horizontal lines)
    for (let y = ROWS - 1; y >= 0; y--) {
      if (state.grid[y].every(cell => cell)) {
        state.grid.splice(y, 1);
        state.grid.unshift(Array(COLS).fill(null));
        cleared++;
        y++; // re-check this index, rows shifted down into it
      }
    }

    // Full columns (house rule — the field scores both directions)
    for (let x = 0; x < COLS; x++) {
      let full = true;
      for (let y = 0; y < ROWS; y++) {
        if (!state.grid[y][x]) { full = false; break; }
      }
      if (!full) continue;
      for (let y = 0; y < ROWS; y++) state.grid[y][x] = null;
      cleared++;
    }

    if (cleared === 0) return;
    state.score += LINE_SCORES[Math.min(cleared, LINE_SCORES.length - 1)] * state.level;
    state.lines += cleared;
    state.level = Math.floor(state.lines / LINES_PER_LEVEL) + 1;
    state.dropInterval = Math.max(MIN_DROP_MS, BASE_DROP_MS - (state.level - 1) * DROP_STEP_MS);
    sfx.clear();
  }

  function ghostDistance() {
    let dist = 0;
    while (!collides(state.piece, 0, dist + 1)) dist++;
    return dist;
  }

  function hardDrop() {
    const dist = ghostDistance();
    state.piece.y += dist;
    if (dist > 0) state.score += dist * 2;
    sfx.hard();
    lockPiece();
  }

  function doHold() {
    if (!state.canHold || !state.piece) return;
    const current = state.piece.type;
    const swapped = state.holdType ? spawnPiece(state.holdType) : spawnPiece(takeNext());
    if (collides(swapped)) { endGame(); return; }

    state.piece = swapped;
    state.holdType = current;
    state.canHold = false;
    state.dropTimer = 0;
    sfx.hold();
    drawHold();
    drawQueue();
    draw();
  }

  // ---------- Readouts ----------
  function updateStats() {
    const num = stats ? stats.num : String;
    scoreEl.textContent = num(state.score);
    linesEl.textContent = num(state.lines);
    levelEl.textContent = state.level;

    const into = state.lines % LINES_PER_LEVEL;
    const pct = Math.round((into / LINES_PER_LEVEL) * 100);
    levelBar.style.width = pct + "%";
    levelPct.textContent = pct + "%";
    const togo = LINES_PER_LEVEL - into;
    levelToGo.textContent = `${togo} to go`;
    gravityEl.textContent = "Gravity " + (state.dropInterval / 1000).toFixed(2) + "s";
  }

  function updateMeta() {
    const total = Math.floor(state.elapsedMs / 1000);
    const mm = String(Math.floor(total / 60)).padStart(2, "0");
    const ss = String(total % 60).padStart(2, "0");
    sessionMeta.textContent = `TETRIS / BUILD 1.2 / SESSION ${mm}:${ss}`;
  }

  function renderTopScores() {
    if (!stats) return;
    const runs = stats.all()
      .filter(r => r.game === "tetris")
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

  // ---------- Rendering ----------
  /** Flat cell with a 1px gutter, matching the field in the design. */
  function drawCell(ctx, px, py, size, color, alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(px, py, size - GAP, size - GAP);
    ctx.globalAlpha = 1;
  }

  function draw() {
    // Gutter colour shows through as the grid.
    bctx.fillStyle = INK_GAP;
    bctx.fillRect(0, 0, FIELD_W, FIELD_H);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const type = state.grid[y][x];
        drawCell(bctx, x * CELL, y * CELL, CELL, type ? COLORS[type] : INK_EMPTY);
      }
    }

    if (!state.piece) return;

    const color = COLORS[state.piece.type];
    const drop = ghostDistance();
    if (drop > 0) {
      forEachPieceCell(state.piece, (gx, gy) => {
        if (gy + drop >= 0) drawCell(bctx, gx * CELL, (gy + drop) * CELL, CELL, color, 0.18);
      });
    }
    forEachPieceCell(state.piece, (gx, gy) => {
      if (gy >= 0) drawCell(bctx, gx * CELL, gy * CELL, CELL, color);
    });
  }

  /** Centred mini render of one piece, used for hold and the queue slots. */
  function drawMini(ctx, cv, type, maxCell) {
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!type) return;
    const shape = SHAPES[type];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let y = 0; y < shape.length; y++)
      for (let x = 0; x < shape[y].length; x++)
        if (shape[y][x]) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
    const w = maxX - minX + 1, h = maxY - minY + 1;
    const size = Math.min(maxCell, Math.floor(cv.width / (w + 1)), Math.floor(cv.height / (h + 1)));
    const ox = Math.round((cv.width - w * size) / 2);
    const oy = Math.round((cv.height - h * size) / 2);
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++)
        if (shape[y][x]) drawCell(ctx, ox + (x - minX) * size, oy + (y - minY) * size, size, COLORS[type]);
  }

  function drawQueue() {
    const upcoming = state.running ? peekQueue(3) : [null, null, null];
    const sizes = [17, 13, 13];
    queueCtxs.forEach((ctx, i) => drawMini(ctx, queueCvs[i], upcoming[i], sizes[i]));
  }
  const drawHold = () => drawMini(hctx, holdCv, state.holdType, 18);

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
    cancelAnimationFrame(state.rafId);   // never leave a second loop running
    Object.assign(state, {
      grid: emptyGrid(), bag: [], holdType: null, piece: null,
      score: 0, lines: 0, level: 1,
      canHold: true, paused: false, gameOver: false, running: true,
      dropInterval: BASE_DROP_MS, dropTimer: 0, lastTime: 0,
      elapsedMs: 0, metaTimer: 0,
    });
    state.piece = spawnPiece(takeNext());
    updateStats();
    updateMeta();
    drawQueue();
    drawHold();
    hideOverlay();
    pauseBtn.textContent = "Pause";
    draw();
    state.rafId = requestAnimationFrame(loop);
  }

  function endGame() {
    state.gameOver = true;
    state.running = false;
    state.paused = false;
    cancelAnimationFrame(state.rafId);
    sfx.over();
    draw();
    drawQueue();

    if (stats) {
      stats.record("tetris", {
        score: state.score,
        lines: state.lines,
        level: state.level,
        durationMs: state.elapsedMs,
      });
      renderTopScores();
    }
    const num = stats ? stats.num : String;
    showOverlay("Game over", `Score ${num(state.score)} · ${state.lines} lines · level ${state.level}`, "Play again");
  }

  function setPaused(paused) {
    if (!state.running || state.gameOver || state.paused === paused) return;
    state.paused = paused;
    pauseBtn.textContent = paused ? "Resume" : "Pause";
    if (paused) {
      showOverlay("Paused", "Press P to resume", "Resume");
    } else {
      hideOverlay();
      state.lastTime = 0;
    }
  }
  const togglePause = () => setPaused(!state.paused);

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

    state.dropTimer += dt;
    while (state.running && state.dropTimer >= state.dropInterval) {
      state.dropTimer -= state.dropInterval;
      if (collides(state.piece, 0, 1)) {
        lockPiece();   // re-draws, and may end the game
        break;
      }
      state.piece.y++;
      draw();
    }
  }

  // ---------- Input ----------
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (!GAME_KEYS.has(e.code)) return;
    if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    ensureAudio();
    e.preventDefault();          // stop arrows/space from scrolling the page

    if (e.repeat && (e.code === "Space" || e.code === "KeyC" || e.code === "KeyP" || e.code === "Enter")) return;

    if (e.code === "Enter") {
      if (!state.running) startGame();
      else togglePause();
      return;
    }
    if (!state.running || state.paused || state.gameOver) return;

    const p = state.piece;
    switch (e.code) {
      case "ArrowLeft":
        if (!collides(p, -1, 0)) { p.x--; sfx.move(); draw(); }
        break;
      case "ArrowRight":
        if (!collides(p, 1, 0)) { p.x++; sfx.move(); draw(); }
        break;
      case "ArrowDown":
        if (!collides(p, 0, 1)) {
          p.y++; state.score += 1; state.dropTimer = 0;
          sfx.soft(); updateStats(); draw();
        }
        break;
      case "ArrowUp":
      case "KeyX":
        tryRotate(1); draw();
        break;
      case "KeyZ":
        tryRotate(-1); draw();
        break;
      case "Space":  hardDrop(); break;
      case "KeyC":   doHold(); break;
      case "KeyP":   togglePause(); break;
    }
  });

  startBtn.addEventListener("click", () => {
    ensureAudio();
    startBtn.blur();             // otherwise Space/Enter would re-trigger the button mid-game
    if (state.paused) setPaused(false);
    else startGame();
  });

  pauseBtn.addEventListener("click", () => {
    pauseBtn.blur();
    if (state.running) togglePause();
    else startGame();
  });

  // Auto-pause when the player switches away.
  window.addEventListener("blur", () => setPaused(true));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) setPaused(true);
  });

  // ---------- Initial idle render ----------
  state.grid = emptyGrid();
  updateStats();
  updateMeta();
  renderTopScores();
  drawQueue();
  drawHold();
  if (window.Arcade && window.Arcade.fitCanvas) window.Arcade.fitCanvas(boardCv, FIELD_W, FIELD_H, draw);
  else draw();
})();
