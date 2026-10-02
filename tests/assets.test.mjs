import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildAssetService, retryDelay } from '../apps/asset-service/server.mjs';

const services = [], directories = [];
const headers = { host: 'localhost:5174', origin: 'http://localhost:5174' };
const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
async function create(extra = {}) {
  const dir = await mkdtemp(resolve(tmpdir(), 'kart-assets-')); directories.push(dir);
  let time = 0;
  const service = await buildAssetService({
    dbPath: resolve(dir, 'jobs.sqlite'), modelDir: dir, assets: [], apiKey: 'test-key',
    now: () => time, wait: async ms => { time += ms; }, deadlineMs: 100_000, ...extra,
  });
  services.push(service); await service.ready(); return { service, dir };
}
const submit = service => service.inject({ method: 'POST', url: '/api/jobs', headers, payload: { prompt: 'A stylized palm tree', requestId: 'test-request-001' } });
const jobs = async service => (await service.inject({ url: '/api/assets', headers })).json();
afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('local Rodin pipeline (mocked, no paid requests)', () => {
  it('serves assets without a key, blocks submission and rejects foreign origins/hosts', async () => {
    const { service } = await create({ apiKey: '' });
    expect((await jobs(service)).canGenerate).toBe(false);
    expect((await submit(service)).statusCode).toBe(503);
    expect((await service.inject({ url: '/api/assets', headers: { ...headers, origin: 'https://foreign.example' } })).statusCode).toBe(403);
    expect((await service.inject({ url: '/api/assets', headers: { host: 'foreign.example' } })).statusCode).toBe(403);
  });
  it('persists a real GLB response, keeps credentials private and makes submission idempotent', async () => {
    let submitted = 0, checked = 0;
    const glb = Buffer.alloc(12); glb.write('glTF'); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(12, 8);
    const { service, dir } = await create({ fetch: async (url, options) => {
      if (url.endsWith('/rodin')) {
        submitted++; expect(options.body.get('geometry_file_format')).toBe('glb');
        return json({ uuid: 'provider-task', jobs: { subscription_key: 'private-subscription' } });
      }
      if (url.endsWith('/status')) { checked++; return json({ jobs: checked === 1 ? [] : [{ status: 'Done' }, { status: 'Done' }] }); }
      if (url.endsWith('/download')) {
        expect(JSON.parse(options.body).task_uuid).toBe('provider-task');
        return json({ list: [{ name: 'asset.glb', url: 'https://storage.example/model.glb?signature=test' }] });
      }
      expect(options.headers).toBeUndefined();
      return new Response(glb);
    } });
    const created = await submit(service); expect(created.statusCode).toBe(202);
    await service.settled();
    const duplicate = await submit(service); expect(duplicate.json().id).toBe(created.json().id);
    expect(submitted).toBe(1);
    const data = await jobs(service);
    expect(data.jobs[0].status).toBe('ready');
    expect(JSON.stringify(data)).not.toContain('private-subscription');
    expect(JSON.stringify(data)).not.toContain('signature=');
    expect(await readFile(resolve(dir, `${data.jobs[0].id}.glb`))).toEqual(glb);
  });
  it('handles 429 Retry-After then stops on any failed stage', async () => {
    let checks = 0; const waits = [];
    const { service } = await create({
      wait: async ms => { waits.push(ms); },
      fetch: async url => {
        if (url.endsWith('/rodin')) return json({ uuid: 'task', jobs: { subscription_key: 'key' } });
        checks++;
        return checks === 1 ? new Response('', { status: 429, headers: { 'retry-after': '17' } }) : json({ jobs: [{ status: 'Done' }, { status: 'Failed' }] });
      },
    });
    await submit(service); await service.settled();
    expect(waits).toContain(17_000);
    expect((await jobs(service)).jobs[0].status).toBe('failed');
  });
  it('never retries uncertain paid submissions', async () => {
    let calls = 0;
    const { service } = await create({ fetch: async () => { calls++; throw new TypeError('network lost'); } });
    await submit(service); await service.settled(); await submit(service);
    expect(calls).toBe(1);
    const data = await jobs(service);
    expect(data.jobs[0].status).toBe('uncertain');
    expect((await service.inject({ method: 'POST', url: `/api/jobs/${data.jobs[0].id}/resume`, headers })).statusCode).toBe(409);
  });
  it('times out empty stages and restores the known task after a service restart without resubmitting', async () => {
    let submissions = 0;
    const fetcher = async url => {
      if (url.endsWith('/rodin')) { submissions++; return json({ uuid: 'task', jobs: { subscription_key: 'key' } }); }
      return json({ jobs: [] });
    };
    const first = await create({ fetch: fetcher, deadlineMs: 10_000 });
    await submit(first.service); await first.service.settled();
    const job = (await jobs(first.service)).jobs[0]; expect(job.status).toBe('timed_out');
    await first.service.close(); services.splice(services.indexOf(first.service), 1);
    const second = await create({ dbPath: resolve(first.dir, 'jobs.sqlite'), fetch: fetcher, deadlineMs: 10_000 });
    expect((await jobs(second.service)).jobs[0].id).toBe(job.id);
    expect((await second.service.inject({ method: 'POST', url: `/api/jobs/${job.id}/resume`, headers })).statusCode).toBe(202);
    await second.service.settled();
    expect(submissions).toBe(1);
    expect(retryDelay('Thu, 01 Oct 2026 00:00:17 GMT', Date.parse('2026-10-01T00:00:00Z'))).toBe(17_000);
  });
  it('automatically resumes an active persisted task after shutdown', async () => {
    let wake, submitted = 0;
    const polling = new Promise(resolve => { wake = resolve; });
    const first = await create({
      fetch: async () => { submitted++; return json({ uuid: 'existing-task', jobs: { subscription_key: 'known-key' } }); },
      wait: async (ms, signal) => {
        wake();
        await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
      },
    });
    await submit(first.service); await polling;
    await first.service.close(); services.splice(services.indexOf(first.service), 1);
    const second = await create({
      dbPath: resolve(first.dir, 'jobs.sqlite'),
      fetch: async url => { expect(url).toContain('/status'); return json({ jobs: [{ status: 'Failed' }] }); },
    });
    await second.service.settled();
    expect((await jobs(second.service)).jobs[0].status).toBe('failed');
    expect(submitted).toBe(1);
  });
  it('refreshes an expired signed URL without repeating the paid generation', async () => {
    let downloads = 0, submissions = 0;
    const glb = Buffer.alloc(12); glb.write('glTF');
    const { service } = await create({
      fetch: async url => {
        if (url.endsWith('/rodin')) { submissions++; return json({ uuid: 'task', jobs: { subscription_key: 'key' } }); }
        if (url.endsWith('/status')) return json({ jobs: [{ status: 'Done' }] });
        if (url.endsWith('/download')) { downloads++; return json({ list: [{ name: 'asset.glb', url: `https://storage.example/${downloads}.glb` }] }); }
        return downloads === 1 ? new Response('', { status: 403 }) : new Response(glb);
      },
    });
    await submit(service); await service.settled();
    expect((await jobs(service)).jobs[0].status).toBe('ready');
    expect(downloads).toBe(2); expect(submissions).toBe(1);
  });
});
