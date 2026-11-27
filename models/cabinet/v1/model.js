// AESS cabinet v1 (browser build). FROZEN once published. Same design intent and
// parameters as the SolidCraft reference model models/cabinet/v1/model.sc.
//
// The shell of a drawer cabinet: an open-front box with a pair of ledge rails for each
// drawer. Drawers (a separate model) hold a gx x gy baseplate grid of bins gz units tall
// and slide on the rails. Gridfinity feet underneath and baseplate pockets on top, centred
// on the shell, so cabinets stack, sit on a baseplate and take bins or crates on top.
// Prints on its back, open front up, with no supports.
//
// The drawer interface below is fixed for this version: drawers are built to fit it.
import * as K from "../../_kit/k1/kit.js";

export const PITCH = 42, GAP = 0.5, R = 3.75, ZB = 4.75, POCKET = 4.65;
export const DRAWER_WALL = 2, DRAWER_FRONT = 3, CLEAR = 0.5;   // drawer walls and running clearance
export const DRAWER_EXTRA = 11;                                 // drawer height = 7 * gz + this
export const RAIL_W = 4.5, RAIL_H = 2, SLOT_GAP = 1;            // ledge rails; gap above each drawer
// Pull-out stop: a bump on each rail, under the drawer's wall line (x = ±gx*21), that runs
// in a groove under the drawer. The groove is closed at the drawer's back, so the drawer
// stops just before it comes out. Its front is a 45° ramp the drawer rides over going in.
export const STOP_W = 1, STOP_H = 0.6, STOP_Y = 2, STOP_FLAT = 2;  // from the front edge

// Where everything goes, shared with the drawer model and the site.
export function layout(p) {
  const Gx = PITCH * p.gx, Gy = PITCH * p.gy;
  const slotW = Gx + 2 * (DRAWER_WALL + CLEAR);                 // between the side walls
  const drawerD = Gy + DRAWER_WALL + DRAWER_FRONT;
  const slotD = drawerD + CLEAR;                                 // front edge to back wall
  const W = slotW + 2 * p.wall, D = slotD + p.wall;
  const hd = 7 * p.gz + DRAWER_EXTRA, pitch = RAIL_H + hd + SLOT_GAP;
  const zb = p.feet ? ZB : 0, z0 = zb + p.floor_t;               // top of the floor
  const zc = z0 + p.drawers * pitch;                             // ceiling
  const zt = zc + p.top_t, Ht = zt + (p.stack ? POCKET : 0);
  return { Gx, Gy, slotW, slotD, drawerD, W, D, hd, pitch, zb, z0, zc, zt, Ht };
}

export function build(M, ctx, p, code) {
  const { Manifold } = M;
  const L = layout(p);
  const cells = [];
  for (let i = 0; i < p.gx; i++) for (let j = 0; j < p.gy; j++) {
    cells.push([(i - (p.gx - 1) / 2) * PITCH, (j - (p.gy - 1) / 2) * PITCH]);
  }
  const yFront = -L.D / 2, yBack = yFront + L.slotD;

  const solids = [K.rrPrism(M, L.W, L.D, R, L.zb, L.Ht)];
  if (p.feet) {
    for (const [cx, cy] of cells) {
      solids.push(K.rrLoft(M, PITCH - GAP, PITCH - GAP, R, [[0, 2.95], [0.8, 2.15], [2.6, 2.15], [ZB, 0]], cx, cy));
    }
  }
  const cut = [K.box(M, L.slotW, L.slotD + 1, L.zc - L.z0, 0, (yFront - 1 + yBack) / 2, (L.z0 + L.zc) / 2)];
  if (p.stack) {
    for (const [cx, cy] of cells) {
      cut.push(K.rrLoft(M, PITCH, PITCH, 4, [[L.Ht + 0.5, -0.5], [L.Ht - 2.15, 2.15], [L.zt + 0.7, 2.15], [L.zt, 2.85]], cx, cy));
    }
  }
  if (!p.back) {
    const w = L.slotW - 16, h = L.zc - L.z0 - 16;
    if (w > 4 && h > 4) cut.push(K.box(M, w, p.wall + 2, h, 0, yBack + p.wall / 2, (L.z0 + L.zc) / 2));
  }
  if (code && !ctx.noEngrave) {
    const [cx, cy] = cells[0];
    const { cs } = K.textBlock(M, ctx.font, K.codeLines(code), { capHeight: 3, maxWidth: 27, maxHeight: 16 });
    cut.push(K.undersideText(M, cs, cx, cy, 0.6));
  }
  let shell = Manifold.union(solids).subtract(Manifold.union(cut));

  // Ledge rails: one pair at the bottom of each slot, front to back wall.
  const rails = [];
  for (let k = 0; k < p.drawers; k++) {
    const z = L.z0 + k * L.pitch;
    for (const s of [-1, 1]) {
      rails.push(K.box(M, RAIL_W + 0.01, L.slotD, RAIL_H, s * (L.slotW / 2 - RAIL_W / 2 + 0.005), (yFront + yBack) / 2, z + RAIL_H / 2));
    }
  }
  // Stops: ramp up from the front, flat top, square back face.
  const y0 = yFront + STOP_Y, zr = L.z0 + RAIL_H;
  for (let k = 0; k < p.drawers; k++) {
    const z = zr + k * L.pitch;
    const prof = K.polygonCS(M, [[y0, z - 0.01], [y0 + STOP_H, z + STOP_H], [y0 + STOP_H + STOP_FLAT, z + STOP_H], [y0 + STOP_H + STOP_FLAT, z - 0.01]]);
    const stop = K.extrudeAlongX(M, prof, STOP_W);
    for (const s of [-1, 1]) rails.push(stop.translate([s * L.Gx / 2, 0, 0]));
  }
  return shell.add(Manifold.union(rails));
}
