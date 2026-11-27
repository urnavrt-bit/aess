// The printed-weight estimate must stay realistic (it once showed solid weight, ~2x too high).
import { test } from "node:test";
import assert from "node:assert/strict";
import { estimate } from "../../scripts/estimate_print.mjs";

test("print estimate is realistic", async () => {
  const small = await estimate("bin", 2, { gx: 1, gy: 1, gz: 3 });
  assert.ok(small.grams > 9 && small.grams < 17, `1x1x3 bin: ${small.grams.toFixed(1)} g`);
  const big = await estimate("bin", 2, { gx: 4, gy: 4, gz: 7 });
  assert.ok(big.grams > 130 && big.grams < 190, `4x4x7 bin: ${big.grams.toFixed(1)} g`);
  assert.ok(big.grams < 0.7 * big.solidGrams, "estimate must account for infill");
  const lighter = await estimate("bin", 2, { gx: 4, gy: 4, gz: 7, wall: 1.2, floor_z: 6 });
  assert.ok(lighter.grams < big.grams, "thinner walls and floor must weigh less");
});
