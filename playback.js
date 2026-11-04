// Playback rules shared by the main page and the player: settings, which stream to play, skip and next-episode timing.
import { pickAutoPlay } from './protocol.js';

export const PLAYBACK_DEFAULTS = { player: 'marquee', externalPath: '', streamMode: 'reuse', quality: '1080p', nextDelay: 10, stillWatching: 3, skip: 'button' };
const QUALITY = { '2160p': '2160p|\\b4k\\b|uhd', '1080p': '1080p', '720p': '720p' };

// mode 'reuse' replays last.stream (the link that played this video before), else behaves like 'auto'; 'ask' never picks.
export function chooseStream({ mode, quality, last, groups, bingeGroup = null }) {
  if (mode === 'ask') return null;
  if (mode === 'reuse' && last?.stream?.url) return last.stream;
  return pickAutoPlay(groups, { mode: 'regex', regex: QUALITY[quality] ?? '', bingeGroup });
}

// Segments are { kind: 'intro' | 'recap' | 'outro', start, end } in seconds.
export const fromIntroDB = (j) => ['intro', 'recap', 'outro']
  .filter((k) => j?.[k] && j[k].end_sec > j[k].start_sec)
  .map((k) => ({ kind: k, start: j[k].start_sec, end: j[k].end_sec }));

const ANISKIP = { op: 'intro', 'mixed-op': 'intro', ed: 'outro', 'mixed-ed': 'outro', recap: 'recap' };
export const fromAniSkip = (j) => (j?.results ?? [])
  .filter((r) => ANISKIP[r.skipType])
  .map((r) => ({ kind: ANISKIP[r.skipType], start: r.interval.startTime, end: r.interval.endTime }));

export const segmentAt = (segs, t) => segs.find((x) => x.kind !== 'outro' && t >= x.start && t < x.end - 1) ?? null;

// Card time: when the end credits start, else 30 s before the end. Credits before the halfway mark are bad data.
export function nextCardAt(segs, duration) {
  if (!(duration > 0)) return null;
  const outro = segs.find((x) => x.kind === 'outro' && x.start > duration / 2);
  return outro ? outro.start : Math.max(0, duration - 30);
}

// Chapter names inside the file; a chapter runs until the next one (the last until the end).
const CHAPTER = [[/recap|previously/i, 'recap'], [/intro|opening|^op$/i, 'intro'], [/credits|ending|outro|^ed$/i, 'outro']];
export const fromChapters = (list, duration) => (list ?? []).flatMap((c, i) => {
  const kind = CHAPTER.find(([re]) => re.test(c.title ?? ''))?.[1];
  return kind ? [{ kind, start: c.time, end: list[i + 1]?.time ?? duration }] : [];
});
