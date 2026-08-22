# Arcade

A small collection of browser games. No build step, no dependencies, no accounts —
open `index.html` and play. Scores are saved in `localStorage` on your own device.

**Play it:** https://awakenedsniper78-beep.github.io/game-hub/

## Titles

| # | Title | Status |
|---|-------|--------|
| 01 | Tetris | Playable — rows *and* columns score, with hold, hard drop and ghost preview |
| 02 | Snake | Playable — three modes, speed tiers, sprint, run log |
| 03 | Breakout | Planned |
| 04 | 2048 | Planned |
| 05 | Minesweeper | Planned |
| 06 | Asteroids | Planned |

## Pages

| File | Screen |
|------|--------|
| `index.html` | Home — spec-sheet hero and title strip |
| `games.html` | Library — search, filters, recently played |
| `tetris.html` | Tetris play screen |
| `snake.html` | Snake play screen |
| `profile.html` | Profile — totals, personal bests, session chart |

## Layout

```
assets/
  site.css      design tokens, shell, nav, shared primitives
  pages.css     home / library / profile layouts
  play.css      the shared three-column play-screen chassis
  tetris.css    Tetris-only panels
  snake.css     Snake-only panels
  catalog.js    the six titles — single source of truth
  stats.js      local run history (localStorage)
  home.js       home page rendering
  library.js    library rendering, search and filters
  profile.js    profile rendering
  tetris.js     Tetris game logic
  snake.js      Snake game logic
```

## Running locally

Open `index.html` directly, or serve the folder:

```bash
python -m http.server 8000
```

## Adding a game

1. Build `<game>.html` on the shared chassis (`site.css` + `play.css` + your own `<game>.css`).
2. Add the game logic in `assets/<game>.js`, recording finished runs with
   `Arcade.stats.record("<id>", { score, level, durationMs })`.
3. Flip its entry in `assets/catalog.js` to `status: "playable"` with an `href`.

The home page, library and profile all pick the change up automatically.
