// The Unity host's time bridge (plan 11 · C4).
//
// C# owns the simulation — the committed document, the clock and the service
// actors. React is UI. This module is the one place the Unity clock snapshot
// becomes React state, so the shell never invents a time, and the one place a
// time control becomes a `sim.*` command, so a control the host cannot honour
// renders unavailable instead of pretending.
//
// **Two numbers, never one.** `payload.clock.simTimeSeconds` is seconds since the
// station's day zero (06:30 at cold boot); the C# tick counter is diagnostic and
// never reaches a clock reader. `TimePanel`/`ClockCard` keep reading
// `metrics?.simTime ?? unityClock` from `sim/clock.ts`, and the TS app never sets
// `unityClock`, so the ordinary browser game is untouched by this file.
//
// The transport (the v2 bridge envelope, `SendMessage`/`metro:state`) is the
// lead's; this module only needs a `send` function and the `payload` shapes:
//
//   C# state reply       -> port.receiveClock(payload.clock)
//   sim.play   {playing:boolean}
//   sim.speed  {speed:number}
//   sim.seek   {simTimeSeconds:number}
//   sim.restart {}
//
// A `sim.*` command is session-scoped: no `expectedRevision`, no document edit,
// and a rejection never changes the committed revision. Because a paused station
// produces no frames of its own, the host should publish one `state` reply after
// applying any `sim.*` command.
import { timeOfDayOf } from '../sim/constants.ts'
import { simTimeAtDate, type SimDate } from '../sim/clock.ts'

/** The clock object C# publishes as `payload.clock` (`StationSimulationSession.ClockPayloadJson`). */
export interface UnityClock {
    /** Seconds since the station's day zero — never a tick count. */
    simTimeSeconds: number
    /** Whole simulated days since the calendar epoch: 0 on the station's first day. */
    dayIndex: number
    playing: boolean
    /** 1, 4, 16 or 64. */
    speed: number
    /** Inside the station's authored operating hours at this instant. */
    serviceOpen: boolean
    /** The timetable is in a 高峰 window (and the day runs peaks at all). */
    peak: boolean
    period?: 'peak' | 'offpeak' | 'late'
    dateKey?: string
    weekday?: number
    dayType?: 'workday' | 'offday'
    timeOfDaySeconds?: number
    dayFraction?: number
    /** `HH:MM` / `HH:MM:SS`, already formatted by C# from the same instant. */
    clock?: string
    clockSeconds?: string
    hourHandDegrees?: number
    minuteHandDegrees?: number
    tick?: number
    service?: { from: number; to: number }
    peaks?: Array<{ from: number; to: number }>
    /** The authored demand multiplier at this instant (not a measured crowd). */
    demandRate?: number
}

/** What this build of the Unity session publishes. False means: do not bind a control. */
export interface UnitySimulationCapabilities {
    clock: boolean
    play: boolean
    speed: boolean
    seek: boolean
    restart: boolean
    /** The session can apply an authored-day edit; the *document* commit is the host's. */
    serviceWindow: boolean
    trains: boolean
    doors: boolean
    escalators: boolean
    lifts: boolean
    /** Crowd-scale state is not ported yet: queues/boarding must stay visibly unavailable. */
    crowd: boolean
    gates: boolean
    queues: boolean
    boarding: boolean
}

/** A whole `kind:"state"` payload, as far as time is concerned. */
export interface UnitySimulationFrame {
    clock: UnityClock
    capabilities?: UnitySimulationCapabilities
    /** Services are published by stable document id; this adapter does not map them into metrics. */
    services?: unknown
}

/** The controls this module can route. */
export type SimulationAction = 'play' | 'speed' | 'seek' | 'restart' | 'serviceWindow' | 'peakWindow' | 'demand'

export type SimulationCommandType = 'sim.play' | 'sim.speed' | 'sim.seek' | 'sim.restart'

export interface SimulationCommand {
    type: SimulationCommandType
    payload: { playing?: boolean; speed?: number; simTimeSeconds?: number }
}

/** The one transport dependency: send one command envelope. */
export interface SimulationTransport {
    send(command: SimulationCommand): void
}

