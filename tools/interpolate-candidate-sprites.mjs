// Offline motion interpolation of aligned 16-frame candidate studies.
// RIFE_NCNN_HOME must point to the unpacked official RIFE ncnn Vulkan release.
import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
const home=process.env.RIFE_NCNN_HOME??resolve('.preview/rife/rife-ncnn-vulkan-20221029-windows');
const executable=join(home,process.platform==='win32'?'rife-ncnn-vulkan.exe':'rife-ncnn-vulkan'),model=join(home,'rife-v4.6');
function run(command,args){const result=spawnSync(command,args,{stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)throw Error(`${command} failed (${result.status})`)}
const count=16,allViews=[[0,'normal'],[2,'normal'],[4,'normal'],[8,'normal'],[2,'low'],[2,'high']];
const selected=process.argv[2],views=selected?allViews.filter(([angle,elevation])=>`${angle}-${elevation}`===selected):allViews;
if(!views.length)throw Error(`Unknown view: ${selected}`);
for(const [angle,elevation] of views){
 const id=`${angle}-${elevation}`,input=resolve('.preview/human-candidates/sprite-frames',id),work=resolve('.preview/rife/work',id);
 const ci=join(work,'color-input'),ai=join(work,'alpha-input'),co=join(work,'color-output'),ao=join(work,'alpha-output');for(const path of [ci,ai,co,ao])mkdirSync(path,{recursive:true});
 const source=join(input,'%03d.png');
 run('ffmpeg',['-hide_banner','-loglevel','error','-y','-start_number','0','-i',source,'-frames:v',String(count+1),'-vf','format=rgb24','-start_number','0',join(ci,'%03d.png')]);
 run('ffmpeg',['-hide_banner','-loglevel','error','-y','-start_number','0','-i',source,'-frames:v',String(count+1),'-vf','alphaextract','-start_number','0',join(ai,'%03d.png')]);
 for(const [a,b] of [[ci,co],[ai,ao]])run(executable,['-i',a,'-o',b,'-n',String(count*2+1),'-m',model,'-g','0']);
 const target=resolve(`model/public/human-candidates/animation-studies/valid-Asian_F_3_Casual-walk-rife32-${id}.png`);
 run('ffmpeg',['-hide_banner','-loglevel','error','-y','-framerate','30','-start_number','1','-i',join(co,'%08d.png'),'-framerate','30','-start_number','1','-i',join(ao,'%08d.png'),'-filter_complex',`[1:v]format=gray[a];[0:v][a]alphamerge,tile=8x${count/4}`,'-frames:v','1','-update','1',target]);
 console.log(target);
}
