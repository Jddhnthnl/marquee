// node .github/newer.test.mjs
import assert from 'node:assert/strict';
import { compare } from './newer.mjs';

assert.ok(compare('0.7.2', '0.7.1') > 0);
assert.ok(compare('0.7.1', '0.7.2') < 0, 'older tag must not replace the beta feed');
assert.ok(compare('0.10.0', '0.9.9') > 0, 'numeric, not text');
assert.ok(compare('0.7.2', '0.7.2-beta.1') > 0, 'release beats its own beta');
assert.ok(compare('0.7.2-beta.10', '0.7.2-beta.2') > 0);
assert.ok(compare('v0.7.1', '0.7.1') === 0);
assert.ok(compare('0.7.1', '0.0.0') > 0, 'first publish');
console.log('newer tests pass');
