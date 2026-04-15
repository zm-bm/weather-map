import { useState } from 'react'
import { FaPause, FaPlay, FaStepBackward, FaStepForward } from 'react-icons/fa'

import {
  cycleLabel as formatCycleLabel,
  shortTickLabel as formatShortTickLabel,
  tickLabel as formatTickLabel,
  validLabel as formatValidLabel,
} from '../../map/time/format'
import { useTimelineContext } from '../../state/TimelineContext'
import {
  hourTokenAt,
  normalizeHourIndex,
} from '../../map/time/core'

function getTransportStatusLabel(options: {
  isInFlight: boolean
  loadingHourLabel: string
  pendingHourLabel: string | null
}) {
  const { isInFlight, loadingHourLabel, pendingHourLabel } = options
  if (isInFlight && pendingHourLabel != null) {
    return `Loading ${loadingHourLabel} · Queued ${pendingHourLabel}`
  }
  if (isInFlight) return `Loading ${loadingHourLabel}`
  if (pendingHourLabel != null) return `Queued ${pendingHourLabel}`
  return 'Ready'
}

export default function TimelineTransport() {
  const {
    cycle,
    forecastHours,
    state: timelineState,
    controls: timelineControls,
  } = useTimelineContext()
  const {
    appliedHourIndex,
    targetHourIndex,
    pendingHourIndex,
    isInFlight,
    isPlaying,
  } = timelineState
  const {
    requestHour,
    requestPrev,
    requestNext,
    togglePlay,
  } = timelineControls

  const forecastHourCount = forecastHours.length
  const totalHours = Math.max(1, forecastHourCount)
  const maxHourIdx = totalHours - 1
  const appliedHourIdx = normalizeHourIndex(appliedHourIndex, totalHours)
  const targetHourIdx = normalizeHourIndex(targetHourIndex, totalHours)
  const pendingHourIdx = pendingHourIndex == null ? null : normalizeHourIndex(pendingHourIndex, totalHours)
  const hourControlsDisabled = forecastHourCount <= 1
  const [isDraggingSlider, setIsDraggingSlider] = useState(false)

  const appliedHourToken = hourTokenAt(forecastHours, appliedHourIdx)
  const targetHourToken = hourTokenAt(forecastHours, targetHourIdx)
  const pendingHourToken = pendingHourIdx == null ? null : hourTokenAt(forecastHours, pendingHourIdx)

  const cycleText = formatCycleLabel(cycle)
  const validTimeLabel = formatValidLabel(cycle, appliedHourToken)
  const startTickLabel = formatShortTickLabel(cycle, hourTokenAt(forecastHours, 0)) ?? 'Start'
  const appliedTickLabel = formatTickLabel(cycle, appliedHourToken) ?? 'Now'
  const endTickLabel = formatShortTickLabel(cycle, hourTokenAt(forecastHours, maxHourIdx)) ?? 'End'
  const loadingHourLabel = formatShortTickLabel(cycle, targetHourToken) ?? `Hour ${targetHourToken}`
  const pendingHourLabel = pendingHourToken == null
    ? null
    : (formatShortTickLabel(cycle, pendingHourToken) ?? `Hour ${pendingHourToken}`)

  const transportStatus = getTransportStatusLabel({
    isInFlight,
    loadingHourLabel,
    pendingHourLabel,
  })

  const commitSliderHour = (hourIdx: number) => {
    if (hourControlsDisabled) return
    requestHour(normalizeHourIndex(hourIdx, totalHours))
  }

  return (
    <section className="transport-bar lower-third__module" aria-label="Forecast timeline">
      <div className="transport-bar__titlebar">
        <span className="transport-bar__eyebrow">Forecast Timeline</span>
      </div>

      <div className="transport-bar__body">
        <div className="transport-bar__meta">
          <span className="transport-bar__label">Valid Time</span>
          <strong>{validTimeLabel ?? `Hour ${appliedHourToken}`}</strong>
          <span className="transport-bar__detail">
            {cycleText ?? 'Forecast run unavailable'}
          </span>
          <span className="transport-bar__status">{transportStatus}</span>
        </div>

        <div className="transport-bar__controls">
          <button
            className="control-button control-button--transport"
            type="button"
            onClick={requestPrev}
            disabled={hourControlsDisabled}
            aria-label="Previous forecast frame"
          >
            <FaStepBackward aria-hidden="true" />
          </button>

          <button
            className="control-button control-button--primary control-button--play"
            type="button"
            onClick={togglePlay}
            disabled={hourControlsDisabled}
            aria-label={isPlaying ? 'Pause playback' : 'Play forecast timeline'}
          >
            {isPlaying ? <FaPause aria-hidden="true" /> : <FaPlay aria-hidden="true" />}
          </button>

          <button
            className="control-button control-button--transport"
            type="button"
            onClick={requestNext}
            disabled={hourControlsDisabled}
            aria-label="Next forecast frame"
          >
            <FaStepForward aria-hidden="true" />
          </button>
        </div>

        <div className="transport-bar__scrubber">
          <div className="transport-bar__scrubber-header">
            <span>Local Timeline</span>
            <span>
              Frame {appliedHourIdx + 1} of {forecastHourCount}
            </span>
          </div>

          <input
            key={appliedHourIdx}
            className="transport-bar__slider"
            type="range"
            min={0}
            max={maxHourIdx}
            step={1}
            defaultValue={appliedHourIdx}
            onChange={(event) => {
              if (isDraggingSlider) return
              commitSliderHour(Number(event.currentTarget.value))
            }}
            onPointerDown={() => setIsDraggingSlider(true)}
            onPointerUp={(event) => {
              setIsDraggingSlider(false)
              commitSliderHour(Number(event.currentTarget.value))
            }}
            onMouseUp={(event) => {
              setIsDraggingSlider(false)
              commitSliderHour(Number(event.currentTarget.value))
            }}
            onTouchEnd={(event) => {
              setIsDraggingSlider(false)
              commitSliderHour(Number(event.currentTarget.value))
            }}
            onBlur={(event) => {
              if (!isDraggingSlider) return
              setIsDraggingSlider(false)
              commitSliderHour(Number(event.currentTarget.value))
            }}
            disabled={hourControlsDisabled}
            aria-label="Forecast step"
          />

          <div className="transport-bar__ticks" aria-hidden="true">
            <span className="transport-bar__tick transport-bar__tick--edge">{startTickLabel}</span>
            <strong className="transport-bar__tick transport-bar__tick--current">{appliedTickLabel}</strong>
            <span className="transport-bar__tick transport-bar__tick--edge">{endTickLabel}</span>
          </div>
        </div>
      </div>
    </section>
  )
}
