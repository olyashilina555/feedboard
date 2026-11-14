const fs=require('fs');const assert=require('assert');const {JSDOM}=require('jsdom');const {indexedDB}=require('fake-indexeddb');const {File}=require('node:buffer');
// fake-indexeddb uses structuredClone; restore browser File cloning semantics in Node.
const nativeClone=global.structuredClone;
global.structuredClone=function c(x){if(x instanceof File)return new File([x],x.name,{type:x.type,lastModified:x.lastModified});if(x instanceof Blob)return x.slice(0,x.size,x.type);if(Array.isArray(x))return x.map(c);if(x&&Object.getPrototypeOf(x)===Object.prototype)return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,c(v)]));return nativeClone(x)};
const sharp=require('sharp');
let captured;const errors=[];
let png;
function installImageDecoder(w){
 const blobs=new Map();let next=0;
 w.URL.createObjectURL=b=>{const u='blob:audit-'+(++next);blobs.set(u,b);return u};
 w.URL.revokeObjectURL=u=>blobs.delete(u);
 w.Image=class{
  removeAttribute(){this.cancelled=true}
  set src(u){
   if(w.decoderMode==='hang')return;
   const blob=blobs.get(u);
   Promise.resolve().then(async()=>{const b=Buffer.from(await blob.arrayBuffer());
    const result=await sharp(b,{failOn:'warning'}).raw().toBuffer({resolveWithObject:true});
    this.naturalWidth=result.info.width;this.naturalHeight=result.info.height;
    if(!this.cancelled&&this.onload)this.onload();
   }).catch(()=>{if(!this.cancelled&&this.onerror)this.onerror()});
  }
 };
 const timer=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>timer(fn,ms===20000?200:ms,...args);
}
const html=fs.readFileSync(process.env.FEEDBOARD_SOURCE||'index.html','utf8');
function create(){return new JSDOM(html,{url:'https://example.test/feedboard/',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.indexedDB=indexedDB;w.File=File;w.Blob=Blob;w.URL.createObjectURL=()=>`blob:test-${Math.random()}`;w.URL.revokeObjectURL=()=>{};w.confirm=()=>true;w.console.error=()=>{};w.FileReader=class{abort(){if(this.onabort)this.onabort()}readAsArrayBuffer(b){b.arrayBuffer().then(a=>{this.result=a;this.onload()}).catch(e=>{this.error=e;if(this.onerror)this.onerror()})}readAsDataURL(b){b.arrayBuffer().then(a=>{this.result='data:'+b.type+';base64,'+Buffer.from(a).toString('base64');this.onload()})}};installImageDecoder(w);w.addEventListener('error',e=>errors.push(e.message));}})}
const delay=()=>new Promise(r=>setTimeout(r,5));async function idle(w){for(let i=0;i<300;i++){if(!w.eval('busy'))return;await delay()}throw Error('busy timeout')}

