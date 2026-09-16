/**
 * Exact conversions between millimetres, integer 0.001 mm lengths, and squared units.
 * Inputs must already satisfy the shared schema's range and precision constraints.
 */
export function toLengthUnits(value: number): bigint {
  const [whole, fraction] = value.toFixed(3).split('.');
  return BigInt(whole!) * 1000n + BigInt(fraction!);
}

export const toMillimetres = (value: bigint): number => Number(value) / 1000;

export const toSquareMillimetres = (value: bigint): string =>
  `${value / 1000000n}.${(value % 1000000n).toString().padStart(6, '0')}`;
