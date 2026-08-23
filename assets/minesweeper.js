/* Minesweeper — game logic for the instrument-panel play screen.
   The board is DOM rather than canvas: every cell is a real button, so focus,
   keyboard play and screen readers all work without extra machinery.
   Depends on catalog.js/stats.js for the local score history.               */
(() => {
  "use strict";

  const MODES = {
    beginner: { label: "Beginner", cols: 9,  rows: 9,  mines: 10, level: 1,
                note: "9 × 9, 10 mines. Room to learn the patterns." },
    standard: { label: "Standard", cols: 16, rows: 16, mines: 40, level: 2,
                note: "16 × 16, 40 mines. The usual game." },
    expert:   { label: "Expert",   cols: 20, rows: 20, mines: 80, level: 3,
                note: "20 × 20, 80 mines. One in five is live." },
  };

  const POINTS_PER_CELL = 5;
  const WIN_PER_MINE = 20;
  const TIME_BONUS_PER_MINE = 12;    // decays at 2 points a second
  const LOG_LINES = 5;

  // ---------- DOM ----------
  const byId = (id) => document.getElementById(id);
  const gridEl = byId("grid");
  const scoreEl = byId("score"), minesLeftEl = byId("minesLeft"), timeEl = byId("time");
  const clearBar = byId("clearBar"), clearCount = byId("clearCount"), clearPct = byId("clearPct");
  const modesEl = byId("modes"), modeNote = byId("modeNote");
  const boardMeta = byId("boardMeta"), flagMeta = byId("flagMeta"), sessionMeta = byId("sessionMeta");
  const sweepLogEl = byId("sweepLog"), topScoresEl = byId("topScores");
  const overlay = byId("overlay"), ovTitle = byId("ovTitle"), ovMsg = byId("ovMsg");
  const startBtn = byId("startBtn"), newGameBtn = byId("newGameBtn");

  const stats = window.Arcade && window.Arcade.stats;
  const num = stats ? stats.num : String;
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
    reveal: () => beep(440, 0.03, "square", 0.02),
    sweep:  () => { beep(523, 0.05, "triangle", 0.03); beep(784, 0.06, "triangle", 0.03, 0.04); },
    flag:   () => beep(660, 0.04, "triangle", 0.035),
    unflag: () => beep(330, 0.04, "triangle", 0.03),
    boom:   () => { beep(180, 0.22, "sawtooth", 0.06); beep(120, 0.3, "sawtooth", 0.06, 0.16); },
    win:    () => { beep(523, 0.09, "triangle", 0.05); beep(659, 0.09, "triangle", 0.05, 0.09);
                    beep(784, 0.09, "triangle", 0.05, 0.18); beep(1046, 0.2, "triangle", 0.05, 0.27); },
  };

  // ---------- State ----------
  const state = {
    mode: "standard", cells: [], cols: 0, rows: 0, mines: 0,
    seeded: false, revealed: 0, flags: 0, score: 0,
    running: false, gameOver: false, won: false,
    startedAt: 0, elapsedMs: 0, timer: 0, focus: 0, log: [],
  };

  const spec = () => MODES[state.mode];
  const total = () => state.cols * state.rows;
  const safeCells = () => total() - state.mines;

  const idx = (x, y) => y * state.cols + x;
  const xOf = (i) => i % state.cols;
  const yOf = (i) => Math.floor(i / state.cols);

  function neighbours(i) {
    const x = xOf(i), y = yOf(i), out = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= state.cols || ny >= state.rows) continue;
        out.push(idx(nx, ny));
      }
    }
    return out;
  }

  // ---------- Log ----------
  const cellWord = (n) => `${n} CELL${n === 1 ? "" : "S"}`;

  function log(text) {
    state.log.unshift({ t: state.elapsedMs, text });
    state.log = state.log.slice(0, LOG_LINES);
    renderLog();
  }

  function clock(ms) {
    const t = Math.floor(ms / 1000);
    return pad2(Math.floor(t / 60)) + ":" + pad2(t % 60);
  }

  function renderLog() {
    sweepLogEl.innerHTML = state.log.length
      ? state.log.map(e => `<span><time>${clock(e.t)}</time> ${e.text}</span>`).join("")
      : `<span class="idle">Awaiting first click…</span>`;
  }

  // ---------- Readouts ----------
  function updateStats() {
    scoreEl.textContent = num(state.score);
    minesLeftEl.textContent = state.mines - state.flags;
    timeEl.textContent = clock(state.elapsedMs);

    const pct = Math.round((state.revealed / safeCells()) * 100);
    clearBar.style.width = pct + "%";
    clearCount.textContent = `${state.revealed} of ${safeCells()}`;
    clearPct.textContent = pct + "%";

    boardMeta.textContent = `Grid ${state.cols} × ${state.rows} · ${state.mines} mines`;
    flagMeta.textContent = `Flags ${state.flags} / ${state.mines}`;
  }

  function updateMeta() {
    sessionMeta.textContent = `MINESWEEPER / BUILD 1.0 / SESSION ${clock(state.elapsedMs)}`;
  }

  function renderTopScores() {
    if (!stats) return;
    const runs = stats.all()
      .filter(r => r.game === "minesweeper")
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

  function syncModeUI() {
    for (const button of modesEl.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(button.dataset.mode === state.mode));
    }
    modeNote.textContent = spec().note;
  }

  // ---------- Board ----------
  function buildBoard() {
    const s = spec();
    state.cols = s.cols;
    state.rows = s.rows;
    state.mines = s.mines;
    state.cells = Array.from({ length: total() }, () => ({
      mine: false, adj: 0, revealed: false, flagged: false,
    }));
    state.seeded = false;
    state.revealed = 0;
    state.flags = 0;

    gridEl.style.setProperty("--cols", state.cols);
    gridEl.setAttribute("aria-rowcount", state.rows);
    gridEl.setAttribute("aria-colcount", state.cols);

    // One innerHTML build up front; individual cells are patched after that.
    let html = "";
    for (let i = 0; i < total(); i++) {
      html += `<button type="button" class="cell hidden" data-i="${i}" tabindex="${i ? -1 : 0}"` +
              ` aria-label="Row ${yOf(i) + 1} column ${xOf(i) + 1}, hidden"></button>`;
    }
    gridEl.innerHTML = html;
    for (let i = 0; i < total(); i++) state.cells[i].el = gridEl.children[i];
    state.focus = 0;
  }

  /** Mines are laid after the first click so the opening move is never fatal —
      the clicked cell and its neighbours are kept clear to guarantee an open. */
  function seedMines(firstIndex) {
    const banned = new Set([firstIndex, ...neighbours(firstIndex)]);
    const pool = [];
    for (let i = 0; i < total(); i++) if (!banned.has(i)) pool.push(i);

    for (let n = 0; n < state.mines && pool.length; n++) {
      const pick = Math.floor(Math.random() * pool.length);
      state.cells[pool[pick]].mine = true;
      pool.splice(pick, 1);
    }
    for (let i = 0; i < total(); i++) {
      state.cells[i].adj = neighbours(i).filter(n => state.cells[n].mine).length;
    }
    state.seeded = true;
  }

  function paint(i) {
    const cell = state.cells[i];
    const el = cell.el;
    const pos = `Row ${yOf(i) + 1} column ${xOf(i) + 1}`;
    el.className = "cell";

    if (!cell.revealed) {
      el.classList.add(cell.flagged ? "flag" : "hidden");
      el.textContent = cell.flagged ? "⚑" : "";
      el.setAttribute("aria-label", `${pos}, ${cell.flagged ? "flagged" : "hidden"}`);
      return;
    }

    el.classList.add("open");
    if (cell.mine) {
      el.classList.add(cell.blown ? "blown" : "mine");
      el.textContent = "✳";
      el.setAttribute("aria-label", `${pos}, mine`);
    } else if (cell.adj) {
      el.classList.add("n" + cell.adj);
      el.textContent = cell.adj;
      el.setAttribute("aria-label", `${pos}, ${cell.adj}`);
    } else {
      el.textContent = "";
      el.setAttribute("aria-label", `${pos}, clear`);
    }
  }

  // ---------- Play ----------
  function startTimer() {
    if (state.timer) return;
    state.startedAt = Date.now() - state.elapsedMs;
    state.timer = setInterval(() => {
      state.elapsedMs = Date.now() - state.startedAt;
      updateStats();
      updateMeta();
    }, 250);
  }

  function stopTimer() {
    clearInterval(state.timer);
    state.timer = 0;
  }

  /** Iterative flood fill — a recursive one blows the stack on a big open board. */
  function reveal(start) {
    const queue = [start];
    let opened = 0;

    while (queue.length) {
      const i = queue.pop();
      const cell = state.cells[i];
      if (cell.revealed || cell.flagged) continue;
      cell.revealed = true;
      opened++;
      state.revealed++;
      paint(i);
      if (!cell.adj && !cell.mine) for (const n of neighbours(i)) queue.push(n);
    }
    if (opened) state.score += opened * POINTS_PER_CELL;
    return opened;
  }

  function clickCell(i) {
    if (state.gameOver) return;
    const cell = state.cells[i];

    if (!state.seeded) {
      seedMines(i);
      state.running = true;
      startTimer();
      hideOverlay();
      log(`OPENING · ${spec().label.toUpperCase()}`);
    }
    if (cell.flagged) return;

    if (cell.revealed) return chord(i);

    if (cell.mine) {
      cell.blown = true;
      return endGame(false);
    }

    const opened = reveal(i);
    if (opened > 1) { sfx.sweep(); log(`SWEPT ${cellWord(opened)} · +${num(opened * POINTS_PER_CELL)}`); }
    else if (opened) sfx.reveal();

    updateStats();
    if (state.revealed >= safeCells()) endGame(true);
  }

  /** Clicking a satisfied number opens its unflagged neighbours. */
  function chord(i) {
    const cell = state.cells[i];
    if (!cell.adj) return;
    const around = neighbours(i);
    const flagged = around.filter(n => state.cells[n].flagged).length;
    if (flagged !== cell.adj) return;

    const hits = around.filter(n => !state.cells[n].flagged && !state.cells[n].revealed);
    if (!hits.length) return;

    if (hits.some(n => state.cells[n].mine)) {
      for (const n of hits) if (state.cells[n].mine) state.cells[n].blown = true;
      log("CHORD HIT A MINE");
      return endGame(false);
    }
    let opened = 0;
    for (const n of hits) opened += reveal(n);
    if (opened) { sfx.sweep(); log(`CHORD · ${cellWord(opened)} · +${num(opened * POINTS_PER_CELL)}`); }

    updateStats();
    if (state.revealed >= safeCells()) endGame(true);
  }

  function toggleFlag(i) {
    if (state.gameOver) return;
    const cell = state.cells[i];
    if (cell.revealed) return;
    if (!state.seeded) { state.running = true; startTimer(); hideOverlay(); }

    cell.flagged = !cell.flagged;
    state.flags += cell.flagged ? 1 : -1;
    if (cell.flagged) sfx.flag(); else sfx.unflag();
    paint(i);
    updateStats();
  }

  function endGame(won) {
    state.gameOver = true;
    state.running = false;
    state.won = won;
    if (state.startedAt) state.elapsedMs = Date.now() - state.startedAt;
    stopTimer();

    if (won) {
      const seconds = Math.floor(state.elapsedMs / 1000);
      const bonus = state.mines * WIN_PER_MINE +
        Math.max(0, state.mines * TIME_BONUS_PER_MINE - seconds * 2);
      state.score += bonus;
      // A cleared board flags the rest for you.
      for (let i = 0; i < total(); i++) {
        if (state.cells[i].mine && !state.cells[i].flagged) {
          state.cells[i].flagged = true;
          state.flags++;
          paint(i);
        }
      }
      sfx.win();
      log(`BOARD CLEARED · +${num(bonus)}`);
    } else {
      for (let i = 0; i < total(); i++) {
        const cell = state.cells[i];
        if (cell.mine && !cell.flagged) { cell.revealed = true; paint(i); }
        else if (cell.flagged && !cell.mine) { cell.el.classList.add("wrong"); }
      }
      sfx.boom();
      log("MINE · RUN ENDED");
    }

    updateStats();
    if (stats) {
      stats.record("minesweeper", {
        score: state.score,
        level: spec().level,
        durationMs: state.elapsedMs,
      });
      renderTopScores();
    }
    showOverlay(
      won ? "Board cleared" : "Boom",
      won
        ? `${spec().label} in ${clock(state.elapsedMs)} · ${num(state.score)} points`
        : `${state.revealed} of ${safeCells()} cells · ${num(state.score)} points`,
      "New board"
    );
  }

  function newGame() {
    stopTimer();
    Object.assign(state, {
      score: 0, revealed: 0, flags: 0, elapsedMs: 0,
      running: false, gameOver: false, won: false, seeded: false, log: [],
    });
    buildBoard();
    for (let i = 0; i < total(); i++) paint(i);
    syncModeUI();
    updateStats();
    updateMeta();
    renderLog();
    showOverlay("Minesweeper", "Click any cell to open the board", "Start");
  }

  // ---------- Overlay ----------
  function showOverlay(title, message, buttonLabel) {
    ovTitle.textContent = title;
    ovMsg.textContent = message;
    startBtn.textContent = buttonLabel;
    overlay.classList.remove("hidden");
  }
  const hideOverlay = () => overlay.classList.add("hidden");

  // ---------- Input ----------
  gridEl.addEventListener("click", (e) => {
    const button = e.target.closest("button[data-i]");
    if (!button) return;
    ensureAudio();
    setFocus(Number(button.dataset.i), false);
    clickCell(Number(button.dataset.i));
  });

  gridEl.addEventListener("contextmenu", (e) => {
    const button = e.target.closest("button[data-i]");
    if (!button) return;
    e.preventDefault();
    ensureAudio();
    setFocus(Number(button.dataset.i), false);
    toggleFlag(Number(button.dataset.i));
  });

  function setFocus(i, move = true) {
    if (i < 0 || i >= total()) return;
    state.cells[state.focus].el.tabIndex = -1;
    state.focus = i;
    const el = state.cells[i].el;
    el.tabIndex = 0;
    if (move) el.focus();
  }

  gridEl.addEventListener("keydown", (e) => {
    const button = e.target.closest("button[data-i]");
    if (!button) return;
    const i = Number(button.dataset.i);
    const x = xOf(i), y = yOf(i);

    if (e.key === "f" || e.key === "F") {
      e.preventDefault();
      ensureAudio();
      toggleFlag(i);
      return;
    }
    const moves = {
      ArrowLeft:  [x - 1, y], ArrowRight: [x + 1, y],
      ArrowUp:    [x, y - 1], ArrowDown:  [x, y + 1],
    };
    const move = moves[e.key];
    if (!move) return;
    const [nx, ny] = move;
    if (nx < 0 || ny < 0 || nx >= state.cols || ny >= state.rows) return;
    e.preventDefault();
    setFocus(idx(nx, ny));
  });

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === "r" || e.key === "R") { ensureAudio(); newGame(); }
  });

  modesEl.addEventListener("click", (e) => {
    const button = e.target.closest("button[data-mode]");
    if (!button) return;
    state.mode = button.dataset.mode;
    newGame();
  });

  startBtn.addEventListener("click", () => {
    ensureAudio();
    startBtn.blur();
    if (state.gameOver || !state.seeded) newGame();
    hideOverlay();
  });

  newGameBtn.addEventListener("click", () => {
    ensureAudio();
    newGameBtn.blur();
    newGame();
  });

  // ---------- Boot ----------
  newGame();
  renderTopScores();
})();
