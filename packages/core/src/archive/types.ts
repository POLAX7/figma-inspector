import type { AssetFormat } from '../assets.js';

export interface ArchiveLimits {
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly maxTotalBytes: number;
}

export interface FigImage {
  readonly hash: string;
  readonly bytes: Uint8Array;
  readonly format: AssetFormat;
}

export interface FigArchive {
  readonly sourceFilename: string;
  readonly sourceSha256: string;
  readonly meta: Record<string, unknown>;
  readonly canvas: Uint8Array;
  readonly canvasVariant: 'fig-kiwi';
  readonly thumbnail?: Uint8Array;
  readonly images: readonly FigImage[];
}

export const defaultArchiveLimits: ArchiveLimits = {
  maxEntries: 10_000,
  maxEntryBytes: 256 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024
};
