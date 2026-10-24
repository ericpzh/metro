import {audioAssetBase, getAudioVolumes, subscribeAudioVolumes} from './audioSettings.ts'
import {MUSIC_TRACKS} from './musicTracks.ts'

interface MusicState { paused: boolean; track: number; unavailable: boolean }
const KEY='metro-game.music-paused'
// The old 50% slider output is now the maximum music playback level (-6 dB).
const MUSIC_OUTPUT_SCALE=.5
function savedPause():boolean {try{return localStorage.getItem(KEY)==='true'}catch{return false}}
/** One streamed recording at a time; no full-track decode or station state. */
export class GameMusic {
  private player:HTMLAudioElement|null=null
  private mounted=0
  private unlocked=false
  private generation=0
  private unsubscribe:(()=>void)|null=null
  private listeners=new Set<()=>void>()
  private state:MusicState={paused:savedPause(),track:0,unavailable:false}
  getSnapshot=():MusicState=>this.state
  subscribe=(listener:()=>void):(()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
  private update(patch:Partial<MusicState>):void{this.state={...this.state,...patch};for(const listener of this.listeners)listener()}
  private gesture=():void=>{if(!document.hidden){this.unlocked=true;this.apply()}}
  private visibility=():void=>{if(document.hidden){this.unlocked=false;this.generation++;this.player?.pause()}}
  private apply=():void=>{
    if(this.player)this.player.volume=getAudioVolumes().master*getAudioVolumes().music*MUSIC_OUTPUT_SCALE
    if(this.state.paused||getAudioVolumes().master===0||getAudioVolumes().music===0||document.hidden||!this.unlocked||!this.mounted){this.generation++;this.player?.pause();return}
    if(!this.player){
      this.player=new Audio();this.player.preload='none'
      this.player.volume=getAudioVolumes().master*getAudioVolumes().music*MUSIC_OUTPUT_SCALE
      this.player.onended=()=>{this.update({track:(this.state.track+1)%MUSIC_TRACKS.length});this.setSource();this.apply()}
      this.player.onerror=()=>{this.generation++;this.player?.pause();this.update({unavailable:true})}
      this.setSource()
    }
    if(!this.player.paused)return
    const generation=++this.generation,player=this.player
    void player.play().then(()=>{
      if(generation!==this.generation&&(this.state.paused||document.hidden||!this.mounted||!getAudioVolumes().master||!getAudioVolumes().music))player.pause()
      else if(this.state.unavailable)this.update({unavailable:false})
    }).catch(()=>{if(generation===this.generation)this.update({unavailable:true})})
  }
  private setSource():void{if(this.player)this.player.src=new URL(audioAssetBase(location.pathname)+'music/'+MUSIC_TRACKS[this.state.track]!.file,location.origin).href}
  toggle=():void=>{
    if(this.state.unavailable)this.setSource()
    const paused=this.state.unavailable?false:!this.state.paused
    this.update({paused,unavailable:false})
    try{localStorage.setItem(KEY,String(paused))}catch{/* Keep the current session usable. */}
    this.gesture()
  }
  mount():()=>void{
    if(++this.mounted===1){window.addEventListener('pointerdown',this.gesture,true);window.addEventListener('keydown',this.gesture,true);document.addEventListener('visibilitychange',this.visibility);this.unsubscribe=subscribeAudioVolumes(this.apply)}
    return()=>{if(--this.mounted===0){this.generation++;this.unlocked=false;this.player?.pause();window.removeEventListener('pointerdown',this.gesture,true);window.removeEventListener('keydown',this.gesture,true);document.removeEventListener('visibilitychange',this.visibility);this.unsubscribe?.();this.unsubscribe=null}}
  }
}
export const gameMusic=new GameMusic()
