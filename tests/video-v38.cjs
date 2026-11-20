const {create,idle,delay,indexedDB,sharp,setPng}=require('./mobile-harness.cjs'),assert=require('node:assert/strict'),{File}=require('node:buffer'),{execFileSync}=require('node:child_process'),{IDBObjectStore}=require('fake-indexeddb');
(async()=>{
const source=execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=s=64x96:r=5','-f','lavfi','-i','sine=frequency=440','-t','1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1']);
const png=await sharp({create:{width:16,height:16,channels:3,background:'#fff'}}).png().toBuffer();setPng(png);
// Seed the real predecessor layout, then open the new schema via application code.
await new Promise((res,rej)=>{const r=indexedDB.open('feedboard-v2-db',2);r.onupgradeneeded=()=>{const db=r.result,posts=db.createObjectStore('posts',{keyPath:'id'}),meta=db.createObjectStore('meta',{keyPath:'id'});meta.put({id:'state',generation:'before',revision:4});meta.put({id:'projectNames',values:{Personal:'Мой проект'}});posts.put({id:'before',order:0,project:'Personal',type:'photo',file:new File([png],'before.png',{type:'image/png'}),crop:{x:.2,y:.4,z:2}})};r.onsuccess=()=>{r.result.close();res()};r.onerror=rej});
function ctx(w){Object.defineProperty(w.crypto,'subtle',{value:require('node:crypto').webcrypto.subtle});const V=w.HTMLVideoElement.prototype;
Object.defineProperties(V,{src:{configurable:true,set(v){this.setAttribute('src',v);queueMicrotask(()=>this.onloadeddata?.())},get(){return this.getAttribute('src')}},videoWidth:{get(){return 64}},videoHeight:{get(){return 96}},duration:{get(){return 1}},readyState:{get(){return 4}},load:{value(){}},pause:{value(){}}});w.HTMLCanvasElement.prototype.getContext=()=>({drawImage(){}})}
let d=create(ctx),w=d.window;await idle(w);assert.equal(w.eval("items[0].crop.z"),2);assert.equal(w.eval("projectLabel('Personal')"),'Мой проект');
const input=f=>({target:{files:[f],value:'selected'}});
const upload=async f=>w.document.getElementById('videoInput').onchange(input(f));
const good=new File([source],'sample.mp4',{type:'video/mp4'});await upload(new File(['not a video'],'bad.mp4'));assert.equal(w.eval('items.length'),1);
const put=IDBObjectStore.prototype.put;let writes=0;IDBObjectStore.prototype.put=function(...args){if(this.name==='videos'){writes++;throw new DOMException('quota','QuotaExceededError')}return put.apply(this,args)};await upload(good);assert.equal(w.eval('items.length'),1);assert.equal((await w.eval('readSnapshot()')).posts.length,1);
IDBObjectStore.prototype.put=function(...args){if(this.name==='videos')writes++;return put.apply(this,args)};
await upload(good);assert.equal(w.eval('items.length'),2);const id=w.eval('items[0].id');w.postId=id;const val=()=>w.eval('readVideo(postId)').then(x=>Buffer.from(x));assert.deepEqual(await val(),source);const count=writes;
w.eval("openViewer(postId);setGridView('reels')");await delay();const player=w.document.querySelector('#reelPlayer');assert(player.controls&&player.getAttribute('src'));assert(!player.muted);player.onloadedmetadata();const slider=w.document.querySelector('#videoTime');slider.value='.5';slider.oninput();assert.equal(player.currentTime,.5);await w.document.querySelector('#saveFrame').onclick();assert.equal(w.eval('selectedItem().file.name'),'cover.jpg');
await w.document.querySelector('#coverPhoto').onchange(input(new File([png],'separate.png',{type:'image/png'})));assert.equal(w.eval('selectedItem().file.name'),'separate.png');
await w.eval("mutate(()=>{items[0].showInMain=false;items[0].reelsCrop={x:.1,y:.9,z:2};items.reverse()})");assert.equal(writes,count);
let backup;w.cap=b=>backup=b;w.eval('download=b=>cap(b)');await w.document.querySelector('#exportBtn').onclick();assert.equal(await backup.slice(0,4).text(),'FBV2');assert.deepEqual(Buffer.from(await backup.slice(-source.length).arrayBuffer()),source);
d.window.close();d=create(ctx);w=d.window;w.postId=id;await idle(w);assert.deepEqual(await val(),source);assert.equal(w.eval('items.find(p=>p.id===postId).file.name'),'separate.png');
await w.eval('removePost(postId)');await assert.rejects(val());await w.eval('undoDelete()');assert.deepEqual(await val(),source);
const restore=b=>w.document.querySelector('#backupInput').onchange(input(b));const state=async()=>JSON.stringify((await w.eval('readSnapshot()')).state);const before=await state();
const corrupt=new Blob([backup.slice(0,-1),new Uint8Array([source.at(-1)^255])]);await restore(corrupt);assert.equal(await state(),before);assert.deepEqual(await val(),source);
IDBObjectStore.prototype.put=function(...args){if(this.name==='videos')throw new DOMException('full','QuotaExceededError');return put.apply(this,args)};await restore(backup);assert.equal(await state(),before);assert.deepEqual(await val(),source);IDBObjectStore.prototype.put=put;
await w.eval('removePost(postId)');await restore(backup);assert.deepEqual(await val(),source);assert.equal(w.eval('items.find(p=>p.id===postId).reelsCrop.z'),2);assert.equal(w.eval('items.find(p=>p.id===postId).showInMain'),false);assert.equal(w.eval('items.find(p=>p.id===postId).file.name'),'separate.png');
const restored=await val();
const decoded=execFileSync('ffmpeg',['-v','error','-i','pipe:0','-ss','0.4','-map','0:v:0','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{input:restored});assert.equal(decoded.length,64*96*3);
const audio=execFileSync('ffmpeg',['-v','error','-i','pipe:0','-map','0:a:0','-t','0.2','-f','s16le','pipe:1'],{input:restored});assert(audio.length>0 && audio.some(x=>x!==0));
console.log('PASS FFmpeg decodes the restored audio and a video frame at 0.4s.');
console.log('PASS v2 upgrade, MP4 + audio fixture, validation, quota rollback, native player wiring + seek, frame and photo cover, no media rewrite, restart, undo, binary backup, corrupt payload rejection, atomic restore, exact restored bytes. Simulated media events, not native playback.');d.window.close()
})().catch(e=>{console.error(e);process.exit(1)});
