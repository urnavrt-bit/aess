// AESS lid v2 (browser build). FROZEN once published. Same design intent and
// parameters as the SolidCraft reference model models/lid/v2/model.sc.
//
// Underneath: one plug with the Gridfinity foot profile over the whole outline, so the
// lid drops into a bin's stacking lip exactly like a bin stacked on top would.
// On top: either baseplate pockets (bins stack on the lidded bin) or a flat plate.
//
// v2 adds snap clips. Below the narrowest point of a bin's stacking lip the inside
// widens again (the 45° support under the lip). Flexible fingers cut free in the
// sides of the plug carry a small hook that springs out under that point: press the
// lid on and it clicks, a firm pull takes it off (both hook faces are 45°). The hook
// stays inside the plug's height, so the lid still prints plug-down without supports.
import * as K from "../../_kit/k1/kit.js";

export const PITCH = 42, GAP = 0.5, R = 3.75, ZB = 4.75;
// Snap clips: finger thickness, slot behind it, finger length, end slits.
export const CLIP_T = 1.2, CLIP_GAP = 0.8, CLIP_L = 16, CLIP_SLIT = 1;
// Narrowest point of a bin's lip, as an inset from the outline, and its height
// above the bottom of a seated lid's plug.
export const LIP_IN = 2.6, LIP_Z = 0.35;

// The plug's side profile shifted inward by o: [inset, z] from the bottom up.
const plugProfile = (o) => [[2.95 + o, 0], [2.15 + o, 0.8], [2.15 + o, 2.6], [o, ZB]];

// Clip cross-sections as [inset, z] polygons: the hook added, then the cuts that free the
// finger (the slot behind it and the slits at its ends).
export function clipProfiles(depth) {
  const u0 = LIP_IN - depth, zt = (2.95 - u0) / 2;
  // the hook's top face is parallel to the lip's 45° underside; it runs back into the plug
  const hook = [[u0, 0], [3.3, 0], [3.3, zt], [u0 + zt, zt]];
  const outer = plugProfile(CLIP_T), inner = plugProfile(CLIP_T + CLIP_GAP);
  const slot = [[outer[0][0], -0.01], ...outer, ...[...inner].reverse(), [inner[0][0], -0.01]];
  const ui = inner[0][0];  // the slits reach the deepest point of the slot
  const slit = [[-1, -0.01], [ui, -0.01], [ui, ZB], [-1, ZB]];
  return { hook, slot, slit };
}

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
  let lid = Manifold.union([
    K.rrLoft(M, W, D, R, [[0, 2.95], [0.8, 2.15], [2.6, 2.15], [ZB, 0]]),
    K.rrPrism(M, W, D, R, ZB, Ht),
  ]);

  const cut = [];
  if (p.snap) {
    // One clip per grid square along the back and both sides (the front has the grip).
    const pr = clipProfiles(p.snap_d);
    // A profile [inset, z] as a prism of length `len` along the back edge, centred on x.
    const back = (pts, len, x) => K.extrudeAlongX(M, K.polygonCS(M, pts.map(([u, z]) => [D / 2 - u, z])), len).translate([x, 0, 0]);
    // ... and along the right edge, centred on y (left edge by mirroring).
    const right = (pts, len, y) => K.extrudeAlongX(M, K.polygonCS(M, pts.map(([u, z]) => [W / 2 - u, z])), len).rotate([0, 0, -90]).translate([0, y, 0]);
    const xs = [...new Set(cells.map(([x]) => x))], ys = [...new Set(cells.map(([, y]) => y))];
    const hooks = [], cuts = [];
    const sl = CLIP_L / 2 + CLIP_SLIT / 2;
    for (const x of xs) {
      hooks.push(back(pr.hook, CLIP_L, x));
      cuts.push(back(pr.slot, CLIP_L + 2 * CLIP_SLIT, x), back(pr.slit, CLIP_SLIT, x - sl), back(pr.slit, CLIP_SLIT, x + sl));
    }
    const side = [], sideCuts = [];
    for (const y of ys) {
      side.push(right(pr.hook, CLIP_L, y));
      sideCuts.push(right(pr.slot, CLIP_L + 2 * CLIP_SLIT, y), right(pr.slit, CLIP_SLIT, y - sl), right(pr.slit, CLIP_SLIT, y + sl));
    }
    const sideH = Manifold.union(side), sideC = Manifold.union(sideCuts);
    lid = lid.add(Manifold.union([...hooks, sideH, sideH.mirror([1, 0, 0])]));
    cut.push(...cuts, sideC, sideC.mirror([1, 0, 0]));
  }
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
