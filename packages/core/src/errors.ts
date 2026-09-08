export const errorCodes = [
  'INVALID_FIG_ARCHIVE',
  'MISSING_CANVAS',
  'UNSUPPORTED_FIG_VARIANT',
  'CORRUPT_KIWI_CHUNK',
  'RESOURCE_LIMIT_EXCEEDED',
  'OUTPUT_EXISTS',
  'NODE_NOT_FOUND',
  'AMBIGUOUS_NODE_REFERENCE',
  'NODE_REFERENCE_FILE_MISMATCH',
  'INVALID_REFERENCE_IMAGE',
  'REFERENCE_IMAGE_DIMENSION_MISMATCH',
  'REFERENCE_NOT_FOUND'
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export class FigctxError extends Error {
  readonly name = 'FigctxError';

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
  }
}
