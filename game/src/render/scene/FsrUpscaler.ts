import * as THREE from 'three'
import type { UpscalingMode } from '../upscaling.ts'
import { UPSCALING_SCALE } from '../upscaling.ts'
import easuSource from '../shaders/fsr-easu.glsl?raw'
import rcasSource from '../shaders/fsr-rcas.glsl?raw'

/** FSR 1's spatial EASU + RCAS passes. The scene target is multisampled so
 * thin rails and signs have anti-aliased input before the upscale. */
export class FsrUpscaler {
  private readonly renderer: THREE.WebGLRenderer
  private mode: UpscalingMode = 'native'
  private sceneTarget: THREE.WebGLRenderTarget | null = null
  private easuTarget: THREE.WebGLRenderTarget | null = null
  private readonly size = new THREE.Vector2()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly geometry = new THREE.PlaneGeometry(2, 2)
  private readonly easuMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    depthTest: false,
    depthWrite: false,
    uniforms: { iResolution: { value: new THREE.Vector2() }, inputSize: { value: new THREE.Vector2() }, iChannel0: { value: null } },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: easuSource,
  })
  private readonly rcasMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    depthTest: false,
    depthWrite: false,
    uniforms: { iResolution: { value: new THREE.Vector2() }, sharpness: { value: 0.2 }, iChannel0: { value: null } },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: rcasSource,
  })
  private readonly easuScene = new THREE.Scene()
  private readonly rcasScene = new THREE.Scene()

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer
    this.easuScene.add(new THREE.Mesh(this.geometry, this.easuMaterial))
    this.rcasScene.add(new THREE.Mesh(this.geometry, this.rcasMaterial))
  }

  setMode(mode: UpscalingMode): void {
    if (this.mode === mode) return
    this.mode = mode
    this.releaseTargets()
  }

  render(drawScene: () => void): void {
    if (this.mode === 'native') { drawScene(); return }
    this.renderer.getDrawingBufferSize(this.size)
    const width = Math.max(1, Math.round(this.size.x * UPSCALING_SCALE[this.mode]))
    const height = Math.max(1, Math.round(this.size.y * UPSCALING_SCALE[this.mode]))
    if (!this.sceneTarget || this.sceneTarget.width !== width || this.sceneTarget.height !== height ||
        !this.easuTarget || this.easuTarget.width !== this.size.x || this.easuTarget.height !== this.size.y) {
      this.releaseTargets()
      this.sceneTarget = new THREE.WebGLRenderTarget(width, height, { depthBuffer: true, samples: 4 })
      this.easuTarget = new THREE.WebGLRenderTarget(this.size.x, this.size.y, { depthBuffer: false })
      this.sceneTarget.texture.minFilter = this.sceneTarget.texture.magFilter = THREE.NearestFilter
      this.easuTarget.texture.minFilter = this.easuTarget.texture.magFilter = THREE.NearestFilter
      this.sceneTarget.texture.generateMipmaps = false
      this.easuTarget.texture.generateMipmaps = false
    }
    const autoReset = this.renderer.info.autoReset
    this.renderer.info.autoReset = false
    this.renderer.info.reset()
    try {
      this.renderer.setRenderTarget(this.sceneTarget)
      drawScene()
      this.easuMaterial.uniforms.iResolution.value.set(this.size.x, this.size.y)
      this.easuMaterial.uniforms.inputSize.value.set(width, height)
      this.easuMaterial.uniforms.iChannel0.value = this.sceneTarget.texture
      this.renderer.setRenderTarget(this.easuTarget)
      this.renderer.render(this.easuScene, this.camera)
      this.rcasMaterial.uniforms.iResolution.value.set(this.size.x, this.size.y)
      this.rcasMaterial.uniforms.iChannel0.value = this.easuTarget.texture
      this.renderer.setRenderTarget(null)
      this.renderer.render(this.rcasScene, this.camera)
    } finally {
      this.renderer.setRenderTarget(null)
      this.renderer.info.autoReset = autoReset
    }
  }

  private releaseTargets(): void {
    this.sceneTarget?.dispose()
    this.easuTarget?.dispose()
    this.sceneTarget = null
    this.easuTarget = null
  }

  dispose(): void {
    this.releaseTargets()
    this.easuMaterial.dispose()
    this.rcasMaterial.dispose()
    this.geometry.dispose()
  }
}
