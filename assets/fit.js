/* Canvas fields are sized by CSS so they can fill a large screen, but every
   game draws in its own fixed logical units (Tetris 240x480, Snake 440x440,
   Breakout 560x420). This matches the backing store to the rendered size —
   times the device pixel ratio — and scales the context to suit, so the field
   stays crisp at any size and the game code never has to know about it.      */

window.Arcade = window.Arcade || {};

/**
 * @param {HTMLCanvasElement} canvas
 * @param {number} logicalW  drawing width the game code assumes
 * @param {number} logicalH  drawing height the game code assumes
 * @param {function} redraw  called after every resize
 * @returns {function} the same fit routine, to call by hand if needed
 */
window.Arcade.fitCanvas = function (canvas, logicalW, logicalH, redraw) {
  const ctx = canvas.getContext("2d");

  function fit() {
    const rendered = canvas.clientWidth || logicalW;
    const dpr = window.devicePixelRatio || 1;
    const scale = (rendered / logicalW) * dpr;
    const w = Math.round(logicalW * scale);
    const h = Math.round(logicalH * scale);

    // Assigning width/height wipes the context state, so only do it on a real
    // change — then restore the transform either way.
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    if (redraw) redraw();
  }

  let pending = 0;
  function schedule() {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(fit);
  }

  fit();
  window.addEventListener("resize", schedule);
  // Web fonts and late layout can change the column width after first paint.
  window.addEventListener("load", schedule);

  return fit;
};
