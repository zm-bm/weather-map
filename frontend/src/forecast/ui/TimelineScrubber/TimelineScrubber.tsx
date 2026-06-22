import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'

import {
  FORECAST_TIME_STEP_MINUTES,
  formatValidTimeLabel,
  formatValidTimeScaleLabel,
  type ForecastTimelineTime,
  minuteOffsetForValidTime,
  validTimeMsForMinuteOffset,
} from '@/forecast/time'

type TimelineScaleTick = {
  id: string
  kind: 'major' | 'medium' | 'minor'
  label: string | null
  positionPct: number
}

type TimelineBounds = {
  startValidTimeMs: number
  endValidTimeMs: number
  totalMinutes: number
}

type TimelineDrag = {
  pointerId: number
  startClientX: number
  startMinuteOffset: number
  scaleWidthPx: number
  moved: boolean
}

type TimelineScrubberProps = {
  times: ForecastTimelineTime[]
  bounds: TimelineBounds | null
  requestedTimeMs: number
  disabled: boolean
  onRequestTime: (timeMs: number) => void
}

const SCALE_MINOR_HOUR_STEP = 2
const SCALE_MEDIUM_HOUR_STEP = 6
const RULER_DRAG_THRESHOLD_PX = 2
const RULER_MIN_WIDTH_PX = 360
const RULER_PX_PER_MINUTE = 1 / 6
const KEYBOARD_FAST_STEP_MINUTES = 15

type TimelineScaleStyle = CSSProperties & {
  '--wm-timeline-scale-strip-width': string
  '--wm-timeline-selected-position': string
}

function nextLocalHourBlockMs(epochMs: number, hourStep: number): number {
  const date = new Date(epochMs)
  date.setMinutes(0, 0, 0)
  date.setHours(Math.floor(date.getHours() / hourStep) * hourStep + hourStep, 0, 0, 0)
  return date.getTime()
}

function timelineScalePositionPct(bounds: TimelineBounds, epochMs: number): number {
  const spanMs = bounds.endValidTimeMs - bounds.startValidTimeMs
  if (spanMs <= 0) return 0
  return ((epochMs - bounds.startValidTimeMs) / spanMs) * 100
}

function timelineScaleTickKind(epochMs: number): TimelineScaleTick['kind'] {
  const date = new Date(epochMs)
  if (date.getHours() === 0) return 'major'
  if (date.getHours() % SCALE_MEDIUM_HOUR_STEP === 0) return 'medium'
  return 'minor'
}

function createTimelineScaleTicks(bounds: TimelineBounds | null): TimelineScaleTick[] {
  if (!bounds || bounds.totalMinutes <= 0) return []

  const ticks: TimelineScaleTick[] = []
  let tickMs = nextLocalHourBlockMs(bounds.startValidTimeMs, SCALE_MINOR_HOUR_STEP)

  while (tickMs < bounds.endValidTimeMs) {
    if (tickMs > bounds.startValidTimeMs) {
      const kind = timelineScaleTickKind(tickMs)
      ticks.push({
        id: `${kind}:${tickMs}`,
        kind,
        label: kind === 'major' ? formatValidTimeScaleLabel(tickMs) : null,
        positionPct: timelineScalePositionPct(bounds, tickMs),
      })
    }

    const nextTickMs = nextLocalHourBlockMs(tickMs, SCALE_MINOR_HOUR_STEP)
    if (nextTickMs <= tickMs) break
    tickMs = nextTickMs
  }

  return ticks
}

function normalizeMinuteOffset(
  minuteOffset: number,
  totalMinutes: number
): number {
  if (!Number.isFinite(minuteOffset)) return 0
  const clampedMinutes = Math.max(0, Math.min(totalMinutes, Math.round(minuteOffset)))
  if (clampedMinutes === totalMinutes) return totalMinutes
  return Math.round(clampedMinutes / FORECAST_TIME_STEP_MINUTES) * FORECAST_TIME_STEP_MINUTES
}

function scaleWidthForBounds(bounds: TimelineBounds | null): number {
  if (!bounds || bounds.totalMinutes <= 0) return RULER_MIN_WIDTH_PX
  return Math.max(RULER_MIN_WIDTH_PX, bounds.totalMinutes * RULER_PX_PER_MINUTE)
}

