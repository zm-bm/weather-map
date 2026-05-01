import {
  useState,
  type ChangeEvent,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type TouchEvent,
} from 'react'

import {
  formatValidTimeLabel,
  formatValidTimeScaleLabel,
} from '../../forecast-time'
import {
  FORECAST_TIME_STEP_MINUTES,
  forecastTimeBounds,
  minuteOffsetForValidTime,
  validTimeMsForMinuteOffset,
} from '../../forecast-time'
import { useForecastTimeContext } from '../../forecast-time'

type SliderReleaseEvent =
  | PointerEvent<HTMLInputElement>
  | MouseEvent<HTMLInputElement>
  | TouchEvent<HTMLInputElement>

type SliderStartEvent =
  | PointerEvent<HTMLInputElement>
  | MouseEvent<HTMLInputElement>
  | TouchEvent<HTMLInputElement>

type TimelineScaleTick = {
  id: string
  kind: 'major' | 'minor'
  label: string | null
  labelAlign: 'start' | 'middle' | 'end'
  positionPct: number
}

type TimelineBounds = NonNullable<ReturnType<typeof forecastTimeBounds>>

const SCALE_MINOR_HOUR_STEP = 6

function nextLocalDayMs(epochMs: number): number {
  const date = new Date(epochMs)
  date.setHours(24, 0, 0, 0)
  return date.getTime()
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

function timelineScaleLabelAlign(positionPct: number): TimelineScaleTick['labelAlign'] {
  if (positionPct <= 14) return 'start'
  if (positionPct >= 86) return 'end'
  return 'middle'
}

function timelineScaleTick(
  bounds: TimelineBounds,
  epochMs: number,
  kind: TimelineScaleTick['kind']
): TimelineScaleTick {
  const positionPct = timelineScalePositionPct(bounds, epochMs)

  return {
    id: `${kind}:${epochMs}`,
    kind,
    label: kind === 'major' ? formatValidTimeScaleLabel(epochMs) : null,
    labelAlign: timelineScaleLabelAlign(positionPct),
    positionPct,
  }
}

function createTimelineScaleTicks(bounds: TimelineBounds | null): TimelineScaleTick[] {
  if (!bounds || bounds.totalMinutes <= 0) return []

  const majorTickTimes = new Set<number>()
  const ticks: TimelineScaleTick[] = []
  let majorTickMs = nextLocalDayMs(bounds.startValidTimeMs)

  while (majorTickMs < bounds.endValidTimeMs) {
    if (majorTickMs > bounds.startValidTimeMs) {
      majorTickTimes.add(majorTickMs)
      ticks.push(timelineScaleTick(bounds, majorTickMs, 'major'))
    }

    const nextTickMs = nextLocalDayMs(majorTickMs)
    if (nextTickMs <= majorTickMs) break
    majorTickMs = nextTickMs
  }

  let minorTickMs = nextLocalHourBlockMs(bounds.startValidTimeMs, SCALE_MINOR_HOUR_STEP)

  while (minorTickMs < bounds.endValidTimeMs) {
    if (minorTickMs > bounds.startValidTimeMs && !majorTickTimes.has(minorTickMs)) {
      ticks.push(timelineScaleTick(bounds, minorTickMs, 'minor'))
    }

    const nextTickMs = nextLocalHourBlockMs(minorTickMs, SCALE_MINOR_HOUR_STEP)
    if (nextTickMs <= minorTickMs) break
    minorTickMs = nextTickMs
  }

  return ticks.sort((a, b) => a.positionPct - b.positionPct)
}

export default function TimelineScrubber() {
  const {
    cycle,
    forecastHours,
    state: forecastTimeState,
    controls: forecastTimeControls,
  } = useForecastTimeContext()
  const {
    appliedTimeMs,
    targetTimeMs,
    pendingTimeMs,
  } = forecastTimeState
  const { requestTime } = forecastTimeControls

  const bounds = forecastTimeBounds(cycle, forecastHours)
  const totalMinutes = bounds?.totalMinutes ?? 0
  const requestedTimeMs = pendingTimeMs ?? targetTimeMs
  const requestedMinuteOffset = minuteOffsetForValidTime(cycle, forecastHours, requestedTimeMs)
  const timelineControlsDisabled = forecastHours.length <= 1 || bounds == null
  const [sliderDraftMinuteOffset, setSliderDraftMinuteOffset] = useState<number | null>(null)
  const sliderMinuteOffsetValue = sliderDraftMinuteOffset ?? requestedMinuteOffset

  const selectedTimeMs = bounds == null
    ? appliedTimeMs
    : validTimeMsForMinuteOffset(cycle, forecastHours, sliderMinuteOffsetValue)
  const selectedTimeLabel = formatValidTimeLabel(selectedTimeMs) ?? 'Now'
  const scaleTicks = createTimelineScaleTicks(bounds)

  const commitSliderTime = (minuteOffset: number) => {
    if (timelineControlsDisabled) return
    requestTime(validTimeMsForMinuteOffset(cycle, forecastHours, minuteOffset))
  }

  const sliderMinuteOffset = (event: Pick<ChangeEvent<HTMLInputElement>, 'currentTarget'>) => (
    Number(event.currentTarget.value)
  )

  const startSliderDraft = (minuteOffset: number) => {
    setSliderDraftMinuteOffset(minuteOffset)
  }

  const commitSliderDraft = (minuteOffset: number) => {
    if (sliderDraftMinuteOffset === null) return
    setSliderDraftMinuteOffset(null)
    commitSliderTime(minuteOffset)
  }

  const cancelSliderDraft = () => {
    setSliderDraftMinuteOffset(null)
  }

  const handleSliderStart = (event: SliderStartEvent) => {
    startSliderDraft(sliderMinuteOffset(event))
  }

  const handleSliderRelease = (event: SliderReleaseEvent) => {
    commitSliderDraft(sliderMinuteOffset(event))
  }

  return (
    <section className="timeline-scrubber timeline-bar__zone timeline-bar__zone--timeline" aria-label="Forecast timeline">
      <div className="timeline-scrubber__time-header">
        <strong className="timeline-scrubber__selected-time wm-display-caps">
          {selectedTimeLabel}
        </strong>
      </div>

      <div className="timeline-scrubber__slider-stack">
        <input
          className="timeline-scrubber__slider"
          type="range"
          min={0}
          max={totalMinutes}
          step={FORECAST_TIME_STEP_MINUTES}
          value={sliderMinuteOffsetValue}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            const minuteOffset = sliderMinuteOffset(event)
            if (sliderDraftMinuteOffset !== null) {
              setSliderDraftMinuteOffset(minuteOffset)
              return
            }
            commitSliderTime(minuteOffset)
          }}
          onPointerDown={handleSliderStart}
          onMouseDown={handleSliderStart}
          onTouchStart={handleSliderStart}
          onPointerUp={handleSliderRelease}
          onPointerCancel={cancelSliderDraft}
          onMouseUp={handleSliderRelease}
          onTouchEnd={handleSliderRelease}
          onBlur={(event: FocusEvent<HTMLInputElement>) => {
            commitSliderDraft(sliderMinuteOffset(event))
          }}
          disabled={timelineControlsDisabled}
          aria-label="Forecast time"
        />

        <div className="timeline-scrubber__scale" aria-hidden="true">
          {scaleTicks.map((tick) => (
            <span
              key={tick.id}
              className={`timeline-scrubber__scale-tick timeline-scrubber__scale-tick--${tick.kind}`}
              style={{ left: `${tick.positionPct}%` }}
            >
              {tick.label ? (
                <span
                  className={`timeline-scrubber__scale-label timeline-scrubber__scale-label--${tick.labelAlign}`}
                >
                  {tick.label}
                </span>
              ) : null}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
