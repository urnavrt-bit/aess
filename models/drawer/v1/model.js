// AESS drawer v1 (browser build). FROZEN once published. Same design intent and
// parameters as the SolidCraft reference model models/drawer/v1/model.sc.
//
// A drawer for the cabinet v1 shell: a gx x gy baseplate grid for bins gz units tall,
// 2 mm walls, a 3 mm front with a pull. Its size comes from the cabinet's drawer
// interface, so a drawer fits any cabinet v1 with the same gx, gy and gz. Under each side
// wall a groove runs from the front and stops 5 mm short of the back: the cabinet's rail
// stops run in it, so the drawer can't be pulled right out. Lift its back to remove it.
// Prints upright, no supports.
import * as K from "../../_kit/k1/kit.js";
import { PITCH, DRAWER_WALL, DRAWER_FRONT, DRAWER_EXTRA, STOP_W, STOP_H } from "../../cabinet/v1/model.js";

export const POCKET = 4.65, R = 1;
export const GROOVE_W = STOP_W + 0.4, GROOVE_H = STOP_H + 0.3, GROOVE_END = 5, CHAMFER = 1;
export const PULL_OUT = 10, PULL_T = 2;

export function build(M, ctx, p, code) {
  const { Manifold } = M;
  const Gx = PITCH * p.gx, Gy = PITCH * p.gy;
  const W = Gx + 2 * DRAWER_WALL, D = Gy + DRAWER_WALL + DRAWER_FRONT, H = 7 * p.gz + DRAWER_EXTRA;
  const yF = -D / 2, yB = D / 2, cy0 = yF + DRAWER_FRONT + Gy / 2; // the grid sits behind the front
  const cells = [];
  for (let i = 0; i < p.gx; i++) for (let j = 0; j < p.gy; j++) {
    cells.push([(i - (p.gx - 1) / 2) * PITCH, cy0 + (j - (p.gy - 1) / 2) * PITCH]);
  }
  const zf = p.floor_t, zr = zf + POCKET;

  const solids = [K.rrPrism(M, W, D, R, 0, H)];
  if (p.pull) {
    // a lip along the top of the front, 45° underneath
    const prof = K.polygonCS(M, [[yF + 0.01, H], [yF - PULL_OUT, H], [yF - PULL_OUT, H - PULL_T], [yF + 0.01, H - PULL_T - PULL_OUT - 0.01]]);
    solids.push(K.extrudeAlongX(M, prof, p.pull_w));
  }
  const cut = [K.box(M, Gx, Gy, H - zr + 1, 0, cy0, (zr + H + 1) / 2)];
  for (const [cx, cy] of cells) {
    cut.push(K.rrLoft(M, PITCH, PITCH, 4, [[zr + 0.5, -0.5], [zr - 2.15, 2.15], [zf + 0.7, 2.15], [zf, 2.85]], cx, cy));
  }
  // grooves for the rail stops, closed at the back; the back edge is chamfered to ride over the stops
  const gl = D - GROOVE_END + 0.01;
  for (const s of [-1, 1]) cut.push(K.box(M, GROOVE_W, gl, 2 * GROOVE_H, s * Gx / 2, yF - 0.01 + gl / 2, 0));
  cut.push(K.extrudeAlongX(M, K.polygonCS(M, [[yB - CHAMFER, -0.01], [yB + 0.01, -0.01], [yB + 0.01, CHAMFER + 0.02]]), W + 1));
  if (code && !ctx.noEngrave) {
    const [cx, cy] = cells[0];
    const { cs } = K.textBlock(M, ctx.font, K.codeLines(code), { capHeight: 3, maxWidth: 27, maxHeight: 16 });
    cut.push(K.undersideText(M, cs, cx, cy, 0.6));
  }
  return Manifold.union(solids).subtract(Manifold.union(cut));
}
