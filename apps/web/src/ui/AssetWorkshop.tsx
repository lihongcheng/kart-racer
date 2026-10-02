import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { ArrowUpRight, Box, Check, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react';
import { loadModel, normalizeModel, disposeObject } from '../game/visuals';

type Asset = { id: string; name: string; url: string; displayUrl?: string; bytes: number; triangles: number; source: string };
type Job = { id: string; prompt: string; status: string; error?: string; assetUrl?: string };
type Library = { assets: Asset[]; jobs: Job[]; canGenerate: boolean };
const statuses: Record<string, string> = { submitted: '已提交', waiting: '排队中', generating: '生成中', downloading: '保存模型中', ready: '已完成', failed: '失败', uncertain: '提交结果待核实', timed_out: '等待超时，可恢复查询' };

function ModelPreview({ url }: { url: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    setError(''); setLoaded(false);
    let disposed = false, frame = 0;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#e8e9db');
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setSize(host.current.clientWidth, 240); renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.current.append(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(38, host.current.clientWidth / 240, 0.1, 100);
    camera.position.set(6, 4, 7); camera.lookAt(0, 1.6, 0);
    scene.add(new THREE.HemisphereLight('#ffffff', '#587163', 3));
    const sun = new THREE.DirectionalLight('#fff3db', 3); sun.position.set(3, 6, 5); scene.add(sun);
    let model: THREE.Group | undefined;
    loadModel(url).then(source => {
      if (disposed) { disposeObject(source); return; }
      model = normalizeModel(source, 4); scene.add(model); setLoaded(true);
    }).catch(() => { if (!disposed) setError('模型暂时无法预览'); });
    const animate = () => { if (disposed) return; if (model) model.rotation.y += 0.006; renderer.render(scene, camera); frame = requestAnimationFrame(animate); }; animate();
    const observer = new ResizeObserver(() => {
      if (!host.current) return;
      renderer.setSize(host.current.clientWidth, 240); camera.aspect = host.current.clientWidth / 240; camera.updateProjectionMatrix();
    }); observer.observe(host.current);
    return () => {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect();
      scene.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); const materials = Array.isArray(o.material) ? o.material : [o.material]; materials.forEach(m => { Object.values(m).forEach(v => { if (v instanceof THREE.Texture) v.dispose(); }); m.dispose(); }); } });
      renderer.dispose(); renderer.domElement.remove();
    };
  }, [url]);
  return <div ref={host} className="model-preview" aria-busy={!loaded && !error} data-loaded={loaded}>{error && <span>{error}</span>}</div>;
}

export function AssetWorkshop() {
  const [data, setData] = useState<Library>({ assets: [], jobs: [], canGenerate: false });
  const [selected, setSelected] = useState<string>('kart-classic');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [offline, setOffline] = useState(false);
  const pendingRequest = useRef<{ prompt: string; id: string } | null>(null);
  async function refresh() {
    try {
      const response = await fetch('/api/assets');
      if (!response.ok) throw new Error();
      setData(await response.json()); setOffline(false);
    } catch {
      setOffline(true);
      try {
        const response = await fetch('/models/manifest.json');
        if (response.ok) setData({ assets: await response.json(), jobs: [], canGenerate: false });
      } catch { setNotice('资产清单暂时无法读取'); }
    }
  }
  useEffect(() => { void refresh(); const timer = setInterval(refresh, 5000); return () => clearInterval(timer); }, []);
  const current = data.assets.find(a => a.id === selected) ?? data.assets[0];
  async function generate() {
    if (!prompt.trim() || busy) return;
    setBusy(true); setNotice('');
    try {
      if (pendingRequest.current?.prompt !== prompt.trim()) pendingRequest.current = { prompt: prompt.trim(), id: crypto.randomUUID() };
      const response = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), requestId: pendingRequest.current.id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '生成任务提交失败');
      pendingRequest.current = null;
      setNotice('任务已提交，可稍后返回查看。'); setPrompt(''); await refresh();
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="workshop">
    <p className="muted">从经典小车到海岛风景。选择一件，看看它的每一个角度。</p>
    <div className="asset-layout">
      <div className="asset-list">{data.assets.map(asset => <button key={asset.id} className={asset.id === current?.id ? 'active' : ''} onClick={() => setSelected(asset.id)}><Box size={18} /><span>{asset.name}<small>{asset.source.includes('Hyper3D') ? 'Hyper3D Rodin' : 'Coastline Club 原创'} · GLB</small></span>{asset.id === current?.id && <Check size={16} />}</button>)}</div>
      {current ? <div className="asset-detail"><ModelPreview url={current.url} /><div className="asset-meta"><span>{(current.bytes / 1024 / 1024).toFixed(1)} MB · {current.triangles ? `${current.triangles.toLocaleString()} 三角形` : '原始模型，待优化'}</span>{current.displayUrl && <a href={current.displayUrl} target="_blank" rel="noreferrer">查看原作<ExternalLink size={13} /></a>}<a href={current.url} download>下载 GLB<ArrowUpRight size={13} /></a></div></div> : <div className="empty"><LoaderCircle className="spin" /><p>正在读取资产库</p></div>}
    </div>
    <details className="creator-panel"><summary>开发者资产工作台<ArrowUpRight size={16} /></summary>
      <p className="small muted">{data.canGenerate ? '描述新的模型，由 Rodin 生成。提交任务会消耗 Hyper3D 额度。' : offline ? '当前运行的是静态游戏。启动本地资产服务后可管理生成任务。' : '现有模型已通过 TRAE 的 OAuth MCP 生成并入库。可继续在 TRAE 中请求新模型；若要从此页面独立生成，请为本地资产服务配置 RODIN_API_KEY。'}</p>
      <textarea aria-label="模型描述" value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={1024} placeholder="例如：一座卡通海边看台，奶油白与薄荷绿色，低多边形…" disabled={!data.canGenerate} />
      <button className="primary" disabled={!data.canGenerate || !prompt.trim() || busy} onClick={generate}>{busy ? <LoaderCircle className="spin" size={16} /> : <Box size={16} />}生成 3D 模型</button>
      {notice && <p role="status" className="small">{notice}</p>}
      {data.jobs.map(job => <div className="job-row" key={job.id}><span>{job.prompt.slice(0, 46)}<small>{job.error}</small></span><b>{statuses[job.status] || job.status}</b>{job.status === 'timed_out' && <button className="icon" aria-label="恢复任务查询" onClick={async () => { await fetch(`/api/jobs/${job.id}/resume`, { method: 'POST' }); await refresh(); }}><RefreshCw size={15} /></button>}{job.assetUrl && <a href={job.assetUrl} download>下载 GLB</a>}</div>)}
    </details>
  </div>;
}
