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
function create(extra=()=>{}){return new JSDOM(html,{url:'https://example.test/feedboard/',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.indexedDB=indexedDB;w.File=File;w.Blob=Blob;w.URL.createObjectURL=()=>`blob:test-${Math.random()}`;w.URL.revokeObjectURL=()=>{};w.confirm=()=>true;w.console.error=()=>{};w.FileReader=class{abort(){if(this.onabort)this.onabort()}readAsArrayBuffer(b){b.arrayBuffer().then(a=>{this.result=a;this.onload()}).catch(e=>{this.error=e;if(this.onerror)this.onerror()})}readAsDataURL(b){b.arrayBuffer().then(a=>{this.result='data:'+b.type+';base64,'+Buffer.from(a).toString('base64');this.onload()})}};installImageDecoder(w);w.HTMLCanvasElement.prototype.getContext=function(){return {drawImage(img){assert(img.naturalWidth>0)}}};w.HTMLCanvasElement.prototype.toBlob=function(cb,type){cb(new Blob([png],{type}))};extra(w);w.addEventListener('error',e=>errors.push(e.message));}})}
const delay=()=>new Promise(r=>setTimeout(r,5));async function idle(w){for(let i=0;i<300;i++){if(!w.eval('busy'))return;await delay()}throw Error('busy timeout')}

module.exports={create,idle,delay,errors,indexedDB,sharp,setPng:b=>{png=b}};
