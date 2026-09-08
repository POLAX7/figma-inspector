/**
 * figma-pruner.ts
 * 
 * Compresses verbose Figma node JSON AST while preserving 100% depth hierarchy,
 * styling details (CSS), and typography according to the selected fidelity mode.
 */

export interface CompactLayout {
  mode?: 'ROW' | 'COL';
  gap?: number;
  padding?: string; // CSS standard "T R B L"
  align?: string;   // align-items (CENTER, FLEX_START, FLEX_END)
  justify?: string; // justify-content (CENTER, SPACE_BETWEEN, FLEX_START, FLEX_END)
  width?: number;
  height?: number;
  flex?: number;    // flex-grow (e.g. 1 for fill-container)
}

export interface CompactStyle {
  fill?: string;              // #HEX or rgba(...)
  stroke?: string;            // e.g. "1px solid #E0E0E0"
  radius?: number | string;   // corner radius (number or "8px 8px 0px 0px")
  shadow?: string;            // box-shadow format
  opacity?: number;
}

export interface CompactText {
  content: string;
  font?: string;              // e.g. "16px Inter 600"
  color?: string;
  align?: string;
  lineHeight?: number;
  lineHeightUnit?: string;
  letterSpacing?: number;
  textCase?: string;
  textDecoration?: string;
}

export interface CompactIcon {
  name: string;               // e.g. "icon/warning" or "WarningIcon"
  size?: string;              // e.g. "24x24"
}

export interface CompactNode {
  id: string;
  name: string;
  type: string;
  props?: Record<string, any>; // Extracted Component Properties (e.g. { type: 'Warning', hasIcon: true })
  layout?: CompactLayout;
  style?: CompactStyle;
  text?: CompactText;
  icon?: CompactIcon;
  children?: CompactNode[];
  unsupportedProperties?: string[];
  renderMetadata?: Record<string, any>;
}

export type FidelityMode = 'semantic' | 'render-critical' | 'lossless-ast';

export interface CompressionOptions {
  stripInvisible?: boolean; // default: true
  roundDimensions?: boolean; // default: false
  fidelity?: FidelityMode;
}

/**
 * Converts Figma RGBA (0 to 1 range) to #RRGGBB or rgba(...)
 */
