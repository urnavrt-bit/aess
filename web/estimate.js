// Printed-filament estimate, modelled on how a slicer lays down plastic, layer by layer:
// perimeters and top/bottom skins print solid, everything else is sparse infill.
export const PRINT = { layer: 0.2, walls: 3, line: 0.42, shells: 4, infill: 0.15, density: 1.27, filament: 1.75 };

export function estimatePrint(solid, opt = {}) {
  const { layer, walls, line, shells, infill, density, filament } = { ...PRINT, ...opt };
  const zMax = solid.boundingBox().max[2];
  const n = Math.ceil(zMax / layer);
  const slices = [];
  for (let i = 0; i < n; i++) slices.push(solid.slice(Math.min((i + 0.5) * layer, zMax - 1e-3)));
  let perim = 0, skin = 0, sparse = 0;
  for (let i = 0; i < n; i++) {
    const s = slices[i];
    const inner = s.offset(-walls * line, "Miter");
    perim += s.area() - inner.area();
    let coreArea = 0;                     // inside the part for `shells` layers above and below
    if (i >= shells && i + shells < n) {
      let core = inner;
      for (let k = 1; k <= shells; k++) core = core.intersect(slices[i - k]).intersect(slices[i + k]);
      coreArea = core.area();
    }
    skin += inner.area() - coreArea;
    sparse += coreArea;
  }
  const mm3 = (perim + skin + infill * sparse) * layer;
  return {
    grams: (mm3 / 1000) * density,
    solidGrams: (solid.volume() / 1000) * density,
    meters: mm3 / (Math.PI * (filament / 2) ** 2) / 1000,
  };
}
