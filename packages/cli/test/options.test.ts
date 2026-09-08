import { expect, test } from 'vitest';

const loadOptions = () => import('../src/options.js').catch(() => ({}));

test('parses positive search limits and bounded mismatch ratios', async () => {
  const { positiveInteger, mismatchRatio } = await loadOptions() as { positiveInteger?: (value: string) => number; mismatchRatio?: (value: string) => number };

  expect(positiveInteger).toBeTypeOf('function');
  expect(mismatchRatio).toBeTypeOf('function');
  expect(positiveInteger!('3')).toBe(3);
  expect(() => positiveInteger!('0')).toThrow(/positive integer/i);
  expect(mismatchRatio!('0.02')).toBe(0.02);
  expect(() => mismatchRatio!('1.1')).toThrow(/between 0 and 1/i);
});
