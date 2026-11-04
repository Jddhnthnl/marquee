// node newer.mjs new.json old.json -> exit 0 when new's "version" is the same or newer (semver), else 1.
import { readFileSync } from 'node:fs';

export function compare(a, b) {
  const parse = (v) => { const [core, pre = ''] = String(v).replace(/^v/, '').split(/-(.*)/s); return [core.split('.').map(Number), pre]; };
  const [ca, pa] = parse(a), [cb, pb] = parse(b);
  for (let i = 0; i < 3; i++) if ((ca[i] || 0) !== (cb[i] || 0)) return (ca[i] || 0) - (cb[i] || 0);
  if (pa === pb) return 0;
  if (!pa || !pb) return pa ? -1 : 1; // 0.7.2 is newer than 0.7.2-beta.1
  return pa.localeCompare(pb, 'en', { numeric: true });
}

const [, , next, prev] = process.argv;
if (next) {
  const ver = (f) => JSON.parse(readFileSync(f, 'utf8')).version;
  process.exit(compare(ver(next), ver(prev)) >= 0 ? 0 : 1);
}
