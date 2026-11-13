// Availability for the shared playback controls (`app/windows/topbar/SimulationControls`).
//
// The same control renders in two shells:
//
// * the ordinary browser game, where a Web Worker always runs, so nothing is bound
//   here (`boundSimulationPort()` is `null`) and every button stays enabled;
// * the Unity player, where `main.tsx` binds the live port and C# owns the clock and
//   transport. There the buttons must say what the host can honour: a Play/speed
//   control whose command the host would only drop is disabled, not optimistic.
//
// Kept out of `simulationAdapter.ts` so that module stays importable by a Node test
// with no React in the graph.
import { useEffect, useState } from 'react'
import { boundSimulationPort, simulationAvailabilityOf, type SimulationAvailability } from './simulationAdapter.ts'

const NATIVE: SimulationAvailability = { play: true, speed: true, seek: true, restart: true }

export function useSimulationAvailability(): SimulationAvailability {
  const port = boundSimulationPort()
  const [availability, setAvailability] = useState<SimulationAvailability>(() => simulationAvailabilityOf(port))
  useEffect(() => {
    if (!port) { setAvailability(NATIVE); return }
    // The port publishes on every state frame (10 Hz); only a changed answer is a
    // re-render, or the top bar would redraw on every clock tick.
    const sync = (): void => {
      const next = simulationAvailabilityOf(port)
      setAvailability(previous => previous.play === next.play && previous.speed === next.speed &&
        previous.seek === next.seek && previous.restart === next.restart ? previous : next)
    }
    sync()
    return port.subscribe(sync)
  }, [port])
  return port ? availability : NATIVE
}
