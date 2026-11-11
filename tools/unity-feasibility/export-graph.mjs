// Export the actual TS Tianhe graph, without rendering or derived crowd assets.
import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { referenceStation } from '../../game/src/data/reference-station.ts'
import { buildGraph } from '../../game/src/sim/station.ts'
const out = resolve(process.argv[2] ?? '.preview/unity/feasibility/graph.bytes')
const graph = buildGraph(referenceStation('tianhe'))
const n = graph.nodeCount, e = graph.adjTo.length, s = graph.servers.length
const buf = Buffer.alloc(16 + n * 12 + (n + 1) * 4 + e * 4 + s * 8)
let p = 0; for (const x of [0x4d475231,n,e,s]) { buf.writeUInt32LE(x,p); p += 4 }
for (const a of [graph.nodeX,graph.nodeY,graph.nodeZ]) for (const v of a) { buf.writeFloatLE(v,p); p += 4 }
for (const a of [graph.adjStart,graph.adjTo]) for (const v of a) { buf.writeInt32LE(v,p); p += 4 }
for (const server of graph.servers) { buf.writeInt32LE(server.node,p); p += 4; buf.writeFloatLE(server.rate,p); p += 4 }
if (p !== buf.length) throw new Error('graph byte length mismatch')
mkdirSync(dirname(out),{recursive:true}); writeFileSync(out,buf)
const summary = { fixture:'tianhe', nodes:n, edges:e, servers:s, sha256:createHash('sha256').update(buf).digest('hex') }
writeFileSync(out + '.json',JSON.stringify(summary,null,2)); console.log(summary)
