// AESS crate v1 (browser build). FROZEN once published. Same design intent and
// parameters as the SolidCraft reference model models/crate/v1/model.sc.
//
// An open-front box for bins: a baseplate grid inside, Gridfinity feet underneath and
// baseplate pockets on top, so crates stack on each other, sit on a baseplate and take
// bins on top. The feet, the inside grid and the top pockets share one 42 mm grid,
// centred on the crate. Prints on its back, open front up, with no supports.
import * as K from "../../_kit/k1/kit.js";

export const PITCH = 42, GAP = 0.5, R = 3.75, ZB = 4.75, LIP = 4.4, POCKET = 4.65;

// Baseplate pockets for every cell, from zf (pocket floor) up to zf + POCKET.
function pockets(M, cells, zf) {
  const top = zf + POCKET;
  return cells.map(([cx, cy]) => K.rrLoft(M, PITCH, PITCH, 4, [[top + 0.5, -0.5], [top - 2.15, 2.15], [zf + 0.7, 2.15], [zf, 2.85]], cx, cy));
}

export function build(M, ctx, p, code) {
  const { Manifold } = M;
  const Gx = PITCH * p.gx, Gy = PITCH * p.gy;
  const W = Gx + 2 * p.wall, D = Gy + 2 * p.wall;
  const cells = [];
  for (let i = 0; i < p.gx; i++) for (let j = 0; j < p.gy; j++) {
    cells.push([(i - (p.gx - 1) / 2) * PITCH, (j - (p.gy - 1) / 2) * PITCH]);
  }
  const zb = p.feet ? ZB : 0;                        // underside of the body
  const zfl = zb + p.floor_t;                        // where bins stand
  const zc = zfl + 7 * p.gz + LIP + p.headroom;      // ceiling of the opening
  const zt = zc + p.top_t;                           // flat top, or floor of the top pockets
  const Ht = zt + (p.stack ? POCKET : 0);

  const solids = [K.rrPrism(M, W, D, R, zb, Ht)];
  if (p.feet) {
    for (const [cx, cy] of cells) {
      solids.push(K.rrLoft(M, PITCH - GAP, PITCH - GAP, R, [[0, 2.95], [0.8, 2.15], [2.6, 2.15], [ZB, 0]], cx, cy));
    }
  }
  const cut = [
    // the opening: full grid width, from the inside grid's ridges to the ceiling, out the front
    K.box(M, Gx, Gy + p.wall + 1, zc - (zfl + POCKET), 0, -(p.wall + 1) / 2, (zc + zfl + POCKET) / 2),
    ...pockets(M, cells, zfl),
  ];
  if (p.stack) cut.push(...pockets(M, cells, zt));
  if (!p.back) {
    // open back: a window leaving a frame as wide as the side walls are deep... kept simple: 8 mm border
    const w = Gx - 16, h = zc - (zfl + POCKET) - 16;
    if (w > 4 && h > 4) cut.push(K.box(M, w, p.wall + 2, h, 0, Gy / 2 + p.wall / 2, (zc + zfl + POCKET) / 2));
  }
  if (code && !ctx.noEngrave) {
    const [cx, cy] = cells[0];
    const { cs } = K.textBlock(M, ctx.font, K.codeLines(code), { capHeight: 3, maxWidth: 27, maxHeight: 16 });
    cut.push(K.undersideText(M, cs, cx, cy, 0.6));
  }
  return Manifold.union(solids).subtract(Manifold.union(cut));
}
