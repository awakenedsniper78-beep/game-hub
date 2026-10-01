/* Library page — renders the catalogue, the recently-played strip and the
   search/filter behaviour. Data comes from catalog.js + stats.js. */
(() => {
  "use strict";

  const { catalog, statusLabel, stats } = window.Gus;
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

  function recentCell(gus, meta, className = "") {
    return `
      <div${className ? ` class="${className}"` : ""}>
        <div class="chip" aria-hidden="true">${gus ? gus.icon : ""}</div>
        <div>
          ${gus ? `<div class="name">${esc(gus.name)}</div>` : ""}
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
      const gus = window.Gus.byId(run.gus);
      if (gus) cells.push(recentCell(gus, `${stats.ago(run.ts)} · ${stats.num(run.score)}`));
    }

    if (cells.length < SLOTS) {
      const played = new Set(stats.all().map(r => r.gus));
      const untried = catalog.filter(g => g.status === "playable" && !played.has(g.id));
      for (const gus of untried) {
        if (cells.length >= SLOTS) break;
        cells.push(recentCell(gus, "Never played", "suggest"));
      }
    }
    while (cells.length < SLOTS) cells.push(recentCell(null, "Slot empty", "slot"));

    strip.innerHTML = cells.join("");
  }

  // ---------- catalogue grid ----------
  function matches(gus, query) {
    if (filter === "playable" && gus.status !== "playable") return false;
    if (filter === "wip" && gus.status === "playable") return false;
    if ((filter === "puzzle" || filter === "motion") && gus.genre.toLowerCase() !== filter) return false;
    if (!query) return true;
    const best = stats.best(gus.id);
    const haystack = [gus.name, gus.genre, gus.blurb, statusLabel[gus.status], best ? best.score : ""]
      .join(" ").toLowerCase();
    return haystack.includes(query);
  }

  function footFor(gus) {
    const best = stats.best(gus.id);
    if (best) return `BEST ${stats.num(best.score)}`;
    if (gus.status === "playable") return "NO RUNS YET";
    if (gus.status === "wip") return `BUILD ${gus.build || "—"}`;
    return "SLOT RESERVED";
  }

  function cardFor(gus, index) {
    const playable = gus.status === "playable" && gus.href;
    const tag = gus.status === "playable"
      ? `<span class="tag on">${statusLabel[gus.status]}</span>`
      : `<span class="tag">${statusLabel[gus.status]}</span>`;
    const inner = `
      ${playable ? '<i class="cm"></i>' : ""}
      <div class="shot">
        ${playable ? `<span class="fig">FIG. ${pad2(index + 1)}</span>` : ""}
        <span aria-hidden="true">${gus.icon}</span>
      </div>
      <div class="head"><h3 class="h3">${esc(gus.name)}</h3>${tag}</div>
      <p>${esc(gus.blurb)}</p>
      <div class="foot"><span>${footFor(gus)}</span><span>${gus.genre.toUpperCase()}</span></div>`;

    return playable
      ? `<a class="title-card marks" href="${gus.href}">${inner}</a>`
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
