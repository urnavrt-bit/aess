// AESS bin v2 (browser build). FROZEN once published. Same design intent and
// parameters as the SolidCraft reference model models/bin/v1/model.sc.
import * as K from "../../_kit/k1/kit.js";

export const PITCH = 42, GAP = 0.5, R = 3.75, ZB = 4.75;

export function build(M, ctx, p, code) {
  const { Manifold } = M;
  const W = PITCH * p.gx - GAP, D = PITCH * p.gy - GAP, H = 7 * p.gz;
  const lip = p.lip ? 1 : 0;
  const Ht = H + (4.4 - p.lip_flat) * lip;
  const cells = [];
  for (let i = 0; i < p.gx; i++) for (let j = 0; j < p.gy; j++) {
    cells.push([(i - (p.gx - 1) / 2) * PITCH, (j - (p.gy - 1) / 2) * PITCH]);
  }

  // Outer body and the Gridfinity feet (0.8 chamfer, 1.8 straight, 2.15 chamfer).
  const solids = [K.rrPrism(M, W, D, R, ZB, Ht)];
  for (const [cx, cy] of cells) {
    solids.push(K.rrLoft(M, PITCH - GAP, PITCH - GAP, R, [[0, 2.95], [0.8, 2.15], [2.6, 2.15], [ZB, 0]], cx, cy));
  }

  // Inside: stacking lip (mirror of the base profile, flat-topped), 45° support
  // under the lip, straight walls, rounded corner into the floor.
  const fr = Math.min(2, R - p.wall - 0.05);
  const stations = lip
    ? [[Ht + 1, p.lip_flat - 1], [H + 2.5, 1.9], [H + 0.7, 1.9], [H, 2.6], [H - (2.6 - p.wall), p.wall]]
    : [[H + 1, p.wall]];
  stations.push(...K.filletStations(p.floor_z + fr, p.wall, fr));
  const cavity = K.rrLoft(M, W, D, R, stations);

  // Dividers, label shelf and scoop go back into the cavity.
  const inside = [];
  const iw = W - 2 * p.wall, id = D - 2 * p.wall;
  const divTop = H - (2.6 - p.wall) * lip - p.div_drop;
  if (divTop - p.floor_z > 0.5) {
    const h = divTop - p.floor_z, zc = (divTop + p.floor_z) / 2;
    const sx = (iw + p.div_t) / (p.ndx + 1), sy = (id + p.div_t) / (p.ndy + 1);
    for (let k = 1; k <= p.ndx; k++) inside.push(K.box(M, p.div_t, D - p.wall, h, -iw / 2 + k * sx - p.div_t / 2, 0, zc));
    for (let k = 1; k <= p.ndy; k++) inside.push(K.box(M, W - p.wall, p.div_t, h, 0, -id / 2 + k * sy - p.div_t / 2, zc));
  }
  if (p.label) {
    const top = H - (2.6 - p.wall) * lip, yb = D / 2 - p.wall + 0.5, yf = D / 2 - p.wall - p.label_w;
    const bottom = top - p.label_w - 1.2;
    const prof = K.polygonCS(M, [[yf, top], [yf, bottom + p.label_w], [yf + p.label_w, bottom], [yb, bottom], [yb, top]]);
    inside.push(K.extrudeAlongX(M, prof, iw));
  }
  if (p.scoop) {
    const y0 = -id / 2, z0 = p.floor_z, r = p.scoop_r;
    const rect = M.CrossSection.square([r + 0.5, r + 0.5]).translate([y0 - 0.5, z0 - 0.5]);
    const prof = rect.subtract(K.circle(M, r).translate([y0 + r, z0 + r]));
    inside.push(K.extrudeAlongX(M, prof, iw));
  }

  let bin = Manifold.union(solids).subtract(cavity);
  if (inside.length) bin = bin.add(Manifold.union(inside).intersect(K.rrPrism(M, W - 0.2, D - 0.2, R - 0.1, 0, Ht)));

  // Holes under each foot and the engraved config code.
  const cut = [];
  for (const [cx, cy] of cells) {
    for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
      if (p.magnets) cut.push(K.cylinder(M, p.mag_d / 2, -0.01, p.mag_h, cx + 13 * sx, cy + 13 * sy));
      if (p.screws) cut.push(K.cylinder(M, p.screw_d / 2, -0.01, p.screw_h, cx + 13 * sx, cy + 13 * sy));
    }
  }
  if (code && !ctx.noEngrave) {
    const [cx, cy] = cells[0];
    const { cs } = K.textBlock(M, ctx.font, K.codeLines(code), { capHeight: 3, maxWidth: 27, maxHeight: 16 });
    cut.push(K.undersideText(M, cs, cx, cy, 0.6));
  }
  if (cut.length) bin = bin.subtract(Manifold.union(cut));
  return bin;
}
