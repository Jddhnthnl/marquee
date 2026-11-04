// node sync.test.mjs — pure merge rules only (sync.js imports Firebase from a URL, so we copy the two functions' module text).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./sync.js', import.meta.url), 'utf8');
const pick = (name) => src.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}`))[0].replace('export ', '');
const { decide, mergeProfiles } = new Function(`${pick('decide')}\n${pick('mergeProfiles')}\nreturn { decide, mergeProfiles };`)();

const keepOffline = new Function(`return ${src.match(/export const keepOffline = (.*);/)[1]}`)();
assert.equal(keepOffline('unavailable', true), true, 'offline at launch: stay signed in');
assert.equal(keepOffline(undefined, true), true, 'unknown network error: stay signed in');
assert.equal(keepOffline('permission-denied', true), false, 'removed from the invite list: signed out');
assert.equal(keepOffline('unavailable', false), false, 'another account was never synced here: no data to open');

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

const profileOf = new Function(`return ${src.match(/export const profileOf = (.*);/)[1]}`)();
assert.equal(profileOf('library_k3x9'), 'k3x9');
assert.equal(profileOf('installed_addon_urls_1'), '1', 'underscores in the key name');
assert.equal(profileOf('profiles'), null);
assert.equal(profileOf('autoplay_prefs'), null, 'not a per-profile key');

const { pruneProfiles } = new Function(`${pick('pruneProfiles')}\nreturn { pruneProfiles };`)();
const three = JSON.stringify({ active: '2', list: [{ id: '1' }, { id: '2' }, { id: '3' }] });
assert.deepEqual(JSON.parse(pruneProfiles(three, new Set(['3']))), { active: '2', list: [{ id: '1' }, { id: '2' }] }, 'stale offline list loses the deleted profile');
assert.equal(JSON.parse(pruneProfiles(three, new Set(['2']))).active, '1', 'active moves off a deleted profile');
assert.equal(pruneProfiles(three, new Set(['9'])), three, 'nothing deleted: same text, so no push');
const one = JSON.stringify({ active: '1', list: [{ id: '1' }] });
assert.equal(pruneProfiles(one, new Set(['1'])), one, 'never empties the list');
console.log('sync tests pass');
