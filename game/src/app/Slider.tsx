import type { ComponentProps, CSSProperties } from 'react'

type SliderProps = Omit<ComponentProps<'input'>, 'type' | 'value' | 'defaultValue' | 'min' | 'max'> & {
  value: number
  min: number
  max: number
}

/** Tile-style chrome over a native range, retaining pointer and keyboard semantics. */
export function Slider({ value, min, max, className = '', style, onPointerUp, onPointerCancel, onLostPointerCapture, ...props }: SliderProps) {
  const progress = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0
  return <input {...props} type="range" min={min} max={max} value={value}
    onPointerUp={event => {
      onPointerUp?.(event)
      event.currentTarget.blur()
    }}
    onPointerCancel={event => {
      onPointerCancel?.(event)
      event.currentTarget.blur()
    }}
    onLostPointerCapture={event => {
      onLostPointerCapture?.(event)
      event.currentTarget.blur()
    }}
    className={`tileSlider ${className}`.trim()}
    style={{ ...style, '--slider-fill': `${progress * 100}%` } as CSSProperties} />
}
