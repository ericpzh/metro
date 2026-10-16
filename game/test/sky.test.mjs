import test from 'node:test'
import assert from 'node:assert/strict'
import { skyIntensity } from '../src/render/scene/systems/SkySystem.ts'

const HOUR = 3600

test('sky has bright days, dark nights and gradual dawn/dusk', () => {
  const noon = skyIntensity(12 * HOUR)
  const midnight = skyIntensity(0)
  assert.equal(noon, 1)
  assert.ok(midnight > 0 && midnight < noon / 20, 'cloud silhouettes remain faintly visible at night')
  assert.equal(skyIntensity(23 * HOUR), midnight)
  for (const hour of [5.25, 5.5, 6, 6.5, 6.75]) {
    assert.ok(skyIntensity((hour - .01) * HOUR) < skyIntensity(hour * HOUR), 'dawn brightens gradually')
    assert.ok(skyIntensity((hour + 12 - .01) * HOUR) > skyIntensity((hour + 12) * HOUR), 'dusk darkens gradually')
  }
})

test('sky follows SIM time across midnight, backwards seeks and multiple days', () => {
  for (const hour of [0, 5.5, 6, 12, 17.5, 18.5, 23.99]) {
    const expected = skyIntensity(hour * HOUR)
    for (const day of [-2, -1, 0, 1, 12]) {
      assert.ok(Math.abs(skyIntensity((day * 24 + hour) * HOUR) - expected) < 1e-10)
    }
  }
  const paused = skyIntensity(18 * HOUR)
  skyIntensity(12 * HOUR)
  assert.equal(skyIntensity(18 * HOUR), paused, 'seeking back restores the same sky')
  assert.equal(skyIntensity(24 * HOUR - 1), skyIntensity(24 * HOUR), 'no midnight flash')
})
