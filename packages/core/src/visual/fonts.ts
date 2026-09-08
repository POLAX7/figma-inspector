import type { FontRequirement } from '../tokens/extract.js';

export interface AvailableFont { family: string; style?: string; postscript?: string; weight?: number; path: string; }
export interface FontAudit { available: FontRequirement[]; missing: FontRequirement[]; }

/** Matches exact PostScript names when available; otherwise family, style, and a required weight. */
export function auditFontRequirements(requirements: readonly FontRequirement[], fonts: readonly AvailableFont[]): FontAudit {
  const available: FontRequirement[] = []; const missing: FontRequirement[] = [];
  for (const requirement of requirements) {
    const found = fonts.some((font) => matches(requirement, font));
    (found ? available : missing).push(requirement);
  }
  return { available, missing };
}
function matches(requirement: FontRequirement, font: AvailableFont): boolean {
  if (requirement.postscript && font.postscript) return requirement.postscript === font.postscript;
  return requirement.family === font.family && requirement.style === font.style && (requirement.weights.length === 0 || font.weight === undefined || requirement.weights.includes(font.weight));
}