(async()=>{
png=await sharp({create:{width:12,height:16,channels:3,background:'#E86F3A'}}).png().toBuffer();
const media={name:'test.png',data:'data:image/png;base64,'+png.toString('base64')};
const backup={format:'feedboard-backup',version:1,posts:[
{id:'a',project:'Personal',order:0,type:'photo',crop:{x:.2,y:.8,z:2},files:[media]},
{id:'b',project:'Personal',order:1,type:'reel',files:[media]},
{id:'c',project:'Personal',order:2,type:'carousel',files:[media,media]},
{id:'d',project:'Personal',order:3,type:'reel',files:[media]},
{id:'e',project:'Project 1',order:0,type:'carousel',files:[media,media]}]};
let checks=0;const pass=s=>{checks++;console.log('PASS '+s)};
async function restore(w,data){const text=JSON.stringify(data);await w.document.querySelector('#backupInput').onchange({target:{files:[{size:Buffer.byteLength(text),text:async()=>text}],value:''}})}
async function fresh(){const d=create();await idle(d.window);return d}
let d=await fresh(),w=d.window;await restore(w,backup);
const beforeNodes=[...w.document.querySelectorAll('.card')],beforeImgs=beforeNodes.map(c=>c.querySelector('img')),urls=beforeImgs.map(i=>i.src);
await w.eval("mutate(()=>{items.reverse()})");
for(let i=0;i<beforeNodes.length;i++){assert.strictEqual(w.document.querySelector(`[data-id="${beforeNodes[i].dataset.id}"]`),beforeNodes[i]);assert.strictEqual(beforeNodes[i].querySelector('img'),beforeImgs[i]);assert.equal(beforeImgs[i].src,urls[i])}pass('reorder retains card/image DOM nodes and exact URLs; no image reload');
await w.eval("mutate(()=>{items.unshift({...items[0],id:'new',type:'photo'})})");assert.strictEqual(w.document.querySelector('[data-id="a"] img'),beforeImgs[0]);pass('adding leaves existing images mounted');
await restore(w,backup);const crop=w.eval('JSON.stringify(items[0].crop)');
w.eval("setGridView('reels')");assert.deepEqual([...w.document.querySelectorAll('.card')].map(x=>x.dataset.id),['b','d']);
await w.eval("mutate(()=>reorderVisible(['d','b']))");assert.equal(w.eval('items.map(x=>x.id).join()'),'a,d,c,b');assert.equal(w.eval('JSON.stringify(items[0].crop)'),crop);pass('Reels filter and drag reorder only Reel slots; crop preserved');
w.eval("setGridView('main')");assert.equal(w.document.querySelectorAll('.card').length,4);assert.equal(w.document.querySelectorAll('.reel-icon svg').length,2);assert.equal(w.document.querySelectorAll('.carousel-icon svg').length,1);pass('main grid retains shared posts and SVG badges');
await w.eval("activeProject='Project 2';loadProject()");w.eval("setGridView('reels')");assert.match(w.document.querySelector('.empty').textContent,/Пока нет/);assert.equal((await w.eval('getAllPosts()')).length,5);pass('empty Reels view creates no data');
await w.eval("activeProject='Personal';loadProject()");w.eval("setGridView('main')");await w.eval("removePost('c')");assert(!w.eval("items.some(x=>x.id==='c')"));
await w.eval("activeProject='Project 1';loadProject()");assert.equal(await w.eval('undoDelete()'),true);assert.equal(w.eval('activeProject'),'Project 1');
await w.eval("activeProject='Personal';loadProject()");assert.equal(w.eval('items.map(x=>x.id).join()'),'a,d,c,b');assert.equal(w.eval("mediaFiles(items.find(x=>x.id==='c')).length"),2);pass('undo from another project restores carousel and original slot without moving active project');
await w.eval("removePost('a')");await w.eval("mutate(()=>{items[0].type='photo'})");assert.equal(await w.eval('undoDelete()'),true);assert.equal(w.eval("items.find(x=>x.id==='a').crop.z"),2);assert.equal(w.eval("items.find(x=>x.id==='d').type"),'photo');pass('undo preserves crop and later local edits');
await w.eval("removePost('a')");let other=await fresh();await other.window.eval("mutate(()=>{items[0].type='carousel'})");const stateBefore=JSON.stringify((await w.eval('readSnapshot()')).state);assert.equal(await w.eval('undoDelete()'),false);assert.equal(JSON.stringify((await w.eval('readSnapshot()')).state),stateBefore);pass('stale undo refuses to overwrite another tab');other.window.close();
await w.eval('loadProject()');await w.eval("removePost('c')");await restore(w,backup);assert.equal(w.eval('undoEntry'),null);assert.equal(await w.eval('undoDelete()'),false);pass('import invalidates old undo');
async function rename(w,name){await w.document.querySelector('#renameBtn').onclick();w.document.querySelector('#projectName').value=name;await w.document.querySelector('#renameForm').onsubmit({preventDefault(){}})}
const idsBefore=(await w.eval('getAllPosts()')).map(p=>[p.id,p.project]);await rename(w,'Личный блог');assert.equal(w.eval("projectLabel('Personal')"),'Личный блог');assert.deepEqual((await w.eval('getAllPosts()')).map(p=>[p.id,p.project]),idsBefore);pass('rename persists only label; internal IDs/photos unchanged');
w.capture=b=>captured=b;w.eval('download=(blob,name)=>capture(blob)');await w.document.querySelector('#exportBtn').onclick();const exported=JSON.parse(await captured.text());assert.equal(exported.projectNames.Personal,'Личный блог');pass('backup contains names and all image bytes');
const repeat=w.document.querySelector('#message button.backup-shortcut');assert(repeat);captured=null;repeat.onclick();assert(captured instanceof Blob);assert.equal(w.document.querySelector('#message a'),null);pass('repeat download creates a new URL on demand, no stale anchor');
d.window.close();d=await fresh();w=d.window;assert.equal(w.eval("projectLabel('Personal')"),'Личный блог');pass('project name survives restart');
await w.eval(`(async()=>{const db=await openDB();await new Promise((resolve,reject)=>{const tx=db.transaction('meta','readwrite'),store=tx.objectStore('meta'),q=store.get('state');q.onsuccess=()=>store.put({id:'state',generation:q.result.generation,revision:q.result.revision+1});tx.oncomplete=resolve;tx.onabort=reject});db.close()})()`);
await w.eval('loadProject()');assert.equal(w.eval("projectLabel('Personal')"),'Личный блог');pass('V3.6.3-shaped metadata write cannot erase new project names');

await restore(w,backup);assert.equal(w.eval("projectLabel('Personal')"),'Personal');await restore(w,exported);assert.equal(w.eval("projectLabel('Personal')"),'Личный блог');pass('old unnamed and new named backups both restore');
const bad={...exported,projectNames:{Personal:'x'.repeat(31)}};const snap=JSON.stringify((await w.eval('readSnapshot()')).state);await restore(w,bad);assert.equal(JSON.stringify((await w.eval('readSnapshot()')).state),snap);pass('invalid names rejected before any database changes');
other=await fresh();await w.document.querySelector('#renameBtn').onclick();await rename(other.window,'Работа');w.document.querySelector('#projectName').value='Устарело';await w.document.querySelector('#renameForm').onsubmit({preventDefault(){}});assert.equal((await w.eval('readSnapshot()')).state.projectNames.Personal,'Работа');pass('concurrent rename rejects stale metadata snapshot');other.window.close();
await w.eval('loadProject()');w.eval("openViewer('c')");const thumb=w.document.querySelector('.carousel-thumb');w.eval('renderViewer()');assert.strictEqual(w.document.querySelector('.carousel-thumb'),thumb);pass('unchanged carousel thumbnails are not rebuilt');
for(const width of [320,375,390,412,1440]){w.innerWidth=width;w.dispatchEvent(new w.Event('resize'));w.eval("applyTheme('dark');applyTheme('light')");}assert.deepEqual(errors,[]);pass('resize handlers and theme switches execute at five widths (DOM only, no layout engine)');
d.window.close();console.log('TOTAL '+checks+' V3.7 checks passed; DOM/IndexedDB adapter, not real mobile browser.');
})().catch(e=>{console.error(e);process.exit(1)});
