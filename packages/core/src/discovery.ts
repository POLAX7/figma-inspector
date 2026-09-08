import { access, readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { describePng } from './visual/compare.js';
import type { AgentDocument, AgentNode } from './normalize/document.js';

export interface NodeSearchOptions { type?: string; limit?: number; }
export interface NodeSearchResult {
  id: string;
  name: string;
  type: string;
  text?: string;
  bounds?: unknown;
  matched: Array<'name' | 'text'>;
  ancestors: Array<Pick<AgentNode, 'id' | 'name' | 'type'>>;
}

export function searchNodes(document: AgentDocument, query: string, options: NodeSearchOptions = {}): NodeSearchResult[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const limit = Number.isInteger(options.limit) && options.limit! > 0 ? options.limit! : 20;
  const type = options.type?.toLocaleLowerCase();
  const results: NodeSearchResult[] = [];

  for (const node of Object.values(document.nodesById)) {
    if (type && node.type.toLocaleLowerCase() !== type) continue;
    const matched: Array<'name' | 'text'> = [];
    if (node.name.toLocaleLowerCase().includes(needle)) matched.push('name');
    if (node.text?.toLocaleLowerCase().includes(needle)) matched.push('text');
    if (!matched.length) continue;
    results.push({ id: node.id, name: node.name, type: node.type, ...(node.text === undefined ? {} : { text: node.text }), ...(node.bounds === undefined ? {} : { bounds: node.bounds }), matched, ancestors: ancestorsFor(document, node) });
    if (results.length === limit) break;
  }
  return results;
}

export interface DoctorCheck { code: string; ok: boolean; path?: string; message: string; }
export interface BundleDoctorReport { ok: boolean; checks: DoctorCheck[]; }

const requiredJsonFiles = [
  'manifest.json', 'document.raw.json', 'document.agent.json', 'tokens/colors.json', 'tokens/typography.json', 'tokens/effects.json', 'tokens/fonts.json', 'assets/images.json', 'assets/vectors.json'
] as const;

export async function doctorBundle(bundle: string): Promise<BundleDoctorReport> {
  const root = resolve(bundle);
  const checks: DoctorCheck[] = [];
  const json = new Map<string, unknown>();
  for (const path of requiredJsonFiles) {
    const value = await readJson(root, path, checks, true);
    if (value !== undefined) json.set(path, value);
  }

  checkContract(json.get('manifest.json'), 'manifest.json', checks);
  checkContract(json.get('document.agent.json'), 'document.agent.json', checks);
  for (const path of ['tokens/colors.json', 'tokens/typography.json', 'tokens/effects.json', 'tokens/fonts.json', 'assets/images.json', 'assets/vectors.json']) checkContract(json.get(path), path, checks);
  const variables = await readJson(root, 'tokens/variables.json', checks, false);
  if (variables !== undefined) checkContract(variables, 'tokens/variables.json', checks);
  await checkIndexedFiles(root, json.get('assets/images.json'), 'images', checks);
  await checkIndexedFiles(root, json.get('assets/vectors.json'), 'vectors', checks);

  const references = await readJson(root, 'references/index.json', checks, false) as { references?: unknown } | undefined;
  if (references?.references !== undefined) await checkReferences(root, references.references, checks);
  return { ok: checks.every((check) => check.ok), checks };
}

function ancestorsFor(document: AgentDocument, node: AgentNode): Array<Pick<AgentNode, 'id' | 'name' | 'type'>> {
  const ancestors: Array<Pick<AgentNode, 'id' | 'name' | 'type'>> = [];
  let parent = node.parentId ? document.nodesById[node.parentId] : undefined;
  while (parent) { ancestors.unshift({ id: parent.id, name: parent.name, type: parent.type }); parent = parent.parentId ? document.nodesById[parent.parentId] : undefined; }
  return ancestors;
}

async function readJson(root: string, path: string, checks: DoctorCheck[], required: boolean): Promise<unknown | undefined> {
  try {
    const contents = await readFile(bundlePath(root, path), 'utf8');
    const value = JSON.parse(contents) as unknown;
    checks.push({ code: 'JSON_OK', ok: true, path, message: 'Valid JSON.' });
    return value;
  } catch (error) {
    const missing = (error as { code?: string }).code === 'ENOENT';
    if (!required && missing) return undefined;
    checks.push({ code: missing ? 'MISSING_REQUIRED_FILE' : 'INVALID_JSON', ok: false, path, message: missing ? 'Required bundle file is missing.' : 'Bundle file is not valid JSON.' });
    return undefined;
  }
}

function checkContract(value: unknown, path: string, checks: DoctorCheck[]): void {
  if (!isRecord(value)) return;
  if (value.contractVersion === '1') checks.push({ code: 'CONTRACT_VERSION_OK', ok: true, path, message: 'Supported contract version.' });
  else checks.push({ code: 'INVALID_CONTRACT_VERSION', ok: false, path, message: 'Expected contractVersion "1".' });
}

async function checkIndexedFiles(root: string, value: unknown, key: 'images' | 'vectors', checks: DoctorCheck[]): Promise<void> {
  if (!isRecord(value) || !Array.isArray(value[key])) return;
  for (const entry of value[key]) {
    if (!isRecord(entry) || typeof entry.path !== 'string') {
      checks.push({ code: 'INVALID_INDEX_ENTRY', ok: false, message: `Invalid ${key} index entry.` });
      continue;
    }
    await checkFile(root, entry.path, checks);
  }
}

async function checkReferences(root: string, value: unknown, checks: DoctorCheck[]): Promise<void> {
  if (!Array.isArray(value)) {
    checks.push({ code: 'INVALID_REFERENCE_INDEX', ok: false, path: 'references/index.json', message: 'references must be an array.' });
    return;
  }
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.path !== 'string' || typeof entry.sha256 !== 'string' || typeof entry.width !== 'number' || typeof entry.height !== 'number') {
      checks.push({ code: 'INVALID_REFERENCE_ENTRY', ok: false, path: 'references/index.json', message: 'Invalid reference entry.' });
      continue;
    }
    try {
      const bytes = await readFile(bundlePath(root, entry.path));
      const description = describePng(bytes);
      if (description.sha256 !== entry.sha256) checks.push({ code: 'REFERENCE_HASH_MISMATCH', ok: false, path: entry.path, message: 'Reference PNG SHA-256 does not match its index.' });
      else if (description.width !== entry.width || description.height !== entry.height) checks.push({ code: 'REFERENCE_DIMENSION_MISMATCH', ok: false, path: entry.path, message: 'Reference PNG dimensions do not match its index.' });
      else checks.push({ code: 'REFERENCE_OK', ok: true, path: entry.path, message: 'Reference PNG matches its index.' });
    } catch (error) {
      const missing = (error as { code?: string }).code === 'ENOENT';
      checks.push({ code: missing ? 'MISSING_INDEXED_FILE' : 'INVALID_REFERENCE_IMAGE', ok: false, path: entry.path, message: missing ? 'Indexed file is missing.' : 'Reference is not a valid PNG.' });
    }
  }
}

async function checkFile(root: string, path: string, checks: DoctorCheck[]): Promise<void> {
  try { await access(bundlePath(root, path)); checks.push({ code: 'INDEXED_FILE_OK', ok: true, path, message: 'Indexed file exists.' }); }
  catch { checks.push({ code: 'MISSING_INDEXED_FILE', ok: false, path, message: 'Indexed file is missing.' }); }
}

function bundlePath(root: string, path: string): string {
  const resolved = resolve(root, path);
  const relativePath = relative(root, resolved);
  if (relativePath === '' || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !relativePath.startsWith(sep))) return resolved;
  throw new Error(`Bundle path escapes root: ${path}`);
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
