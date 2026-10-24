import type {AmbientKind} from '../render/audioScene.ts'

export interface AmbientPlaybackPolicy {mode:'loop'|'skip'|'mute';rate:number;speed:number}
/** Approved sound-studio choices; shared by the game and the preview defaults. */
export function ambientTactic(kind:AmbientKind,speed:number):'natural'|'rate'|'skip'{
  if(kind==='crowd')return 'natural'
  if(kind==='train')return speed>1?'skip':'natural'
  return speed>=16?'skip':'rate'
}
export function gameAmbientPolicy(kind:AmbientKind,speed=1):AmbientPlaybackPolicy{
  const tactic=ambientTactic(kind,speed)
  return {mode:tactic==='skip'?'skip':'loop',rate:tactic==='rate'?speed:1,speed}
}

const SLICE=.12,FADE=.015,HOP=SLICE-FADE
/** Shared audition/game player: one spatial bus and at most three live grains.
 * Missed slices are discarded after a slow frame, never replayed as a backlog. */
export class AmbientVoice {
  readonly level:GainNode
  readonly pan:StereoPannerNode
  readonly nodes=new Set<AudioBufferSourceNode>()
  private context:AudioContext
  private buffer:AudioBuffer
  private stopped=false
  private key:string|null=null
  private policy!:AmbientPlaybackPolicy
  private origin=0
  private next=0
  constructor(context:AudioContext,buffer:AudioBuffer,bus:AudioNode,policy:AmbientPlaybackPolicy){
    this.context=context;this.buffer=buffer
    this.level=context.createGain();this.pan=context.createStereoPanner()
    this.level.gain.value=0;this.level.connect(this.pan).connect(bus)
    this.setPolicy(policy)
  }
  setPolicy(policy:AmbientPlaybackPolicy):void{
    const key=`${policy.mode}/${policy.rate}/${policy.mode==='skip'?policy.speed:1}`
    if(this.stopped||key===this.key)return
    this.clear();this.key=key;this.policy=policy;this.origin=this.context.currentTime;this.next=this.origin
    if(policy.mode==='loop'){
      const source=this.makeSource();source.loop=true;source.playbackRate.value=policy.rate
      source.connect(this.level);source.start()
    }else if(policy.mode==='skip')this.tick()
  }
  private makeSource():AudioBufferSourceNode{
    const source=this.context.createBufferSource();source.buffer=this.buffer;this.nodes.add(source)
    source.onended=()=>{this.nodes.delete(source);source.disconnect()}
    return source
  }
  tick():void{
    if(this.stopped||this.policy.mode!=='skip')return
    const now=this.context.currentTime
    if(this.next<now)this.next=now
    for(let count=0;this.next<now+.12&&count<3;count++,this.next+=HOP){
      const when=this.next,offset=((when-this.origin)*this.policy.speed)%this.buffer.duration
      const source=this.makeSource(),envelope=this.context.createGain()
      // Wrap only when this 120 ms slice crosses the recording's end.
      source.loop=true;source.playbackRate.value=1;source.connect(envelope).connect(this.level)
      envelope.gain.setValueAtTime(0,when);envelope.gain.linearRampToValueAtTime(1,when+FADE)
      envelope.gain.setValueAtTime(1,when+SLICE-FADE);envelope.gain.linearRampToValueAtTime(0,when+SLICE)
      source.onended=()=>{this.nodes.delete(source);source.disconnect();envelope.disconnect()}
      source.start(when,offset);source.stop(when+SLICE)
    }
  }
  private clear():void{for(const source of [...this.nodes])source.stop();this.nodes.clear()}
  replay():void{if(this.stopped)return;this.key=null;this.setPolicy(this.policy)}
  stop():void{if(this.stopped)return;this.stopped=true;this.clear();this.level.disconnect();this.pan.disconnect()}
}
