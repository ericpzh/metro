import type { RoutingFault } from './protocol.ts'
import { WasmRouting, type WasmRouterConstructor } from './wasmRouting.ts'

interface Bindings {
  default(options: { module_or_path: Response }): Promise<unknown>
  probe(): number
  trap_search(): void
  Router: WasmRouterConstructor
}

export async function loadWasmRouting(fault: RoutingFault | undefined): Promise<{ routing: WasmRouting; probe: number }> {
  const [bindings, binary] = await Promise.all([
    Object.values(import.meta.glob<Bindings>('../../generated/wasm/metro_routing.js'))[0]?.(),
    Object.values(import.meta.glob<string>('../../generated/wasm/metro_routing_bg.wasm',
      { query: '?url', import: 'default' }))[0]?.(),
  ])
  if (!bindings || !binary) throw new Error('WASM routing was not built')
  const url = new URL(binary, self.location.href)
  if (fault === 'missing') url.pathname += '.missing'
  const response = await fetch(url)
  if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'application/wasm') {
    throw new Error(`Could not load WASM binary (HTTP ${response.status}, ${response.headers.get('content-type')})`)
  }
  await bindings.default({ module_or_path: response })
  const probe = bindings.probe()
  if (probe !== 42) throw new Error('Unexpected WASM probe result')
  const routing = new WasmRouting(bindings.Router)
  if (fault === 'search') {
    routing.search = () => {
      bindings.trap_search()
      throw new Error('Expected WASM search to trap')
    }
  }
  return { routing, probe }
}
