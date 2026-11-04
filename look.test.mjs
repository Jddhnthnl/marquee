// node look.test.mjs
import assert from 'node:assert/strict';
import { LOOK_DEFAULTS, ACCENTS, AVATARS, PROFILE_COLORS, orderRows, removeProfile, resetSection, newProfileId } from './look.js';

// defaults the spec settled on
assert.equal(LOOK_DEFAULTS.accent, 'tungsten');
assert.equal(LOOK_DEFAULTS.posterSize, 'M');
assert.equal(LOOK_DEFAULTS.intro, true);
assert.deepEqual(Object.keys(ACCENTS), ['tungsten', 'red', 'plum', 'green']);
assert.equal(Object.keys(AVATARS).length, 16);
assert.equal(PROFILE_COLORS.length, 8);

// home rows: saved order first, rows the user never arranged keep their place at the end, gone rows drop out
assert.deepEqual(orderRows(['cw', 'a', 'b', 'c'], { order: [], hidden: [] }),
  [{ key: 'cw', shown: true }, { key: 'a', shown: true }, { key: 'b', shown: true }, { key: 'c', shown: true }]);
assert.deepEqual(orderRows(['cw', 'a', 'b', 'c'], { order: ['b', 'gone', 'cw'], hidden: ['a'] }),
  [{ key: 'b', shown: true }, { key: 'cw', shown: true }, { key: 'a', shown: false }, { key: 'c', shown: true }]);

// profiles: never delete the last one; deleting the active one hands over to the first left
const two = { active: '1', list: [{ id: '1', name: 'Main' }, { id: 'k2', name: 'Kid' }] };
assert.deepEqual(removeProfile(two, '1'), { active: 'k2', list: [{ id: 'k2', name: 'Kid' }] });
assert.deepEqual(removeProfile(two, 'k2'), { active: '1', list: [{ id: '1', name: 'Main' }] });
const one = { active: '1', list: [{ id: '1', name: 'Main' }] };
assert.equal(removeProfile(one, '1'), one);
// new ids never repeat a deleted one (its synced data would come back)
assert.match(newProfileId(), /^\w+$/);
assert.notEqual(newProfileId(), newProfileId());

// each section's reset only clears its own keys
const saved = { player: 'mpv', subSize: 150, subLang1: 'es', accent: 'red', homeRows: { order: ['a'], hidden: [] }, intro: false };
assert.deepEqual(resetSection(saved, 'look'), { player: 'mpv', subSize: 150, subLang1: 'es' });
assert.deepEqual(resetSection(saved, 'subtitles'), { player: 'mpv', accent: 'red', homeRows: { order: ['a'], hidden: [] }, intro: false });
assert.deepEqual(resetSection(saved, 'playback'), { subSize: 150, subLang1: 'es', accent: 'red', homeRows: { order: ['a'], hidden: [] }, intro: false });

console.log('look tests pass');
