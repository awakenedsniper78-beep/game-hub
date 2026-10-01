/* Home page — spec sheet, title strip and the player's top runs. */
(() => {
  "use strict";

  const { catalog, stats } = window.Gus;
  const pad2 = (n) => String(n).padStart(2, "0");
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const statusNote = (gus) => {
    if (gus.status === "playable") return "PLAYABLE";
    if (gus.status === "wip") return `BUILD ${gus.build || "—"}`;
    return "QUEUED";
  };

  // Spec sheet
  const playable = catalog.filter(g => g.status === "playable").length;
  document.getElementById("specPlayable").textContent = `${pad2(playable)} / ${pad2(catalog.length)}`;

  // Title strip — playable entries link, the rest are dimmed placeholders
  document.getElementById("titleStrip").innerHTML = catalog.map((gus, i) => {
    const body = `
      <span class="idx">${pad2(i + 1)}</span>
      <span class="nm">${esc(gus.name)}</span>
      <span class="micro sm">${statusNote(gus)}</span>`;
    return gus.href
      ? `<a href="${gus.href}">${body}</a>`
      : `<div class="off">${body}</div>`;
  }).join("");

  // Top runs
  const runs = stats.topRuns(4);
  const list = document.getElementById("topRuns");
  list.innerHTML = runs.length
    ? runs.map((run, i) => {
        const gus = window.Gus.byId(run.gus);
        // Only the personal best is called out in accent; the rest stay quiet.
        return `<div class="row${i === 0 ? " you" : ""}">
            <span>${esc((gus ? gus.name : run.gus).toUpperCase())} · ${stats.ago(run.ts)}</span>
            <b>${stats.num(run.score)}</b>
          </div>`;
      }).join("")
    : `<p class="empty">No runs recorded yet. Scores you set are saved in this browser and show up here —
       <a href="stack.html">start with Stack</a>.</p>`;
})();
