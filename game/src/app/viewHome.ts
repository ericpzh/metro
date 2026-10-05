// 回到默认视角 — the home view: the isometric build view in perspective, through the
// lens the camera opens with.
//
// **It owns three things and nothing else.** The iso preset, the 透视/正交 flag (a preset
// and the projection the rail shows have to agree — `Viewport.onPreset` writes the same
// pair), and the **lens**, because 视场角 is the one camera setting a player can leave the
// view in: a home that kept a 120° wide-angle would be "wherever I was", not home. 显示其他层,
// 隐藏天花板 和 the 剖切 surface are the player's own settings instead; a "home" that
// quietly rewrote one of them is exactly what made the old button read as broken.
//
// One definition for the three ways in: the nav cube's ⌂ button, Ctrl+H in the shell
// (which hands it over as `metro:home`, the split `metro:preset` / `metro:frame` already
// use), and any later caller. A second copy of "iso plus perspective plus a 45° lens" is a
// second place for the home view to change.
//
// `DEFAULT_FOV` comes from the camera system **directly, not through the
// `render/scene.ts` barrel**: the barrel exports `SceneRenderer`, which reaches
// `adArt.ts` and its Vite-only `import.meta.glob`, and this module is imported by a node
// test (`test/view-home.test.mjs`). The type-only `SceneRenderer` import below is erased
// at runtime and costs nothing.
import { DEFAULT_FOV } from '../render/scene/systems/CameraSystem.ts'
import type { SceneRenderer } from '../render/scene.ts'
import { useStore } from './store.ts'

export function goHomeView(scene: SceneRenderer | null): void {
  if (!scene) return
  scene.setPreset('iso')
  scene.setFov(DEFAULT_FOV)
  useStore.getState().setOrtho(false)
}
