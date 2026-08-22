/* Home page — spec sheet, title strip and the player's top runs. */
(() => {
  "use strict";

  const { catalog, stats } = window.Arcade;
  const pad2 = (n) => String(n).padStart(2, "0");
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const statusNote = (game) => {
    if (game.status === "playable") return "PLAYABLE";
    if (game.status === "wip") return `BUILD ${game.build || "—"}`;
    return "QUEUED";
  };

  // Spec sheet
  const playable = catalog.filter(g => g.status === "playable").length;
  document.getElementById("specPlayable").textContent = `${pad2(playable)} / ${pad2(catalog.length)}`;

  // Title strip — playable entries link, the rest are dimmed placeholders
  document.getElementById("titleStrip").innerHTML = catalog.map((game, i) => {
    const body = `
      <span class="idx">${pad2(i + 1)}</span>
      <span class="nm">${esc(game.name)}</span>
      <span class="micro sm">${statusNote(game)}</span>`;
    return game.href
      ? `<a href="${game.href}">${body}</a>`
      : `<div class="off">${body}</div>`;
  }).join("");

  // Top runs
  const runs = stats.topRuns(4);
  const list = document.getElementById("topRuns");
  list.innerHTML = runs.length
    ? runs.map((run, i) => {
        const game = window.Arcade.byId(run.game);
        // Only the personal best is called out in accent; the rest stay quiet.
        return `<div class="row${i === 0 ? " you" : ""}">
            <span>${esc((game ? game.name : run.game).toUpperCase())} · ${stats.ago(run.ts)}</span>
            <b>${stats.num(run.score)}</b>
          </div>`;
      }).join("")
    : `<p class="empty">No runs recorded yet. Scores you set are saved in this browser and show up here —
       <a href="tetris.html">start with Tetris</a>.</p>`;
})();
