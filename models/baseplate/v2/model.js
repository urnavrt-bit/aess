// AESS baseplate v2 (browser build). FROZEN once published. Same design intent and
// parameters as the SolidCraft reference model models/baseplate/v1/model.sc.
import * as K from "../../_kit/k1/kit.js";

export const PITCH = 42, TRIM = 0.5, R = 4;

export function build(M, ctx, p, code) {
  const { Manifold } = M;
  const W = PITCH * p.gx - TRIM + 2 * p.pad_x, D = PITCH * p.gy - TRIM + 2 * p.pad_y;
  const Hp = 4.65 + p.floor_t, f = p.floor_t;
  const cells = [];
  for (let i = 0; i < p.gx; i++) for (let j = 0; j < p.gy; j++) {
    cells.push([(i - (p.gx - 1) / 2) * PITCH, (j - (p.gy - 1) / 2) * PITCH]);
  }

  // Each cell: 2.15 chamfer, 1.8 straight, 0.7 chamfer; open frame when there's no floor.
  const cut = [];
  for (const [cx, cy] of cells) {
    const st = [[Hp + 0.5, -0.5], [Hp - 2.15, 2.15], [f + 0.7, 2.15], [f, 2.85]];
    if (f === 0) st.push([-0.5, 2.85]);
    cut.push(K.rrLoft(M, PITCH, PITCH, R, st, cx, cy));
    for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
      if (p.magnets) cut.push(K.cylinder(M, p.mag_d / 2, f - p.mag_h, f + 0.01, cx + 13 * sx, cy + 13 * sy));
    }
    if (p.screws) {
      const depth = (p.cs_d - p.sd) / 2;
      cut.push(K.cylinder(M, p.sd / 2, -0.01, f + 0.01, cx, cy));
      cut.push(K.cylinder(M, p.sd / 2, f - depth, f + 0.01, cx, cy, p.cs_d / 2 + 0.01));
    }
  }
  if (code && !ctx.noEngrave) {
    const rim = 2.6 + p.pad_y;
    const { cs } = K.textBlock(M, ctx.font, [code], {
      capHeight: Math.min(3, 1.6 + p.pad_y), maxWidth: W - 12, maxHeight: rim - 0.8,
    });
    cut.push(K.undersideText(M, cs, 0, -D / 2 + rim / 2, 0.6));
  }
  return K.rrPrism(M, W, D, R, 0, Hp).subtract(Manifold.union(cut));
}
