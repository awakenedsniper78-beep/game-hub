/* The arcade catalogue — single source of truth for every title listing.
   Home, Library and Profile all render from this array.
   `status` drives the badge and whether the card is a link:
     playable — shipped, `href` set
     wip      — being built, `href` null
     planned  — reserved slot, `href` null                                   */

window.Arcade = window.Arcade || {};

window.Arcade.catalog = [
  {
    id: "tetris",
    name: "Tetris",
    icon: "🟦",
    href: "tetris.html",
    status: "playable",
    genre: "Puzzle",
    build: "1.2",
    blurb: "Stack the falling pieces and clear full rows or columns.",
  },
  {
    id: "snake",
    name: "Snake",
    icon: "🐍",
    href: "snake.html",
    status: "playable",
    genre: "Arcade",
    build: "1.0",
    blurb: "Eat, grow, and never meet your own tail.",
  },
  {
    id: "breakout",
    name: "Breakout",
    icon: "🧱",
    href: null,
    status: "planned",
    genre: "Arcade",
    build: null,
    blurb: "One paddle, one ball, forty-eight bricks.",
  },
  {
    id: "2048",
    name: "2048",
    icon: "🔢",
    href: null,
    status: "planned",
    genre: "Puzzle",
    build: null,
    blurb: "Slide tiles, double them, run out of room.",
  },
  {
    id: "minesweeper",
    name: "Minesweeper",
    icon: "💣",
    href: null,
    status: "planned",
    genre: "Puzzle",
    build: null,
    blurb: "Read the numbers, flag the rest, hold your breath.",
  },
  {
    id: "asteroids",
    name: "Asteroids",
    icon: "🚀",
    href: null,
    status: "planned",
    genre: "Arcade",
    build: null,
    blurb: "Vector rocks, vector ship, vector regret.",
  },
];

window.Arcade.statusLabel = {
  playable: "Playable",
  wip: "In progress",
  planned: "Planned",
};

window.Arcade.byId = (id) => window.Arcade.catalog.find(g => g.id === id) || null;
window.Arcade.playable = () => window.Arcade.catalog.filter(g => g.status === "playable");
