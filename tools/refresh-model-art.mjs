// One repeatable model-to-art operation. No deployment or hand-edited SVGs.
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createServer} from 'node:net';
const repo=resolve(import.meta.dirname,'..');
const env={...process.env,
 PASSENGER_CARDS_DIR:resolve(repo,'.preview/model-art/passenger-cards'),
 UI_SHOTS_DIR:resolve(repo,'.preview/model-art/ui-shots'),
 UI_SHOTS_EN_DIR:resolve(repo,'.preview/model-art/ui-shots-en'),
};
async function freePort() {
 const server=createServer();
 await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok)});
 const port=server.address().port;
 await new Promise(ok=>server.close(ok));return String(port);
}
function run(command,args) {
 console.log(`\n> ${command} ${args.join(' ')}`);
 const result=spawnSync(command,args,{cwd:repo,stdio:'inherit',env});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status??1);
}
// npm_execpath is npm's JavaScript CLI, so this also works on Windows without
// composing shell commands or relying on npm.cmd executable handling.
const npm=process.env.npm_execpath;
if(!npm)throw new Error('Run from the root: npm run art:models [-- --from-game]');
const node=(...args)=>run(process.execPath,args);
const npmRun=(...args)=>node(npm,...args);
const unknown=process.argv.slice(2).filter(arg=>arg!=='--from-game');
if(unknown.length)throw new Error(`Unknown option: ${unknown.join(', ')}`);
if(!process.argv.includes('--from-game'))npmRun('run','bake:passengers');
npmRun('--prefix','game','run','build');
node('tools/render-piece-elevations.mjs','--port',await freePort(),'--debug-port',await freePort());
node('tools/render-piece-views.mjs','--hero','--scale','4','--port',await freePort(),'--debug-port',await freePort());
env.PASSENGER_CAPTURE_PORT=await freePort();
env.PASSENGER_CAPTURE_DEBUG_PORT=await freePort();
node('tools/render-passenger-cards.mjs');
for(const language of ['zh-CN','en'])node('tools/render-ui-shots.mjs','--lang',language,'--sheet','07',
 '--out',language==='en'?env.UI_SHOTS_EN_DIR:env.UI_SHOTS_DIR,
 '--port',await freePort(),'--debug-port',await freePort());
node('tools/gen-art.mjs','01','02','07','12','13','--en');
env.PASSENGER_ANIMATION_PORT=await freePort();
env.PASSENGER_ANIMATION_DEBUG_PORT=await freePort();
node('tools/test-passenger-animation.mjs');
for(const sheet of ['01-isometric-cutaway','02-vertical-section','07-interface','12-platform-doors-flow','13-two-line-interchange']) {
 for(const language of ['', '-en'])node('tools/sheet-png.mjs',`${sheet}${language}.svg`,'--at','8','--port',await freePort(),'--debug-port',await freePort());
}
npmRun('--prefix','web','run','build'); // prebuild synchronises generated art.
console.log('\nUpdated model art in Chinese and English; previews: .preview/sheets/');
