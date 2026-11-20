const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom'),sharp=require('sharp');
(async()=>{
 const html=fs.readFileSync('index.html','utf8'),doc=new JSDOM(html).window.document;
 const manifest=JSON.parse(fs.readFileSync('manifest.webmanifest')),sw=fs.readFileSync('sw.js','utf8');
 for(const [src,n] of [[doc.querySelector('link[rel=apple-touch-icon]').getAttribute('href'),180],...manifest.icons.map(i=>[i.src,Number(i.sizes.split('x')[0])])]){
 const {width,height}=await sharp(src).metadata();assert.equal(width,n);assert.equal(height,n);assert(sw.includes(src));}
 const fragment=html.slice(html.indexOf('const lastPaint='),html.indexOf("document.getElementById('cropBtn').onclick"));const paint=Function(fragment+';return paintCrop')();
 let writes=0;const image={naturalWidth:200,naturalHeight:350,style:new Proxy({},{set(o,k,v){writes++;o[k]=v;return true}})},frame={clientWidth:120,clientHeight:160};
 paint(image,frame);let initial=writes;assert(initial>0);paint(image,frame);assert.equal(writes,initial);paint(image,frame,{x:0,y:1,z:2});assert(writes>initial);
 assert(doc.querySelector('details.storage-help summary'));assert(html.includes('.storage-help[open] summary::after'));
 console.log('PASS icon paths/dimensions/cache, stable crop and crop update, disclosure states');
})().catch(e=>{console.error(e);process.exit(1)});
