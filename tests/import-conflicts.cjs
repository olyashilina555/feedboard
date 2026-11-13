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
png=await sharp({create:{width:2,height:3,channels:3,background:'#E86F3A'}}).png().toBuffer();
const media={name:'test.png',data:'data:image/png;base64,'+png.toString('base64')};
const backup={format:'feedboard-backup',version:1,posts:[{id:'one',project:'Personal',order:1,type:'carousel',crop:{x:.3,y:.6,z:1.5},files:[media,media]},{id:'two',project:'Personal',order:0,type:'reel',files:[media]},{id:'three',project:'Project 2',order:0,type:'photo',files:[media]}]};
const copy=x=>JSON.parse(JSON.stringify(x));let checks=0;
const pass=s=>{checks++;console.log('PASS '+s)};
async function restore(w,data){const text=typeof data==='string'?data:JSON.stringify(data);await w.document.querySelector('#backupInput').onchange({target:{files:[{size:Buffer.byteLength(text),text:async()=>text}],value:''}})}
async function snapshot(w){const x=await w.eval('readSnapshot()');const out=[];for(const p of x.posts){const files=[];for(const f of (p.carouselFiles||[p.file]))files.push(Buffer.from(await f.arrayBuffer()).toString('base64'));out.push({...p,file:undefined,carouselFiles:undefined,files})}return JSON.stringify({state:x.state,posts:out})}
async function fresh(){const d=create();await idle(d.window);return d}
let d=await fresh(),w=d.window;
await restore(w,backup);assert.equal(w.eval('JSON.stringify(items.map(x=>x.id))'),'["two","one"]');assert.equal(w.eval('items[1].crop.z'),1.5);assert.equal((await w.eval('getAllPosts()')).length,3);pass('old backup v1 accepted: all projects, order, carousel, type, crop');
w.capture=b=>captured=b;w.eval('download=(blob,name)=>capture(blob)');await w.document.querySelector('#exportBtn').onclick();const exported=JSON.parse(await captured.text());
assert.deepEqual(exported.posts.map(p=>p.files.map(f=>f.data)),backup.posts.slice().sort((a,b)=>a.id.localeCompare(b.id)).map(p=>p.files.map(f=>f.data)));pass('export retains exact image bytes');
const stable=await snapshot(w);let confirms=0;w.confirm=()=>{confirms++;return true};
for(const [name,edit] of [
 ['text disguised as PNG',b=>{b.posts[1].files=[{name:'bad.png',data:'data:image/png;base64,aGVsbG8='}]}],
 ['truncated PNG',b=>{b.posts[1].files=[{name:'bad.png',data:'data:image/png;base64,'+png.subarray(0,30).toString('base64')}]}],
 ['invalid base64',b=>{b.posts[1].files=[{name:'bad.png',data:'data:image/png;base64,%%%'}]}],
 ['duplicate post ID',b=>{b.posts[1].id='one'}]
]){const bad=copy(backup);edit(bad);await restore(w,bad);assert.equal(await snapshot(w),stable);assert.equal(confirms,0);assert.equal(w.eval('busy'),false);pass(name+' rejected before confirmation; all bytes and metadata unchanged')}
await restore(w,'{');assert.equal(await snapshot(w),stable);pass('invalid JSON leaves database unchanged');
w.decoderMode='hang';await restore(w,backup);delete w.decoderMode;assert.equal(await snapshot(w),stable);assert.equal(w.eval('busy'),false);pass('decoder timeout leaves data unchanged and unlocks UI');
w.confirm=()=>false;await restore(w,backup);assert.equal(await snapshot(w),stable);pass('cancelled restore leaves data unchanged');w.confirm=()=>true;
const {IDBObjectStore}=require('fake-indexeddb');const realPut=IDBObjectStore.prototype.put;
IDBObjectStore.prototype.put=function(v,...args){if(this.name==='posts'&&v.id==='two')throw new DOMException('full','QuotaExceededError');return realPut.call(this,v,...args)};
await restore(w,backup);IDBObjectStore.prototype.put=realPut;assert.equal(await snapshot(w),stable);pass('failure after clear/partial puts rolls back photos AND generation');
let old=await fresh();const changed=copy(backup);changed.posts[1].type='photo';await restore(w,changed);
let saved=await snapshot(w);assert.equal(await old.window.eval('mutate(()=>{items.reverse()})'),false);assert.equal(await snapshot(w),saved);pass('stale tab cannot overwrite restored same-ID posts');old.window.close();
old=await fresh();await restore(w,changed);saved=await snapshot(w);assert.equal(await old.window.eval('mutate(()=>{items.reverse()})'),false);assert.equal(await snapshot(w),saved);pass('repeat identical import still invalidates old tabs');old.window.close();
old=await fresh();await old.window.eval("activeProject='Project 1';loadProject()");await restore(w,{format:'feedboard-backup',version:1,posts:[]});saved=await snapshot(w);old.window.testFile=new File([png],'x.png',{type:'image/png'});assert.equal(await old.window.eval("mutate(()=>{items.push({id:'stale',file:testFile,type:'photo',project:activeProject})})"),false);assert.equal(await snapshot(w),saved);pass('empty project / empty restore still rejects stale writes');old.window.close();
await restore(w,backup);old=await fresh();await old.window.eval("activeProject='Project 2';loadProject()");await restore(w,changed);saved=await snapshot(w);assert.equal(await old.window.eval("mutate(()=>{items[0].type='reel'})"),false);assert.equal(await snapshot(w),saved);pass('other project stale tab rejected after restore');old.window.close();
// A valid write in another tab while images are being validated must survive.
old=await fresh();w.eval('realValidator=validateBackupImage;validateBackupImage=async(...args)=>{if(window.validationGate){const gate=window.validationGate;window.validationGate=null;await gate;}return realValidator(...args)}');
w.validationGate=new Promise(r=>w.releaseValidation=r);const pending=restore(w,backup);for(let i=0;i<100&&w.validationGate;i++)await delay();
assert.equal(await old.window.eval("mutate(()=>{items[0].type='carousel'})"),true);saved=await snapshot(w);w.releaseValidation();await pending;assert.equal(await snapshot(w),saved);pass('concurrent normal write during import preserved; import rejected');w.eval('validateBackupImage=realValidator');old.window.close();
// Two imports start from one snapshot: only one may commit.
old=await fresh();for(const win of [w,old.window]){win.eval('realValidator=validateBackupImage;validateBackupImage=async(...args)=>{if(window.validationGate){const gate=window.validationGate;window.validationGate=null;await gate;}return realValidator(...args)}');win.validationGate=new Promise(r=>win.releaseValidation=r)}
const beforeRevision=(await w.eval('readSnapshot()')).state.revision;const first=restore(w,backup),second=restore(old.window,changed);
for(let i=0;i<100&&(w.validationGate||old.window.validationGate);i++)await delay();w.releaseValidation();old.window.releaseValidation();await Promise.all([first,second]);assert.equal((await w.eval('readSnapshot()')).state.revision,beforeRevision+1);assert.equal([w,old.window].filter(win=>win.document.querySelector('#message').textContent.includes('Все проекты восстановлены')).length,1);pass('simultaneous imports: one commit, one explicit conflict');old.window.close();
await w.eval('loadProject()');w.eval('validateBackupImage=realValidator');assert.equal(await w.eval("mutate(()=>{items[0].type='photo'})"),true);pass('reloaded tab can write normally');
const blocked=await new Promise(r=>{const q=indexedDB.open('feedboard-v2-db',1);q.onerror=()=>r(q.error.name);q.onsuccess=()=>{q.result.close();r('unexpected success')}});assert.equal(blocked,'VersionError');pass('V3.6.2 database opener cannot write after upgrade');
saved=await snapshot(w);d.window.close();d=await fresh();w=d.window;assert.equal(await snapshot(w),saved);pass('restart preserves final database and metadata');
assert.deepEqual(errors,[]);d.window.close();console.log('TOTAL '+checks+' targeted checks passed. DOM/IndexedDB with sharp decoder adapter; real Safari gestures not exercised.');
})().catch(e=>{console.error(e);process.exit(1)});
