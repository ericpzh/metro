import {DEFAULT_MIX} from './spatial.js';
import {TUNING,shapeEffect} from './effects.js';
import {AmbientVoice} from './ambient.js';
export class SoundEngine {
 constructor() { this.epoch=0; this.buffers=new Map(); this.pending=new Map(); this.voices=new Set(); this.loops=new Map(); }
 async enable(mix) {
  if (!this.context) {
   this.context=new AudioContext();
   this.limiter=this.context.createDynamicsCompressor();
   this.limiter.threshold.value=-12; this.limiter.ratio.value=8;
   this.limiter.connect(this.context.destination);
   this.buses={};
   for(const key of Object.keys(DEFAULT_MIX)) this.buses[key]=this.context.createGain();
   this.buses.master.connect(this.limiter);
   this.buses.effects.connect(this.buses.master); this.buses.ambience.connect(this.buses.master);
   for(const key of ['crowd','train','traffic']) this.buses[key].connect(this.buses.ambience);
  }
  this.apply(mix);
  await this.context.resume();
 }
 apply(mix) {
  if(!this.context) return;
  for(const [key, value] of Object.entries(mix)) this.buses[key].gain.setTargetAtTime(value.enabled?value.volume:0,this.context.currentTime,.025);
 }
 load(file) {
  if(this.buffers.has(file)) return Promise.resolve(this.buffers.get(file));
  if(!this.pending.has(file)) this.pending.set(file,(async()=>{
   try {
    const response=await fetch(new URL(`./sounds/${file}`, document.baseURI));
    if(!response.ok) throw new Error(`Could not load ${file} (${response.status})`);
    const decoded=await this.context.decodeAudioData(await response.arrayBuffer());
    const buffer=shapeEffect(this.context,decoded,TUNING[file]);
    this.buffers.set(file,buffer); return buffer;
   } finally {this.pending.delete(file);}
  })());
  return this.pending.get(file);
 }
 async play(file, bus='effects', {loop=false, epoch=this.epoch, gain=.8}={}) {
  const buffer=await this.load(file);
  if(epoch!==this.epoch) return null;
  // Bound one-shot overlap; loops use three separate, retained source nodes.
  if(!loop && [...this.voices].filter(v=>!v.loop).length>=8) return null;
  const source=this.context.createBufferSource(), level=this.context.createGain(), pan=this.context.createStereoPanner();
  source.buffer=buffer; source.loop=loop; level.gain.value=gain;
  if(TUNING[file]?.rate) source.playbackRate.value=TUNING[file].rate;
  source.connect(level).connect(pan).connect(this.buses[bus]);
  const voice={source, level, pan, loop}; this.voices.add(voice);
  source.onended=()=>{this.voices.delete(voice); source.disconnect();level.disconnect();pan.disconnect();};
  source.start(); return voice;
 }
 stop() {
  this.epoch=(this.epoch??0)+1;
  for(const voice of this.loops.values())voice.stop();
  for(const voice of this.voices) voice.source.stop();
  this.voices.clear();this.loops.clear();
 }
 async ambient(file,bus,policy){
  const epoch=this.epoch,buffer=await this.load(file);
  if(epoch!==this.epoch)return null;
  const voice=new AmbientVoice(this.context,buffer,this.buses[bus],policy);
  this.loops.get(bus)?.stop();this.loops.set(bus,voice);return voice;
 }
}
