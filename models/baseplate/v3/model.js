// AESS baseplate v3 (browser build). FROZEN once published. Same design intent and
// parameters as the SolidCraft reference model models/baseplate/v3/model.sc.
//
// New in v3:
// - Joined edges: plates link with dovetail tabs where grid lines meet the edge (tabs on
//   the right and back, matching sockets on the left and front), so any number of plates
//   lock into one larger grid. A joined edge sits exactly on the 42 mm grid line, with no
//   trim and no padding, so the spacing stays exact across the seam.
// - Light frame: bins stand on the surface below and the frame only keeps them in place,
//   so the middle of every grid line is cut down to a low web and only the corners keep
//   the full profile. Saves about 40% of the filament.
import * as K from "../../_kit/k1/kit.js";

export const PITCH = 42, TRIM = 0.25, R = 4;
export const WEB = 1.0, KEEP = 8; // light frame: web height, full profile kept this far from each corner
export const NECK = 0.9, HEAD_X = 2.0, HEAD_R = 1.6; // dovetail: neck half-width, head centre and radius

// Outline with a separate corner radius at each corner (0 = square), counter-clockwise.
function outline(M, x0, y0, x1, y1, radii) {
  const corners = [[x1, y0, -Math.PI / 2, 1, 1], [x1, y1, 0, 1, -1], [x0, y1, Math.PI / 2, -1, -1], [x0, y0, Math.PI, -1, 1]];
  const pts = [];
  corners.forEach(([x, y, a0], k) => {
    const r = radii[k];
    if (r <= 0) { pts.push([x, y]); return; }
    const ox = x - Math.sign(x - (x0 + x1) / 2) * r, oy = y - Math.sign(y - (y0 + y1) / 2) * r;
    const n = K.arcSegments(r);
    for (let s = 0; s <= n; s++) {
      const a = a0 + (s / n) * (Math.PI / 2);
      pts.push([ox + r * Math.cos(a), oy + r * Math.sin(a)]);
    }
  });
  return M.CrossSection.ofPolygons([pts]);
}

// Dovetail outline pointing along +x from the edge at x = 0: neck then a round head.
function dovetail(M, grow, back) {
  const neck = M.CrossSection.square([HEAD_X + back, 2 * (NECK + grow)]).translate([-back, -(NECK + grow)]);
  return neck.add(K.circle(M, HEAD_R + grow).translate([HEAD_X, 0]));
}

export function build(M, ctx, p, code) {
  const { Manifold } = M;
  const f = p.floor_t, Hp = 4.65 + f;
  const jl = !!p.join_l, jr = !!p.join_r, jf = !!p.join_f, jb = !!p.join_b;
  const Gx = PITCH * p.gx, Gy = PITCH * p.gy;
  const ex = p.pad_x - TRIM, ey = p.pad_y - TRIM; // a free edge: trimmed, then padded
  const x0 = -Gx / 2 - (jl ? 0 : ex), x1 = Gx / 2 + (jr ? 0 : ex);
  const y0 = -Gy / 2 - (jf ? 0 : ey), y1 = Gy / 2 + (jb ? 0 : ey);
  const round = (a, b) => (a || b ? 0 : R);
  const radii = [round(jr, jf), round(jr, jb), round(jl, jb), round(jl, jf)];

  // Junctions: where inner grid lines meet each joined edge.
  const ys = [], xs = [];
  for (let j = 1; j < p.gy; j++) ys.push(-Gy / 2 + j * PITCH);
  for (let i = 1; i < p.gx; i++) xs.push(-Gx / 2 + i * PITCH);
  const along = (cs, x, y, angle) => cs.rotate(angle).translate([x, y]);
  const tabs = [], sockets = [];
  const tab = dovetail(M, 0, 0.5), sock = dovetail(M, p.fit, 0.01);
  if (jr) for (const y of ys) tabs.push(along(tab, Gx / 2, y, 0));
  if (jb) for (const x of xs) tabs.push(along(tab, x, Gy / 2, 90));
  if (jl) for (const y of ys) sockets.push(along(sock, -Gx / 2, y, 0));
  if (jf) for (const x of xs) sockets.push(along(sock, x, -Gy / 2, 90));

  let plan = outline(M, x0, y0, x1, y1, radii);
  if (tabs.length) plan = plan.add(M.CrossSection.union(tabs));
  if (sockets.length) plan = plan.subtract(M.CrossSection.union(sockets));
  const body = plan.extrude(Hp);

  // Pockets: every cell, plus the neighbouring cells past a tabbed edge (they shape the tabs).
  const cells = [];
  for (let i = 0; i < p.gx + (jr ? 1 : 0); i++) for (let j = 0; j < p.gy + (jb ? 1 : 0); j++) {
    if (i >= p.gx && j >= p.gy) continue;
    cells.push([(i - (p.gx - 1) / 2) * PITCH, (j - (p.gy - 1) / 2) * PITCH, i < p.gx && j < p.gy]);
  }
  const cut = [];
  for (const [cx, cy, own] of cells) {
    const st = [[Hp + 0.5, -0.5], [Hp - 2.15, 2.15], [f + 0.7, 2.15], [f, 2.85]];
    if (f === 0) st.push([-0.5, 2.85]);
    cut.push(K.rrLoft(M, PITCH, PITCH, R, st, cx, cy));
    if (!own) continue;
    for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
      if (p.magnets) cut.push(K.cylinder(M, p.mag_d / 2, f - p.mag_h, f + 0.01, cx + 13 * sx, cy + 13 * sy));
    }
    if (p.screws) {
      const depth = (p.cs_d - p.sd) / 2;
      cut.push(K.cylinder(M, p.sd / 2, -0.01, f + 0.01, cx, cy));
      cut.push(K.cylinder(M, p.sd / 2, f - depth, f + 0.01, cx, cy, p.cs_d / 2 + 0.01));
    }
  }

  // Light frame: lower the middle of each grid line (and the padding beside it) to a web.
  if (p.light) {
    const len = PITCH - 2 * KEEP, z0 = f + WEB, z1 = Hp + 1;
    const win = (ax0, ax1, ay0, ay1) => cut.push(K.box(M, ax1 - ax0, ay1 - ay0, z1 - z0, (ax0 + ax1) / 2, (ay0 + ay1) / 2, (z0 + z1) / 2));
    for (let i = 0; i <= p.gx; i++) { // lines along y
      const x = -Gx / 2 + i * PITCH;
      const a = i === 0 ? x0 - 1 : x - 3, b = i === p.gx ? x1 + 1 : x + 3;
      for (let j = 0; j < p.gy; j++) { const cy = -Gy / 2 + (j + 0.5) * PITCH; win(a, b, cy - len / 2, cy + len / 2); }
    }
    for (let j = 0; j <= p.gy; j++) { // lines along x
      const y = -Gy / 2 + j * PITCH;
      const a = j === 0 ? y0 - 1 : y - 3, b = j === p.gy ? y1 + 1 : y + 3;
      for (let i = 0; i < p.gx; i++) {
        const cx = -Gx / 2 + (i + 0.5) * PITCH; win(cx - len / 2, cx + len / 2, a, b);
      }
    }
  }

  if (code && !ctx.noEngrave) {
    const rim = 2.85 + (jf ? 0 : ey);
    const { cs } = K.textBlock(M, ctx.font, [code], {
      capHeight: Math.min(3, rim - 1), maxWidth: 30, maxHeight: rim - 0.8,
    });
    cut.push(K.undersideText(M, cs, -Gx / 2 + PITCH / 2, y0 + rim / 2, 0.6));
  }
  return body.subtract(Manifold.union(cut));
}
