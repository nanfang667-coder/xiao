import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEntry, mountEntry } from './entry.mjs';

test('preserves short and legacy invitation codes', () => {
  for (const code of ['NVG', 'abc', '12345678-1234-4123-8123-123456789abc']) {
    assert.equal(resolveEntry(`?code=${code}`).destination, `https://husil.world/${code}`);
  }
});
test('rejects missing, duplicate and malformed codes', () => {
  for (const query of ['', '?code=', '?code=NVG&code=ABC', '?code=//evil.test', '?code=%3Cscript%3E', '?code=ab', '?code=NVG%0a']) {
    assert.equal(resolveEntry(query).destination, null);
  }
});
test('query cannot override target or append injected URL parameters', () => {
  assert.equal(resolveEntry('?code=NVG&target=https://evil.test&url=https://evil.test').destination, 'https://husil.world/NVG');
});
function fixture(search) {
  const nodes = new Map();
  const doc = { getElementById(id) {
    assert.equal(id, 'title');
    if (!nodes.has(id)) nodes.set(id, { textContent: '即将抵达' });
    return nodes.get(id);
  } };
  const jumps = [];
  mountEntry(doc, { search, replace: url => jumps.push(url) });
  return { nodes, jumps };
}
test('preview keeps the arrival message without real traffic', () => {
  const app = fixture('?code=NVG&preview=1');
  assert.equal(app.nodes.get('title').textContent, '即将抵达');
  assert.deepEqual(app.jumps, []);
});
test('real mode redirects immediately without timer or click', () => {
  const app = fixture('?code=NVG');
  assert.deepEqual(app.jumps, ['https://husil.world/NVG']);
});
test('invalid invitation never redirects', () => {
  const app = fixture('?code=../');
  assert.deepEqual(app.jumps, []);
});
