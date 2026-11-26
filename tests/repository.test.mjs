import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('package metadata defines an ESM-only, private, Apache-2.0 package', () => {
  assert.equal(packageJson.type, 'module');
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.license, 'Apache-2.0');
  assert.equal(packageJson.packageManager, 'pnpm@12.18.0');
  assert.equal(packageJson.engines.node, '>=22.18.0');
  assert.equal(packageJson.sideEffects, false);
});

test('runtime and tooling dependencies are exact-pinned', () => {
  for (const version of [
    ...Object.values(packageJson.dependencies),
    ...Object.values(packageJson.devDependencies),
    ...Object.values(packageJson.peerDependencies),
  ]) {
    assert.match(version, /^\d+\.\d+\.\d+$/u);
  }
});

test('package exports point only to built artifacts', () => {
  assert.deepEqual(Object.keys(packageJson.exports).sort(), [
    '.',
    './clipboard',
    './file',
    './qr',
    './webrtc',
  ]);
  for (const [name, conditions] of Object.entries(packageJson.exports)) {
    assert.ok(conditions.import.startsWith('./dist/'), name);
    assert.ok(conditions.types.startsWith('./dist/'), name);
  }
});

test('project documentation contains the protocol and security specifications', async () => {
  const [protocol, architecture, security, api] = await Promise.all([
    readFile(new URL('../docs/protocol.md', import.meta.url), 'utf8'),
    readFile(new URL('../docs/architecture.md', import.meta.url), 'utf8'),
    readFile(new URL('../docs/security.md', import.meta.url), 'utf8'),
    readFile(new URL('../docs/api.md', import.meta.url), 'utf8'),
  ]);

  assert.match(protocol, /Signaling Exchange Envelope/u);
  assert.match(security, /does not identify the sender/u);
  assert.match(api, /FragmentReassembler/u);
});

test('browser compatibility is tested without browser performance benchmarks', async () => {
  const [playwrightConfig, browserSuite, benchmarkGuide] = await Promise.all([
    readFile(new URL('../playwright.config.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../tests/browser/webrtc.spec.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../docs/benchmarks.md', import.meta.url), 'utf8'),
  ]);

  assert.match(playwrightConfig, /chromium/u);
  assert.match(playwrightConfig, /firefox/u);
  assert.match(playwrightConfig, /webkit/u);
  assert.match(playwrightConfig, /const webServerPort = 4174/u);
  assert.match(playwrightConfig, /--strictPort/u);
  assert.match(playwrightConfig, /reuseExistingServer: false/u);
  assert.match(browserSuite, /runPeerExchange/u);
  assert.match(benchmarkGuide, /pnpm test:browser/u);
  assert.match(benchmarkGuide, /correctness and compatibility tests, not performance benchmarks/u);
  assert.doesNotMatch(benchmarkGuide, /browser timing|browser benchmark|browser performance comparison/iu);
  assert.equal('benchmark:browser' in packageJson.scripts, false);
});
