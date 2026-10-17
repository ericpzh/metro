import {spawn} from 'node:child_process';
import {connect} from 'node:net';
import {resolve} from 'node:path';
const npmCli=process.env.npm_execpath;
if(!npmCli)throw new Error('Run this launcher with npm start or npm run dev:all.');
const services=[
  {name:'web',port:5173,args:[npmCli,'--prefix','web','run','dev']},
  {name:'game',port:5174,args:[npmCli,'--prefix','game','run','dev']},
  {name:'model',port:5175,args:[npmCli,'--prefix','model','run','dev']},
  {name:'stats',port:5176,args:[npmCli,'run','dev:stats']},
],children=[];
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
for(const service of services){
 const {name,port,args}=service;
 if(await listening(port)){console.log(`[${name}] Reusing service at http://localhost:${port}/`);continue}
 console.log(`[${name}] Starting at http://localhost:${port}/`);
 const child=spawn(process.execPath,args,{cwd:resolve(import.meta.dirname,'..'),stdio:'inherit',windowsHide:true});children.push(child);
 child.on('error',error=>{console.error(`[${name}] ${error.message}`);stop(1)});
 child.on('exit',code=>{if(!stopping){console.error(`[${name}] Stopped (${code}).`);stop(code||0)}});
}
if(children.length===0)console.log('All services are already running.');
