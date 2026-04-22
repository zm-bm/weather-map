import { useState } from 'react'
import { FaPause, FaPlay, FaStepBackward, FaStepForward } from 'react-icons/fa'

import {
  formatShortTickLabel,
  formatValidLabel,
} from '../../forecast-time/format'
import {
  hourTokenAt,
  normalizeHourIndex,
} from '../../forecast-time/time'
import { useForecastTimeContext } from '../../forecast-time/ForecastTimeContext'

function getTransportStatusLabel(options: {
  isInFlight: boolean
  loadingHourLabel: string
  pendingHourLabel: string | null
}): string | null {
  const { isInFlight, loadingHourLabel, pendingHourLabel } = options
  if (isInFlight && pendingHourLabel != null) {
    return `Loading ${loadingHourLabel} · Queued ${pendingHourLabel}`
  }
  if (isInFlight) return `Loading ${loadingHourLabel}`
  if (pendingHourLabel != null) return `Queued ${pendingHourLabel}`
  return null
}

export default function TimelinePanel() {
  const {
    cycle,
    forecastHours,
    state: forecastTimeState,
    controls: forecastTimeControls,
  } = useForecastTimeContext()
  const {
    appliedHourIndex,
    targetHourIndex,
    pendingHourIndex,
    isInFlight,
    isPlaying,
  } = forecastTimeState
  const { requestHour, requestPrev, requestNext, togglePlay } = forecastTimeControls

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

  const startTickLabel = formatValidLabel(cycle, hourTokenAt(forecastHours, 0)) ?? 'Start'
  const appliedTickLabel = formatValidLabel(cycle, appliedHourToken) ?? 'Now'
  const endTickLabel = formatValidLabel(cycle, hourTokenAt(forecastHours, maxHourIdx)) ?? 'End'
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
    <section className="timeline-panel wm-module-shell lower-third__module" aria-label="Forecast timeline">
      <div className="timeline-panel__titlebar wm-titlebar wm-module-titlebar">
        <span className="timeline-panel__eyebrow wm-eyebrow">Timeline</span>
      </div>

      <div className="timeline-panel__body">
        <div className="timeline-panel__console lower-third__console">
          <div className="timeline-panel__control-row">
            <div className="timeline-panel__controls-bay">
              <div className="timeline-panel__controls" aria-label="Timeline transport controls">
                <button
                  className="panel-button wm-bevel-button panel-button--transport"
                  type="button"
                  onClick={requestPrev}
                  disabled={hourControlsDisabled}
                  aria-label="Previous forecast frame"
                >
                  <FaStepBackward aria-hidden="true" />
                </button>

                <button
                  className="panel-button wm-bevel-button panel-button--primary panel-button--play"
                  type="button"
                  onClick={togglePlay}
                  disabled={hourControlsDisabled}
                  aria-label={isPlaying ? 'Pause playback' : 'Play forecast timeline'}
                >
                  {isPlaying ? <FaPause aria-hidden="true" /> : <FaPlay aria-hidden="true" />}
                </button>

                <button
                  className="panel-button wm-bevel-button panel-button--transport"
                  type="button"
                  onClick={requestNext}
                  disabled={hourControlsDisabled}
                  aria-label="Next forecast frame"
                >
                  <FaStepForward aria-hidden="true" />
                </button>
              </div>

              {transportStatus ? (
                <span className="timeline-panel__status wm-mono-caps">{transportStatus}</span>
              ) : null}
            </div>

            <div className="timeline-panel__timeline-well">
              <div className="timeline-panel__scrubber-header wm-mono-caps">
                <span>Local Timeline</span>
              </div>

              <input
                key={appliedHourIdx}
                className="timeline-panel__slider"
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

              <div className="timeline-panel__ticks wm-mono-caps" aria-hidden="true">
                <span className="timeline-panel__tick timeline-panel__tick--edge">{startTickLabel}</span>
                <strong className="timeline-panel__tick timeline-panel__tick--current">{appliedTickLabel}</strong>
                <span className="timeline-panel__tick timeline-panel__tick--edge">{endTickLabel}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
