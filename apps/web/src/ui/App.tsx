import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ArrowRight, ArrowLeft, Flag, Volume2, VolumeX, Settings2, X, Trophy, Timer, ChevronRight, Wind, Waves, Gauge, Keyboard, Zap, Pause, RotateCcw, Box, ExternalLink, Check, LoaderCircle } from 'lucide-react';
import { KartGame, initialSnapshot, type RaceMode, type Settings, type Snapshot } from '../game/engine';
import { PAINTS } from '../game/visuals';
import { getTrack, isTrackId, TRACKS, type RaceTrack, type TrackId } from '../game/track';
import { addResult, emptyResults, parseResults, resultKey, medalFor, nextMedal, MEDAL_LABELS, RESULTS_KEY, type RecordEntry, type Medal } from '../game/results';
import { formatTime } from '../game/rules';
import { AssetWorkshop } from './AssetWorkshop';

const defaults: Settings = { sound: true, quality: 'high', motion: true, difficulty: 'easy', paint: 0, trackId: 'coastline' };
function readSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem('coastline.settings') || '{}');
    return {
      sound: typeof s.sound === 'boolean' ? s.sound : true,
      motion: typeof s.motion === 'boolean' ? s.motion : true,
      quality: s.quality === 'low' ? 'low' : 'high',
      difficulty: s.difficulty === 'normal' ? 'normal' : 'easy',
      paint: [0, 1, 2].includes(s.paint) ? s.paint : 0,
      trackId: isTrackId(s.trackId) ? s.trackId : 'coastline',
    };
  } catch { return defaults; }
}
function readRecords() {
  try {
    return parseResults(localStorage.getItem(RESULTS_KEY), localStorage.getItem('coastline.records'));
  } catch { return emptyResults(); }
}

