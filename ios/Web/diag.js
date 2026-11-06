// Send diagnostics: a small buffer of the app's own errors, plus the rules that turn it and mpv's log into one report.
// Pure apart from the buffer, so `node diag.test.mjs` covers it.

export const MAX_LINES = 200, MAX_NOTE = 500, MAX_LINE = 400;
const buf = [];

// One line per app error/warning, newest last; only the last 100 are kept.
export function logLine(level, args, now = new Date()) {
  const text = args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : safeJson(a))).join(' ');
  buf.push(`${now.toISOString().slice(11, 19)} ${level} ${text}`.slice(0, MAX_LINE));
  if (buf.length > 100) buf.shift();
}
export const appLines = () => buf.slice();
const safeJson = (a) => { try { return JSON.stringify(a); } catch { return String(a); } };

// Remove anything that would let the reader use someone's debrid account: API keys in addon config paths,
// resolve URLs, query tokens and auth headers. Runs over the URL and every log line.
// shortcut: targeted patterns keep info-hashes and file names readable; a debrid/addon with a new key format leaks until listed here.
const SECRET_PARAM = /((?:^|[/?&|;,\s])(?:torbox|realdebrid|alldebrid|premiumize|debridlink|offcloud|putio|easydebrid|\w*(?:key|token|secret|auth|pass|sig)\w*)=)[^|/&\s"',;]+/gi;
export function redact(text) {
  return String(text)
    .replace(/(\/resolve\/[\w-]+\/)[^/\s"']+/gi, '$1<key>') // Torrentio: /resolve/<service>/<KEY>/<hash>/...
    .replace(SECRET_PARAM, '$1<key>')                       // addon config (torbox=KEY|...) and query (?token=...)
    .replace(/(authorization:\s*)[^\r\n]*/gi, '$1<key>');   // headers echoed in mpv's log
}

// The Firestore document: { v, at, note, url, log }. The log is app lines, then mpv's, last MAX_LINES in total.
export function buildReport({ version, note = '', url = '', app = [], mpv = '' }, now = Date.now()) {
  const lines = [...app, ...(mpv ? ['--- mpv ---', ...mpv.split('\n')] : [])].slice(-MAX_LINES).map((l) => redact(l).slice(0, MAX_LINE));
  return { v: String(version || '?'), at: now, note: note.trim().slice(0, MAX_NOTE), url: redact(url).slice(0, 2000), log: lines.join('\n') };
}
