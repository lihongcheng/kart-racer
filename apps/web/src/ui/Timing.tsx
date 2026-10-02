import { compareSectors, formatDelta } from '../game/timing';
import { formatTime } from '../game/rules';
import type { Snapshot } from '../game/engine';

const deltaClass = (value: number | null) => value === null ? '' : value < -0.0005 ? 'faster' : value > 0.0005 ? 'slower' : '';
export function TimingHUD({ state }: { state: Snapshot }) {
  const last = compareSectors(state.sectorEnds, state.referenceEnds).at(-1);
  return <div className="timing-hud">
    <span>第 {Math.min(3, Math.floor(state.sectorEnds.length / 3) + 1)} 圈 · S{Math.min(8, state.sectorEnds.length) % 3 + 1}</span>
    <strong>{formatTime(state.elapsed - (state.sectorEnds.at(-1) ?? 0))}</strong>
    {last ? <div aria-live="polite"><span>L{last.lap} S{last.sector} · {formatTime(last.duration)}</span>
      <b className={deltaClass(last.delta)}>分段 {formatDelta(last.delta)}</b>
      <b className={deltaClass(last.cumulative)}>累计 {formatDelta(last.cumulative)}</b></div>
      : <small>{state.ghostAvailable ? '对比个人最佳三圈成绩' : '完成三圈，记录你的节奏'}</small>}
  </div>;
}
export function TimingResults({ state }: { state: Snapshot }) {
  const rows = compareSectors(state.sectorEnds, state.referenceEnds);
  const gains = rows.filter(r => r.delta !== null && r.delta < -0.0005).sort((a, b) => a.delta! - b.delta!);
  const losses = rows.filter(r => r.delta !== null && r.delta > 0.0005).sort((a, b) => b.delta! - a.delta!);
  return <section className="sector-results" aria-label="九段计时对比">
    <p>{state.referenceEnds.length ? '对比本场出发前的个人最佳' : '首次有效分段 · 下次从这里进步'}</p>
    <table><thead><tr><th>路段</th><th>用时</th><th>分段差</th><th>累计差</th></tr></thead>
      <tbody>{rows.map(r => <tr key={`${r.lap}:${r.sector}`}><th>L{r.lap} · S{r.sector}</th>
        <td>{formatTime(r.duration)}</td><td className={deltaClass(r.delta)}>{formatDelta(r.delta)}</td>
        <td className={deltaClass(r.cumulative)}>{formatDelta(r.cumulative)}</td></tr>)}</tbody></table>
    {(gains[0] || losses[0]) && <div className="sector-insights">
      {gains[0] && <span className="faster">进步最多 L{gains[0].lap} S{gains[0].sector} · {formatDelta(gains[0].delta)}</span>}
      {losses[0] && <span className="slower">损失最多 L{losses[0].lap} S{losses[0].sector} · {formatDelta(losses[0].delta)}</span>}
    </div>}
    {state.replayLimited && <p>本场超过回放容量，仍保留成绩与九段用时。</p>}
  </section>;
}
