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
   if(w.decoderMode==='hang')return; if(w.decoderMode==='rejectBlob'&&u.startsWith('blob:')){queueMicrotask(()=>this.onerror?.());return;}
   const blob=u.startsWith("data:")?new Blob([Buffer.from(u.split(",")[1],"base64")],{type:"image/png"}):blobs.get(u);
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
function create(){return new JSDOM(html,{url:'https://example.test/feedboard/',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.indexedDB=indexedDB;w.File=File;w.Blob=Blob;w.URL.createObjectURL=()=>`blob:test-${Math.random()}`;w.URL.revokeObjectURL=()=>{};w.confirm=()=>true;w.console.error=()=>{};w.FileReader=class{abort(){if(this.onabort)this.onabort()}readAsArrayBuffer(b){b.arrayBuffer().then(a=>{this.result=a;this.onload()}).catch(e=>{this.error=e;if(this.onerror)this.onerror()})}readAsDataURL(b){b.arrayBuffer().then(a=>{this.result='data:'+b.type+';base64,'+Buffer.from(a).toString('base64');this.onload()})}};installImageDecoder(w);w.HTMLCanvasElement.prototype.getContext=function(){return {drawImage(img){assert(img.naturalWidth>0)}}};w.HTMLCanvasElement.prototype.toBlob=function(cb,type){cb(new Blob([png],{type}))};w.addEventListener('error',e=>errors.push(e.message));}})}
const delay=()=>new Promise(r=>setTimeout(r,5));async function idle(w){for(let i=0;i<300;i++){if(!w.eval('busy'))return;await delay()}throw Error('busy timeout')}

