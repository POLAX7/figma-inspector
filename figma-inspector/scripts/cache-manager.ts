/**
 * cache-manager.ts
 * 
 * Manages local persistence and retrieval of pruned Figma Component ASTs.
 * Ensures an external component instance is fetched from the cloud API AT MOST ONCE.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CompactNode } from './prune-figma-node.ts';

export interface CacheEntry {
  fileKey: string;
  nodeId: string;
  componentName: string;
  cachedAt: string;
  version: string;
  schemaVersion: string;
  sourceSha256?: string;
  ast: CompactNode;
}

export interface CacheLoaderResult {
  componentName: string;
  ast: CompactNode;
  sourceSha256?: string;
}

export class FigmaCacheManager {
  private static readonly CACHE_SCHEMA_VERSION = '1.0.0';
  private baseDir: string | null = null;
  private figctxRoot: string | null = null;
  private inFlight = new Map<string, Promise<CacheEntry>>();

  constructor(customDir?: string) {
    if (customDir) {
      this.baseDir = customDir;
      this.ensureDirExists(this.baseDir);
    } else {
      // Find .figctx upward from current working directory
      this.figctxRoot = this.findFigctxRoot(process.cwd());
      if (!this.figctxRoot) {
        this.baseDir = path.resolve(process.cwd(), '.figma-cache', 'components');
        this.ensureDirExists(this.baseDir);
      }
    }
  }

  /**
   * Search upwards for a .figctx directory
   */
  private findFigctxRoot(startDir: string): string | null {
    let current = path.resolve(startDir);
    while (true) {
      const candidate = path.join(current, '.figctx');
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return null;
  }

  private ensureDirExists(dirPath: string) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  private manifestSourceExists(bundleDir: string, sourceFilename?: string): boolean {
    if (!sourceFilename) return true;
    const candidates = [
      path.resolve(bundleDir, sourceFilename),
      ...(this.figctxRoot ? [path.resolve(this.figctxRoot, sourceFilename)] : []),
    ];
    return candidates.some((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  }

  /**
   * Finds the exact bundle folder under .figctx matching the given fileKey,
   * by checking manifest.json originFileKey or folder names.
   */
  public resolveTargetDirectory(fileKey?: string): string {
    if (this.baseDir) {
      return this.baseDir;
    }

    if (this.figctxRoot && fs.existsSync(this.figctxRoot)) {
      try {
        const entries = fs.readdirSync(this.figctxRoot, { withFileTypes: true });
        const subdirs = entries.filter((e) => e.isDirectory());

        if (fileKey) {
          // 1. Check each bundle's manifest.json for matching originFileKey
          for (const dir of subdirs) {
            const manifestPath = path.join(this.figctxRoot, dir.name, 'manifest.json');
            if (fs.existsSync(manifestPath)) {
              try {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
                if (manifest.originFileKey === fileKey || manifest.sourceFilename?.includes(fileKey)) {
                  const targetHydrated = path.join(this.figctxRoot, dir.name, 'hydrated');
                  this.ensureDirExists(targetHydrated);
                  return targetHydrated;
                }
              } catch {
                // ignore JSON parse error in individual manifest
              }
            }
          }
        }

        if (fileKey) {
          throw new Error(`[FigmaCacheManager] No .figctx bundle matches fileKey "${fileKey}".`);
        }

        // 2. Resolve a default directory only when no source identity was supplied.
        const defaultDir = subdirs[0]
          ? path.join(this.figctxRoot, subdirs[0].name, 'hydrated')
          : path.join(this.figctxRoot, 'hydrated');
        this.ensureDirExists(defaultDir);
        return defaultDir;
      } catch (err) {
        if (fileKey) throw err;
        // Fallback below when resolving an unspecified default directory.
      }
    }

    const fallback = path.resolve(process.cwd(), '.figma-cache', 'components');
    this.ensureDirExists(fallback);
    return fallback;
  }

  /**
   * Generates a safe filename for the cached component
   * e.g., "1518-55106.json" or "fileKey_1518-55106.json"
   */
  public getCacheFilePath(fileKey: string, nodeId: string): string {
    const targetDir = this.resolveTargetDirectory(fileKey);
    const sanitizedFileKey = fileKey.replace(/[:\/\\?%*|"<>]/g, '-');
    const sanitizedNodeId = nodeId.replace(/[:\/\\?%*|"<>]/g, '-');
    const filename = `${sanitizedFileKey}_${sanitizedNodeId}_schema-${FigmaCacheManager.CACHE_SCHEMA_VERSION}.json`;
    return path.join(targetDir, filename);
  }

  /**
   * Retrieves the sourceSha256 from manifest.json of the bundle matching fileKey
   */
  public getSourceSha256(fileKey?: string): string | null {
    if (!this.figctxRoot || !fs.existsSync(this.figctxRoot) || !fileKey) {
      return null;
    }
    try {
      const entries = fs.readdirSync(this.figctxRoot, { withFileTypes: true });
      for (const dir of entries.filter((e) => e.isDirectory())) {
        const manifestPath = path.join(this.figctxRoot, dir.name, 'manifest.json');
        if (fs.existsSync(manifestPath)) {
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
                if ((manifest.originFileKey === fileKey || manifest.sourceFilename?.includes(fileKey))
                  && this.manifestSourceExists(path.join(this.figctxRoot, dir.name), manifest.sourceFilename)) {
                  return manifest.sourceSha256 || null;
                }
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Checks if a valid, fresh cached AST exists for the given fileKey and nodeId
   */
  public has(fileKey: string, nodeId: string): boolean {
    return this.get(fileKey, nodeId) !== null;
  }

  public async getOrSet(
    fileKey: string,
    nodeId: string,
    loader: () => Promise<CacheLoaderResult>
  ): Promise<CacheEntry> {
    const cached = this.get(fileKey, nodeId);
    if (cached) return cached;

    const key = `${fileKey}\u0000${nodeId}`;
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const pending = (async () => {
      const rechecked = this.get(fileKey, nodeId);
      if (rechecked) return rechecked;
      const loaded = await loader();
      this.set(fileKey, nodeId, loaded.componentName, loaded.ast, { sourceSha256: loaded.sourceSha256 });
      return this.get(fileKey, nodeId)!;
    })();
    this.inFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      this.inFlight.delete(key);
    }
  }

  /**
   * Reads the cached CompactNode from disk.
   * Automatically invalidates and returns null if the source .fig file's SHA256 has changed.
   */
  public get(fileKey: string, nodeId: string): CacheEntry | null {
    const filePath = this.getCacheFilePath(fileKey, nodeId);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const rawContent = fs.readFileSync(filePath, 'utf-8');
      const entry = JSON.parse(rawContent) as CacheEntry;

      if (entry.fileKey !== fileKey || entry.nodeId !== nodeId || entry.schemaVersion !== FigmaCacheManager.CACHE_SCHEMA_VERSION) {
        console.warn(`[FigmaCacheManager] Cache identity or schema mismatch at ${filePath}.`);
        this.clear(fileKey, nodeId);
        return null;
      }

      // Auto-invalidation check: If manifest.json has a newer sourceSha256, invalidate stale cache
      const currentSha = this.getSourceSha256(fileKey);
      const shaMissingOrChanged = !currentSha || !entry.sourceSha256 || currentSha !== entry.sourceSha256;
      if ((currentSha && currentSha !== entry.sourceSha256) || (!this.baseDir && shaMissingOrChanged)) {
        console.warn(`[FigmaCacheManager] Cache for ${nodeId} is stale (source .fig changed). Auto-invalidating.`);
        this.clear(fileKey, nodeId);
        return null;
      }

      return entry;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[FigmaCacheManager] Failed to read cache file at ${filePath}: ${reason}`);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return null;
    }
  }

  /**
   * Saves a pruned CompactNode to disk with sourceSha256 metadata
   */
  public set(
    fileKey: string,
    nodeId: string,
    componentName: string,
    ast: CompactNode,
    options?: { sourceSha256?: string }
  ): string {
    const filePath = this.getCacheFilePath(fileKey, nodeId);
    const currentSha = options?.sourceSha256 || this.getSourceSha256(fileKey) || undefined;

    const entry: CacheEntry = {
      fileKey,
      nodeId,
      componentName,
      cachedAt: new Date().toISOString(),
      version: '1.0.0',
      schemaVersion: FigmaCacheManager.CACHE_SCHEMA_VERSION,
      sourceSha256: currentSha,
      ast,
    };

    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(entry, null, 2), 'utf-8');
    fs.renameSync(temporaryPath, filePath);
    return filePath;
  }

  /**
   * Clears a single cache entry or all cached entries
   */
  public clear(fileKey?: string, nodeId?: string): void {
    if (fileKey && nodeId) {
      const filePath = this.getCacheFilePath(fileKey, nodeId);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } else {
      if (this.baseDir) {
        if (fs.existsSync(this.baseDir)) {
          fs.rmSync(this.baseDir, { recursive: true, force: true });
        }
        this.ensureDirExists(this.baseDir);
      } else if (this.figctxRoot && fs.existsSync(this.figctxRoot)) {
        for (const entry of fs.readdirSync(this.figctxRoot, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const hydratedDir = path.join(this.figctxRoot, entry.name, 'hydrated');
          if (fs.existsSync(hydratedDir)) {
            fs.rmSync(hydratedDir, { recursive: true, force: true });
          }
          this.ensureDirExists(hydratedDir);
        }
      }
    }
  }

  public getCacheDirectory(): string {
    return this.baseDir || this.figctxRoot || path.resolve(process.cwd(), '.figma-cache', 'components');
  }
}
