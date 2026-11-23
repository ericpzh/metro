import { gameAudio } from '../app/gameAudio.ts'
import { gameMusic } from '../app/gameMusic.ts'
import { getAudioVolumes } from '../app/audioSettings.ts'
import { crowdSound, type AudioSceneFrame } from '../render/audioScene.ts'
import { stationBridge } from './stationBridge.ts'

export function mountUnityAudio(): () => void {
  const unmountEffects = gameAudio.mount()
  const unmountMusic = gameMusic.mount()
  const unsubscribeCommit = stationBridge.onCommit(snapshot => {
    // Full station commits (`station.new` / `station.open` / `station.openDemo`) replace
    // the committed station document; stop active audio beds and one-shots cleanly
    // without interrupting same-station delta edits.
    if (snapshot.document && snapshot.documentRevision === snapshot.revision && !snapshot.resyncNeeded) {
      gameAudio.stop()
    }
  })
  const unsubscribe = stationBridge.onAudio(payload => {
    const cue = payload.cue
    if (cue === 'place' || cue === 'select' || cue === 'pick' || cue === 'delete' || cue === 'move' || cue === 'refused') {
      gameAudio.play(cue)
      return
    }
    const volumes = getAudioVolumes()
    if (!volumes.master || !volumes.ambient) return
    const frame = payload as unknown as AudioSceneFrame & { passengers?: number[]; sampleWeight?: number }
    if (!Array.isArray(frame.position) || !Array.isArray(frame.right) || !Array.isArray(frame.sources)) return
    if (frame.passengers?.length) {
      const crowd = crowdSound(frame.passengers, frame.passengers.length / 3, frame.position, 3, frame.sampleWeight)
      if (crowd) frame.sources.push(crowd)
    }
    gameAudio.updateScene(frame)
  })
  return () => {
    unsubscribe()
    unsubscribeCommit()
    unmountMusic()
    unmountEffects()
  }
}
