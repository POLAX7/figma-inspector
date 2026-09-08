export function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('Expected a positive integer.');
  return parsed;
}

export function mismatchRatio(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw new Error('Expected a number between 0 and 1.');
  return parsed;
}
