import { spawn } from 'node:child_process';
import { readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';

const resultsDir = resolve('benchmarks/results');
const requestedRunId = process.argv[2];
const entries = await readdir(resultsDir, { withFileTypes: true });
const runs = [];

for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  const runDir = join(resultsDir, entry.name);
  try {
    const [raw, summary, metadata] = await Promise.all([
      stat(join(runDir, 'results.jsonl')),
      stat(join(runDir, 'summary.json')),
      stat(join(runDir, 'metadata.json')),
    ]);
    if (raw.isFile() && summary.isFile() && metadata.isFile()) runs.push(entry.name);
  } catch {
    // Ignore incomplete or unrelated directories.
  }
}

runs.sort();
const runId = requestedRunId ?? runs.at(-1);
if (!runId || !runs.includes(runId)) {
  throw new Error(requestedRunId
    ? `No completed benchmark run found for "${requestedRunId}"`
    : 'No completed benchmark runs found. Run pnpm benchmark:run first.');
}
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(runId)) {
  throw new Error('Invalid run ID');
}

const archivePath = join(resultsDir, `${runId}.zip`);
await rm(archivePath, { force: true });
const child = spawn('zip', ['-q', '-r', archivePath, runId], {
  cwd: resultsDir,
  stdio: 'inherit',
});
const [code, signal] = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('close', (exitCode, exitSignal) => resolve([exitCode, exitSignal]));
});
if (code !== 0) {
  throw new Error(`zip failed (${signal ?? code}). Install the zip utility and retry.`);
}

process.stdout.write(`Benchmark archive created: ${archivePath}\n`);
