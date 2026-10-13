import {writeFileSync,renameSync,copyFileSync,unlinkSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
let sequence=0;

// Windows dev-service/antivirus readers can briefly hold an existing asset.
// Prefer atomic replacement; some Windows readers permit writes but not rename.
export async function writeAsset(destination,bytes){
 const path=destination instanceof URL?fileURLToPath(destination):destination;
 const temporary=path+`.${process.pid}.${sequence++}.tmp`;
 writeFileSync(temporary,bytes);
 for(let attempt=0;;attempt++){
  try{renameSync(temporary,path);return}catch(error){
   if(!['EPERM','EBUSY','UNKNOWN'].includes(error.code)||attempt>=120)throw error;
   if(attempt>=8){
    try{
     copyFileSync(temporary,path);
     try{unlinkSync(temporary)}catch{/* A locked temporary file can be cleaned after export. */}
     return;
    }catch(copyError){if(!['EPERM','EBUSY','UNKNOWN'].includes(copyError.code))throw copyError}
   }
   await sleep(250);
  }
 }
}
