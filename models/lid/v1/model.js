// AESS lid v1 (browser build). FROZEN once published. Same design intent and
// parameters as the SolidCraft reference model models/lid/v1/model.sc.
//
// Underneath: one plug with the Gridfinity foot profile over the whole outline, so the
// lid drops into a bin's stacking lip exactly like a bin stacked on top would.
// On top: either baseplate pockets (bins stack on the lidded bin) or a flat plate.
import * as K from "../../_kit/k1/kit.js";

export const PITCH = 42, GAP = 0.5, R = 3.75, ZB = 4.75;

export function build(M, ctx, p, code) {
  const { Manifold } = M;
  const W = PITCH * p.gx - GAP, D = PITCH * p.gy - GAP;
  const zf = ZB + p.top_t;                     // flat top, or floor of the pockets
  const Ht = zf + (p.stack ? 4.65 : 0);
  const cells = [];
  for (let i = 0; i < p.gx; i++) for (let j = 0; j < p.gy; j++) {
    cells.push([(i - (p.gx - 1) / 2) * PITCH, (j - (p.gy - 1) / 2) * PITCH]);
  }

  // Plug (0.8 chamfer, 1.8 straight, 2.15 chamfer, as a bin foot) and the plate.
  const lid = Manifold.union([
    K.rrLoft(M, W, D, R, [[0, 2.95], [0.8, 2.15], [2.6, 2.15], [ZB, 0]]),
    K.rrPrism(M, W, D, R, ZB, Ht),
  ]);

  const cut = [];
  if (p.stack) {
    // Baseplate pockets: 2.15 chamfer, 1.8 straight, 0.7 chamfer.
    for (const [cx, cy] of cells) {
      cut.push(K.rrLoft(M, PITCH, PITCH, 4, [[Ht + 0.5, -0.5], [Ht - 2.15, 2.15], [zf + 0.7, 2.15], [zf, 2.85]], cx, cy));
      if (p.magnets) {
        for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
          cut.push(K.cylinder(M, p.mag_d / 2, zf - p.mag_h, zf + 0.01, cx + 13 * sx, cy + 13 * sy));
        }
      }
    }
  }
  if (p.grip) {
    // Finger grip: a 45° undercut at the front edge, opening 2 mm above the plug.
    const y = -D / 2;
    cut.push(K.extrudeAlongX(M, K.polygonCS(M, [[y - 1, ZB - 1], [y + 3, ZB - 1], [y - 1, ZB + 3]]), p.grip_w));
  }
  if (code && !ctx.noEngrave) {
    const [cx, cy] = cells[0];
    const { cs } = K.textBlock(M, ctx.font, K.codeLines(code), { capHeight: 3, maxWidth: 27, maxHeight: 16 });
    cut.push(K.undersideText(M, cs, cx, cy, 0.6));
  }
  return cut.length ? lid.subtract(Manifold.union(cut)) : lid;
}
