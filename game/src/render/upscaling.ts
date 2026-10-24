export type UpscalingMode = 'native' | 'ultra' | 'quality' | 'balanced' | 'performance'

export const UPSCALING_SCALE: Record<UpscalingMode, number> = {
  native: 1,
  ultra: 1 / 1.3,
  quality: 1 / 1.5,
  balanced: 1 / 1.7,
  performance: 0.5,
}
