import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve, dirname, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { editorTreeHash } from '../scripts/editor-benchmark-build.ts'

test('build and browser audit share a canonical cross-platform fingerprint and detect edited input',t=>{
  const dir=mkdtempSync(join(tmpdir(),'metro-editor-hash-'))
  assert.equal(dirname(resolve(dir)),resolve(tmpdir()))
  assert.ok(basename(dir).startsWith('metro-editor-hash-'))
  t.after(()=>rmSync(dir,{recursive:true,force:true}))
  mkdirSync(join(dir,'nested'))
  writeFileSync(join(dir,'nested','b.txt'),'beta')
  writeFileSync(join(dir,'a.txt'),'alpha')
  const hash=value=>createHash('sha256').update(value).digest('hex')
  const expected=hash(`a.txt ${hash('alpha')}\nnested/b.txt ${hash('beta')}`)
  assert.equal(editorTreeHash(dir),expected,'paths use forward slashes and entries use real LF separators on Windows too')
  writeFileSync(join(dir,'nested','b.txt'),'changed')
  assert.notEqual(editorTreeHash(dir),expected,'a stale bundle cannot claim the edited source')
})
