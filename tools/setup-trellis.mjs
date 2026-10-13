// Local model weights stay in the ignored cache, outside shipped game assets.
import {mkdirSync,existsSync,statSync,createReadStream,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const repo=resolve(import.meta.dirname,'..');
const dir=resolve(repo,'.cache/trellis/models');mkdirSync(dir,{recursive:true});
const response=await fetch('https://huggingface.co/api/models/ilintar/trellis2-gguf/tree/main?recursive=true');
if(!response.ok)throw Error(`Model listing: HTTP ${response.status}`);
const listing=await response.json();
const names=['birefnet.gguf','dinov3.gguf','ss_flow.gguf','ss_dec.gguf','shape_flow_512.gguf','shape_flow_1024.gguf','shape_dec.gguf','tex_flow_512.gguf','tex_flow_1024.gguf','tex_dec.gguf'];
const files=names.map(name=>{const file=listing.find(f=>f.path===name);if(!file?.lfs?.oid)throw Error(`No checksum for ${name}`);return file;});
async function download(file){
 const dest=resolve(dir,file.path);
 if(!existsSync(dest)||statSync(dest).size!==file.size){
  console.log(`Downloading ${file.path} (${(file.size/1e9).toFixed(2)} GB)`);
  await new Promise((done,fail)=>{const p=spawn('curl.exe',['-sS','-L','--fail','--retry','3','-C','-','-o',dest,`https://huggingface.co/ilintar/trellis2-gguf/resolve/main/${file.path}`],{stdio:'inherit'});p.on('error',fail);p.on('exit',code=>code===0?done():fail(Error(`curl ${file.path}: ${code}`)));});
 }
 if(statSync(dest).size!==file.size)throw Error(`Incomplete ${file.path}`);
 const hash=createHash('sha256');for await(const chunk of createReadStream(dest))hash.update(chunk);
 if(hash.digest('hex')!==file.lfs.oid)throw Error(`Checksum mismatch: ${file.path}`);
 console.log(`Verified ${file.path}`);
}
let next=0;
const results=await Promise.allSettled(Array.from({length:3},async()=>{while(next<files.length)await download(files[next++]);}));
for(const result of results)if(result.status==='rejected')throw result.reason;
writeFileSync(resolve(repo,'.cache/trellis/models-manifest.json'),JSON.stringify({source:'ilintar/trellis2-gguf',files:files.map(f=>({name:f.path,size:f.size,sha256:f.lfs.oid}))},null,2));
console.log('All model weights downloaded and SHA-256 verified.');
