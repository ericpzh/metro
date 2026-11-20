import { useEffect, useRef } from 'react'
import type { ChangeEvent, ComponentProps, CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { beginPointerDrag, sliderValueForPointer } from './pointerDrag.ts'

type SliderProps = Omit<ComponentProps<'input'>, 'type' | 'value' | 'defaultValue' | 'min' | 'max'> & {
  value: number
  min: number
  max: number
  onValueChange?: (value: number) => void
  onDragStart?: () => void
  onDragEnd?: (completed: boolean) => void
}

/**
 * Tile-style chrome over a native range, retaining keyboard semantics while
 * driving pointer drags through window-capture listeners so Unity desktop
 * WebView2 drags stay smooth even outside the track.
 */
export function Slider({
  value,
  min,
  max,
  step,
  disabled,
  className = '',
  style,
  onChange,
  onValueChange,
  onDragStart,
  onDragEnd,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  ...props
}: SliderProps) {
  const dragCleanup = useRef<(() => void) | null>(null)
  const latest = useRef({ min, max, step, value, onChange, onValueChange, onDragStart, onDragEnd, onPointerUp, onPointerCancel })
  latest.current = { min, max, step, value, onChange, onValueChange, onDragStart, onDragEnd, onPointerUp, onPointerCancel }

  useEffect(() => () => dragCleanup.current?.(), [])

  const progress = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0

  const handlePointerDown = (event: ReactPointerEvent<HTMLInputElement>): void => {
    onPointerDown?.(event)
    if (event.defaultPrevented || disabled || event.button !== 0 || dragCleanup.current) return

    const input = event.currentTarget
    input.blur()
    let lastValue = latest.current.value

    const update = (clientX: number): void => {
      const { min: lo, max: hi, step: st, onValueChange: emitValue, onChange: emitChange } = latest.current
      const track = input.getBoundingClientRect()
      const next = sliderValueForPointer(clientX, track.left, track.width, input.offsetWidth, lo, hi, st)
      if (next === lastValue) return
      lastValue = next
      if (emitValue) {
        emitValue(next)
        return
      }
      if (emitChange) {
        input.value = String(next)
        emitChange({ target: input, currentTarget: input } as ChangeEvent<HTMLInputElement>)
      }
    }

    const stop = beginPointerDrag(event, {
      capture: input,
      onMove: (clientX) => update(clientX),
      onEnd: (completed, endEvent) => {
        dragCleanup.current = null
        input.blur()
        latest.current.onDragEnd?.(completed)
        if (completed && endEvent) {
          latest.current.onPointerUp?.(endEvent as unknown as ReactPointerEvent<HTMLInputElement>)
        } else if (!completed && endEvent && 'pointerId' in endEvent) {
          latest.current.onPointerCancel?.(endEvent as unknown as ReactPointerEvent<HTMLInputElement>)
        }
      },
    })
    if (!stop) return
    dragCleanup.current = stop
    latest.current.onDragStart?.()
    update(event.clientX)
  }

  return <input
    {...props}
    type="range"
    min={min}
    max={max}
    step={step}
    disabled={disabled}
    value={value}
    onChange={(event) => {
      onChange?.(event)
      onValueChange?.(Number(event.target.value))
    }}
    onPointerDown={handlePointerDown}
    onPointerUp={(event) => {
      if (dragCleanup.current) return
      onPointerUp?.(event)
      event.currentTarget.blur()
    }}
    onPointerCancel={(event) => {
      if (dragCleanup.current) return
      onPointerCancel?.(event)
      event.currentTarget.blur()
    }}
    onLostPointerCapture={(event) => {
      onLostPointerCapture?.(event)
      event.currentTarget.blur()
    }}
    className={`tileSlider ${className}`.trim()}
    style={{ ...style, '--slider-fill': `${progress * 100}%` } as CSSProperties}
  />
}
