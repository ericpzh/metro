import * as THREE from '../../game/node_modules/three/build/three.module.js'
import { GLTFExporter } from '../../game/node_modules/three/examples/jsm/exporters/GLTFExporter.js'
import { createModelMaterials } from '../../game/src/render/models/PieceBuilder.ts'
import { buildTrain, setDoorsSides } from '../../game/src/render/models/pieces/TrainModel.ts'
import { Rng } from '../../game/src/sim/rng.ts'

export async function exportTypeA() {
  // Two cars exercise both cab ends, a gangway and two powered roof assemblies.
  const cars = 2
  // The brushed-steel canvas samples random strokes during material creation.
  // Scope the seed to that synchronous call so repeat exports match byte for byte.
  const random = Math.random
  const textureRng = new Rng(1)
  let mats
  try {
    Math.random = () => textureRng.next()
    mats = createModelMaterials()
  } finally {
    Math.random = random
  }
  const train = buildTrain(mats, {
    x: 0, y: 0, z: 0, yaw: 0, stock: 'A', cars, power: 'catenary',
    doorsOpen: false, colour: '#c8102e', dirSign: 1,
  })
  const leaves = train.userData.doors
  const doors = leaves.map((mesh, i) => {
    mesh.name = `TypeADoor${String(i).padStart(2, '0')}`
    return { name: mesh.name, side: mesh.userData.side, samples: [] }
  })
  for (const [plus, minus] of [[0, 0], [0.18, 0], [1, 0], [0, 0.18], [0, 1]]) {
    setDoorsSides(train, plus, minus)
    leaves.forEach((mesh, i) => doors[i].samples.push({ position: mesh.position.toArray() }))
  }
  setDoorsSides(train, 0, 0)
  const bounds = new THREE.Box3().setFromObject(train)
  const names = new Map(Object.entries(mats).map(([name, material]) => [material, name]))
  names.set(train.userData.liveryMaterial, 'lineLivery')
  const materials = new Map()
  let meshes = 0
  train.traverse(object => {
    object.userData = {}
    if (!object.isMesh) return
    meshes++
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      material.name = names.get(material) ?? `trainMaterial${materials.size}`
      if (materials.has(material)) continue
      materials.set(material, material.name)
    }
  })
  const root = new THREE.Group()
  root.name = 'Type A'
  root.rotation.x = -Math.PI / 2
  root.add(train)
  const clips = [[1, 'OpenPlus', 1], [-1, 'OpenMinus', 3]].map(([side, name, start]) =>
    new THREE.AnimationClip(name, 1, doors.filter(door => door.side === side).map(door =>
      new THREE.VectorKeyframeTrack(`${door.name}.position`, [0, 0.18, 1],
        [door.samples[0], ...door.samples.slice(start, start + 2)].flatMap(sample => sample.position)))))
  const bytes = await new GLTFExporter().parseAsync(root, { binary: true, animations: clips })
  return {
    bytes: new Uint8Array(bytes),
    manifest: {
      schemaVersion: 1,
      id: 'train.A.two-car.catenary', cars, meshes, doors,
      source: 'game/src/render/models/pieces/TrainModel.ts',
      provenance: 'Repository procedural Type A geometry, palette, and canvas generators',
      units: 'metres',
      min: bounds.min.toArray(), max: bounds.max.toArray(),
    },
  }
}
