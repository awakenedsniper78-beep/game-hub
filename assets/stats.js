/* Local play history. Every number shown on Home, Library and Profile comes
   from here — one record per finished run, kept in localStorage on this
   browser only. No accounts, no network, matching the design's
   "Saved in this browser" line.                                             */

window.Arcade = window.Arcade || {};

window.Arcade.stats = (() => {
  "use strict";

  const KEY = "arcade.history.v1";
  const DAY = 86400000;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      const runs = raw ? JSON.parse(raw) : [];
      return Array.isArray(runs) ? runs.filter(isRun) : [];
    } catch (e) {
      return [];                     // private mode, quota, or corrupt payload
    }
  }

  function isRun(r) {
    return r && typeof r.game === "string" && Number.isFinite(r.score) && Number.isFinite(r.ts);
  }

  function save(runs) {
    try { localStorage.setItem(KEY, JSON.stringify(runs.slice(-500))); }
    catch (e) { /* storage unavailable — the session still plays, just unrecorded */ }
  }

  /** Record one finished run. Extra fields (lines, level, durationMs) optional. */
  function record(game, run) {
    const runs = load();
    runs.push({
      game,
      ts: Date.now(),
      score: Number(run.score) || 0,
      lines: Number(run.lines) || 0,      // Tetris
      apples: Number(run.apples) || 0,    // Snake
      level: Number(run.level) || 1,
      durationMs: Number(run.durationMs) || 0,
    });
    save(runs);
    return runs;
  }

  const runsFor = (game) => load().filter(r => r.game === game);

  /** Highest-scoring run for a title, or null if never played. */
  function best(game) {
    return runsFor(game).reduce((top, r) => (!top || r.score > top.score ? r : top), null);
  }

  /** The last N runs, newest first. A title repeats if it was played twice. */
  function recentRuns(limit = 4) {
    return load().sort((a, b) => b.ts - a.ts).slice(0, limit);
  }

  /** Top runs across every title, newest-first tiebreak. */
  function topRuns(limit = 4) {
    return load().sort((a, b) => b.score - a.score || b.ts - a.ts).slice(0, limit);
  }

  function totals() {
    const runs = load();
    return {
      score: runs.reduce((n, r) => n + r.score, 0),
      games: runs.length,
      lines: runs.reduce((n, r) => n + r.lines, 0),
      bestLevel: runs.reduce((n, r) => Math.max(n, r.level), 0),
      timeMs: runs.reduce((n, r) => n + r.durationMs, 0),
      first: runs.length ? Math.min(...runs.map(r => r.ts)) : null,
    };
  }

  /** Consecutive days played, counting back from today (or yesterday). */
  function streak() {
    const days = new Set(load().map(r => Math.floor(r.ts / DAY)));
    if (!days.size) return 0;
    const today = Math.floor(Date.now() / DAY);
    let day = days.has(today) ? today : today - 1;
    if (!days.has(day)) return 0;
    let n = 0;
    while (days.has(day)) { n++; day--; }
    return n;
  }

  /** Scores of the last N runs, oldest first — the profile sparkline. */
  const lastScores = (n = 14) => load().slice(-n).map(r => r.score);

  const playsThisWeek = () => load().filter(r => r.ts > Date.now() - 7 * DAY).length;

  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) { /* nothing to do */ }
  }

  // ---------- formatting helpers shared by every page ----------
  const num = (n) => (Number(n) || 0).toLocaleString("en-US");

  function ago(ts) {
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 1) return "JUST NOW";
    if (mins < 60) return mins + "M AGO";
    const hours = Math.round(mins / 60);
    if (hours < 24) return hours + "H AGO";
    const days = Math.round(hours / 24);
    return days === 1 ? "YESTERDAY" : days + "D AGO";
  }

  function duration(ms) {
    const mins = Math.round(ms / 60000);
    if (mins < 60) return mins + "m";
    return Math.round(mins / 60) + "h";
  }

  return {
    record, best, recentRuns, topRuns, totals, streak, lastScores,
    playsThisWeek, clear, all: load, num, ago, duration,
  };
})();
