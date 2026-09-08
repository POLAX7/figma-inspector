import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const patterns = [
  { type: 'Figma personal access token', regex: /figd_[A-Za-z0-9_-]{20,}/g },
  { type: 'GitHub classic token', regex: /gh[pousr]_[A-Za-z0-9]{30,}/g },
  { type: 'GitHub fine-grained token', regex: /github_pat_[A-Za-z0-9_]{40,}/g },
  { type: 'private key', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g }
];

export function findSecretFindings(text) {
  const findings = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern.regex)) {
      if (/^figd_x+$/i.test(match[0])) continue;
      findings.push({ line: text.slice(0, match.index).split(/\r?\n/).length, type: pattern.type });
    }
  }
  return findings;
}

function scanRepository(root) {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  const findings = [];
  for (const file of files) {
    let text;
    try { text = readFileSync(resolve(root, file), 'utf8'); } catch { continue; }
    if (text.includes('\0')) continue;
    for (const finding of findSecretFindings(text)) findings.push(`${file}:${finding.line} ${finding.type}`);
  }
  return { files, findings };
}

function main() {
  const { files, findings } = scanRepository(process.cwd());
  if (findings.length) {
    console.error(`Potential secrets detected:\n${findings.join('\n')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Secret pattern check passed (${files.length} files scanned; token values were not printed).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
