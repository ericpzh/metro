import { getAudioVolumes, subscribeAudioVolumes, audioAssetBase } from './audioSettings.ts'
import { sourceMix } from '../render/audioScene.ts'
import type { AudioSceneFrame, AmbientKind } from '../render/audioScene.ts'
import type { ToolSound } from './audioActions.ts'

interface Voice {source:AudioBufferSourceNode;gain:GainNode;pan:StereoPannerNode}
export class GameAudio {
  private context:AudioContext|null=null
  private effects:GainNode|null=null
  private ambient:GainNode|null=null
  private cache=new Map<string,Promise<AudioBuffer>>()
  private voices=new Set<Voice>()
  private beds=new Map<AmbientKind,Voice>()
  private loading=new Set<AmbientKind>()
  private frame:AudioSceneFrame|null=null
  private lastEffect=-Infinity
  private epoch=0
  private mounted=0
  private unsubscribe:(()=>void)|null=null
  private readonly unlock=():void=>{
    if(document.hidden)return
    try {
      if(!this.context){
        this.context=new AudioContext()
        const limiter=this.context.createDynamicsCompressor();limiter.threshold.value=-12;limiter.ratio.value=8;limiter.connect(this.context.destination)
        this.effects=this.context.createGain();this.ambient=this.context.createGain()
        this.effects.connect(limiter);this.ambient.connect(limiter);this.apply()
      }
      void this.context.resume().then(()=>{
        // Decode the small interaction set once, outside tool event work.
        if(getAudioVolumes().effects>0) for(const name of ['place','pick','move','select','delete','refused'])void this.load(`${name}.wav`).catch(()=>{})
      }).catch(()=>{})
    }catch{ /* Audio must never block construction on unsupported devices. */ }
  }
  private readonly visibility=():void=>{
    if(document.hidden){this.stop();void this.context?.suspend()}
    // Resume only on the next real gesture, respecting browser autoplay policy.
  }
  private apply():void {
    if(!this.context)return
    const values=getAudioVolumes(),now=this.context.currentTime
    this.effects?.gain.setTargetAtTime(values.master*values.effects,now,.025)
    this.ambient?.gain.setTargetAtTime(values.master*values.ambient,now,.05)
    if(values.master===0||values.ambient===0)this.stopBeds()
    if(values.master===0||values.effects===0)for(const voice of [...this.voices])if(!voice.source.loop)voice.source.stop()
  }
  mount():()=>void {
    if(++this.mounted===1){
      window.addEventListener('pointerdown',this.unlock,true);window.addEventListener('keydown',this.unlock,true)
      document.addEventListener('visibilitychange',this.visibility)
      this.unsubscribe=subscribeAudioVolumes(()=>this.apply())
    }
    return ()=>{if(--this.mounted===0){
      window.removeEventListener('pointerdown',this.unlock,true);window.removeEventListener('keydown',this.unlock,true)
      document.removeEventListener('visibilitychange',this.visibility);this.unsubscribe?.();this.unsubscribe=null
      this.stop();this.frame=null
    }}
  }
  private load(file:string):Promise<AudioBuffer>{
    if(!this.cache.has(file)){
      const context=this.context!
      const pending=fetch(new URL(audioAssetBase(location.pathname)+file,location.origin)).then(response=>{
        if(!response.ok)throw Error(`Audio ${response.status}`)
        return response.arrayBuffer()
      }).then(bytes=>context.decodeAudioData(bytes)).catch(error=>{this.cache.delete(file);throw error})
      this.cache.set(file,pending)
    }
    return this.cache.get(file)!
  }
  private voice(buffer:AudioBuffer,bus:GainNode,loop:boolean):Voice{
    const context=this.context!,source=context.createBufferSource(),gain=context.createGain(),pan=context.createStereoPanner()
    source.buffer=buffer;source.loop=loop;gain.gain.value=loop?0:.8
    source.connect(gain).connect(pan).connect(bus)
    const voice={source,gain,pan};this.voices.add(voice)
    source.onended=()=>{this.voices.delete(voice);source.disconnect();gain.disconnect();pan.disconnect()}
    source.start();return voice
  }
  play(kind:ToolSound):void{
    if(!this.context || document.hidden || !getAudioVolumes().master || !getAudioVolumes().effects)return
    const now=performance.now()
    if(now-this.lastEffect<65)return
    this.lastEffect=now
    const epoch=this.epoch
    void this.load(`${kind}.wav`).then(buffer=>{
      if(epoch!==this.epoch || document.hidden || !getAudioVolumes().master || !getAudioVolumes().effects || this.voices.size-this.beds.size>=8)return
      this.voice(buffer,this.effects!,false)
    }).catch(()=>{})
  }
  updateScene(frame:AudioSceneFrame):void{
    this.frame=frame
    if(!this.context || this.context.state!=='running' || document.hidden || !getAudioVolumes().master || !getAudioVolumes().ambient)return
    const epoch=this.epoch
    for(const kind of ['crowd','train','traffic'] as const){
      if(kind==='train' && (frame.speed??1)>1){
        this.beds.get(kind)?.source.stop();this.beds.delete(kind)
        continue
      }
      const source=frame.sources.find(s=>s.kind===kind),mix=source?sourceMix(frame.position,frame.right,source):{gain:0,pan:0}
      const voice=this.beds.get(kind)
      if(voice){
        voice.source.playbackRate.setTargetAtTime(kind==='crowd'?Math.min(2,frame.speed??1):1,this.context.currentTime,.02)
        voice.gain.gain.setTargetAtTime(mix.gain,this.context.currentTime,kind==='train'?.025:.15)
        voice.pan.pan.setTargetAtTime(mix.pan,this.context.currentTime,.08)
      }
      else if(mix.gain>.005 && !this.loading.has(kind)){
        this.loading.add(kind)
        void this.load(`${kind}.mp3`).then(buffer=>{
          if(epoch!==this.epoch || document.hidden || !getAudioVolumes().master || !getAudioVolumes().ambient)return
          const latest=this.frame,source=latest?.sources.find(s=>s.kind===kind)
          if(kind==='train' && (latest?.speed??1)>1)return
          if(!latest || !source || sourceMix(latest.position,latest.right,source).gain<=.005)return
          const voice=this.voice(buffer,this.ambient!,true)
          voice.source.playbackRate.value=kind==='crowd'?Math.min(2,latest.speed??1):1
          this.beds.set(kind,voice)
        }).catch(()=>{}).finally(()=>{this.loading.delete(kind)})
      }
    }
  }
  private stopBeds():void{this.epoch++;for(const voice of this.beds.values())voice.source.stop();this.beds.clear()}
  stop():void{this.epoch++;for(const voice of this.voices)voice.source.stop();this.voices.clear();this.beds.clear()}
}
export const gameAudio=new GameAudio()
