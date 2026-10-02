import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { makeKart } from '../apps/web/src/game/kart-model.ts';

// GLTFExporter only needs Blob -> ArrayBuffer for this texture-free model.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); });
  }
};

export async function exportClassicKart() {
  const kart = makeKart('#219cde');
  const binary = await new GLTFExporter().parseAsync(kart.group, { binary: true, onlyVisible: true });
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const document = await io.readBinary(new Uint8Array(binary));
  await document.transform(dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const target = 'apps/web/public/models/classic-kart.glb';
  await io.write(target, document);
  let triangles = 0;
  for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    triangles += (primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION').getCount()) / 3;
  }
  const entry = {
    id: 'kart-classic', name: '浪游者 Classic · 当前赛车', url: '/models/classic-kart.glb',
    source: 'Coastline Club / 原创程序建模', triangles, bytes: (await fs.stat(target)).size,
  };
  kart.group.traverse(object => {
    if (!object.isMesh) return;
    object.geometry.dispose(); object.material.dispose();
  });
  console.log(`classic-kart: ${triangles} triangles, ${(entry.bytes / 1024).toFixed(1)} KB`);
  return entry;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const classic = await exportClassicKart();
  const previous = JSON.parse(await fs.readFile('assets/manifest.json', 'utf8'));
  const manifest = [classic, ...previous.filter(asset => asset.id !== classic.id).map(asset => (
    asset.id === 'kart' ? { ...asset, name: '初代 Rodin 概念车 · 收藏' } : asset
  ))];
  for (const file of ['assets/manifest.json', 'apps/web/public/models/manifest.json']) {
    await fs.writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
  }
}
