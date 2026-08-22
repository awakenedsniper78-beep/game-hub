/* 2048 — game logic and rendering for the instrument-panel play screen (3b).
   Turn-based, so there is no animation loop: the board re-renders per move.
   Depends on catalog.js/stats.js for the local score history. */
(() => {
  "use strict";

  // ---------- Constants ----------
  const SIZE = 4;
  const GOAL = 2048;
  const START_TILES = 2;
  const FOUR_CHANCE = 0.1;

  const DIRS = {
    left:  { dx: -1, dy: 0, arrow: "←" },
    right: { dx: 1,  dy: 0, arrow: "→" },
    up:    { dx: 0,  dy: -1, arrow: "↑" },
    down:  { dx: 0,  dy: 1,  arrow: "↓" },
  };
  const KEY_DIRS = {
    ArrowLeft: "left", KeyA: "left",
    ArrowRight: "right", KeyD: "right",
    ArrowUp: "up", KeyW: "up",
    ArrowDown: "down", KeyS: "down",
  };
  const GAME_KEYS = new Set([...Object.keys(KEY_DIRS), "KeyU", "KeyR", "Enter", "Space"]);
  const LOG_LINES = 4;

  // ---------- DOM ----------
  const byId = (id) => document.getElementById(id);
  const gridEl = byId("grid");
  const scoreEl = byId("score"), movesEl = byId("moves"), mergesEl = byId("merges");
  const goalBar = byId("goalBar"), goalPct = byId("goalPct"), bestTileEl = byId("bestTile");
  const freeEl = byId("freeCells"), legalEl = byId("legalMoves"), pairsEl = byId("mergePairs");
  const lastMoveEl = byId("lastMove"), moveLogEl = byId("moveLog"), undoState = byId("undoState");
  const sessionMeta = byId("sessionMeta"), topScoresEl = byId("topScores");
  const overlay = byId("overlay"), ovTitle = byId("ovTitle"), ovMsg = byId("ovMsg");
  const startBtn = byId("startBtn"), newGameBtn = byId("newGameBtn");

  const stats = window.Arcade && window.Arcade.stats;
  const num = stats ? stats.num : String;

  // ---------- Audio ----------
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { audioCtx = null; }
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  }
  function beep(freq, dur, type = "square", vol = 0.05, when = 0) {
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
    slide: () => beep(180, 0.04, "square", 0.025),
    merge: (value) => beep(260 + Math.min(9, Math.log2(value)) * 60, 0.07, "square", 0.045),
    milestone: () => { beep(659, 0.09, "triangle", 0.05); beep(988, 0.14, "triangle", 0.05, 0.08); },
    over: () => { beep(392, 0.18, "sawtooth", 0.06); beep(311, 0.18, "sawtooth", 0.06, 0.18); beep(233, 0.35, "sawtooth", 0.06, 0.36); },
  };

  // ---------- State ----------
  const state = {
    grid: [], score: 0, moves: 0, merges: 0,
    log: [], undo: null, reachedGoal: false, over: false,
    startedAt: Date.now(), recorded: false,
  };

  const emptyGrid = () => Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  const cloneGrid = (g) => g.map(row => row.slice());

  function freeCells(g) {
    const free = [];
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++)
        if (!g[y][x]) free.push({ x, y });
    return free;
  }

  function addRandomTile(g) {
    const free = freeCells(g);
    if (!free.length) return false;
    const spot = free[Math.floor(Math.random() * free.length)];
    g[spot.y][spot.x] = Math.random() < FOUR_CHANCE ? 4 : 2;
    return true;
  }

  // ---------- Core move ----------
  /** Collapse one line towards index 0. Returns {line, gained, merges, biggest}. */
  function collapse(values) {
    const tiles = values.filter(v => v);
    const line = [];
    let gained = 0, merges = 0, biggest = 0;
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] === tiles[i + 1]) {
        const merged = tiles[i] * 2;
        line.push(merged);
        gained += merged;
        merges++;
        biggest = Math.max(biggest, merged);
        i++;                       // the partner is consumed
      } else {
        line.push(tiles[i]);
      }
    }
    while (line.length < SIZE) line.push(0);
    return { line, gained, merges, biggest };
  }

  /** Read a row/column in the direction of travel, so collapse() always works
      towards index 0. */
  function lineFor(g, dir, index) {
    const cells = [];
    for (let i = 0; i < SIZE; i++) {
      const step = (dir === "left" || dir === "up") ? i : SIZE - 1 - i;
      cells.push((dir === "left" || dir === "right")
        ? { x: step, y: index }
        : { x: index, y: step });
    }
    return cells;
  }

  /** Apply a move to a grid copy. Returns null when nothing shifts. */
  function simulate(g, dir) {
    const next = cloneGrid(g);
    let gained = 0, merges = 0, biggest = 0, changed = false;

    for (let index = 0; index < SIZE; index++) {
      const cells = lineFor(next, dir, index);
      const before = cells.map(c => next[c.y][c.x]);
      const result = collapse(before);
      if (result.line.some((v, i) => v !== before[i])) changed = true;
      cells.forEach((c, i) => { next[c.y][c.x] = result.line[i]; });
      gained += result.gained;
      merges += result.merges;
      biggest = Math.max(biggest, result.biggest);
    }
    return changed ? { grid: next, gained, merges, biggest } : null;
  }

  const canMove = (g) => Object.keys(DIRS).some(dir => simulate(g, dir));

  function mergePairs(g) {
    let pairs = 0;
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const v = g[y][x];
        if (!v) continue;
        if (x + 1 < SIZE && g[y][x + 1] === v) pairs++;
        if (y + 1 < SIZE && g[y + 1][x] === v) pairs++;
      }
    return pairs;
  }

  const bestTile = (g) => Math.max(...g.flat(), 0);

  function move(dirName) {
    if (state.over) return;
    const result = simulate(state.grid, dirName);
    const dir = DIRS[dirName];

    if (!result) {
      log(`${state.moves + 1} ${dir.arrow} BLOCKED`);
      render();
      return;
    }

    // One level of undo, captured before the board changes.
    state.undo = {
      grid: cloneGrid(state.grid),
      score: state.score,
      moves: state.moves,
      merges: state.merges,
      log: state.log.slice(),
    };

    const previousBest = bestTile(state.grid);
    state.grid = result.grid;
    state.score += result.gained;
    state.moves++;
    state.merges += result.merges;
    addRandomTile(state.grid);

    lastMoveEl.textContent = `Last move ${dir.arrow}` + (result.gained ? ` · +${num(result.gained)}` : "");
    log(result.merges
      ? `${state.moves} ${dir.arrow} MERGE ${num(result.biggest / 2)}+${num(result.biggest / 2)}`
      : `${state.moves} ${dir.arrow} NO MERGE`);

    const best = bestTile(state.grid);
    if (result.merges) sfx.merge(result.biggest); else sfx.slide();
    if (best > previousBest && best >= 128) sfx.milestone();

    if (best >= GOAL && !state.reachedGoal) {
      state.reachedGoal = true;
      showOverlay("2048", `Reached in ${state.moves} moves · ${num(state.score)} points`, "Keep going", "continue");
    } else if (!canMove(state.grid)) {
      endGame();
    }
    render();
  }

  function undo() {
    if (!state.undo || state.over) return;
    Object.assign(state, {
      grid: state.undo.grid,
      score: state.undo.score,
      moves: state.undo.moves,
      merges: state.undo.merges,
      log: state.undo.log,
      undo: null,
    });
    lastMoveEl.textContent = "Last move — undone";
    render();
  }

  // ---------- Logging ----------
  function log(text) {
    const [n, ...rest] = text.split(" ");
    state.log.unshift({ n, text: rest.join(" ") });
    state.log = state.log.slice(0, LOG_LINES);
  }

  // ---------- Game flow ----------
  function newGame() {
    Object.assign(state, {
      grid: emptyGrid(), score: 0, moves: 0, merges: 0,
      log: [], undo: null, reachedGoal: false, over: false,
      startedAt: Date.now(), recorded: false,
    });
    for (let i = 0; i < START_TILES; i++) addRandomTile(state.grid);
    lastMoveEl.textContent = "Last move —";
    hideOverlay();
    render();
  }

  function endGame() {
    state.over = true;
    sfx.over();
    if (stats && !state.recorded) {
      state.recorded = true;
      stats.record("2048", {
        score: state.score,
        level: Math.max(1, Math.round(Math.log2(bestTile(state.grid) || 2))),
        durationMs: Date.now() - state.startedAt,
      });
      renderTopScores();
    }
    showOverlay(
      "No moves left",
      `${num(state.score)} points · best tile ${num(bestTile(state.grid))} · ${state.moves} moves`,
      "New game", "restart"
    );
  }

  // ---------- Overlay ----------
  let overlayAction = "restart";
  function showOverlay(title, message, buttonLabel, action) {
    ovTitle.textContent = title;
    ovMsg.textContent = message;
    startBtn.textContent = buttonLabel;
    overlayAction = action;
    overlay.classList.remove("hidden");
  }
  const hideOverlay = () => overlay.classList.add("hidden");

  // ---------- Rendering ----------
  function tileClass(value) {
    if (!value) return "cell empty";
    const ramp = value > GOAL ? "max" : value;
    return `cell t-${ramp}` + (String(value).length > 4 ? " small" : "");
  }

  function render() {
    gridEl.innerHTML = state.grid.flat()
      .map(v => `<div class="${tileClass(v)}" role="gridcell">${v ? num(v) : ""}</div>`)
      .join("");

    scoreEl.textContent = num(state.score);
    movesEl.textContent = num(state.moves);
    mergesEl.textContent = num(state.merges);

    const best = bestTile(state.grid);
    const pct = Math.min(100, Math.round((best / GOAL) * 100));
    goalBar.style.width = pct + "%";
    goalPct.textContent = pct + "%";
    bestTileEl.textContent = `Best tile ${num(best)}`;

    freeEl.textContent = freeCells(state.grid).length;
    legalEl.textContent = Object.keys(DIRS).filter(d => simulate(state.grid, d)).length;
    pairsEl.textContent = mergePairs(state.grid);

    undoState.textContent = state.undo ? "Undo ×1" : "Undo used";
    undoState.style.color = state.undo ? "var(--accent)" : "var(--dim)";

    moveLogEl.innerHTML = state.log.length
      ? state.log.map(e => `<span><b>${e.n}</b> ${e.text}</span>`).join("")
      : `<span class="idle">Slide to begin…</span>`;
  }

  function renderTopScores() {
    if (!stats) return;
    const runs = stats.all()
      .filter(r => r.game === "2048")
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

  // ---------- Session clock ----------
  setInterval(() => {
    if (document.hidden || state.over) return;
    const total = Math.floor((Date.now() - state.startedAt) / 1000);
    const mm = String(Math.floor(total / 60)).padStart(2, "0");
    const ss = String(total % 60).padStart(2, "0");
    sessionMeta.textContent = `2048 / BUILD 1.0 / SESSION ${mm}:${ss}`;
  }, 1000);

  // ---------- Input ----------
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (!GAME_KEYS.has(e.code)) return;
    if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    ensureAudio();
    e.preventDefault();

    if (e.code === "KeyR") { newGame(); return; }
    if (e.code === "KeyU") { undo(); return; }
    if (e.code === "Enter" || e.code === "Space") {
      if (!overlay.classList.contains("hidden")) startBtn.click();
      return;
    }
    const dir = KEY_DIRS[e.code];
    if (dir) move(dir);
  });

  startBtn.addEventListener("click", () => {
    ensureAudio();
    startBtn.blur();
    if (overlayAction === "continue") hideOverlay();   // 2048 reached, play on
    else newGame();
  });

  newGameBtn.addEventListener("click", () => {
    ensureAudio();
    newGameBtn.blur();
    newGame();
  });

  // ---------- Boot ----------
  renderTopScores();
  newGame();
})();