(async()=>{
png=await sharp({create:{width:12,height:16,channels:3,background:'#E86F3A'}}).png().toBuffer();
let checks=0;const pass=s=>{checks++;console.log('PASS '+s)};
const d=create(),w=d.window;await idle(w);
w.file=new File([png],'screen.png',{type:'application/octet-stream'});
let processed=await w.eval('prepareImages([file])');assert.equal(processed[0].type,'image/png');pass('PNG signature accepted despite Android generic MIME; actual bytes decoded');
w.file=new File([png],'screen',{type:''});processed=await w.eval('prepareImages([file])');assert.equal(processed[0].type,'image/png');pass('missing MIME and extension accepted from signature');
w.decoderMode='rejectBlob';processed=await w.eval('prepareImages([file])');assert.equal(processed.length,1);pass('blob URL decode failure recovers through data URL with real raster decoder');w.decoderMode=null;
w.file=new File(['<svg/>'],'fake.png',{type:'image/png'});await assert.rejects(w.eval('prepareImages([file])'));pass('mislabelled non-raster file rejected before write');
w.file=new File([png.subarray(0,25)],'broken.png',{type:'image/png'});await assert.rejects(w.eval('prepareImages([file])'));pass('truncated PNG rejected by both decode routes');
const stable=JSON.stringify((await w.eval('readSnapshot()')).state);w.decoderMode='hang';w.file=new File([png],'screen.png',{type:'image/png'});assert.equal(await w.eval('mutate(async()=>{await prepareImages([file])})'),false);assert.equal(w.eval('busy'),false);assert.equal(JSON.stringify((await w.eval('readSnapshot()')).state),stable);w.decoderMode=null;pass('decode timeout unlocks UI and leaves database untouched');
let cleared=false;const providerInput={files:[w.file],get value(){return ''},set value(v){cleared=true}};
const Reader=w.FileReader;w.FileReader=class extends Reader{readAsArrayBuffer(b){assert.equal(cleared,false,'provider input must remain selected until bytes captured');super.readAsArrayBuffer(b)}};
await w.addPosts(providerInput,false);assert(cleared);assert.equal(w.eval('items.length'),1);w.FileReader=Reader;pass('file input only clears after complete processing and save');
w.file=new File([png],'other.png',{type:'image/png'});const before=w.eval('items.length');w.file2=new File(['bad'],'bad.png',{type:'image/png'});await w.eval('addPosts({files:[file,file2],value:""},true)');assert.equal(w.eval('items.length'),before);pass('failed second carousel image leaves earlier saved project intact');
await w.eval("mutate(()=>{items[0].type='reel';items[0].crop={x:.2,y:.8,z:2};items[0].reelsCrop={x:.8,y:.2,z:1.5};items[0].showInMain=false})");assert.equal(w.eval('visibleItems().length'),0);w.eval("setGridView('reels')");assert.equal(w.eval('visibleItems().length'),1);assert.equal(w.eval('cardCrop(items[0]).z'),1.5);pass('hidden Reel remains in Reels and keeps independent crop');
await w.eval('loadProject()');assert.equal(w.eval('items[0].showInMain'),false);assert.equal(w.eval('items[0].crop.z'),2);pass('visibility and both crops persist through database reload');
w.eval('openViewer(items[0].id)');w.document.querySelector('#cropBtn').onclick();assert.equal(w.eval('cropMode'),'reels');w.eval('cropDraft.z=2.7');w.document.querySelector('#cropMain').onclick();assert.equal(w.eval('cropDraft.z'),2);w.eval('cropDraft.z=1.2');await w.document.querySelector('#cropSave').onclick();assert.equal(w.eval('items[0].crop.z'),1.2);assert.equal(w.eval('items[0].reelsCrop.z'),2.7);pass('modal switches frames and saves two independent drafts');
w.capture=b=>captured=b;w.eval('download=(blob)=>capture(blob)');await w.document.querySelector('#exportBtn').onclick();const exported=JSON.parse(await captured.text());assert.equal(exported.posts[0].showInMain,false);assert.equal(exported.posts[0].reelsCrop.z,2.7);
async function restore(data){const t=JSON.stringify(data);await w.document.querySelector('#backupInput').onchange({target:{files:[{size:t.length,text:async()=>t}],value:''}})}
await restore(exported);assert.equal(w.eval('items[0].reelsCrop.z'),2.7);assert.equal(w.eval('items[0].showInMain'),false);pass('new fields round trip in compatible v1 backup');
for(const bad of [{reelsCrop:{x:2,y:.5,z:1}},{showInMain:'false'}]){const s=JSON.stringify((await w.eval('readSnapshot()')).state);await restore({...exported,posts:[{...exported.posts[0],...bad}]});assert.equal(JSON.stringify((await w.eval('readSnapshot()')).state),s)}pass('invalid new backup metadata rejected without replacing data');
const old=JSON.parse(JSON.stringify(exported));delete old.posts[0].showInMain;delete old.posts[0].reelsCrop;await restore(old);w.eval("setGridView('main')");assert.equal(w.eval('visibleItems().length'),1);assert.equal(w.eval('items[0].crop.z'),1.2);pass('old backup defaults to visible Reel and preserves existing main crop');
await w.eval("mutate(()=>{const p=items[0];p.type='carousel';p.carouselFiles=[p.file,new File([p.file],'second.png',{type:'image/png'}),new File([p.file],'third.png',{type:'image/png'})]})");w.eval('openViewer(items[0].id)');
const thumbs=[...w.document.querySelectorAll('.carousel-thumb')],img=thumbs[0].querySelector('img');w.document.elementFromPoint=()=>thumbs[2];
function touch(type,x,y){const e=new w.Event(type,{bubbles:true,cancelable:true});Object.defineProperty(e,'touches',{value:type==='touchend'?[]:[{clientX:x,clientY:y}]});img.dispatchEvent(e);return e}
touch('touchstart',10,10);await new Promise(r=>setTimeout(r,350));assert(w.eval('carouselDrag.active'));assert(touch('touchmove',150,20).defaultPrevented);touch('touchend',150,20);await idle(w);assert.equal(w.eval('mediaFiles(items[0])[0].name'),'second.png');assert.equal(w.eval('mediaFiles(items[0])[2].name'),'screen.png');assert.equal(w.document.querySelectorAll('.carousel-drag-ghost').length,0);pass('long hold + touch move + drop actually inserts slide at target and saves');
const order=w.eval('mediaFiles(items[0]).map(f=>f.name).join()');const newimg=w.document.querySelector('.carousel-thumb img');const ev=new w.Event('touchstart');Object.defineProperty(ev,'touches',{value:[{clientX:0,clientY:0}]});newimg.dispatchEvent(ev);const move=new w.Event('touchmove');Object.defineProperty(move,'touches',{value:[{clientX:50,clientY:0}]});newimg.dispatchEvent(move);assert.equal(w.eval('carouselDrag'),null);assert.equal(w.eval('mediaFiles(items[0]).map(f=>f.name).join()'),order);pass('normal scroll before hold cancels drag without mutation');
w.eval('openViewer(items[0].id)');w.document.querySelector('#cropBtn').onclick();const zoom=w.document.querySelector('#cropZoom');let bubbled=0;w.document.querySelector('#cropModal').addEventListener('pointerdown',()=>bubbled++);zoom.dispatchEvent(new w.Event('pointerdown',{bubbles:true}));assert.equal(bubbled,0);zoom.value='1.8';zoom.dispatchEvent(new w.Event('input'));assert.equal(w.eval('cropDraft.z'),1.8);pass('slider updates crop without bubbling gesture into modal');
const second=create();await idle(second.window);assert.equal(second.window.eval('items.length'),1);assert.equal(second.window.eval('mediaFiles(items[0])[0].name'),'second.png');second.window.close();pass('shared database new window retains project and reordered slides');
assert.deepEqual(errors,[]);d.window.close();console.log('TOTAL '+checks+' V3.7.1 checks passed; simulated DOM/IndexedDB/image decoder, not Android or Telegram.');
})().catch(e=>{console.error(e);process.exit(1)});
