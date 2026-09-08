import { expect, test } from 'vitest';
import { auditFontRequirements } from '../src/visual/fonts.js';

test('reports missing exact PostScript font requirements', () => {
  const result = auditFontRequirements(
    [{ id: 'font_a', family: 'Montserrat', style: 'Bold', postscript: 'Montserrat-Bold', weights: [700], nodeIds: ['1:2'] }],
    [{ family: 'Montserrat', style: 'Regular', postscript: 'Montserrat-Regular', weight: 400, path: 'fonts/Montserrat-Regular.otf' }]
  );
  expect(result).toEqual({ available: [], missing: [{ id: 'font_a', family: 'Montserrat', style: 'Bold', postscript: 'Montserrat-Bold', weights: [700], nodeIds: ['1:2'] }] });
});

test('accepts an exact PostScript match', () => {
  const requirement = { id: 'font_a', family: 'Montserrat', style: 'Bold', postscript: 'Montserrat-Bold', weights: [700], nodeIds: ['1:2'] };
  expect(auditFontRequirements([requirement], [{ family: 'Montserrat', style: 'Bold', postscript: 'Montserrat-Bold', weight: 700, path: 'fonts/Montserrat-Bold.otf' }])).toEqual({ available: [requirement], missing: [] });
});