export default function TimelineScrubber({
  times,
  bounds,
  requestedTimeMs,
  disabled,
  onRequestTime,
}: TimelineScrubberProps) {
  const totalMinutes = bounds?.totalMinutes ?? 0
  const requestedMinuteOffset = minuteOffsetForValidTime(times, requestedTimeMs)
  const [draftMinuteOffset, setDraftMinuteOffset] = useState<number | null>(null)
  const dragRef = useRef<TimelineDrag | null>(null)
  const scaleStripRef = useRef<HTMLDivElement | null>(null)
  const activeMinuteOffset = draftMinuteOffset ?? requestedMinuteOffset

  const selectedTimeMs = bounds == null
    ? requestedTimeMs
    : validTimeMsForMinuteOffset(times, activeMinuteOffset)
  const selectedTimeLabel = formatValidTimeLabel(selectedTimeMs) ?? 'Valid time'
  const selectedPositionPct = bounds == null ? 0 : timelineScalePositionPct(bounds, selectedTimeMs)
  const scaleTicks = createTimelineScaleTicks(bounds)
  const scaleWidthPx = scaleWidthForBounds(bounds)
  const scaleStyle: TimelineScaleStyle = {
    '--wm-timeline-scale-strip-width': `max(100%, ${scaleWidthPx}px)`,
    '--wm-timeline-selected-position': `${-selectedPositionPct}%`,
  }

  const commitMinuteOffset = (minuteOffset: number) => {
    if (disabled) return
    onRequestTime(validTimeMsForMinuteOffset(times, normalizeMinuteOffset(minuteOffset, totalMinutes)))
  }

  const minuteOffsetForDrag = (event: Pick<PointerEvent<HTMLDivElement>, 'clientX'>) => {
    const drag = dragRef.current
    if (drag == null) return activeMinuteOffset

    const deltaX = event.clientX - drag.startClientX
    const minuteDelta = (deltaX / drag.scaleWidthPx) * totalMinutes
    return normalizeMinuteOffset(drag.startMinuteOffset - minuteDelta, totalMinutes)
  }

  const clearDrag = () => {
    dragRef.current = null
    setDraftMinuteOffset(null)
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || bounds == null) return

    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const measuredScaleWidth = scaleStripRef.current?.getBoundingClientRect().width ?? 0
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startMinuteOffset: activeMinuteOffset,
      scaleWidthPx: measuredScaleWidth > 0 ? measuredScaleWidth : scaleWidthPx,
      moved: false,
    }
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag == null || event.pointerId !== drag.pointerId) return

    event.preventDefault()
    const deltaX = event.clientX - drag.startClientX
    if (!drag.moved && Math.abs(deltaX) < RULER_DRAG_THRESHOLD_PX) return
    drag.moved = true
    setDraftMinuteOffset(minuteOffsetForDrag(event))
  }

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag == null || event.pointerId !== drag.pointerId) return

    event.preventDefault()
    const finalMinuteOffset = minuteOffsetForDrag(event)
    const hasMoved = drag.moved
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    clearDrag()
    if (!hasMoved) return
    commitMinuteOffset(finalMinuteOffset)
  }

  const handlePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag == null || event.pointerId !== drag.pointerId) return

    event.currentTarget.releasePointerCapture?.(event.pointerId)
    clearDrag()
  }

  const handleBlur = () => {
    clearDrag()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault()
      return
    }

    if (disabled) return

    let nextMinuteOffset: number | null = null
    if (event.key === 'ArrowLeft') {
      nextMinuteOffset = activeMinuteOffset - (
        event.shiftKey ? KEYBOARD_FAST_STEP_MINUTES : FORECAST_TIME_STEP_MINUTES
      )
    } else if (event.key === 'ArrowRight') {
      nextMinuteOffset = activeMinuteOffset + (
        event.shiftKey ? KEYBOARD_FAST_STEP_MINUTES : FORECAST_TIME_STEP_MINUTES
      )
    }

    if (nextMinuteOffset == null) return
    event.preventDefault()
    setDraftMinuteOffset(null)
    commitMinuteOffset(nextMinuteOffset)
  }

  return (
    <section
      id="forecast-timeline-scrubber"
      className="timeline-scrubber timeline-bar__zone timeline-bar__zone--timeline"
      aria-label="Forecast timeline"
    >
      <div className="timeline-scrubber__ruler-wrap">
        <div
          className="timeline-scrubber__ruler"
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label="Forecast time"
          aria-orientation="horizontal"
          aria-disabled={disabled ? 'true' : undefined}
          aria-valuemin={0}
          aria-valuemax={totalMinutes}
          aria-valuenow={activeMinuteOffset}
          aria-valuetext={selectedTimeLabel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        >
          <span className="timeline-scrubber__time-badge wm-display-caps" aria-hidden="true">
            <span className="timeline-scrubber__time-badge-text">
              {selectedTimeLabel}
            </span>
          </span>
          <div className="timeline-scrubber__scale" aria-hidden="true">
            <div
              ref={scaleStripRef}
              className="timeline-scrubber__scale-strip"
              style={scaleStyle}
            >
              {scaleTicks.map((tick) => (
                <span
                  key={tick.id}
                  className={`timeline-scrubber__scale-tick timeline-scrubber__scale-tick--${tick.kind}`}
                  style={{ left: `${tick.positionPct}%` }}
                >
                  {tick.label ? (
                    <span className="timeline-scrubber__scale-label">
                      {tick.label}
                    </span>
                  ) : null}
                </span>
              ))}
            </div>
          </div>
          <span className="timeline-scrubber__current-marker" aria-hidden="true" />
        </div>
      </div>
    </section>
  )
}
