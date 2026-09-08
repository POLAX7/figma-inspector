import { inflateRawSync, inflateSync } from 'node:zlib';
import { decompress as decompressZstd } from 'fzstd';
import { ByteBuffer, decodeBinarySchema, type Definition, type Field, type Schema } from 'kiwi-schema';
import { FigctxError } from '../errors.js';
import type { DecodedFig } from './types.js';

const headerLength = 12;
const kiwiSignature = new TextEncoder().encode('fig-kiwi');

export function decodeKiwiCanvas(canvas: Uint8Array): DecodedFig {
  try {
    const { version, chunks } = readChunks(canvas);
    const schema = decodeBinarySchema(decompressChunk(chunks[0]!));
    const root = findRootDefinition(schema);
    const decoded: unknown = new KiwiInterpreter(schema).decode(root, decompressChunk(chunks[1]!));
    if (!isRecord(decoded)) {
      throw new Error('Kiwi root message is not an object.');
    }

    const nodeChanges = decoded.nodeChanges;
    if (!Array.isArray(nodeChanges) || !nodeChanges.every(isRecord)) {
      throw new Error('Kiwi root message does not contain nodeChanges.');
    }

    return {
      decoderVersion: 'kiwi-schema@0.5.0',
      canvasVersion: version,
      document: decoded,
      nodeChanges,
      blobs: Array.isArray(decoded.blobs) ? decoded.blobs : []
    };
  } catch (error) {
    if (error instanceof FigctxError) throw error;
    throw new FigctxError('CORRUPT_KIWI_CHUNK', 'Unable to decode fig-kiwi canvas.', error);
  }
}

function readChunks(canvas: Uint8Array): { version: number; chunks: Uint8Array[] } {
  if (canvas.byteLength < headerLength || !hasPrefix(canvas, kiwiSignature)) {
    throw new Error('Missing fig-kiwi header.');
  }

  const view = new DataView(canvas.buffer, canvas.byteOffset, canvas.byteLength);
  const version = view.getUint32(8, true);
  const chunks: Uint8Array[] = [];
  let offset = headerLength;

  while (offset < canvas.byteLength) {
    if (offset + 4 > canvas.byteLength) {
      throw new Error('Truncated chunk length.');
    }

    const length = view.getUint32(offset, true);
    offset += 4;
    if (length > canvas.byteLength - offset) {
      throw new Error('Truncated chunk payload.');
    }

    chunks.push(canvas.subarray(offset, offset + length));
    offset += length;
  }

  if (chunks.length < 2) {
    throw new Error('fig-kiwi canvas requires schema and message chunks.');
  }

  return { version, chunks };
}

function decompressChunk(chunk: Uint8Array): Uint8Array {
  try {
    return new Uint8Array(inflateRawSync(chunk));
  } catch {
    try {
      return new Uint8Array(inflateSync(chunk));
    } catch {
      return decompressZstd(chunk);
    }
  }
}

function findRootDefinition(schema: Schema): string {
  const root = schema.definitions.find(
    (definition) =>
      definition.kind === 'MESSAGE' &&
      definition.fields.some((field) => field.name === 'nodeChanges') &&
      definition.fields.some((field) => field.name === 'blobs')
  );

  if (!root) {
    throw new Error('Kiwi schema has no Message definition with nodeChanges and blobs.');
  }

  return root.name;
}

/**
 * Reads the binary schema directly. It intentionally does not call
 * `kiwi-schema.compileSchema()`, which generates JavaScript with `new Function`.
 */
class KiwiInterpreter {
  readonly #definitions = new Map<string, Definition>();

  constructor(schema: Schema) {
    for (const definition of schema.definitions) this.#definitions.set(definition.name, definition);
  }

  decode(rootName: string, bytes: Uint8Array): unknown {
    return this.#decodeDefinition(this.#definition(rootName), new ByteBuffer(bytes));
  }

  #decodeDefinition(definition: Definition, buffer: ByteBuffer): Record<string, unknown> {
    if (definition.kind === 'ENUM') throw new Error(`Cannot decode enum ${definition.name} as a root value.`);
    const result: Record<string, unknown> = {};

    if (definition.kind === 'STRUCT') {
      for (const field of definition.fields) result[field.name] = this.#decodeField(field, buffer);
      return result;
    }

    const fields = new Map(definition.fields.map((field) => [field.value, field]));
    while (true) {
      const fieldNumber = buffer.readVarUint();
      if (fieldNumber === 0) return result;
      const field = fields.get(fieldNumber);
      if (!field) throw new Error(`Message ${definition.name} has unknown field ${fieldNumber}.`);
      result[field.name] = this.#decodeField(field, buffer);
    }
  }

  #decodeField(field: Field, buffer: ByteBuffer): unknown {
    if (field.isArray) {
      if (field.type === 'byte') return buffer.readByteArray();
      const length = buffer.readVarUint();
      return Array.from({ length }, () => this.#decodeValue(field.type!, buffer));
    }
    return this.#decodeValue(field.type!, buffer);
  }

  #decodeValue(type: string, buffer: ByteBuffer): unknown {
    switch (type) {
      case 'bool': return Boolean(buffer.readByte());
      case 'byte': return buffer.readByte();
      case 'int': return buffer.readVarInt();
      case 'uint': return buffer.readVarUint();
      case 'float': return buffer.readVarFloat();
      case 'string': return buffer.readString();
      case 'int64': return buffer.readVarInt64();
      case 'uint64': return buffer.readVarUint64();
      default: {
        const definition = this.#definition(type);
        if (definition.kind === 'ENUM') {
          const value = buffer.readVarUint();
          const variant = definition.fields.find((field) => field.value === value);
          if (!variant) throw new Error(`Enum ${type} contains an unknown value.`);
          return variant.name;
        }
        return this.#decodeDefinition(definition, buffer);
      }
    }
  }

  #definition(name: string): Definition {
    const definition = this.#definitions.get(name);
    if (!definition) throw new Error(`Kiwi schema refers to unknown definition ${name}.`);
    return definition;
  }
}

function hasPrefix(bytes: Uint8Array, prefix: Uint8Array): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
