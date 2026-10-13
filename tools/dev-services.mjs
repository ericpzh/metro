import {spawn} from 'node:child_process';
import {connect} from 'node:net';
import {resolve} from 'node:path';
const services=[['web',5173],['game',5174],['model',5175]],children=[];
const npmCli=process.env.npm_execpath;
if(!npmCli)throw new Error('Run this launcher with npm start or npm run dev:all.');
function listening(port){return new Promise(resolve=>{const socket=connect({host:'localhost',port});socket.setTimeout(500);socket.once('connect',()=>{socket.destroy();resolve(true)});socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(false)})})}
let stopping=false;
function stop(code=0){
 if(stopping)return;stopping=true;
 for(const child of children){
  if(child.exitCode!==null)continue;
  if(process.platform==='win32')spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
  else child.kill('SIGTERM');
 }
 setTimeout(()=>process.exit(code),700);
}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
for(const [folder,port] of services){
 if(await listening(port)){console.log(`[${folder}] Reusing service at http://localhost:${port}/`);continue}
 console.log(`[${folder}] Starting at http://localhost:${port}/`);
 const child=spawn(process.execPath,[npmCli,'--prefix',folder,'run','dev'],{cwd:resolve(import.meta.dirname,'..'),stdio:'inherit',windowsHide:true});children.push(child);
 child.on('error',error=>{console.error(`[${folder}] ${error.message}`);stop(1)});
 child.on('exit',code=>{if(!stopping){console.error(`[${folder}] Stopped (${code}).`);stop(code||0)}});
}
if(children.length===0)console.log('All three services are already running.');
