/* Library page — renders the catalogue, the recently-played strip and the
   search/filter behaviour. Data comes from catalog.js + stats.js. */
(() => {
  "use strict";

  const { catalog, statusLabel, stats } = window.Arcade;
  const byId = (id) => document.getElementById(id);

  const grid = byId("titleGrid");
  const strip = byId("recentStrip");
  const noResults = byId("noResults");
  const countLabel = byId("countLabel");
  const search = byId("q");

  const pad2 = (n) => String(n).padStart(2, "0");
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let filter = "all";

  // ---------- header numbers ----------
  function renderHeader() {
    const totals = stats.totals();
    byId("playsWeek").textContent = stats.num(stats.playsThisWeek());
    byId("linesTotal").textContent = stats.num(totals.lines);
    byId("catalogLine").textContent = `EST. 2026 / ${pad2(catalog.length)} TITLES`;
  }

  // ---------- recently played ----------
  const SLOTS = 4;

  function recentCell(game, meta, className = "") {
    return `
      <div${className ? ` class="${className}"` : ""}>
        <div class="chip" aria-hidden="true">${game ? game.icon : ""}</div>
        <div>
          ${game ? `<div class="name">${esc(game.name)}</div>` : ""}
          <div class="micro sm">${meta}</div>
        </div>
      </div>`;
  }

  /* The strip is the last four runs, so replaying one title fills more than a
     single slot. Anything left over suggests a title not played yet rather
     than sitting empty. */
  function renderRecent() {
    const cells = [];
    for (const run of stats.recentRuns(SLOTS)) {
      const game = window.Arcade.byId(run.game);
      if (game) cells.push(recentCell(game, `${stats.ago(run.ts)} · ${stats.num(run.score)}`));
    }

    if (cells.length < SLOTS) {
      const played = new Set(stats.all().map(r => r.game));
      const untried = catalog.filter(g => g.status === "playable" && !played.has(g.id));
      for (const game of untried) {
        if (cells.length >= SLOTS) break;
        cells.push(recentCell(game, "Never played", "suggest"));
      }
    }
    while (cells.length < SLOTS) cells.push(recentCell(null, "Slot empty", "slot"));

    strip.innerHTML = cells.join("");
  }

  // ---------- catalogue grid ----------
  function matches(game, query) {
    if (filter === "playable" && game.status !== "playable") return false;
    if (filter === "wip" && game.status === "playable") return false;
    if ((filter === "puzzle" || filter === "arcade") && game.genre.toLowerCase() !== filter) return false;
    if (!query) return true;
    const best = stats.best(game.id);
    const haystack = [game.name, game.genre, game.blurb, statusLabel[game.status], best ? best.score : ""]
      .join(" ").toLowerCase();
    return haystack.includes(query);
  }

  function footFor(game) {
    const best = stats.best(game.id);
    if (best) return `BEST ${stats.num(best.score)}`;
    if (game.status === "playable") return "NO RUNS YET";
    if (game.status === "wip") return `BUILD ${game.build || "—"}`;
    return "SLOT RESERVED";
  }

  function cardFor(game, index) {
    const playable = game.status === "playable" && game.href;
    const tag = game.status === "playable"
      ? `<span class="tag on">${statusLabel[game.status]}</span>`
      : `<span class="tag">${statusLabel[game.status]}</span>`;
    const inner = `
      ${playable ? '<i class="cm"></i>' : ""}
      <div class="shot">
        ${playable ? `<span class="fig">FIG. ${pad2(index + 1)}</span>` : ""}
        <span aria-hidden="true">${game.icon}</span>
      </div>
      <div class="head"><h3 class="h3">${esc(game.name)}</h3>${tag}</div>
      <p>${esc(game.blurb)}</p>
      <div class="foot"><span>${footFor(game)}</span><span>${game.genre.toUpperCase()}</span></div>`;

    return playable
      ? `<a class="title-card marks" href="${game.href}">${inner}</a>`
      : `<div class="title-card locked">${inner}</div>`;
  }

  function renderGrid() {
    const query = search.value.trim().toLowerCase();
    const shown = catalog.filter(g => matches(g, query));
    grid.innerHTML = shown.map((g, i) => cardFor(g, catalog.indexOf(g))).join("");
    noResults.hidden = shown.length > 0;
    countLabel.textContent = shown.length === catalog.length
      ? `All titles / ${pad2(catalog.length)}`
      : `Showing ${pad2(shown.length)} / ${pad2(catalog.length)}`;
  }

  // ---------- wiring ----------
  search.addEventListener("input", renderGrid);

  byId("filters").addEventListener("click", (e) => {
    const button = e.target.closest("button[data-filter]");
    if (!button) return;
    filter = button.dataset.filter;
    for (const b of byId("filters").querySelectorAll("button")) {
      b.setAttribute("aria-pressed", String(b === button));
    }
    renderGrid();
  });

  byId("clearHistory").addEventListener("click", () => {
    if (!stats.all().length) return;
    if (!confirm("Clear all locally saved play history?")) return;
    stats.clear();
    renderHeader();
    renderRecent();
    renderGrid();
  });

  renderHeader();
  renderRecent();
  renderGrid();
})();
