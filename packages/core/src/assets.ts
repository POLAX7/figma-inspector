export type AssetFormat = 'png' | 'jpeg' | 'gif' | 'webp' | 'svg' | 'unknown';

const textDecoder = new TextDecoder();

export function detectAssetFormat(bytes: Uint8Array): AssetFormat {
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'png';
  }

  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) {
    return 'jpeg';
  }

  if (hasAsciiPrefix(bytes, 'GIF87a') || hasAsciiPrefix(bytes, 'GIF89a')) {
    return 'gif';
  }

  if (hasAsciiPrefix(bytes, 'RIFF') && asciiAt(bytes, 8, 4) === 'WEBP') {
    return 'webp';
  }

  if (/^\s*<svg(?:\s|>)/i.test(textDecoder.decode(bytes.subarray(0, 256)))) {
    return 'svg';
  }

  return 'unknown';
}

export function extensionForAsset(format: AssetFormat): string | undefined {
  return format === 'unknown' ? undefined : format === 'jpeg' ? 'jpg' : format;
}

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function hasAsciiPrefix(bytes: Uint8Array, value: string): boolean {
  return asciiAt(bytes, 0, value.length) === value;
}

function asciiAt(bytes: Uint8Array, start: number, length: number): string {
  return textDecoder.decode(bytes.subarray(start, start + length));
}
