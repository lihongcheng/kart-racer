import { getTrack, isTrackId, TRACKS, type TrackId } from './track';

export type RaceMode = 'race' | 'time';
export type Medal = 'gold' | 'silver' | 'bronze' | 'none';
export type RecordEntry = { trackId: TrackId; date: string; time: number; bestLap: number; rank: number; mode: RaceMode };
export type BestResult = Pick<RecordEntry, 'time' | 'bestLap' | 'rank'>;
export type ResultKey = `${TrackId}:${RaceMode}`;
export type Results = { version: 2; history: RecordEntry[]; bests: Partial<Record<ResultKey, BestResult>> };
export const RESULTS_KEY = 'coastline.records.v2';
export const MEDAL_LABELS: Record<Medal, string> = { gold: '金牌', silver: '银牌', bronze: '铜牌', none: '已完成' };
export const resultKey = (trackId: TrackId, mode: RaceMode): ResultKey => `${trackId}:${mode}`;
export const emptyResults = (): Results => ({ version: 2, history: [], bests: {} });
export function medalFor(trackId: TrackId, mode: RaceMode, result: BestResult): Medal {
  if (mode === 'race') return result.rank === 1 ? 'gold' : result.rank <= 3 ? 'silver' : 'bronze';
  const thresholds = getTrack(trackId).medals;
  for (const medal of ['gold', 'silver', 'bronze'] as const) if (result.time <= thresholds[medal]) return medal;
  return 'none';
}
export function nextMedal(trackId: TrackId, mode: RaceMode, medal: Medal) {
  if (medal === 'gold') return null;
  const next = medal === 'silver' ? 'gold' : medal === 'bronze' ? 'silver' : 'bronze';
  return { medal: next as Medal, target: mode === 'time' ? getTrack(trackId).medals[next] : next === 'gold' ? 1 : next === 'silver' ? 3 : 6 };
}
function mergeBest(a: BestResult | undefined, b: BestResult): BestResult {
  return a ? { time: Math.min(a.time, b.time), bestLap: Math.min(a.bestLap, b.bestLap), rank: Math.min(a.rank, b.rank) } : { time: b.time, bestLap: b.bestLap, rank: b.rank };
}
export function addResult(results: Results, entry: RecordEntry): Results {
  const key = resultKey(entry.trackId, entry.mode);
  return { version: 2, history: [entry, ...results.history].slice(0, 30),
    bests: { ...results.bests, [key]: mergeBest(results.bests[key], entry) } };
}
function validBest(value: unknown): value is BestResult {
  if (!value || typeof value !== 'object') return false;
  const r = value as BestResult;
  return Number.isFinite(r.time) && r.time > 0 && Number.isFinite(r.bestLap) && r.bestLap > 0 &&
    r.bestLap <= r.time && Number.isInteger(r.rank) && r.rank >= 1 && r.rank <= 6;
}
function parseEntry(value: unknown, legacy: boolean): RecordEntry | null {
  if (!validBest(value)) return null;
  const r = value as RecordEntry;
  const trackId = legacy && r.trackId === undefined ? 'coastline' : r.trackId;
  if (!isTrackId(trackId) || !['race', 'time'].includes(r.mode) || (r.mode === 'time' && r.rank !== 1) ||
      typeof r.date !== 'string' || !Number.isFinite(Date.parse(r.date))) return null;
  return { trackId, date: r.date, mode: r.mode, time: r.time, bestLap: r.bestLap, rank: r.rank };
}
/** Prefer v2 even if malformed, so an old backup cannot resurrect deleted history. */
export function parseResults(current: string | null, legacy: string | null = null): Results {
  const result = emptyResults();
  try {
    const data = JSON.parse(current ?? legacy ?? 'null');
    const old = current === null;
    if (old ? !Array.isArray(data) : !data || data.version !== 2 || !Array.isArray(data.history)) return result;
    const entries = (old ? data : data.history).map((r: unknown) => parseEntry(r, old)).filter((r: RecordEntry | null): r is RecordEntry => r !== null) as RecordEntry[];
    if (!old && data.bests && typeof data.bests === 'object') {
      for (const track of TRACKS) for (const mode of ['race', 'time'] as const) {
        const key = resultKey(track.id, mode), best = data.bests[key];
        if (validBest(best) && (mode !== 'time' || best.rank === 1)) result.bests[key] = mergeBest(undefined, best);
      }
    }
    for (const entry of entries) {
      const key = resultKey(entry.trackId, entry.mode);
      result.bests[key] = mergeBest(result.bests[key], entry);
    }
    result.history = entries.slice(0, 30);
    return result;
  } catch { return result; }
}
