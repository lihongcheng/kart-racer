import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Render the actual game model in fixed views for repeatable art inspection.
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1650, height: 590 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/__kart-art-review', route => route.fulfill({ contentType: 'text/html', body: `
<!doctype html><meta charset="utf-8">
<style>
*{box-sizing:border-box}body{margin:0;background:#e8ebe1;color:#23453f;font-family:system-ui}
header{padding:25px 36px 10px;font-size:24px;font-weight:700}small{font-size:12px;font-weight:500;margin-left:15px;letter-spacing:2px}
main{display:flex}section{width:550px}h2{margin:8px 36px;font-size:15px;font-weight:500}canvas{display:block}
</style>
<header>浪游者 Classic<small>COASTLINE CLUB / MODEL STUDY</small></header><main></main>
<script type="module">
import * as THREE from '/@fs${resolve('node_modules/three/build/three.module.js')}';
import {makeKart} from '/src/game/kart-model.ts';
const reports=[];
for(const [name,color,eye,boost] of [
  ['01 / FRONT · 海湾蓝','#219cde',[4.8,3.2,6.5],false],
  ['02 / SIDE · 日落橘子','#ff8057',[7.7,2.4,0.2],false],
  ['03 / REAR · 奶油柠檬','#e5f26b',[-4.8,2.9,-6.5],true],
]){
  const section=document.createElement('section'); section.innerHTML='<h2>'+name+'</h2>'; document.querySelector('main').append(section);
  const renderer=new THREE.WebGLRenderer({antialias:true}); renderer.setSize(550,480);
  renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  section.append(renderer.domElement);
  const scene=new THREE.Scene(); scene.background=new THREE.Color('#e8ebe1');
  scene.add(new THREE.HemisphereLight('#ffffff','#9fae9f',2.4));
  const sun=new THREE.DirectionalLight('#fff4e0',3);sun.position.set(-3,7,5);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.normalBias=.025;scene.add(sun);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:'#e8ebe1',roughness:1}));
  floor.rotation.x=-Math.PI/2;floor.position.y=-.012;floor.receiveShadow=true;scene.add(floor);
  const kart=makeKart(color);scene.add(kart.group);kart.flame.visible=boost;
  if(boost) kart.wheels.filter(w=>w.position.z>0).forEach(w=>w.rotation.y=.22);
  const camera=new THREE.PerspectiveCamera(33,550/480,.1,100);camera.position.set(...eye);camera.lookAt(0,.92,0);renderer.render(scene,camera);
  const box=new THREE.Box3().setFromObject(kart.shell);
  reports.push({name,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,bodyBounds:{min:box.min.toArray(),max:box.max.toArray()},wheelCount:kart.wheels.length});
}
window.artReport=reports; document.documentElement.dataset.ready='true';
</script>` }));
await page.goto('http://localhost:5174/__kart-art-review');
await page.waitForSelector('html[data-ready="true"]');
await mkdir('docs/screenshots', { recursive: true });
await page.screenshot({ path: 'docs/screenshots/classic-kart-views.png' });
const report = { views: await page.evaluate(() => window.artReport), errors };
await writeFile('docs/classic-model-validation.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
await browser.close();
if (errors.length) process.exitCode = 1;