function Map({ track, state, compact = false }: { track: RaceTrack; state?: Snapshot; compact?: boolean }) {
  const { minimapPath, mapPosition } = track;
  const start = track.at(0).position, marker = mapPosition(start.x, start.z);
  return <svg viewBox="0 0 220 180" className={`track-map ${compact ? 'compact' : ''}`} aria-label={`${track.name}赛道地图`}>
    <path d={minimapPath} fill="none" stroke="currentColor" strokeWidth="11" strokeLinejoin="round" opacity=".12" />
    <path d={minimapPath} fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
    {state?.racers.slice().reverse().map(r => {
      const p = mapPosition(r.x, r.z);
      return <circle key={r.name} cx={p.x} cy={p.y} r={r.name === '你' ? 5 : 3.5} fill={r.name === '你' ? '#eff581' : r.color} stroke="#244b43" strokeWidth="1.5" />;
    })}
    <circle cx={marker.x} cy={marker.y} r="4" fill="#f17e60" />
  </svg>;
}
function MedalBadge({ medal }: { medal: Medal }) {
  return <span className={`medal-badge ${medal}`}><Trophy size={15} />{MEDAL_LABELS[medal]}</span>;
}
function targetText(trackId: TrackId, mode: RaceMode, medal: Medal) {
  const next = nextMedal(trackId, mode, medal);
  if (!next) return '金牌已点亮 · 继续挑战个人最佳';
  const target = mode === 'time' ? `三圈 ≤ ${formatTime(next.target)}` : next.target === 1 ? '夺得第一名' : next.target === 3 ? '进入前三名' : '完成三圈比赛';
  return `${MEDAL_LABELS[next.medal]}目标 · ${target}`;
}
function Key({ children }: { children: React.ReactNode }) { return <kbd>{children}</kbd>; }
function Modal({ title, eyebrow, close, children, wide = false }: { title: string; eyebrow: string; close: () => void; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'Tab') {
        const all = ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, a[href], textarea');
        if (!all?.length) return;
        if (e.shiftKey && document.activeElement === all[0]) { e.preventDefault(); all[all.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === all[all.length - 1]) { e.preventDefault(); all[0].focus(); }
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => { document.removeEventListener('keydown', handler, true); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div ref={ref} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
      <button className="icon close" onClick={close} aria-label="关闭"><X size={20} /></button>
      <span className="eyebrow">{eyebrow}</span><h2>{title}</h2>{children}
    </div>
  </div>;
}

export default function App() {
  const host = useRef<HTMLDivElement>(null), game = useRef<KartGame | null>(null);
  const [state, setState] = useState(initialSnapshot);
  const [settings, setSettings] = useState<Settings>(readSettings);
  const [results, setResults] = useState(readRecords);
  const resultsRef = useRef(results);
  const [completion, setCompletion] = useState({ personalBest: false, lapBest: false });
  const [recordTrack, setRecordTrack] = useState<TrackId | 'all'>('all');
  const [recordMode, setRecordMode] = useState<RaceMode | 'all'>('all');
  const [tab, setTab] = useState<'race' | 'garage'>('race');
  const [mode, setMode] = useState<RaceMode>('race');
  const [modal, setModal] = useState<'settings' | 'help' | 'records' | 'track' | 'assets' | null>(null);
  const [pendingStart, setPendingStart] = useState(false);
  const [error, setError] = useState('');
  const [storageNotice, setStorageNotice] = useState('');
  const onFinished = useRef((result: Snapshot) => {});
  onFinished.current = result => {
    const entry: RecordEntry = { trackId: result.trackId, date: new Date().toISOString(), time: result.elapsed,
      bestLap: Math.min(...result.lapTimes), rank: result.rank, mode: result.mode };
    const previous = resultsRef.current.bests[resultKey(entry.trackId, entry.mode)];
    setCompletion({ personalBest: !previous || entry.time < previous.time, lapBest: !previous || entry.bestLap < previous.bestLap });
    const next = addResult(resultsRef.current, entry);
    resultsRef.current = next; setResults(next);
    try { localStorage.setItem(RESULTS_KEY, JSON.stringify(next)); } catch { setStorageNotice('浏览器无法保存成绩，本次纪录仅在当前页面保留。'); }
  };
  useEffect(() => {
    if (!host.current) return;
    setState({ ...initialSnapshot, trackId: settings.trackId }); setError('');
    let engine: KartGame;
    try {
      engine = new KartGame(host.current, settings, setState, setError); game.current = engine;
      engine.onFinish = result => onFinished.current(result);
      engine.initialize().then(() => {
        if (import.meta.env.DEV && !engine.disposed) (window as unknown as { __kart: unknown }).__kart = engine.debug();
      }).catch(e => { if (!engine.disposed) setError(`无法启动 3D 场景：${e.message}`); });
    } catch { setError('无法创建 3D 场景，请启用浏览器硬件加速后刷新。'); }
    return () => {
      engine?.dispose();
      if (game.current === engine) {
        game.current = null;
        delete (window as unknown as { __kart?: unknown }).__kart;
      }
    };
  }, [settings.trackId]);
  useEffect(() => {
    game.current?.updateSettings(settings);
    try { localStorage.setItem('coastline.settings', JSON.stringify(settings)); } catch { setStorageNotice('浏览器无法保存设置，当前设置仍可使用。'); }
  }, [settings]);
  useEffect(() => { game.current?.setGarage(tab === 'garage'); }, [tab, state.ready, settings.trackId]);
  const isMenu = state.phase === 'menu';
  const track = getTrack(settings.trackId), raceTrack = getTrack(state.trackId);
  const best = results.bests[resultKey(track.id, mode)];
  const bestLap = best?.bestLap ?? Infinity;
  const bestMedal = best ? medalFor(track.id, mode, best) : 'none';
  const resultMedal = medalFor(state.trackId, state.mode, { time: state.elapsed, bestLap: 0, rank: state.rank });
  const records = results.history.filter(r => (recordTrack === 'all' || r.trackId === recordTrack) && (recordMode === 'all' || r.mode === recordMode));
  const trackReady = state.ready && state.trackId === settings.trackId;
  const closeModal = () => { setModal(null); setPendingStart(false); };
  const begin = () => {
    if (!trackReady) return;
    let seen = false;
    try { seen = localStorage.getItem('coastline.tutorial') === 'seen'; } catch {}
    if (!seen) { setPendingStart(true); setModal('help'); } else game.current?.start(mode);
  };
  const acknowledge = () => {
    try { localStorage.setItem('coastline.tutorial', 'seen'); } catch {}
    setModal(null);
    if (pendingStart) game.current?.start(mode);
    setPendingStart(false);
  };
  const menu = () => { game.current?.menu(); setTab('race'); };
  const setOption = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings(s => ({ ...s, [key]: value }));

  return <div className={`app theme-${track.theme} ${isMenu ? 'in-menu' : 'in-race'} ${tab === 'garage' && isMenu ? 'in-garage' : ''}`}>
    <div ref={host} className={`world ${isMenu ? 'world-menu' : ''}`} />
    {isMenu && <>
      <div className="menu-wash" />
      <header className="topbar">
        <button className="brand" onClick={() => setTab('race')} aria-label="极速小车首页">
          <span className="brand-mark"><Flag size={22} strokeWidth={2.5} /></span>
          <span>极速小车<small>COASTLINE CLUB</small></span>
        </button>
        <nav className="navigation" aria-label="主导航">
          <button className={tab === 'race' ? 'selected' : ''} onClick={() => setTab('race')}>开始竞速</button>
          <button className={tab === 'garage' ? 'selected' : ''} onClick={() => setTab('garage')}>我的车库</button>
          <button onClick={() => setModal('records')}>个人纪录<ArrowUpRight size={13} /></button>
        </nav>
        <div className="top-actions">
          <span className="local-status"><i /> 单人练习 · 本地存档</span>
          <button className="icon" aria-label={settings.sound ? '关闭声音' : '开启声音'} onClick={() => setOption('sound', !settings.sound)}>{settings.sound ? <Volume2 size={19} /> : <VolumeX size={19} />}</button>
          <button className="icon" aria-label="设置" onClick={() => setModal('settings')}><Settings2 size={19} /></button>
        </div>
      </header>
      <main className="menu-content">
        {tab === 'race' ? <section className="hero">
          <div className="season"><span>02 / CHASE THE HORIZON</span><span className="tiny-flag">☀  追风巡回</span></div>
          <h1>把风<br />甩在<span className="title-tail">身后<svg viewBox="0 0 180 16" aria-hidden="true"><path d="M3 12Q70 0 176 7" /></svg>。</span></h1>
          <p className="hero-description">{track.theme === 'desert' ? '踩下油门，追着峡谷的落日。' : '踩下油门，沿着海岸线出发。'}<br />在每一次漂移里，找到你的节奏。</p>
          <div className="mode-switch" role="group" aria-label="比赛模式">
            <button className={mode === 'race' ? 'active' : ''} onClick={() => setMode('race')}><Flag size={15} />快速竞速</button>
            <button className={mode === 'time' ? 'active' : ''} onClick={() => setMode('time')}><Timer size={15} />计时练习</button>
          </div>
          <button className="start-button" disabled={!trackReady || !!error} onClick={begin}>
            <span>{trackReady ? '即刻出发' : '准备赛道中'}<small>{mode === 'race' ? '和 5 位车手一较高下' : '挑战你的最佳圈速'}</small></span>
            {trackReady ? <ArrowUpRight size={30} /> : <LoaderCircle className="spin" />}
          </button>
          <p className="challenge-target">{targetText(track.id, mode, bestMedal)}</p>
          <button className="help-link" onClick={() => setModal('help')}><Keyboard size={17} />第一次开？30 秒上手<ArrowRight size={15} /></button>
        </section> : <section className="hero garage-copy">
          <span className="eyebrow">YOUR RIDE / CLASSIC 01</span><h1>浪游者<span className="orange-dot">.</span></h1>
          <p className="hero-description">圆润车头，宽胎低坐姿。<br />开着记忆里的小车，再漂一个弯。</p>
          <div className="paint-name"><span>车身配色</span><strong>{PAINTS[settings.paint].name}</strong></div>
          <div className="paints">{PAINTS.map((p, i) => <button key={p.name} aria-label={p.name} aria-pressed={settings.paint === i} className={settings.paint === i ? 'chosen' : ''} style={{ background: p.hex }} onClick={() => setOption('paint', i)}>{settings.paint === i && <Check size={22} />}</button>)}</div>
          <div className="specs"><div><span>直线极速</span><b>122 <small>km/h</small></b></div><div><span>氮气极速</span><b>169 <small>km/h</small></b></div><div><span>驾驶风格</span><b>灵巧型</b></div></div>
          <p className="muted small">每种配色拥有相同驾驶性能，自由选择你的风格。</p>
          <button className="start-button" onClick={() => setTab('race')}><span>去赛道试试<small>{track.name}已经准备好了</small></span><ArrowUpRight size={28} /></button>
        </section>}
        <div className="scene-label"><span className="coordinate">{track.theme === 'desert' ? 'GOLDEN HOUR · VIRTUAL CANYON' : '24° N / 118° E · VIRTUAL ISLAND'}</span><div><i /><span>{track.name}<small>{track.subtitle}</small></span></div></div>
        <div className="weather"><Wind size={18} /><span>{track.theme === 'desert' ? '落日余温' : '微风正好'}</span><b>{track.theme === 'desert' ? '31°' : '26°'}</b></div>
        <div className="bottom-cards">
          <button className="track-card" onClick={() => setModal('track')}>
            <span className="card-index">{track.id === 'coastline' ? '01' : '02'}</span><div><span className="eyebrow">本次赛道 · 点击切换</span><h3>{track.name}</h3><p>{(track.length / 1000).toFixed(2)} km <i /> 3 圈 <i /> {track.features.split(' · ')[0]}</p></div><Map track={track} compact /><span className="circle-arrow"><ArrowUpRight size={20} /></span>
          </button>
          <button className="record-card" onClick={() => { setRecordTrack(track.id); setRecordMode(mode); setModal('records'); }}><Trophy size={21} /><span className="eyebrow">{mode === 'time' ? '计时' : '竞速'} · 最佳圈速</span><strong>{formatTime(bestLap)}</strong><span className="small">{best ? `${MEDAL_LABELS[bestMedal]} · 下一圈，超越自己` : '第一项纪录，等你创造'}<ArrowUpRight size={14} /></span></button>
          <button className="workshop-card" onClick={() => setModal('assets')}><Box size={21} /><span>每一辆车<br />都有新可能。</span><small>探索 3D 创作工坊 <ArrowUpRight size={13} /></small></button>
        </div>
      </main>
      <footer className="menu-footer"><span>少一点公式，多一点风。</span><span><Waves size={15} /> BUILT FOR THE JOY OF DRIVING</span><span>VOL. 02 — TWO HORIZONS</span></footer>
    </>}
    {!isMenu && <div className="hud">
      <div className="race-top"><div className="position"><strong>{state.rank}</strong><span>/ {state.mode === 'race' ? 6 : 1}<small>当前名次</small></span></div>
        <div className="race-lap"><span>{raceTrack.name}</span><strong>LAP {state.lap}<i>/ 3</i></strong></div>
        <div className="race-time"><span>总用时</span><strong>{formatTime(state.elapsed)}</strong><button className="icon" aria-label="暂停比赛" onClick={() => game.current?.pause()}><Pause size={20} /></button></div>
      </div>
      <div className="ranking">{state.racers.map((r, i) => <div key={r.name} className={r.name === '你' ? 'you' : ''}><b>{i + 1}</b><i style={{ background: r.color }} /><span>{r.name}</span>{r.name === '你' && <Flag size={12} />}</div>)}</div>
      <div className="race-notice" aria-live="polite">{state.wrongWay ? '方向反了，掉头继续！' : state.offroad ? '驶出道路 · 回到柏油路提速' : state.toast}</div>
      <div className="turn-hint"><ChevronRight size={21} />{state.hint}</div>
      <div className="race-map"><span>{raceTrack.subtitle}</span><Map track={raceTrack} state={state} /></div>
      {(state.drifting || state.mini) && <div className={`drift-feedback ${state.miniProgress >= 1 || state.mini ? 'ready' : ''}`}>
        <span><Wind size={17} />{state.mini ? '出弯小喷！' : state.miniProgress >= 1 ? '小喷就绪 · 松开 SHIFT' : '保持漂移，准备小喷'}</span>
        <div className="drift-track" role="progressbar" aria-label="小喷准备进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.miniProgress * 100)}><i style={{ width: `${state.mini ? 100 : state.miniProgress * 100}%` }} /></div>
      </div>}
      <div className="speed-panel"><div className="speed"><strong>{state.speed}</strong><span>KM/H</span></div><div className={`nitro ${state.boost ? 'boosting' : ''}`}><div><Zap size={15} /><span>{state.nitro ? '氮气加速！' : state.mini ? '出弯小喷！' : state.drifting ? '漂移集气中' : '氮气储备'}</span><b>{state.cans} / 2</b></div><div className="charge-track"><i style={{ width: `${state.charge * 100}%` }} /></div><span className="nitro-help"><Key>SPACE</Key>{state.cans ? '释放氮气' : 'Shift + 转向，漂移集气'}</span></div></div>
      <div className="race-controls"><Key>W A S D</Key>驾驶<Key>SHIFT</Key>漂移<Key>R</Key>复位<Key>ESC</Key>暂停</div>
      {state.boost && settings.motion && <div className="boost-vignette" />}
      {state.phase === 'countdown' && <div className="countdown"><span>READY TO ROLL</span><b key={state.countdown}>{state.countdown > 3 ? 'READY' : state.countdown}</b><p>按住 W 或 ↑，准备出发</p></div>}
    </div>}
    {state.phase === 'paused' && <Modal title="歇一下，风会等你。" eyebrow="RACE PAUSED" close={() => game.current?.pause()}>
      <p className="muted">比赛已暂停，计时也停下了。</p><button className="primary full" onClick={() => game.current?.pause()}>继续比赛<ArrowRight size={18} /></button><button className="secondary full" onClick={() => game.current?.start(state.mode)}><RotateCcw size={17} />重新开始</button><button className="text-button full" onClick={menu}>返回俱乐部</button>
    </Modal>}
    {state.phase === 'finished' && <Modal title={state.mode === 'time' ? '与自己，再快一点。' : state.rank === 1 ? '漂亮！冲线第一。' : '这一程，跑得尽兴。'} eyebrow={`FINISH / ${raceTrack.subtitle}`} close={menu}>
      <div className="result-hero"><Trophy size={40} /><strong>{state.mode === 'time' ? '3/3' : `#${state.rank}`}</strong><span>{raceTrack.name}<br />{state.mode === 'time' ? '计时练习完成' : '三圈竞速完成'}</span><MedalBadge medal={resultMedal} /></div>
      {(completion.personalBest || completion.lapBest) && <p className="personal-best">{completion.personalBest ? '刷新个人最佳总用时' : '刷新个人最佳单圈'}{completion.personalBest && completion.lapBest ? ' · 单圈也更快了！' : '！'}</p>}
      <p className="result-target">{targetText(state.trackId, state.mode, resultMedal)}</p>
      <div className="result-times"><div><span>完赛用时</span><b>{formatTime(state.elapsed)}</b></div><div><span>最佳圈速</span><b>{formatTime(Math.min(...state.lapTimes))}</b></div></div>
      <div className="lap-list">{state.lapTimes.map((t, i) => <div key={i}><span>LAP 0{i + 1}</span><b>{formatTime(t)}</b>{t === Math.min(...state.lapTimes) && <span className="best-tag">BEST</span>}</div>)}</div>
      <button className="primary full" onClick={() => game.current?.start(state.mode)}>再跑一场<RotateCcw size={17} /></button><button className="text-button full" onClick={menu}>返回俱乐部</button>
    </Modal>}
    {modal === 'help' && <Modal title="上手，只要一个弯。" eyebrow="QUICK START" close={closeModal}>
      <div className="tutorial"><div><span>01</span><div><h3>踩油门，去感受速度</h3><p><Key>W / ↑</Key> 加速 <Key>S / ↓</Key> 刹车<br /><Key>A D / ← →</Key> 控制方向</p></div></div><div><span>02</span><div><h3>按住漂移，顺势过弯</h3><p>达到一定速度后，按住 <Key>SHIFT</Key> 并转向。小喷进度条亮起后，松开 <Key>SHIFT</Key> 触发小喷；持续漂移还能积攒氮气。</p></div></div><div><span>03</span><div><h3>出弯加速，甩开对手</h3><p>氮气充满一罐后，按 <Key>SPACE</Key> 加速。迷路或卡住时按 <Key>R</Key> 复位，用时 +2 秒。</p></div></div></div>
      <button className="primary full" onClick={acknowledge}>{pendingStart ? '明白了，出发！' : '准备好了'}<ArrowUpRight size={20} /></button>
    </Modal>}
    {modal === 'settings' && <Modal title="按你的节奏来。" eyebrow="PREFERENCES" close={closeModal}>
      <div className="setting-row"><div><b>游戏音效</b><p>引擎、漂移和倒计时</p></div><button role="switch" aria-checked={settings.sound} className={`toggle ${settings.sound ? 'on' : ''}`} onClick={() => setOption('sound', !settings.sound)} aria-label="游戏音效"><i /></button></div>
      <div className="setting-row"><div><b>加速镜头效果</b><p>氮气时扩大视野</p></div><button role="switch" aria-checked={settings.motion} className={`toggle ${settings.motion ? 'on' : ''}`} onClick={() => setOption('motion', !settings.motion)} aria-label="加速镜头效果"><i /></button></div>
      <div className="setting-row"><div><b>画面质量</b><p>流畅模式降低阴影和分辨率</p></div><select aria-label="画面质量" value={settings.quality} onChange={e => setOption('quality', e.target.value as Settings['quality'])}><option value="high">精致</option><option value="low">流畅</option></select></div>
      <div className="setting-row"><div><b>对手难度</b><p>下一场比赛使用此设置</p></div><select aria-label="对手难度" value={settings.difficulty} onChange={e => setOption('difficulty', e.target.value as Settings['difficulty'])}><option value="easy">轻松兜风</option><option value="normal">认真较量</option></select></div>
      <p className="small muted">设置会自动保存在当前浏览器。</p>
    </Modal>}
    {modal === 'records' && <Modal title="每一圈，都算数。" eyebrow="PERSONAL RECORDS" close={closeModal} wide>
      <div className="record-filters"><label>赛道<select aria-label="纪录赛道" value={recordTrack} onChange={e => setRecordTrack(e.target.value as TrackId | 'all')}><option value="all">全部赛道</option>{TRACKS.map(t => <option value={t.id} key={t.id}>{t.name}</option>)}</select></label><label>模式<select aria-label="纪录模式" value={recordMode} onChange={e => setRecordMode(e.target.value as RaceMode | 'all')}><option value="all">全部模式</option><option value="race">快速竞速</option><option value="time">计时练习</option></select></label><span>最近 30 场 · 最佳成绩永久保留</span></div>
      <div className="medal-collection">{TRACKS.filter(t => recordTrack === 'all' || t.id === recordTrack).flatMap(t => (['race', 'time'] as const).filter(m => recordMode === 'all' || m === recordMode).map(m => {
        const b = results.bests[resultKey(t.id, m)];
        return <div key={`${t.id}:${m}`}><span>{t.name} · {m === 'time' ? '计时' : '竞速'}</span>{b ? <><MedalBadge medal={medalFor(t.id, m, b)} /><b>{formatTime(b.time)}</b><small>最佳单圈 {formatTime(b.bestLap)}</small></> : <small>等待首次完赛</small>}</div>;
      }))}</div>
      {records.length ? <div className="records-table"><div className="table-head"><span>日期 / 赛道 / 模式</span><span>用时</span><span>最佳单圈</span><span>奖牌</span></div>{records.map((r, i) => <div key={r.date + i}><span>{new Date(r.date).toLocaleDateString('zh-CN')}<small>{getTrack(r.trackId).name} · {r.mode === 'time' ? '计时练习' : `快速竞速 #${r.rank}`}</small></span><b>{formatTime(r.time)}</b><b>{formatTime(r.bestLap)}</b><MedalBadge medal={medalFor(r.trackId, r.mode, r)} /></div>)}</div> : <div className="empty"><Trophy size={38} /><h3>起跑线，永远为你留着。</h3><p>完成第一场比赛，你的成绩就会出现在这里。</p><button className="primary" onClick={closeModal}>去创造纪录<ArrowRight size={18} /></button></div>}
    </Modal>}
    {modal === 'track' && <Modal title="下一程，去哪里？" eyebrow="CHOOSE YOUR CIRCUIT" close={closeModal} wide>
      <div className="track-options">{TRACKS.map((t, i) => <button key={t.id} className={`track-option ${t.theme} ${t.id === track.id ? 'selected' : ''}`} aria-label={`选择${t.name}`} aria-pressed={t.id === track.id} onClick={() => setOption('trackId', t.id)}><div><span>0{i + 1} / {t.subtitle}</span>{t.id === track.id && <Check size={18} />}</div><Map track={t} /><h3>{t.name}</h3><p>{(t.length / 1000).toFixed(2)} km · 3 圈</p><small>{t.features}</small></button>)}</div>
      <p className="muted track-description">{track.description}按顺序通过所有路段，抄近路不会计圈。</p>
      <div className="medal-targets"><span>计时三圈目标</span>{(['gold', 'silver', 'bronze'] as const).map(m => <div key={m}><MedalBadge medal={m} /><b>≤ {formatTime(track.medals[m])}</b></div>)}</div>
      <p className="small muted">快速竞速：第 1 名金牌，第 2–3 名银牌，其余完赛铜牌。</p>
      <button className="primary full" onClick={closeModal}>就跑这里 · {track.name}<Check size={18} /></button>
    </Modal>}
    {modal === 'assets' && <Modal title="把想象，开上赛道。" eyebrow="3D CREATOR WORKSHOP" close={closeModal} wide><AssetWorkshop /></Modal>}
    {error && <div className="error-banner" role="alert">{error}<button onClick={() => window.location.reload()}>重新加载</button></div>}
    {storageNotice && <div className="storage-notice" role="status">{storageNotice}<button onClick={() => setStorageNotice('')} aria-label="关闭提示"><X size={14} /></button></div>}
    <div className="mobile-notice"><Keyboard size={20} /><span>这一站，为键盘准备。<small>请在电脑浏览器打开，体验完整驾驶。</small></span></div>
  </div>;
}
