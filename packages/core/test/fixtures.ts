import { createWriteStream } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZipFile } from 'yazl';

export const kiwiCanvas = new TextEncoder().encode('fig-kiwi\0\0\0\0');

export async function writeFixtureZip(entries: Record<string, Uint8Array>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'figctx-fixture-'));
  const path = join(directory, 'fixture.fig');
  const zip = new ZipFile();

  for (const [name, bytes] of Object.entries(entries)) {
    zip.addBuffer(Buffer.from(bytes), name);
  }

  const output = createWriteStream(path);
  const done = new Promise<void>((resolve, reject) => {
    output.once('close', resolve);
    output.once('error', reject);
  });

  zip.outputStream.pipe(output);
  zip.end();
  await done;
  return path;
}
