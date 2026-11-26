import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

assert.equal(packageJson.type, 'module', 'The package must remain ESM-only');
assert.equal(packageJson.private, true, 'The package is private');
assert.equal(packageJson.license, 'Apache-2.0');
assert.equal(packageJson.sideEffects, false);
assert.ok(packageJson.files.includes('dist'));
assert.ok(packageJson.files.includes('docs'));

const coreEntrypoint = await readFile(path.join(root, 'dist/index.js'), 'utf8');
assert.doesNotMatch(
  coreEntrypoint,
  /(?:transports\/(?:qr|file|clipboard)|webrtc\/index|from\s+['"]\.\/(?:file|clipboard|qr|webrtc)\.js['"])/u,
  'Core entry point must not pull in adapters',
);

for (const [subpath, conditions] of Object.entries(packageJson.exports)) {
  assert.equal(subpath.startsWith('.'), true, `Invalid export key: ${subpath}`);
  assert.ok(conditions.import?.startsWith('./dist/'), `Export ${subpath} must point to built ESM`);
  assert.ok(
    conditions.types?.startsWith('./dist/'),
    `Export ${subpath} must point to built declarations`,
  );
  await access(path.join(root, conditions.import));
  await access(path.join(root, conditions.types));
}

for (const requiredFile of [
  'LICENSE',
  'README.md',
  'docs/api.md',
  'docs/protocol.md',
  'docs/benchmarks.md',
  'SECURITY.md',
]) {
  await access(path.join(root, requiredFile));
}

process.stdout.write(`Verified ${Object.keys(packageJson.exports).length} package entry points.\n`);
