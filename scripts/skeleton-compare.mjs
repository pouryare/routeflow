/* Two captures are the same page when the boxes line up within a few pixels: text that wraps a
   pixel differently, or a clock that ticked, must not rewrite the file. A box that appears,
   disappears or moves further than the tolerance is a real change. */
const TOLERANCE = 3;

function sameLayout(a, b) {
  if (!a || !b) return a === b;
  if (a.bones.length !== b.bones.length || Math.abs(a.height - b.height) > TOLERANCE) return false;
  return a.bones.every((x, i) => {
    const y = b.bones[i];
    /* x and width are % of the page width (about 4 px per point at phone width), y and height px. */
    return x.length === y.length && x[4] === y[4]
      && Math.abs(x[0] - y[0]) <= 1 && Math.abs(x[2] - y[2]) <= 1
      && Math.abs(x[1] - y[1]) <= TOLERANCE && Math.abs(x[3] - y[3]) <= TOLERANCE;
  });
}

export const sameCapture = (a, b) => a.route === b.route && sameLayout(a.phone, b.phone) && sameLayout(a.desktop, b.desktop);
