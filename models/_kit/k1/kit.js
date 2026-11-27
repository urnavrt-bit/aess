// AESS geometry kit k1. FROZEN once a published model version uses it: any
// change here would change those models' geometry. A new kit gets a new folder.
//
// Everything is in millimetres, Z up. `M` is the initialised manifold-3d module.

// Curves are split so no facet strays more than TOL from the true curve,
// far below what a printer can show.
export const TOL = 0.005;

export function arcSegments(r, angle = Math.PI / 2) {
  if (r <= TOL) return 1;
  const step = 2 * Math.acos(1 - TOL / r);
  return Math.max(2, Math.min(96, Math.ceil(angle / step)));
}

// Points of a rounded rectangle (counter-clockwise), centred on (cx, cy).
export function rrPoints(w, d, r, cx = 0, cy = 0) {
  r = Math.max(0.001, Math.min(r, w / 2 - 1e-4, d / 2 - 1e-4));
  const n = arcSegments(r);
  const hx = w / 2 - r, hy = d / 2 - r;
  const corners = [[hx, -hy, -Math.PI / 2], [hx, hy, 0], [-hx, hy, Math.PI / 2], [-hx, -hy, Math.PI]];
  const pts = [];
  for (const [ox, oy, a0] of corners) {
    for (let k = 0; k <= n; k++) {
      const a = a0 + (k / n) * (Math.PI / 2);
      pts.push([cx + ox + r * Math.cos(a), cy + oy + r * Math.sin(a)]);
    }
  }
  return pts;
}

export function rrPrism(M, w, d, r, z0, z1, cx = 0, cy = 0) {
  return M.CrossSection.ofPolygons([rrPoints(w, d, r, cx, cy)]).extrude(z1 - z0).translate([0, 0, z0]);
}

// A solid whose horizontal sections are rounded rectangles: `stations` is a list of
// [z, inset], each section being the w x d / radius r outline shrunk by `inset`
// (negative grows it). Consecutive sections are joined by their convex hull, which
// is exact for the straight 45° and vertical runs of the Gridfinity profiles.
export function rrLoft(M, w, d, r, stations, cx = 0, cy = 0) {
  const rings = stations.map(([z, i]) => rrPoints(w - 2 * i, d - 2 * i, r - i, cx, cy).map(([x, y]) => [x, y, z]));
  const pieces = [];
  for (let k = 0; k + 1 < rings.length; k++) {
    if (Math.abs(rings[k][0][2] - rings[k + 1][0][2]) < 1e-9) continue;
    pieces.push(M.Manifold.hull([...rings[k], ...rings[k + 1]]));
  }
  return M.Manifold.union(pieces);
}

// Quarter-circle fillet stations, from (zTop, inset0) down to (zTop - r, inset0 + r).
export function filletStations(zTop, inset0, r) {
  const n = arcSegments(r);
  const out = [];
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * (Math.PI / 2);
    out.push([zTop - r * Math.sin(a), inset0 + r - r * Math.cos(a)]);
  }
  return out;
}

export function box(M, sx, sy, sz, cx, cy, cz) {
  return M.Manifold.cube([sx, sy, sz], true).translate([cx, cy, cz]);
}

export function cylinder(M, r, z0, z1, cx, cy, r1 = r) {
  return M.Manifold.cylinder(z1 - z0, r, r1, arcSegments(Math.max(r, r1), 2 * Math.PI)).translate([cx, cy, z0]);
}

export function circle(M, r) {
  return M.CrossSection.circle(r, arcSegments(r, 2 * Math.PI));
}

// Extrude a profile drawn in the (y, z) plane along X, centred on x = 0.
export function extrudeAlongX(M, cs, length) {
  return cs.extrude(length).transform([0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, -length / 2, 0, 0, 1]);
}

export function polygonCS(M, pts) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    area += x0 * y1 - x1 * y0;
  }
  return M.CrossSection.ofPolygons([area < 0 ? [...pts].reverse() : pts]);
}

// ---------------------------------------------------------------- text

function flatten(path) {
  const polys = [];
  let cur = null, x = 0, y = 0;
  const steps = 10;
  for (const c of path.commands) {
    if (c.type === "M") { cur = [[c.x, -c.y]]; polys.push(cur); x = c.x; y = c.y; }
    else if (c.type === "L") { cur.push([c.x, -c.y]); x = c.x; y = c.y; }
    else if (c.type === "Q") {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        cur.push([u * u * x + 2 * u * t * c.x1 + t * t * c.x, -(u * u * y + 2 * u * t * c.y1 + t * t * c.y)]);
      }
      x = c.x; y = c.y;
    } else if (c.type === "C") {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        cur.push([u * u * u * x + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
          -(u * u * u * y + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y)]);
      }
      x = c.x; y = c.y;
    }
  }
  return polys.filter((p) => p.length >= 3);
}

// Lines of text as a 2D cross-section, centred on (0, 0), y up. Shrinks to fit
// maxWidth/maxHeight. capHeight is the height of capital letters in mm.
export function textBlock(M, font, lines, { capHeight, maxWidth = Infinity, maxHeight = Infinity, lineGap = 0.55 }) {
  const capRatio = (font.tables.os2?.sCapHeight || font.unitsPerEm * 0.7) / font.unitsPerEm;
  let h = capHeight;
  const totalH = (hh) => hh * (lines.length + (lines.length - 1) * lineGap);
  const widthAt = (hh) => Math.max(...lines.map((l) => font.getAdvanceWidth(l, hh / capRatio)));
  h = Math.min(h, h * maxWidth / widthAt(h), h * maxHeight / totalH(h));
  const size = h / capRatio;
  const polys = [];
  lines.forEach((line, i) => {
    const w = font.getAdvanceWidth(line, size);
    const baseline = totalH(h) / 2 - h - i * h * (1 + lineGap);
    for (const p of flatten(font.getPath(line, -w / 2, 0, size))) polys.push(p.map(([px, py]) => [px, py + baseline]));
  });
  return { cs: M.CrossSection.ofPolygons(polys, "NonZero"), capHeight: h };
}

// The code split into engraving lines: "AE2-XXXXX" then the remaining groups, `per` to a line.
export function codeLines(code, per = 2) {
  const groups = code.split("-");
  const lines = [groups.slice(0, 2).join("-")];
  for (let i = 2; i < groups.length; i += per) lines.push(groups.slice(i, i + per).join("-"));
  return lines;
}

// Cutter for text engraved into an underside (z = 0) at (cx, cy), reading upright
// when the part is tipped toward you (flipped about the X axis).
export function undersideText(M, cs, cx, cy, depth) {
  return cs.mirror([0, 1]).extrude(depth + 0.01).translate([cx, cy, -0.01]);
}