/** Every speed the source runs at (TopBar's 1× 4× 16× 64×). */
export const SIMULATION_SPEEDS: readonly number[] = [1, 4, 16, 64]

export interface SimulationPortState {
    connected: boolean
    clock: UnityClock | null
    capabilities: UnitySimulationCapabilities
    /** The last command the port sent, for ack correlation in the shell. */
    lastCommand: SimulationCommand | null
}

export interface SimulationPort {
    subscribe(listener: () => void): () => void
    getState(): SimulationPortState
    /** Feed the `payload.clock` of a `state` reply. */
    receiveClock(clock: UnityClock, capabilities?: UnitySimulationCapabilities): void
    /** Feed a whole `kind:"state"` payload. */
    receiveFrame(frame: UnitySimulationFrame): void
    /** Mark the session gone (a failed load, a closed player): controls must disable. */
    disconnect(): void
    send(command: SimulationCommand): boolean
    /** Why `action` cannot be driven by this host, or null when it can. */
    unavailableReason(action: SimulationAction): string | null
}

/**
 * Nothing is available before the first state reply, and the crowd-scale and
 * document-edit capabilities stay off until the host says otherwise: a station
 * with no connector has no clock to print, and a service/peak edit has to be
 * committed through the document transaction, not through a session command.
 */
export const NO_CAPABILITIES: UnitySimulationCapabilities = {
    clock: false, play: false, speed: false, seek: false, restart: false, serviceWindow: false,
    trains: false, doors: false, escalators: false, lifts: false,
    crowd: false, gates: false, queues: false, boarding: false,
}

/** Create the external store the shell subscribes to (same shape as `zooBridge`). */
export function createSimulationPort(transport: SimulationTransport, options: {
    /** Set only when the host wires the committed authored-day edit path (A's transaction). */
    hostCommitsDayEdits?: boolean
} = {}): SimulationPort {
    let state: SimulationPortState = {
        connected: false, clock: null, capabilities: { ...NO_CAPABILITIES }, lastCommand: null,
    }
    const listeners = new Set<() => void>()
    const update = (next: Partial<SimulationPortState>): void => {
        state = { ...state, ...next }
        listeners.forEach((listener) => listener())
    }

    const port: SimulationPort = {
        subscribe(listener) {
            listeners.add(listener)
            return () => { listeners.delete(listener) }
        },
        getState: () => state,
        receiveClock(clock, capabilities) {
            if (clock === null || clock === undefined || !Number.isFinite(clock.simTimeSeconds)) return
            update({
                connected: true,
                clock,
                capabilities: capabilities ?? state.capabilities,
            })
        },
        receiveFrame(frame) {
            if (!frame || !frame.clock) return
            port.receiveClock(frame.clock, frame.capabilities)
        },
        disconnect() {
            update({ connected: false, clock: null, capabilities: { ...NO_CAPABILITIES } })
        },
        send(command) {
            if (!state.connected) return false
            transport.send(command)
            update({ lastCommand: command })
            return true
        },
        unavailableReason(action) {
            const caps = state.capabilities
            if (!state.connected) return 'no-session'
            switch (action) {
                case 'play': return caps.play ? null : 'play-unavailable'
                case 'speed': return caps.speed ? null : 'speed-unavailable'
                case 'seek': return caps.seek ? null : 'seek-unavailable'
                case 'restart': return caps.restart ? null : 'restart-unavailable'
                // The session can apply an authored day, but the document edit has to be
                // committed and serialized through the host before the UI may offer it.
                case 'serviceWindow':
                case 'peakWindow':
                case 'demand': return caps.serviceWindow && options.hostCommitsDayEdits ? null : 'day-edit-unavailable'
                default: return 'unsupported-action'
            }
        },
    }
    return port
}

/* ------------------------------------------------------------- store mapping */

/** The narrow slice of a zustand store this adapter reads and writes. */
export interface SimulationStoreState {
    playing: boolean
    speed: number
    unityClock?: number | null
    station: { calendar: { epoch: SimDate } }
    metrics?: { simTime: number } | null
}
export interface SimulationStore<T extends SimulationStoreState> {
    getState(): T
    setState(partial: Partial<T>): void
    subscribe?(listener: (state: T, previous: T) => void): () => void
}

