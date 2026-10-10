import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createToolSlice } from '../src/app/store/slices/ToolSlice.ts'

function toolSlice() {
  let state
  const set = (update) => {
    state = { ...state, ...(typeof update === 'function' ? update(state) : update) }
  }
  state = createToolSlice(set, () => state, {})
  return () => state
}

test('B, P and M shortcuts toggle back to the most recently active tool', () => {
  const state = toolSlice()
  assert.equal(state().tool, 'select')
  assert.equal(state().previousTool, 'select')

  state().setTool('delete')
  assert.equal(state().previousTool, 'select')
  state().setTool(state().previousTool)
  assert.equal(state().tool, 'select', 'B cancels back to the tool that preceded delete')

  state().setTool('wall')
  state().setTool('pick')
  assert.equal(state().previousTool, 'wall')
  state().setTool(state().previousTool)
  assert.equal(state().tool, 'wall', 'P cancels back to the tool that preceded pick')

  state().setTool('move')
  assert.equal(state().previousTool, 'wall')
  state().setTool(state().previousTool)
  assert.equal(state().tool, 'wall', 'M cancels back to the tool that preceded move')
})

test('B, P and M keyboard handlers toggle the active tool to its remembered predecessor', () => {
  const shell = fs.readFileSync(new URL('../src/app/windows/AppShell.tsx', import.meta.url), 'utf8')
  assert.match(shell, /case 'b':[\s\S]{0,80}st\.setTool\(st\.tool === 'delete' \? st\.previousTool : 'delete'\)/)
  assert.match(shell, /case 'p':[\s\S]{0,80}st\.setTool\(st\.tool === 'pick' \? st\.previousTool : 'pick'\)/)
  assert.match(shell, /case 'm':[\s\S]{0,80}st\.setTool\(st\.tool === 'move' \? st\.previousTool : 'move'\)/)
})
