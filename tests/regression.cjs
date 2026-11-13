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
const file=new File([png],'old.png',{type:'image/png'});
const db=await new Promise(r=>{const q=indexedDB.open('feedboard-v2-db',1);q.onupgradeneeded=()=>q.result.createObjectStore('posts',{keyPath:'id'});q.onsuccess=()=>r(q.result)});
await new Promise(r=>{const tx=db.transaction('posts','readwrite');for(const p of [{id:'old1',project:'Personal',order:0},{id:'old2',project:'Personal',order:1},{id:'other',project:'Project 1',order:0}])tx.objectStore('posts').put({...p,file,type:'photo'});tx.oncomplete=r});db.close();
// Reproduce a WebKit-style failure on any attempted Blob/File write.
const {IDBObjectStore}=require('fake-indexeddb');const realPut=IDBObjectStore.prototype.put;
function hasBlob(value){if(value instanceof Blob)return true;if(Array.isArray(value))return value.some(hasBlob);if(value&&typeof value==='object')return Object.values(value).some(hasBlob);return false}
IDBObjectStore.prototype.put=function(value,...args){if(hasBlob(value))throw new Error('Error preparing Blob/File data to be stored in object store');return realPut.call(this,value,...args)};
let dom=create(),w=dom.window;await idle(w);assert.equal(w.eval('items.length'),2);
// Image decoder is stubbed only in DOM tests; actual browser decode requires device test.
w.eval('prepareImages=async files=>files');w.testFiles=[new File([png],'a.png',{type:'image/png'}),new File([png],'b.png',{type:'image/png'})];
await w.eval('addPosts({files:testFiles,value:""},false)');assert.equal(w.eval('items[0].file.name'),'a.png');assert.equal(w.eval('items[1].file.name'),'b.png');
await w.eval('addPosts({files:testFiles,value:""},true)');assert.equal(w.eval('items[0].type'),'carousel');
w.eval('openViewer(items[0].id)');await w.eval('moveCarouselImage(selectedItem(),0,1)');assert.equal(w.eval('mediaFiles(items[0])[0].name'),'b.png');
assert.notEqual(w.eval('urlForFile(items[0],0)'),w.eval('urlForFile(items[0],1)'));
w.document.querySelector('[data-type="reel"]').click();await idle(w);assert.equal(w.eval('items[0].type'),'reel');
w.document.querySelector('[data-type="carousel"]').click();await idle(w);assert.equal(w.eval('items[0].type'),'carousel');
await w.eval('mutate(()=>{items[0].crop={x:.3,y:.7,z:1.8};items.reverse()})');const order=w.eval('JSON.stringify(items.map(x=>x.id))');
dom.window.close();dom=create();w=dom.window;await idle(w);assert.equal(w.eval('JSON.stringify(items.map(x=>x.id))'),order);assert.equal(w.eval('items.at(-1).crop.z'),1.8);
w.document.querySelectorAll('.project-btn')[1].click();await idle(w);assert.equal(w.eval('items[0].id'),'other');
w.document.querySelectorAll('.project-btn')[0].click();await idle(w);assert.equal(w.eval('JSON.stringify(items.map(x=>x.id))'),order);
// Transaction abort restores both the database and visible state.
w.eval('originalWrite=writeChanges;writeChanges=async()=>{throw new DOMException("Full","QuotaExceededError")}');
const count=w.eval('items.length');await w.eval('removePost(items[0].id)');assert.equal(w.eval('items.length'),count);assert.match(w.document.querySelector('#message').textContent,/Недостаточно/);
w.eval('writeChanges=originalWrite');
w.capture=(blob)=>captured=blob;w.eval('download=(blob,name)=>capture(blob)');await w.document.querySelector('#exportBtn').onclick();assert(captured);const backupText=await captured.text();const backup=JSON.parse(backupText);assert.equal(backup.posts.length,6);
await w.eval('removePost(items[0].id)');assert.equal(w.eval('items.length'),4);
await w.document.querySelector('#backupInput').onchange({target:{files:[{size:backupText.length,text:async()=>backupText}],value:''}});assert.equal(w.eval('items.length'),5);assert.equal(w.eval('JSON.stringify(items.map(x=>x.id))'),order);
const corrupt=JSON.stringify({format:'feedboard-backup',version:1,posts:[{}]});await w.document.querySelector('#backupInput').onchange({target:{files:[{size:corrupt.length,text:async()=>corrupt}],value:''}});assert.equal(w.eval('items.length'),5);
// Rapid second mutation cannot overlap the first; project buttons blocked while processing.
w.release=undefined;const promise=w.eval('mutate(async()=>{await new Promise(r=>window.release=r);items[0].type="reel"})');assert.equal(w.document.querySelector('.project-btn').disabled,true);assert.equal(await w.eval('mutate(()=>{items=[]})'),false);w.release();await promise;
assert.equal(w.eval('items.length'),5);
// A second open window cannot overwrite more recent changes.
const second=create();await idle(second.window);await w.eval('mutate(()=>{items[0].type="photo"})');
const rejected=await second.window.eval('mutate(()=>{items.reverse()})');assert.equal(rejected,false);assert.match(second.window.document.querySelector('#message').textContent,/другом окне/);second.window.close();
// A malformed record aborts the entire transaction, including preceding deletes.
const firstId=w.eval('items[0].id');w.invalidId=firstId;
await assert.rejects(w.eval('writeChanges([{file:null}],[invalidId])'));
assert.equal(await w.eval('(async()=> (await getAllPosts()).some(x=>x.id===invalidId))()'),true);
assert.equal(await w.eval('(async()=>{const f=mediaFiles((await getAllPosts())[0])[0];return (await f.arrayBuffer()).byteLength>0})()'),true);
assert.deepEqual(errors,[]);dom.window.close();console.log('PASS 17 checks: legacy database, prepend batch, carousel creation/reorder/URLs, type switches, crop persistence, reload order, project isolation, failed write rollback, all-project backup and restore, invalid import, mutation isolation.\nDOM/IndexedDB emulation only; browser rendering and iPhone gestures not verified.');
})().catch(e=>{console.error(e);process.exit(1)});