/**
 * Write one Unity clock snapshot into the shell: `playing`/`speed` are the C#'s
 * own values (authoritative, never optimistic), and `simTimeSeconds` becomes the
 * store's `unityClock` — the fallback `TimePanel`/`ClockCard` read after
 * `metrics?.simTime`. No other field is touched: a clock reply must not populate
 * population, queues or any other metric, because C# has not measured them.
 */
export function applyUnityClock<T extends SimulationStoreState>(store: SimulationStore<T>, clock: UnityClock, options: {
    /** Time controls this host does not implement keep their last value and render disabled. */
    applyPlaying?: boolean
    applySpeed?: boolean
} = {}): void {
    if (!Number.isFinite(clock.simTimeSeconds)) return
    const partial: Partial<T> = { unityClock: clock.simTimeSeconds } as Partial<T>
    if (options.applyPlaying !== false) partial.playing = clock.playing
    if (options.applySpeed !== false) partial.speed = clock.speed
    store.setState(partial)
}

/**
 * The store actions the Unity host replaces, so a click becomes a `sim.*` command
 * instead of the TS worker message. The shell installs these in its bootstrap
 * (`useStore.setState({ setPlaying, setSpeed, restartSim, seekToDate })`); a
 * command the host cannot honour is dropped, and the control is expected to have
 * rendered unavailable from `port.unavailableReason`.
 */
export function simulationStoreActions<T extends SimulationStoreState>(port: SimulationPort, store: SimulationStore<T>): {
    setPlaying: (on: boolean) => void
    setSpeed: (speed: number) => void
    restartSim: () => void
    seekToDate: (date: SimDate) => void
} {
    return {
        setPlaying(on) {
            if (port.unavailableReason('play') !== null) return
            port.send({ type: 'sim.play', payload: { playing: on } })
        },
        setSpeed(speed) {
            if (port.unavailableReason('speed') !== null) return
            if (!SIMULATION_SPEEDS.includes(speed)) return
            port.send({ type: 'sim.speed', payload: { speed } })
        },
        restartSim() {
            if (port.unavailableReason('restart') !== null) return
            port.send({ type: 'sim.restart', payload: {} })
        },
        seekToDate(date) {
            if (port.unavailableReason('seek') !== null) return
            const state = store.getState()
            // The time of day is kept, so picking a date asks "run this day", not
            // "start it at midnight" — the same rule the TS `SimSlice.seekToDate` applies.
            const timeOfDay = state.unityClock ?? state.metrics?.simTime ?? 0
            const simTimeSeconds = simTimeAtDate(date, state.station.calendar.epoch, timeOfDayOf(timeOfDay))
            port.send({ type: 'sim.seek', payload: { simTimeSeconds } })
        },
    }
}

/**
 * The clock a panel should print: the TS run's own `metrics.simTime` when the
 * browser worker is running, else the Unity session's `unityClock`, else null
 * (print `--:--:--`, never 0:00). Pure, so the selector can be tested without a
 * store; `TimePanel`/`ClockCard` use `s.metrics?.simTime ?? s.unityClock ?? null`.
 */
export function stationClockOf(state: { metrics?: { simTime: number } | null; unityClock?: number | null }): number | null {
    if (state.metrics && Number.isFinite(state.metrics.simTime)) return state.metrics.simTime
    if (typeof state.unityClock === 'number' && Number.isFinite(state.unityClock)) return state.unityClock
    return null
}

/**
 * The window a day-bar draws, from the Unity clock when it carries one, else from
 * the committed document. `null` fields mean "this host did not publish it".
 */
export function serviceWindowOf(clock: UnityClock | null, fallback: { service: { from: number; to: number }; peaks: ReadonlyArray<{ from: number; to: number }> }): {
    service: { from: number; to: number }
    peaks: Array<{ from: number; to: number }>
} {
    if (clock?.service) {
        return { service: clock.service, peaks: clock.peaks ?? fallback.peaks.map((peak) => ({ ...peak })) }
    }
    return { service: fallback.service, peaks: fallback.peaks.map((peak) => ({ ...peak })) }
}
