/* The Gus catalogue — single source of truth for every title listing.
   Home, Library and Profile all render from this array.
   `status` drives the badge and whether the card is a link:
     playable — shipped, `href` set
     wip      — being built, `href` null
     planned  — reserved slot, `href` null                                   */

window.Gus = window.Gus || {};

window.Gus.catalog = [
  {
    id: "stack",
    name: "Stack",
    icon: "🟦",
    href: "stack.html",
    status: "playable",
    genre: "Puzzle",
    build: "1.2",
    blurb: "Stack the falling pieces and clear full rows or columns.",
  },
  {
    id: "trail",
    name: "Trail",
    icon: "🟩",
    href: "trail.html",
    status: "playable",
    genre: "Motion",
    build: "1.0",
    blurb: "Eat, grow, and never meet your own tail.",
  },
  {
    id: "bounce",
    name: "Bounce",
    icon: "🟨",
    href: "bounce.html",
    status: "playable",
    genre: "Motion",
    build: "1.0",
    blurb: "One paddle, one ball, forty-eight bricks.",
  },
  {
    id: "tiles",
    name: "Tiles",
    icon: "🟧",
    href: "tiles.html",
    status: "playable",
    genre: "Puzzle",
    build: "1.0",
    blurb: "Slide tiles, double them, run out of room.",
  },
  {
    id: "cells",
    name: "Cells",
    icon: "🟥",
    href: "cells.html",
    status: "playable",
    genre: "Puzzle",
    build: "1.0",
    blurb: "Read the numbers, flag the rest, hold your breath.",
  },
  {
    id: "orbit",
    name: "Orbit",
    icon: "🟪",
    href: "orbit.html",
    status: "playable",
    genre: "Motion",
    build: "1.0",
    blurb: "Vector rocks, vector ship, vector regret.",
  },
];

window.Gus.statusLabel = {
  playable: "Playable",
  wip: "In progress",
  planned: "Planned",
};

window.Gus.byId = (id) => window.Gus.catalog.find(g => g.id === id) || null;
window.Gus.playable = () => window.Gus.catalog.filter(g => g.status === "playable");
