import test from 'node:test'
import assert from 'node:assert/strict'
import { AgentPool } from '../src/sim/agents.ts'
import { Rng } from '../src/sim/rng.ts'
import { WALK_PROFILES } from '../src/sim/constants.ts'
import { passengerProportions, passengerWalkProfile, passengerWalkSpeed } from '../src/sim/walking.ts'
import { PASSENGER_WALK_PROFILES, passengerFrames } from '../src/render/passengerModel.ts'

test('spawned passengers keep randomly distributed slow, medium and fast profiles', () => {
  const a=new AgentPool(new Rng(4242)),b=new AgentPool(new Rng(4242))
  const trip={origin:'a',stops:[],dest:'b'},counts=[0,0,0]
  for(let i=0;i<600;i++){
    const one=a.spawn(trip,0,0,0,0),two=b.spawn(trip,0,0,0,0)
    const profile=passengerWalkProfile(one.id)
    counts[profile]++
    assert.equal(one.speed,two.speed,'same identities retain the same profile across deterministic runs')
    assert.ok(Math.abs(one.speed/passengerProportions(one.id)[1]-WALK_PROFILES[profile].speed)<1e-10,'sim movement uses the assigned profile and physique')
  }
  for(const count of counts) assert.ok(count>150 && count<250,'each speed group occurs without alternating buffer slots')
  const survivor=a.live[1],speed=survivor.speed
  a.live[0].dead=true;a.compact()
  assert.equal(a.live[0].speed,speed,'compaction does not change the surviving walk speed')
  const recycled=a.spawn(trip,0,0,0,1)
  assert.equal(recycled.speed,passengerWalkSpeed(recycled.id),'a recycled object takes its new identity profile')
})

test('all speed profiles advance by step length at a shared natural cadence', () => {
  assert.deepEqual(WALK_PROFILES.map(p=>p.speed),[0.9,1.15,1.4])
  for(let i=0;i<3;i++){
    const profile=PASSENGER_WALK_PROFILES[i]
    assert.equal(profile.cycleSeconds,1.12,'a full left/right cycle takes 1.12 sim seconds')
    assert.ok(Math.abs(profile.stride-WALK_PROFILES[i].speed*1.12)<1e-10)
    const half=passengerFrames(profile.stride/2,0,1,undefined,i)
    assert.equal(half[0],profile.firstFrame+12)
    const seam=passengerFrames(profile.stride*0.999,0,1,undefined,i)
    assert.equal(seam[1],profile.firstFrame,'each profile wraps into its own first pose')
    assert.deepEqual(passengerFrames(profile.stride,0,1,undefined,i),passengerFrames(0,0,1,undefined,i))
  }
  for(let id=1;id<=100;id++){
    const walk=PASSENGER_WALK_PROFILES[passengerWalkProfile(id)]
    const scale=passengerProportions(id)[1]
    assert.ok(Math.abs(walk.stride*scale/passengerWalkSpeed(id)-1.12)<1e-10,'adult and child speeds match their physical stride without faster playback')
  }
})
