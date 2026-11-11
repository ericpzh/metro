export type ZooTool = 'Inspect' | 'Floor' | 'Gate' | 'Delete'
export interface ZooSnapshot {
  tool: ZooTool
  level: number
  running: boolean
  queued: number
  boarded: number
  message: string
}
export interface UnityPlayer { SendMessage(object: string, method: string, value?: string): void }
export type ZooCommand =
  | { type: 'tool'; value: ZooTool }
  | { type: 'level'; value: number }
  | { type: 'run' | 'resetView' | 'focusService' | 'save' }
  | { type: 'open'; value: string }

type State = { ready: boolean; snapshot: ZooSnapshot | null }
let state: State = { ready: false, snapshot: null }
let player: UnityPlayer | null = null
const listeners = new Set<() => void>()
const update = (next: State): void => { state = next; listeners.forEach(listener => listener()) }
export const zooBridge = {
  subscribe(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener) },
  getSnapshot(): State { return state },
  register(instance: UnityPlayer): void { player = instance; update({ ...state, ready: true }) },
  unregister(): void { player = null; update({ ready: false, snapshot: null }) },
  receive(snapshot: ZooSnapshot): void { update({ ...state, snapshot }) },
  send(command: ZooCommand): void {
    const payload = command.type === 'level' ? { ...command, value: String(command.value) } : command
    player?.SendMessage('ZooPlayable', 'BrowserCommand', JSON.stringify(payload))
  },
}
