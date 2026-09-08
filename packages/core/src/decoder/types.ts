export interface DecodedFig {
  readonly decoderVersion: string;
  readonly canvasVersion: number;
  readonly document: Record<string, unknown>;
  readonly nodeChanges: readonly Record<string, unknown>[];
  readonly blobs: readonly unknown[];
}
