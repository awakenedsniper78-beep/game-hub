/* Profile page — every figure is derived from the local run history. */
(() => {
  "use strict";

  const { catalog, stats } = window.Arcade;
  const byId = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const runs = stats.all();
  const totals = stats.totals();

  // ---------- identity + headline figures ----------
  byId("streak").textContent = stats.streak();
  byId("timePlayed").textContent = totals.timeMs ? stats.duration(totals.timeMs) : "0m";
  byId("totalScore").textContent = stats.num(totals.score);
  byId("gamesPlayed").textContent = stats.num(totals.games);
  byId("linesCleared").textContent = stats.num(totals.lines);
  byId("bestLevel").textContent = totals.bestLevel || "—";

  byId("sessionLine").textContent = totals.first
    ? `Saved in this browser · ${totals.games} session${totals.games === 1 ? "" : "s"} since ` +
      new Date(totals.first).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : "Saved in this browser · no sessions yet";

  // ---------- personal bests ----------
  const rows = catalog.map(game => {
    const best = stats.best(game.id);
    const count = runs.filter(r => r.game === game.id).length;
    return `<div class="${best ? "" : "off"}">
        <span class="cell nm">${esc(game.name)}</span>
        <span class="cell val">${best ? stats.num(best.score) : "—"}</span>
        <span class="cell rank">${count || "N/A"}</span>
      </div>`;
  }).join("");
  byId("bests").insertAdjacentHTML("beforeend", rows);

  // ---------- session sparkline ----------
  const scores = stats.lastScores(14);
  const spark = byId("spark");
  if (scores.length) {
    const peak = Math.max(...scores, 1);
    spark.innerHTML = scores.map((score, i) => {
      const height = Math.max(2, Math.round((score / peak) * 100));
      // Older runs sit back in the palette, the newest quarter is accent-blue.
      const shade = i >= scores.length - Math.ceil(scores.length / 3) ? "var(--accent)"
                  : i >= scores.length / 2 ? "#3a4570" : "var(--rule)";
      return `<i style="height:${height}%;background:${shade}"></i>`;
    }).join("");
    byId("sparkLabel").textContent = `Last ${scores.length} session${scores.length === 1 ? "" : "s"} · score`;
    byId("sparkFrom").textContent = stats.ago(runs[Math.max(0, runs.length - scores.length)].ts);
    byId("sparkTo").textContent = `LATEST · ${stats.num(scores[scores.length - 1])}`;

    const recent = scores.slice(-5);
    const average = Math.round(scores.reduce((n, s) => n + s, 0) / scores.length);
    const beating = recent.filter(s => s > average).length;
    byId("trend").innerHTML = `${beating} of your last ${recent.length} runs beat your ` +
      `${scores.length}-session average of <span style="color:var(--text)">${stats.num(average)}</span>.`;
  } else {
    spark.innerHTML = "";
    spark.style.display = "none";
    byId("sparkFrom").textContent = "";
    byId("sparkTo").textContent = "";
    byId("trend").innerHTML = 'Nothing recorded yet — <a href="tetris.html">play a round of Tetris</a> ' +
      "and this profile fills in.";
  }
})();
