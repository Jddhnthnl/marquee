// node sync.test.mjs — pure merge rules only (sync.js imports Firebase from a URL, so we copy the two functions' module text).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./sync.js', import.meta.url), 'utf8');
const pick = (name) => src.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}`))[0].replace('export ', '');
const { decide, mergeProfiles } = new Function(`${pick('decide')}\n${pick('mergeProfiles')}\nreturn { decide, mergeProfiles };`)();

assert.equal(decide(undefined, 5, false), 'pull', 'new device takes the cloud copy');
assert.equal(decide(undefined, 5, true), 'pull', 'unstamped local data (pre-sync) loses to the cloud');
assert.equal(decide(undefined, undefined, true), 'push', 'pre-sync data with nothing in the cloud is uploaded');
assert.equal(decide(9, 5, true), 'push', 'newer local wins');
assert.equal(decide(5, 9, true), 'pull', 'newer remote wins');
assert.equal(decide(5, 5, true), null, 'equal: nothing to do (our own echo)');
assert.equal(decide(5, undefined, false), null, 'nothing anywhere');

const list = [{ id: '1' }, { id: '2' }];
assert.equal(JSON.parse(mergeProfiles(JSON.stringify({ active: '2', list }), JSON.stringify({ active: '1', list }))).active, '2', 'keeps this device\'s profile');
assert.equal(JSON.parse(mergeProfiles(JSON.stringify({ active: '3', list }), JSON.stringify({ active: '1', list }))).active, '1', 'falls back when ours was deleted');
assert.equal(JSON.parse(mergeProfiles(null, JSON.stringify({ active: '1', list }))).active, '1', 'fresh device');
console.log('sync tests pass');
