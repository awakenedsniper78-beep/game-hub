/* Asteroids — game logic and vector rendering for the instrument-panel play
   screen. Everything wraps at the edges, including the drawing, so a rock
   straddling a border is painted on both sides.
   Depends on catalog.js/stats.js for the local score history.               */
(() => {
  "use strict";

  // ---------- Field geometry (logical units; fit.js scales the canvas) ------
  const W = 640, H = 480;

  const SHIP_R = 12;
  const TURN_RATE = 4.6;                  // rad/s
  const THRUST = 280;                     // px/s²
  const DRAG = 0.55;                      // velocity retained per second
  const MAX_SPEED = 430;

  const BULLET_SPEED = 470, BULLET_LIFE = 1.15, MAX_BULLETS = 4, FIRE_GAP = 0.17;

  /* Rocks split large → 2 medium → 2 small each, so one large rock is worth
     seven kills. The key in the left rail lists these values.               */
  const ROCKS = {
    3: { r: 42, value: 20, speed: 46 },
    2: { r: 24, value: 50, speed: 74 },
    1: { r: 13, value: 100, speed: 108 },
  };
  const PER_LARGE = 7;                    // 1 large + 2 medium + 4 small

  const START_LIVES = 3, MAX_LIVES = 5;
  const START_ROCKS = 4, MAX_ROCKS = 10;
  const WAVE_BONUS = 100;
  const EXTRA_LIFE_EVERY = 5000;
  const INVULN = 2.5, RESPAWN_DELAY = 1.2, SPAWN_CLEAR = 90;
  const HYPER_CHARGES = 3, HYPER_COOLDOWN = 1.5;

  const MAX_FRAME_MS = 250;
  const LOG_LINES = 5;

  const INK_GROUND = "#0b0e1a";
  const INK_GRID = "#141829";
  const SHIP_C = "#4f7cff";
  const ROCK_C = "#8b93b8";
  const SHOT_C = "#e8ecff";
  const FLAME_C = "#ffd166";

  const GAME_KEYS = new Set([
    "ArrowLeft", "ArrowRight", "ArrowUp", "KeyA", "KeyD", "KeyW",
    "Space", "Enter", "KeyP", "ShiftLeft", "ShiftRight",
  ]);

  // ---------- DOM ----------
  const byId = (id) => document.getElementById(id);
  const boardCv = byId("board"), ctx = boardCv.getContext("2d");
  const scoreEl = byId("score"), waveEl = byId("wave"), rocksEl = byId("rocks");
  const livesEl = byId("lives"), hyperEl = byId("hyper");
  const waveBar = byId("waveBar"), waveCount = byId("waveCount"), wavePct = byId("wavePct");
  const flightMeta = byId("flightMeta"), sessionMeta = byId("sessionMeta");
  const flightLogEl = byId("flightLog"), topScoresEl = byId("topScores");
  const overlay = byId("overlay"), ovTitle = byId("ovTitle"), ovMsg = byId("ovMsg");
  const startBtn = byId("startBtn"), pauseBtn = byId("pauseBtn");

  const stats = window.Arcade && window.Arcade.stats;
  const num = stats ? stats.num : String;
  const pad2 = (n) => String(n).padStart(2, "0");
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

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
    fire:  () => beep(720, 0.05, "square", 0.03),
    bust:  (size) => beep(90 + size * 60, 0.14, "sawtooth", 0.045),
    hyper: () => { beep(880, 0.06, "sine", 0.04); beep(280, 0.12, "sine", 0.04, 0.05); },
    death: () => { beep(240, 0.2, "sawtooth", 0.06); beep(150, 0.3, "sawtooth", 0.06, 0.18); },
    wave:  () => { beep(523, 0.08, "triangle", 0.045); beep(784, 0.08, "triangle", 0.045, 0.08);
                   beep(1046, 0.16, "triangle", 0.045, 0.16); },
    life:  () => { beep(659, 0.07, "triangle", 0.05); beep(988, 0.12, "triangle", 0.05, 0.07); },
    over:  () => { beep(392, 0.18, "sawtooth", 0.06); beep(311, 0.18, "sawtooth", 0.06, 0.18);
                   beep(233, 0.35, "sawtooth", 0.06, 0.36); },
  };

  // ---------- State ----------
  const state = {
    ship: null, rocks: [], bullets: [], bits: [],
    left: false, right: false, thrusting: false,
    score: 0, wave: 1, lives: START_LIVES, slots: START_LIVES,
    hyper: HYPER_CHARGES, hyperCool: 0,
    waveKills: 0, waveTotal: 0, nextLife: EXTRA_LIFE_EVERY,
    fireCool: 0, respawn: 0,
    running: false, paused: false, gameOver: false,
    elapsedMs: 0, lastTime: 0, metaTimer: 0, rafId: 0,
    log: [],
  };

  const wrap = (v, max) => ((v % max) + max) % max;

  // ---------- Flight log ----------
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
    flightLogEl.innerHTML = state.log.length
      ? state.log.map(e => `<span><time>${clock(e.t)}</time> ${e.text}</span>`).join("")
      : `<span class="idle">Awaiting launch…</span>`;
  }

  // ---------- Readouts ----------
  function updateStats() {
    scoreEl.textContent = num(state.score);
    waveEl.textContent = pad2(state.wave);
    rocksEl.textContent = state.rocks.length;

    const pct = state.waveTotal ? Math.round((state.waveKills / state.waveTotal) * 100) : 0;
    waveBar.style.width = pct + "%";
    waveCount.textContent = `${state.waveKills} of ${state.waveTotal}`;
    wavePct.textContent = pct + "%";

    let pips = "";
    for (let i = 0; i < state.slots; i++) pips += `<i${i < state.lives ? "" : ' class="spent"'}></i>`;
    livesEl.innerHTML = pips;

    let charges = "";
    for (let i = 0; i < HYPER_CHARGES; i++) charges += `<i${i < state.hyper ? "" : ' class="spent"'}></i>`;
    hyperEl.innerHTML = charges;

    const speed = state.ship ? Math.round(Math.hypot(state.ship.vx, state.ship.vy)) : 0;
    flightMeta.textContent = `Drift ${speed}px/s · ${state.rocks.length} rock` +
      (state.rocks.length === 1 ? "" : "s");
  }

  function updateMeta() {
    sessionMeta.textContent = `ASTEROIDS / BUILD 1.0 / SESSION ${clock(state.elapsedMs)}`;
  }

  function renderTopScores() {
    if (!stats) return;
    const runs = stats.all()
      .filter(r => r.game === "asteroids")
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

  // ---------- Entities ----------
  function newShip() {
    return { x: W / 2, y: H / 2, angle: -Math.PI / 2, vx: 0, vy: 0, invuln: INVULN };
  }

  function newRock(size, x, y) {
    const spec = ROCKS[size];
    const dir = rand(0, Math.PI * 2);
    const speed = rand(spec.speed * 0.6, spec.speed * 1.35) * (1 + (state.wave - 1) * 0.06);
    const points = Math.round(rand(9, 12));
    return {
      x, y, size,
      r: spec.r,
      vx: Math.cos(dir) * speed,
      vy: Math.sin(dir) * speed,
      angle: rand(0, Math.PI * 2),
      spin: rand(-1.1, 1.1),
      shape: Array.from({ length: points }, () => rand(0.74, 1.24)),
    };
  }

  /** Spawn a wave's rocks around the rim so none lands on top of the ship. */
  function spawnWave() {
    const count = Math.min(MAX_ROCKS, START_ROCKS + state.wave - 1);
    state.rocks = [];
    for (let i = 0; i < count; i++) {
      let x, y, tries = 0;
      do {
        x = rand(0, W);
        y = rand(0, H);
        tries++;
      } while (tries < 40 && Math.hypot(x - W / 2, y - H / 2) < 150);
      state.rocks.push(newRock(3, x, y));
    }
    state.waveKills = 0;
    state.waveTotal = count * PER_LARGE;
  }

  function burst(x, y, n, spread) {
    for (let i = 0; i < n; i++) {
      const dir = rand(0, Math.PI * 2);
      const speed = rand(spread * 0.3, spread);
      state.bits.push({
        x, y,
        vx: Math.cos(dir) * speed,
        vy: Math.sin(dir) * speed,
        life: rand(0.35, 0.9),
      });
    }
  }

  // ---------- Play ----------
  function fire() {
    if (!state.ship || state.fireCool > 0) return;
    if (state.bullets.length >= MAX_BULLETS) return;
    const s = state.ship;
    state.bullets.push({
      x: s.x + Math.cos(s.angle) * SHIP_R,
      y: s.y + Math.sin(s.angle) * SHIP_R,
      vx: s.vx + Math.cos(s.angle) * BULLET_SPEED,
      vy: s.vy + Math.sin(s.angle) * BULLET_SPEED,
      life: BULLET_LIFE,
    });
    state.fireCool = FIRE_GAP;
    sfx.fire();
  }

  function hyperspace() {
    if (!state.ship || state.hyper <= 0 || state.hyperCool > 0) return;
    state.hyper--;
    state.hyperCool = HYPER_COOLDOWN;
    const s = state.ship;
    burst(s.x, s.y, 10, 90);
    s.x = rand(40, W - 40);
    s.y = rand(40, H - 40);
    s.vx = s.vy = 0;
    s.invuln = Math.max(s.invuln, 0.9);
    sfx.hyper();
    log(`HYPERSPACE · ${state.hyper} LEFT`);
  }

  function awardScore(points) {
    state.score += points;
    if (state.score >= state.nextLife) {
      state.nextLife += EXTRA_LIFE_EVERY;
      if (state.lives < MAX_LIVES) {
        state.lives++;
        state.slots = Math.max(state.slots, state.lives);
      }
      sfx.life();
      log(`EXTRA SHIP · ${num(state.score)}`);
    }
  }

  function bustRock(index) {
    const rock = state.rocks[index];
    const spec = ROCKS[rock.size];
    state.rocks.splice(index, 1);
    state.waveKills++;
    awardScore(spec.value);
    burst(rock.x, rock.y, rock.size * 5 + 4, 40 + rock.size * 28);
    sfx.bust(rock.size);

    if (rock.size > 1) {
      for (let i = 0; i < 2; i++) {
        const shard = newRock(rock.size - 1, rock.x, rock.y);
        shard.vx += rock.vx * 0.4;
        shard.vy += rock.vy * 0.4;
        state.rocks.push(shard);
      }
    }
    if (!state.rocks.length) clearWave();
  }

  function clearWave() {
    const bonus = WAVE_BONUS * state.wave;
    awardScore(bonus);
    log(`WAVE ${pad2(state.wave)} CLEARED · +${num(bonus)}`);
    state.wave++;
    if (state.hyper < HYPER_CHARGES) state.hyper++;      // one charge back per wave
    spawnWave();
    sfx.wave();
  }

  function killShip() {
    const s = state.ship;
    burst(s.x, s.y, 22, 140);
    state.ship = null;
    state.lives--;
    state.thrusting = false;
    sfx.death();

    if (state.lives <= 0) { log("SHIP LOST · NO SHIPS LEFT"); return endGame(); }
    log(`SHIP LOST · ${state.lives} LEFT`);
    state.respawn = RESPAWN_DELAY;
  }

  /** Only put a new ship back once the middle of the field is clear. */
  function centreClear() {
    return state.rocks.every(r => Math.hypot(r.x - W / 2, r.y - H / 2) > r.r + SPAWN_CLEAR);
  }

  // ---------- Update ----------
  function update(dt) {
    const sec = dt / 1000;

    if (state.fireCool > 0) state.fireCool -= sec;
    if (state.hyperCool > 0) state.hyperCool -= sec;

    // Ship
    if (state.ship) {
      const s = state.ship;
      if (state.left) s.angle -= TURN_RATE * sec;
      if (state.right) s.angle += TURN_RATE * sec;

      if (state.thrusting) {
        s.vx += Math.cos(s.angle) * THRUST * sec;
        s.vy += Math.sin(s.angle) * THRUST * sec;
        if (Math.random() < 0.6) {
          const back = s.angle + Math.PI;
          state.bits.push({
            x: s.x + Math.cos(back) * SHIP_R,
            y: s.y + Math.sin(back) * SHIP_R,
            vx: s.vx + Math.cos(back) * rand(60, 130),
            vy: s.vy + Math.sin(back) * rand(60, 130),
            life: rand(0.15, 0.35),
            warm: true,
          });
        }
      }
      const drag = Math.pow(DRAG, sec);
      s.vx *= drag;
      s.vy *= drag;

      const speed = Math.hypot(s.vx, s.vy);
      if (speed > MAX_SPEED) {
        s.vx = (s.vx / speed) * MAX_SPEED;
        s.vy = (s.vy / speed) * MAX_SPEED;
      }
      s.x = wrap(s.x + s.vx * sec, W);
      s.y = wrap(s.y + s.vy * sec, H);
      if (s.invuln > 0) s.invuln -= sec;
    } else if (state.respawn > 0) {
      state.respawn -= sec;
      if (state.respawn <= 0) {
        if (centreClear()) state.ship = newShip();
        else state.respawn = 0.3;                        // wait for a gap
      }
    }

    // Bullets
    for (let i = state.bullets.length - 1; i >= 0; i--) {
      const b = state.bullets[i];
      b.x = wrap(b.x + b.vx * sec, W);
      b.y = wrap(b.y + b.vy * sec, H);
      b.life -= sec;
      if (b.life <= 0) state.bullets.splice(i, 1);
    }

    // Rocks
    for (const r of state.rocks) {
      r.x = wrap(r.x + r.vx * sec, W);
      r.y = wrap(r.y + r.vy * sec, H);
      r.angle += r.spin * sec;
    }

    // Debris
    for (let i = state.bits.length - 1; i >= 0; i--) {
      const p = state.bits[i];
      p.x = wrap(p.x + p.vx * sec, W);
      p.y = wrap(p.y + p.vy * sec, H);
      p.life -= sec;
      if (p.life <= 0) state.bits.splice(i, 1);
    }

    collide();
  }

  /** Shortest separation on a wrapping field. */
  function gap(ax, ay, bx, by) {
    let dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
    if (dx > W / 2) dx = W - dx;
    if (dy > H / 2) dy = H - dy;
    return Math.hypot(dx, dy);
  }

  function collide() {
    // Bullets against rocks — walk backwards, both lists mutate on a hit.
    for (let bi = state.bullets.length - 1; bi >= 0; bi--) {
      const b = state.bullets[bi];
      for (let ri = state.rocks.length - 1; ri >= 0; ri--) {
        const r = state.rocks[ri];
        if (gap(b.x, b.y, r.x, r.y) > r.r) continue;
        state.bullets.splice(bi, 1);
        bustRock(ri);
        break;
      }
      if (!state.running) return;
    }

    if (!state.ship || state.ship.invuln > 0) return;
    for (const r of state.rocks) {
      if (gap(state.ship.x, state.ship.y, r.x, r.y) < r.r + SHIP_R * 0.7) {
        killShip();
        return;
      }
    }
  }

  // ---------- Rendering ----------
  /** Run a draw at every wrapped position the shape can straddle. */
  function drawWrapped(x, y, r, paint) {
    const xs = [x];
    const ys = [y];
    if (x < r) xs.push(x + W); else if (x > W - r) xs.push(x - W);
    if (y < r) ys.push(y + H); else if (y > H - r) ys.push(y - H);
    for (const px of xs) for (const py of ys) paint(px, py);
  }

  function drawGround() {
    ctx.fillStyle = INK_GROUND;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = INK_GRID;
    for (let x = 0; x <= W; x += 32) ctx.fillRect(x, 0, 1, H);
    for (let y = 0; y <= H; y += 32) ctx.fillRect(0, y, W, 1);
  }

  function drawRock(rock) {
    drawWrapped(rock.x, rock.y, rock.r, (px, py) => {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rock.angle);
      ctx.strokeStyle = ROCK_C;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      rock.shape.forEach((mul, i) => {
        const a = (i / rock.shape.length) * Math.PI * 2;
        const px2 = Math.cos(a) * rock.r * mul;
        const py2 = Math.sin(a) * rock.r * mul;
        if (i) ctx.lineTo(px2, py2); else ctx.moveTo(px2, py2);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawShip() {
    const s = state.ship;
    if (!s) return;
    // Blink while the respawn shield holds.
    if (s.invuln > 0 && Math.floor(s.invuln * 10) % 2 === 0) return;

    drawWrapped(s.x, s.y, SHIP_R + 6, (px, py) => {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(s.angle);
      ctx.strokeStyle = SHIP_C;
      ctx.lineWidth = 1.6;
      ctx.shadowColor = "rgba(79,124,255,.45)";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(SHIP_R, 0);
      ctx.lineTo(-SHIP_R * 0.72, SHIP_R * 0.66);
      ctx.lineTo(-SHIP_R * 0.4, 0);
      ctx.lineTo(-SHIP_R * 0.72, -SHIP_R * 0.66);
      ctx.closePath();
      ctx.stroke();

      if (state.thrusting) {
        ctx.shadowBlur = 0;
        ctx.strokeStyle = FLAME_C;
        ctx.beginPath();
        ctx.moveTo(-SHIP_R * 0.45, SHIP_R * 0.34);
        ctx.lineTo(-SHIP_R * (1.0 + Math.random() * 0.5), 0);
        ctx.lineTo(-SHIP_R * 0.45, -SHIP_R * 0.34);
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  function drawBullets() {
    ctx.fillStyle = SHOT_C;
    for (const b of state.bullets) {
      ctx.save();
      ctx.shadowColor = "rgba(232,236,255,.5)";
      ctx.shadowBlur = 8;
      ctx.fillRect(Math.round(b.x) - 1.5, Math.round(b.y) - 1.5, 3, 3);
      ctx.restore();
    }
  }

  function drawBits() {
    for (const p of state.bits) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.6));
      ctx.fillStyle = p.warm ? FLAME_C : ROCK_C;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    drawGround();
    drawBits();
    for (const rock of state.rocks) drawRock(rock);
    drawBullets();
    drawShip();
  }

  // ---------- Flow ----------
  function startGame() {
    cancelAnimationFrame(state.rafId);
    Object.assign(state, {
      rocks: [], bullets: [], bits: [],
      left: false, right: false, thrusting: false,
      score: 0, wave: 1, lives: START_LIVES, slots: START_LIVES,
      hyper: HYPER_CHARGES, hyperCool: 0,
      waveKills: 0, waveTotal: 0, nextLife: EXTRA_LIFE_EVERY,
      fireCool: 0, respawn: 0,
      running: true, paused: false, gameOver: false,
      elapsedMs: 0, lastTime: 0, metaTimer: 0,
      log: [],
    });
    state.ship = newShip();
    spawnWave();
    hideOverlay();
    pauseBtn.textContent = "Pause";
    updateStats();
    updateMeta();
    renderLog();
    draw();
    state.rafId = requestAnimationFrame(loop);
  }

  function endGame() {
    state.running = false;
    state.gameOver = true;
    state.paused = false;
    cancelAnimationFrame(state.rafId);
    sfx.over();
    draw();

    if (stats) {
      stats.record("asteroids", {
        score: state.score,
        level: state.wave,
        durationMs: state.elapsedMs,
      });
      renderTopScores();
    }
    showOverlay("Game over", `Wave ${pad2(state.wave)} · ${num(state.score)} points`, "Play again");
  }

  function setPaused(paused) {
    if (!state.running || state.gameOver || state.paused === paused) return;
    state.paused = paused;
    pauseBtn.textContent = paused ? "Resume" : "Pause";
    if (paused) {
      state.left = state.right = state.thrusting = false;
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

    update(dt);
    updateStats();
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
    if (e.code === "ArrowUp" || e.code === "KeyW") { state.thrusting = true; return; }

    if (e.code === "Space") {
      if (!state.running) { if (!e.repeat) startGame(); return; }
      if (state.paused) return;
      fire();
      return;
    }
    if (e.repeat) return;
    if (e.code === "Enter") { if (!state.running) startGame(); else togglePause(); return; }
    if (e.code === "KeyP") { togglePause(); return; }
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
      if (state.running && !state.paused) hyperspace();
    }
  });

  document.addEventListener("keyup", (e) => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") state.left = false;
    if (e.code === "ArrowRight" || e.code === "KeyD") state.right = false;
    if (e.code === "ArrowUp" || e.code === "KeyW") state.thrusting = false;
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
  window.addEventListener("blur", () => {
    state.left = state.right = state.thrusting = false;
    setPaused(true);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      state.left = state.right = state.thrusting = false;
      setPaused(true);
    }
  });

  // ---------- Initial idle render ----------
  state.ship = newShip();
  state.ship.invuln = 0;
  spawnWave();
  updateStats();
  updateMeta();
  renderLog();
  renderTopScores();
  if (window.Arcade && window.Arcade.fitCanvas) window.Arcade.fitCanvas(boardCv, W, H, draw);
  else draw();
})();
