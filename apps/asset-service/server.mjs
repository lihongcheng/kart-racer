import Fastify from 'fastify';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const activeStates = ['submitted', 'waiting', 'generating', 'downloading'];
const apiBase = 'https://api.hyper3d.com/api/v2';
class Retryable extends Error {
  constructor(ms) { super('供应商暂时繁忙，稍后继续查询'); this.ms = ms; }
}
export function retryDelay(header, now = Date.now()) {
  const seconds = Number(header);
  if (header && Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header || '');
  return Number.isFinite(date) ? Math.max(0, date - now) : 5000;
}

export async function buildAssetService(options = {}) {
  const apiKey = options.apiKey ?? process.env.RODIN_API_KEY ?? '';
  const fetcher = options.fetch ?? fetch;
  const wait = options.wait ?? ((ms, signal) => delay(ms, undefined, { signal }));
  const now = options.now ?? Date.now;
  const deadlineMs = options.deadlineMs ?? 30 * 60 * 1000;
  const dbPath = options.dbPath ?? resolve(root, '.data/assets.sqlite');
  const modelDir = options.modelDir ?? resolve(root, 'apps/web/public/models/generated');
  if (dbPath !== ':memory:') await mkdir(dirname(dbPath), { recursive: true });
  await mkdir(modelDir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, data TEXT NOT NULL)');
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024 });
  const workers = new Map();
  const readJobs = () => db.prepare('SELECT data FROM jobs ORDER BY rowid DESC').all().map(row => JSON.parse(row.data));
  const getJob = id => { const row = db.prepare('SELECT data FROM jobs WHERE id=?').get(id); return row ? JSON.parse(row.data) : null; };
  const save = job => db.prepare('INSERT INTO jobs VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
    .run(job.id, job.requestId, JSON.stringify({ ...job, updatedAt: now() }));
  const publicJob = ({ subscriptionKey, ...job }) => job;
  const readAssets = async () => options.assets ?? JSON.parse(await readFile(resolve(root, 'assets/manifest.json'), 'utf8'));

  app.addHook('onRequest', async (req, reply) => {
    const local = url => {
      try {
        const value = new URL(url);
        return value.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(value.hostname) &&
          ['5174', '4175'].includes(value.port);
      } catch { return false; }
    };
    if (!local(`http://${req.headers.host}`) || (req.headers.origin && !local(req.headers.origin))) {
      return reply.code(403).send({ error: '资产服务仅接受本机开发页面访问' });
    }
  });
  app.setErrorHandler((error, req, reply) => {
    reply.code(error.statusCode || 500).send({ error: error.statusCode === 400 ? '请求格式不正确' : '资产服务处理失败，请检查本地配置' });
  });
  async function api(path, body, signal, multipart = false) {
    const response = await fetcher(`${apiBase}/${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, ...(multipart ? {} : { 'Content-Type': 'application/json' }) },
      body: multipart ? body : JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
    });
    if (response.status === 429 || response.status >= 500) throw new Retryable(retryDelay(response.headers.get('retry-after'), now()));
    if (!response.ok) throw new Error(`Rodin ${path} 请求失败（HTTP ${response.status}）`);
    return response.json();
  }
  async function processJob(job, submit, signal) {
    let started = now(), interval = 5000;
    if (submit) {
      try {
        const form = new FormData();
        form.set('prompt', job.prompt); form.set('tier', 'Gen-2.5-Medium'); form.set('geometry_file_format', 'glb');
        const result = await api('rodin', form, signal, true);
        job.taskUuid = result.uuid;
        job.subscriptionKey = result.jobs?.subscription_key;
        job.consumed = result.consumed ?? result.credits_consumed ?? null;
        if (!job.taskUuid || !job.subscriptionKey) throw new Error('生成响应缺少任务标识');
        job.status = 'waiting'; save(job);
      } catch {
        job.status = 'uncertain';
        job.error = '提交结果未知。请在 Hyper3D 工作区核实，勿重复生成。';
        save(job); return;
      }
    }
    try {
      while (!signal.aborted && now() - started < deadlineMs) {
        await wait(Math.min(interval, Math.max(0, deadlineMs - (now() - started))), signal);
        if (now() - started >= deadlineMs) break;
        try {
          const result = await api('status', { subscription_key: job.subscriptionKey }, signal);
          const stages = Array.isArray(result.jobs) ? result.jobs : [];
          if (stages.some(stage => stage.status === 'Failed')) {
            job.status = 'failed'; job.error = 'Rodin 生成失败，请在原作页面查看详情'; save(job); return;
          }
          if (stages.length && stages.every(stage => stage.status === 'Done')) {
            job.status = 'downloading'; save(job);
            const download = await api('download', { task_uuid: job.taskUuid }, signal);
            const file = download.list?.find(item => /\.glb$/i.test(item.name || ''));
            if (!file?.url) throw new Error('生成结果中没有 GLB 文件');
            const fileUrl = new URL(file.url);
            if (fileUrl.protocol !== 'https:') throw new Error('模型下载地址无效');
            // Never forward the API bearer token to signed asset storage URLs.
            const response = await fetcher(fileUrl.href, { signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]) });
            if ([403, 404, 429].includes(response.status) || response.status >= 500) throw new Retryable(5000);
            if (!response.ok) throw new Error(`模型下载失败（HTTP ${response.status}）`);
            if (Number(response.headers.get('content-length')) > 100 * 1024 * 1024) throw new Error('模型超过 100MB 限制');
            const chunks = []; let bytes = 0;
            for await (const chunk of response.body) {
              bytes += chunk.length;
              if (bytes > 100 * 1024 * 1024) throw new Error('模型超过 100MB 限制');
              chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);
            if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'glTF') throw new Error('下载内容不是有效的 GLB');
            const destination = resolve(modelDir, `${job.id}.glb`);
            await writeFile(`${destination}.tmp`, buffer); await rename(`${destination}.tmp`, destination);
            job.assetUrl = `/models/generated/${job.id}.glb`; job.bytes = bytes;
            job.status = 'ready'; job.error = ''; save(job); return;
          }
          job.status = stages.length ? 'generating' : 'waiting'; save(job);
          interval = Math.min(interval * 1.3, 30_000);
        } catch (error) {
          if (signal.aborted) return;
          if (error instanceof Retryable) { interval = Math.max(5000, error.ms); continue; }
          if (error.name === 'TimeoutError' || error.name === 'TypeError') { interval = 10_000; continue; }
          throw error;
        }
      }
      if (!signal.aborted) { job.status = 'timed_out'; job.error = '本地等待超时，供应商任务可能仍在运行；可恢复查询'; save(job); }
    } catch (error) {
      if (!signal.aborted) { job.status = 'failed'; job.error = error.message; save(job); }
    }
  }
  function launch(job, submit = false) {
    if (workers.has(job.id)) return;
    const controller = new AbortController();
    const promise = processJob(job, submit, controller.signal).finally(() => workers.delete(job.id));
    workers.set(job.id, { controller, promise });
  }
  app.get('/api/health', async () => ({ ok: true, canGenerate: Boolean(apiKey) }));
  app.get('/api/assets', async () => {
    const jobs = readJobs();
    return {
      assets: [...await readAssets(), ...jobs.filter(job => job.status === 'ready').map(job => ({
        id: job.id, name: job.prompt.slice(0, 28), url: job.assetUrl,
        displayUrl: `https://hyper3d.ai/workspace/rodin/${job.taskUuid}`, bytes: job.bytes, triangles: 0, source: 'Hyper3D Rodin',
      }))],
      jobs: jobs.map(publicJob), canGenerate: Boolean(apiKey),
    };
  });
  app.post('/api/jobs', async (req, reply) => {
    const { prompt, requestId } = req.body ?? {};
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 1024 ||
      typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(requestId)) {
      return reply.code(400).send({ error: '请输入 1–1024 字符描述和有效的请求标识' });
    }
    const previous = readJobs().find(job => job.requestId === requestId);
    if (previous) {
      if (previous.prompt !== prompt.trim()) return reply.code(409).send({ error: '相同请求标识不能用于不同描述' });
      return publicJob(previous);
    }
    if (!apiKey) return reply.code(503).send({ error: '尚未配置 RODIN_API_KEY；现有模型仍可直接使用' });
    if (workers.size >= 2) return reply.code(429).send({ error: '已有两个任务运行，请等待完成' });
    const job = { id: randomUUID(), requestId, prompt: prompt.trim(), status: 'submitted', createdAt: now() };
    save(job); launch(job, true);
    return reply.code(202).send(publicJob(job));
  });
  app.post('/api/jobs/:id/resume', async (req, reply) => {
    const job = getJob(req.params.id);
    if (!job) return reply.code(404).send({ error: '任务不存在' });
    if (!apiKey) return reply.code(503).send({ error: '尚未配置 RODIN_API_KEY' });
    if (!['timed_out', 'failed'].includes(job.status) || !job.taskUuid || !job.subscriptionKey) {
      return reply.code(409).send({ error: '此任务无法恢复查询，请在 Hyper3D 工作区核实' });
    }
    if (workers.size >= 2) return reply.code(429).send({ error: '请等待当前任务完成后重试' });
    job.status = 'waiting'; job.error = ''; save(job); launch(job);
    return reply.code(202).send(publicJob(job));
  });
  app.addHook('onReady', async () => {
    for (const job of readJobs()) {
      if (!activeStates.includes(job.status)) continue;
      if (!job.subscriptionKey || !job.taskUuid) {
        job.status = 'uncertain'; job.error = '服务曾在提交期间中断，请先在 Hyper3D 工作区核实'; save(job);
      } else if (apiKey && workers.size < 2) launch(job);
      else { job.status = 'timed_out'; job.error = '任务等待恢复查询'; save(job); }
    }
  });
  app.addHook('onClose', async () => {
    const pending = [...workers.values()];
    pending.forEach(worker => worker.controller.abort());
    for (const worker of pending) await worker.promise;
    db.close();
  });
  // Test synchronization waits for actual worker completion, never creates new jobs.
  app.decorate('settled', async () => { for (const worker of [...workers.values()]) await worker.promise; });
  return app;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await buildAssetService();
  await app.listen({ host: '127.0.0.1', port: 4175 });
  console.log('资产服务：http://127.0.0.1:4175');
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close().then(() => process.exit(0)));
}
