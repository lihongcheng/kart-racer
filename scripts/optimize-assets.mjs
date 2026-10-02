import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { exportClassicKart } from './export-classic-kart.mjs';

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const { jobs } = JSON.parse(await fs.readFile('assets/jobs.json', 'utf8'));
const output = 'apps/web/public/models';
await fs.mkdir(output, { recursive: true });
const manifest = [await exportClassicKart()];
for (const asset of jobs) {
  const file = path.join('assets/source', asset.target);
  const document = await io.read(file);
  if (asset.id === 'kart') {
    // This Rodin output contains baked wheels in its single connected mesh.
    // Remove the outer lower wheel regions before adding animated game wheels.
    for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
      const positions = primitive.getAttribute('POSITION'), indices = primitive.getIndices();
      const kept = [], vertex = [0, 0, 0];
      for (let i = 0; i < indices.getCount(); i += 3) {
        let x = 0, y = 0;
        for (let corner = 0; corner < 3; corner++) {
          positions.getElement(indices.getScalar(i + corner), vertex);
          x += vertex[0] / 3; y += vertex[1] / 3;
        }
        if (Math.abs(x) > 0.39 && y < -0.08) continue;
        kept.push(indices.getScalar(i), indices.getScalar(i + 1), indices.getScalar(i + 2));
      }
      indices.setArray(new Uint32Array(kept));
    }
  }
  await document.transform(
    dedup(), weld(), prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const target = path.join(output, asset.target);
  await io.write(target, document);
  let triangles = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) triangles += (primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION')?.getCount() ?? 0) / 3;
  }
  const bytes = (await fs.stat(target)).size;
  manifest.push({ id: asset.id, name: asset.id === 'kart' ? '初代 Rodin 概念车 · 收藏' : asset.name, url: `/models/${asset.target}`,
    displayUrl: `https://hyper3d.ai/workspace/rodin/${asset.generationId}`,
    generationId: asset.generationId, source: 'Hyper3D Rodin Gen-2.5 / OAuth MCP',
    triangles, bytes });
  console.log(`${asset.id}: ${triangles} triangles, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
}
await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await fs.writeFile('assets/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
