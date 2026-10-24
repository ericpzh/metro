// The six selected cues. Keep sources intact; shaping is cached after decode.
export const EFFECTS = [
 {name:'Place',icon:'＋',label:'Soft impact',file:'impactGeneric_light_000.ogg',hint:'A softer, rounded contact without the heavy thump.'},
 {name:'Pick',icon:'↥',label:'Digital pick',file:'select_002.ogg',hint:'A gentler digital cue as you lift a piece.'},
 {name:'Move',icon:'↔',label:'Set down',file:'drop_001.ogg',hint:'A lower-pitched set down on move release.'},
 {name:'Select',icon:'⌖',label:'Felt tap',file:'soft-select.wav',hint:'A quiet felt tap for repeated selections.'},
 {name:'Delete',icon:'−',label:'Soft brush',file:'soft-delete.wav',hint:'A soft wooden tap with a brushed texture as a piece leaves.'},
 {name:'Refused',icon:'×',label:'Switch click',file:'switch_001.ogg',hint:'A lower-pitched switch click for a refused action.'},
];
export const TUNING = {
 'impactGeneric_light_000.ogg':{gain:.5,lowpass:1600,highpass:160,attack:.012,release:.025,targetRms:.205},
 'select_002.ogg':{gain:.5,lowpass:2400,attack:.004,release:.008,targetRms:.115},
 'soft-select.wav':{targetRms:.23},
 'soft-delete.wav':{targetRms:.20},
 'drop_001.ogg':{rate:2**(-8/12),targetRms:.115},
 'switch_001.ogg':{rate:2**(-5/12),targetRms:.115},
};

export function shapeEffect(context, buffer, tuning) {
 if(!tuning) return buffer;
 const result=context.createBuffer(buffer.numberOfChannels,buffer.length,buffer.sampleRate);
 const dt=1/buffer.sampleRate;
 const low=tuning.lowpass ? 1-Math.exp(-2*Math.PI*tuning.lowpass*dt) : 1;
 const high=tuning.highpass ? Math.exp(-2*Math.PI*tuning.highpass*dt) : 0;
 for(let channel=0;channel<buffer.numberOfChannels;channel++){
  const input=buffer.getChannelData(channel),output=result.getChannelData(channel);
  let lp=0,hp=0,previous=0;
  for(let i=0;i<input.length;i++){
   lp+=low*(input[i]-lp);
   hp=tuning.highpass ? high*(hp+lp-previous) : lp;previous=lp;
   const attack=Math.sin(Math.min(1,i*dt/(tuning.attack||dt))*Math.PI/2)**2;
   const release=Math.sin(Math.min(1,(input.length-1-i)*dt/(tuning.release||dt))*Math.PI/2)**2;
   output[i]=hp*attack*release*(tuning.gain??1);
  }
 }
 // Match the loudest 20 ms of each short cue, rather than averaging its silence.
 // The peak ceiling keeps the level matching from restoring sharp transients.
 if(tuning.targetRms){
  const window=Math.max(1,Math.min(result.length,Math.round(.02*result.sampleRate)));
  let energy=0,maximum=0,peak=0;
  const energies=new Float64Array(result.length);
  for(let channel=0;channel<result.numberOfChannels;channel++){
   const samples=result.getChannelData(channel);
   for(let i=0;i<samples.length;i++){energies[i]+=samples[i]**2/result.numberOfChannels;peak=Math.max(peak,Math.abs(samples[i]));}
  }
  for(let i=0;i<energies.length;i++){
   energy+=energies[i];if(i>=window)energy-=energies[i-window];
   if(i>=window-1)maximum=Math.max(maximum,energy/window);
  }
  const scale=maximum>0 ? Math.min(tuning.targetRms/Math.sqrt(maximum),.5/(peak||1)) : 1;
  for(let channel=0;channel<result.numberOfChannels;channel++){
   const samples=result.getChannelData(channel);for(let i=0;i<samples.length;i++)samples[i]*=scale;
  }
 }
 return result;
}
