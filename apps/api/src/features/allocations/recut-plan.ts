import { toLengthUnits } from './cutting-plan/cutting-dimensions.js';

/** All replacements on this request are the same size. Fill each straight cut
 * across the selected roll before taking the next drop. */
export function recutLayout(
  widthMm: number,
  blind: { widthMm: number; lengthMm: number; quantity: number },
  rules: { edgeTrimMm: number; dropAllowanceMm: number },
) {
  const usable = toLengthUnits(widthMm) - 2n * toLengthUnits(rules.edgeTrimMm);
  const across = Number(usable / toLengthUnits(blind.widthMm));
  if (across < 1) return null;
  const rows = Math.ceil(blind.quantity / across);
  return {
    across,
    rows,
    length:
      BigInt(rows) *
      (toLengthUnits(blind.lengthMm) + toLengthUnits(rules.dropAllowanceMm)),
  };
}