export function colorToHex(color: { r: number; g: number; b: number; a?: number }, opacity = 1): string {
  const r = Math.round((color.r ?? 0) * 255);
  const g = Math.round((color.g ?? 0) * 255);
  const b = Math.round((color.b ?? 0) * 255);
  const effectiveAlpha = color.a !== undefined ? color.a * opacity : opacity;

  if (effectiveAlpha < 0.999) {
    const formattedAlpha = Math.round(effectiveAlpha * 100) / 100;
    return `rgba(${r}, ${g}, ${b}, ${formattedAlpha})`;
  }

  const toHex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Prunes a Figma node recursively, preserving full depth but stripping non-render properties.
 */
export function pruneFigmaNode(node: any, options: CompressionOptions = {}): CompactNode {
  const { stripInvisible = true, roundDimensions = false, fidelity = 'render-critical' } = options;

  const result: CompactNode = {
    id: node.id,
    name: node.name,
    type: node.type,
  };

  // 0. Extract Component Properties (Variants, Booleans, Text props)
  if (node.componentProperties && typeof node.componentProperties === 'object') {
    const cleanProps: Record<string, any> = {};
    for (const [key, propObj] of Object.entries(node.componentProperties as Record<string, any>)) {
      cleanProps[key] = propObj && typeof propObj === 'object' && 'value' in propObj ? propObj.value : propObj;
    }
    if (Object.keys(cleanProps).length > 0) {
      result.props = cleanProps;
    }
  }

  // 1. Extract Auto Layout & Dimensions
  const layout: CompactLayout = {};
  if (node.layoutMode && node.layoutMode !== 'NONE') {
    layout.mode = node.layoutMode === 'VERTICAL' ? 'COL' : 'ROW';
    if (node.itemSpacing !== undefined && node.itemSpacing > 0) {
      layout.gap = node.itemSpacing;
    }

    const pt = node.paddingTop || 0;
    const pr = node.paddingRight || 0;
    const pb = node.paddingBottom || 0;
    const pl = node.paddingLeft || 0;
    if (pt || pr || pb || pl) {
      layout.padding = `${pt}px ${pr}px ${pb}px ${pl}px`;
    }

    if (node.primaryAxisAlignItems && node.primaryAxisAlignItems !== 'MIN') {
      layout.justify = node.primaryAxisAlignItems;
    }
    if (node.counterAxisAlignItems && node.counterAxisAlignItems !== 'MIN') {
      layout.align = node.counterAxisAlignItems;
    }
  }

  // Flex grow (e.g. fill container in auto layout)
  if (node.layoutGrow === 1) {
    layout.flex = 1;
  }

  // Dimension bounds
  if (node.absoluteBoundingBox) {
    layout.width = roundDimensions ? Math.round(node.absoluteBoundingBox.width) : node.absoluteBoundingBox.width;
    layout.height = roundDimensions ? Math.round(node.absoluteBoundingBox.height) : node.absoluteBoundingBox.height;
  }
  if (Object.keys(layout).length > 0) {
    result.layout = layout;
  }

  // 2. Extract Styles
  const style: CompactStyle = {};

  // Fills (Solid color)
  const visibleFill = (node.fills || []).find((f: any) => f.visible !== false && f.type === 'SOLID');
  if (visibleFill?.color) {
    style.fill = colorToHex(visibleFill.color, visibleFill.opacity ?? 1);
  }

  // Strokes (Border)
  const visibleStroke = (node.strokes || []).find((s: any) => s.visible !== false && s.type === 'SOLID');
  if (visibleStroke?.color) {
    const strokeWidth = node.strokeWeight || 1;
    style.stroke = `${strokeWidth}px solid ${colorToHex(visibleStroke.color, visibleStroke.opacity ?? 1)}`;
  }

  // Corner radius (Supports uniform number or 4-corner CSS string "T R B L")
  if (Array.isArray(node.rectangleCornerRadii) && node.rectangleCornerRadii.length === 4) {
    style.radius = node.rectangleCornerRadii.map((r: number) => `${Math.round(r)}px`).join(' ');
  } else if (node.cornerRadius !== undefined && node.cornerRadius > 0) {
    style.radius = node.cornerRadius;
  }

  // Drop Shadows
  const dropShadow = (node.effects || []).find((e: any) => e.visible !== false && e.type === 'DROP_SHADOW');
  if (dropShadow) {
    const { offset = { x: 0, y: 0 }, radius = 0, color = { r: 0, g: 0, b: 0, a: 0.15 } } = dropShadow;
    style.shadow = `${offset.x}px ${offset.y}px ${radius}px ${colorToHex(color)}`;
  }

  if (node.opacity !== undefined && node.opacity < 0.999) {
    style.opacity = Math.round(node.opacity * 100) / 100;
  }

  if (Object.keys(style).length > 0) {
    result.style = style;
  }

  // 3. Extract Text attributes
  if (node.type === 'TEXT') {
    const fontStyle = node.style || {};
    result.text = {
      content: node.characters || '',
      font: `${fontStyle.fontSize || 14}px ${fontStyle.fontFamily || 'sans-serif'} ${fontStyle.fontWeight || 400}`,
      color: style.fill,
    };
    if (fontStyle.lineHeightPx) {
      result.text.lineHeight = Math.round(fontStyle.lineHeightPx);
    }
    if (fontStyle.lineHeightUnit) result.text.lineHeightUnit = fontStyle.lineHeightUnit;
    if (fontStyle.letterSpacing !== undefined) result.text.letterSpacing = fontStyle.letterSpacing;
    if (fontStyle.textCase) result.text.textCase = fontStyle.textCase;
    if (fontStyle.textDecoration) result.text.textDecoration = fontStyle.textDecoration;
    if (fontStyle.textAlignHorizontal && fontStyle.textAlignHorizontal !== 'LEFT') {
      result.text.align = fontStyle.textAlignHorizontal;
    }
  }

  // 4. Extract Vector Icon Hint
  if (node.type === 'VECTOR') {
    result.icon = {
      name: node.name,
      size: layout.width && layout.height ? `${layout.width}x${layout.height}` : undefined,
    };
  }

  // 4. Recurse Full Depth through children
  if (Array.isArray(node.children) && node.children.length > 0) {
    const filteredChildren = stripInvisible
      ? node.children.filter((child: any) => child.visible !== false)
      : node.children;

    if (filteredChildren.length > 0) {
      result.children = filteredChildren.map((child: any) => pruneFigmaNode(child, options));
    }
  }

  const unsupportedProperties: string[] = [];
  if ((node.fills || []).filter((fill: any) => fill.visible !== false).length > 1 ||
      (node.fills || []).some((fill: any) => fill.visible !== false && fill.type !== 'SOLID')) {
    unsupportedProperties.push('fills');
  }
  if ((node.strokes || []).filter((stroke: any) => stroke.visible !== false).length > 1 ||
      (node.strokes || []).some((stroke: any) => stroke.visible !== false && stroke.type !== 'SOLID')) {
    unsupportedProperties.push('strokes');
  }
  if ((node.effects || []).some((effect: any) => effect.visible !== false && effect.type !== 'DROP_SHADOW')) {
    unsupportedProperties.push('effects');
  }
  if (node.blendMode && node.blendMode !== 'PASS_THROUGH' && node.blendMode !== 'NORMAL') {
    unsupportedProperties.push('blendMode');
  }
  if (node.rotation) unsupportedProperties.push('rotation');
  if (node.clipsContent === true || node.isMask === true) unsupportedProperties.push('clipsContent');
  if (node.characterStyleOverrides || node.styleOverrideTable) unsupportedProperties.push('textStyles');
  if (node.layoutPositioning === 'ABSOLUTE') unsupportedProperties.push('absolutePositioning');
  if (node.minWidth !== undefined || node.maxWidth !== undefined || node.minHeight !== undefined ||
      node.maxHeight !== undefined || node.layoutSizingHorizontal || node.layoutSizingVertical) {
    unsupportedProperties.push('sizingConstraints');
  }
  if (node.visible === false) unsupportedProperties.push('invisibleOverlay');
  if (node.vectorPaths !== undefined && fidelity !== 'lossless-ast') unsupportedProperties.push('vectorPaths');
  if (node.fillGeometry !== undefined && fidelity !== 'lossless-ast') unsupportedProperties.push('fillGeometry');
  if (node.strokeGeometry !== undefined && fidelity !== 'lossless-ast') unsupportedProperties.push('strokeGeometry');
  for (const key of Object.keys(node)) {
    if (/(render|geometry)/i.test(key) && !unsupportedProperties.includes(key) && fidelity !== 'lossless-ast') {
      unsupportedProperties.push(key);
    }
  }
  if (unsupportedProperties.length > 0) result.unsupportedProperties = unsupportedProperties;

  if (fidelity === 'semantic') {
    delete result.layout;
    delete result.style;
    delete result.icon;
    delete result.unsupportedProperties;
    if (result.text) {
      result.text = { content: result.text.content };
    }
  }

  if (fidelity === 'lossless-ast') {
    const metadataKeys = [
      'fills', 'strokes', 'effects', 'blendMode', 'relativeTransform', 'constraints',
      'rotation', 'clipsContent', 'isMask', 'layoutPositioning', 'minWidth', 'maxWidth',
      'minHeight', 'maxHeight', 'layoutSizingHorizontal', 'layoutSizingVertical',
      'characterStyleOverrides', 'styleOverrideTable', 'vectorPaths', 'fillGeometry', 'strokeGeometry'
    ];
    const renderMetadata: Record<string, any> = {};
    const renderLikeKeys = Object.keys(node).filter((key) => /(render|geometry)/i.test(key));
    for (const key of [...metadataKeys, ...renderLikeKeys]) {
      if (node[key] !== undefined) renderMetadata[key] = node[key];
    }
    if (Object.keys(renderMetadata).length > 0) result.renderMetadata = renderMetadata;
  }

  return result;
}

/**
 * Calculates compression stats between raw JSON and pruned compact JSON
 */
export function calculateCompressionStats(raw: any, compact: any) {
  const rawString = JSON.stringify(raw, null, 2);
  const compactString = JSON.stringify(compact, null, 2);

  const rawBytes = Buffer.byteLength(rawString, 'utf8');
  const compactBytes = Buffer.byteLength(compactString, 'utf8');

  // Approximation only: this is a character proxy, not tokenizer output.
  const rawCharacterProxy = Math.round(rawString.length / 4);
  const compactCharacterProxy = Math.round(compactString.length / 4);

  const savingsPercent = Math.round(((rawBytes - compactBytes) / rawBytes) * 100);

  return {
    rawBytes,
    compactBytes,
    rawCharacterProxy,
    compactCharacterProxy,
    charactersSaved: rawCharacterProxy - compactCharacterProxy,
    savingsPercent,
  };
}
