import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  CITY_STYLES,
  DEFAULT_LINE_COLOUR,
  cityLineColourPresets,
  normalizeCityStyle,
  type CityStyle,
} from '../../../sim/cityStyles.ts'
import { t } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'
import { beginPointerDrag } from '../../pointerDrag.ts'
import { getUiScale } from '../../uiScale.ts'
import {
  hexToHsv,
  hsvToHex,
  isLightHexColour,
  normalizeHexColour,
  presetBadgeLabel,
  presetTitle,
  type HsvColour,
} from './lineColourUtils.ts'

export interface LineColourPickerProps {
  /** Stable identifier for aria-controls and popover id (e.g. `line.id`). */
  id: string
  /** Current committed line colour (`#rrggbb`). */
  value: string
  /** Active station city style whose predefined palette is shown in the picker. */
  city: CityStyle
  /** Invoked once per confirmed colour edit (preset click, drag release, hex commit, or close). */
  onCommit: (colour: string) => void
}

/**
 * Pure-DOM popover colour picker for metro lines.
 *
 * Replaces native `<input type="color">` (whose OS popup HWND is invisible to
 * Unity desktop WebView2 offscreen composition capture) and includes the active
 * city's predefined line-colour palette alongside a full HSV picker and hex input.
 */
export function LineColourPicker({ id, value, city, onCommit }: LineColourPickerProps): React.ReactElement {
  const language = useLanguage()
  const activeCity = normalizeCityStyle(city)
  const committedHex = normalizeHexColour(value) ?? DEFAULT_LINE_COLOUR
  const presets = useMemo(() => cityLineColourPresets(activeCity), [activeCity])

  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const svRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef<HTMLDivElement>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const wasOpenOnDownRef = useRef(false)

  const [open, setOpen] = useState(false)
  const [hsv, setHsv] = useState<HsvColour>(() => hexToHsv(committedHex))
  const [draftHex, setDraftHex] = useState(committedHex)
  const [hexInput, setHexInput] = useState(committedHex.toUpperCase())

  const hsvRef = useRef(hsv)
  hsvRef.current = hsv
  const draftRef = useRef(draftHex)
  draftRef.current = draftHex
  const committedRef = useRef(committedHex)
  committedRef.current = committedHex
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit

  useEffect(() => {
    setDraftHex(committedHex)
    setHexInput(committedHex.toUpperCase())
    if (hsvToHex(hsvRef.current.h, hsvRef.current.s, hsvRef.current.v) !== committedHex) {
      setHsv(hexToHsv(committedHex))
    }
  }, [committedHex])

  useEffect(() => () => {
    dragCleanupRef.current?.()
    dragCleanupRef.current = null
  }, [])

  const applyHsv = (next: HsvColour): string => {
    const clamped: HsvColour = {
      h: ((next.h % 360) + 360) % 360,
      s: Math.max(0, Math.min(1, next.s)),
      v: Math.max(0, Math.min(1, next.v)),
    }
    const hex = hsvToHex(clamped.h, clamped.s, clamped.v)
    hsvRef.current = clamped
    draftRef.current = hex
    setHsv(clamped)
    setDraftHex(hex)
    setHexInput(hex.toUpperCase())
    return hex
  }

  const commitIfChanged = (hex: string): void => {
    const normalized = normalizeHexColour(hex)
    if (normalized && normalized !== committedRef.current) {
      committedRef.current = normalized
      onCommitRef.current(normalized)
    }
  }

  const positionPopover = (): void => {
    const button = buttonRef.current
    const menu = popoverRef.current
    if (!button || !menu) return
    const scale = getUiScale()
    const anchor = button.getBoundingClientRect()
    const box = menu.getBoundingClientRect()
    const margin = 12
    const gap = 6
    const maxLeft = Math.max(margin, window.innerWidth - box.width - margin)
    const left = Math.max(margin, Math.min(anchor.right - box.width, maxLeft))
    const belowTop = anchor.bottom + gap
    const aboveTop = anchor.top - box.height - gap
    const preferredTop = belowTop + box.height <= window.innerHeight - margin
      ? belowTop
      : (aboveTop >= margin ? aboveTop : window.innerHeight - box.height - margin)
    const top = Math.max(margin, Math.min(preferredTop, window.innerHeight - box.height - margin))
    menu.style.left = `${left / scale}px`
    menu.style.top = `${top / scale}px`
    menu.style.maxHeight = `${Math.max(180, window.innerHeight - margin * 2) / scale}px`
  }

  const show = (): void => {
    const menu = popoverRef.current
    if (!menu) return
    menu.showPopover()
    positionPopover()
  }

  const close = (): void => {
    popoverRef.current?.hidePopover()
  }

  const handleSvPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || dragCleanupRef.current) return
    const pad = svRef.current
    if (!pad) return
    const update = (clientX: number, clientY: number): void => {
      const rect = pad.getBoundingClientRect()
      const s = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)))
      const v = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / Math.max(1, rect.height)))
      applyHsv({ h: hsvRef.current.h, s, v })
    }
    const stop = beginPointerDrag(event, {
      capture: pad,
      onMove: (x, y) => update(x, y),
      onEnd: (completed) => {
        dragCleanupRef.current = null
        if (completed) commitIfChanged(draftRef.current)
      },
    })
    if (!stop) return
    dragCleanupRef.current = stop
    update(event.clientX, event.clientY)
  }

  const handleHuePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || dragCleanupRef.current) return
    const bar = hueRef.current
    if (!bar) return
    const update = (clientX: number): void => {
      const rect = bar.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)))
      applyHsv({ h: ratio >= 1 ? 359.99 : ratio * 360, s: hsvRef.current.s, v: hsvRef.current.v })
    }
    const stop = beginPointerDrag(event, {
      capture: bar,
      onMove: (x) => update(x),
      onEnd: (completed) => {
        dragCleanupRef.current = null
        if (completed) commitIfChanged(draftRef.current)
      },
    })
    if (!stop) return
    dragCleanupRef.current = stop
    update(event.clientX)
  }

  const selectPreset = (colour: string): void => {
    const normalized = normalizeHexColour(colour)
    if (!normalized) return
    const nextHsv = hexToHsv(normalized)
    hsvRef.current = nextHsv
    draftRef.current = normalized
    setHsv(nextHsv)
    setDraftHex(normalized)
    setHexInput(normalized.toUpperCase())
    commitIfChanged(normalized)
  }

  const commitHexInput = (raw: string = hexInput): void => {
    const normalized = normalizeHexColour(raw)
    if (!normalized) {
      setHexInput(draftRef.current.toUpperCase())
      return
    }
    selectPreset(normalized)
  }

  const popoverId = `lineColourPicker-${id}`
  const pureHueHex = hsvToHex(hsv.h, 1, 1)

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="lineColourInput"
        aria-label={t('line_colour')}
        title={`${t('line_colour')} · ${draftHex.toUpperCase()}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popoverId}
        onPointerDown={() => {
          wasOpenOnDownRef.current = popoverRef.current?.matches(':popover-open') ?? false
        }}
        onClick={() => {
          if (wasOpenOnDownRef.current) {
            wasOpenOnDownRef.current = false
            close()
            return
          }
          if (popoverRef.current?.matches(':popover-open')) close()
          else show()
        }}
      >
        <span className="lineColourSwatch" style={{ background: draftHex }} />
      </button>

      <div
        ref={popoverRef}
        id={popoverId}
        className="lineColourPopover"
        popover="auto"
        role="dialog"
        aria-label={t('line_colour')}
        onToggle={(e) => {
          const isOpen = e.newState === 'open'
          setOpen(isOpen)
          if (!isOpen) {
            dragCleanupRef.current?.()
            dragCleanupRef.current = null
            commitIfChanged(draftRef.current)
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
          e.stopPropagation()
        }}
      >
        <div className="lineColourHead">
          <strong>{t('line_colour')}</strong>
          <button
            type="button"
            className="ghost iconBtn lineColourClose"
            aria-label={t('cancel')}
            onClick={close}
          >
            ×
          </button>
        </div>

        <div
          ref={svRef}
          className="lineColourPad"
          role="application"
          aria-label={t('colour_saturation_brightness')}
          style={{ backgroundColor: pureHueHex }}
          onPointerDown={handleSvPointerDown}
        >
          <span
            className="lineColourPadThumb"
            style={{
              left: `${hsv.s * 100}%`,
              top: `${(1 - hsv.v) * 100}%`,
              background: draftHex,
            }}
          />
        </div>

        <div
          ref={hueRef}
          className="lineColourHue"
          role="slider"
          aria-label={t('colour_hue')}
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={Math.round(hsv.h)}
          tabIndex={0}
          onPointerDown={handleHuePointerDown}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 15 : 5
            if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
              e.preventDefault()
              const hex = applyHsv({ h: hsvRef.current.h - step, s: hsvRef.current.s, v: hsvRef.current.v })
              commitIfChanged(hex)
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
              e.preventDefault()
              const hex = applyHsv({ h: hsvRef.current.h + step, s: hsvRef.current.s, v: hsvRef.current.v })
              commitIfChanged(hex)
            }
          }}
        >
          <span
            className="lineColourHueThumb"
            style={{ left: `${(hsv.h / 360) * 100}%`, background: pureHueHex }}
          />
        </div>

        <div className="lineColourHexRow">
          <span className="lineColourPreview" style={{ background: draftHex }} aria-hidden="true" />
          <input
            type="text"
            className="lineNameInput lineColourHexInput"
            value={hexInput}
            maxLength={7}
            spellCheck={false}
            aria-label={t('colour_hex')}
            onChange={(e) => {
              const raw = e.target.value
              setHexInput(raw)
              const trimmed = raw.trim().replace(/^#/, '')
              if (trimmed.length === 6) {
                const parsed = normalizeHexColour(raw)
                if (parsed) {
                  const nextHsv = hexToHsv(parsed)
                  hsvRef.current = nextHsv
                  draftRef.current = parsed
                  setHsv(nextHsv)
                  setDraftHex(parsed)
                }
              }
            }}
            onBlur={(e) => commitHexInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commitHexInput(e.currentTarget.value)
                e.currentTarget.blur()
              } else if (e.key === 'Escape') {
                setHexInput(draftRef.current.toUpperCase())
                close()
              }
            }}
          />
        </div>

        <div className="lineColourPresetSection">
          <div className="lineColourPresetTitle">
            {t('city_line_colours', t(CITY_STYLES[activeCity].nameKey))}
          </div>
          <div className="lineColourPresets" data-city={activeCity}>
            {presets.map((preset) => {
              const selected = preset.colour === draftHex
              const badge = presetBadgeLabel(preset, language)
              const title = presetTitle(preset, language)
              return (
                <button
                  key={`${preset.id}-${preset.colour}`}
                  type="button"
                  className={selected ? 'lineColourPreset on' : 'lineColourPreset'}
                  data-colour={preset.colour}
                  data-line-preset={preset.id}
                  aria-pressed={selected}
                  aria-label={title}
                  title={title}
                  style={{
                    background: preset.colour,
                    color: isLightHexColour(preset.colour) ? '#11161d' : '#ffffff',
                  }}
                  onClick={() => selectPreset(preset.colour)}
                >
                  <span>{badge}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}
