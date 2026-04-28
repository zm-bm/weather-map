import {
  useState,
  type ChangeEvent,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type TouchEvent,
} from 'react'
import { FaPause, FaPlay } from 'react-icons/fa'

import {
  formatValidTimeLabel,
  formatValidTimeTickLabel,
} from '../../forecast-time/format'
import {
  FORECAST_TIME_STEP_MINUTES,
  forecastTimeBounds,
  minuteOffsetForValidTime,
  validTimeMsForMinuteOffset,
} from '../../forecast-time/time'
import { useForecastTimeContext } from '../../forecast-time/ForecastTimeContext'

type SliderReleaseEvent =
  | PointerEvent<HTMLInputElement>
  | MouseEvent<HTMLInputElement>
  | TouchEvent<HTMLInputElement>

export default function TimelinePanel() {
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
    isPlaying,
  } = forecastTimeState
  const { requestTime, togglePlay } = forecastTimeControls

  const bounds = forecastTimeBounds(cycle, forecastHours)
  const totalMinutes = bounds?.totalMinutes ?? 0
  const requestedTimeMs = pendingTimeMs ?? targetTimeMs
  const requestedMinuteOffset = minuteOffsetForValidTime(cycle, forecastHours, requestedTimeMs)
  const timelineControlsDisabled = forecastHours.length <= 1 || bounds == null
  const [isDraggingSlider, setIsDraggingSlider] = useState(false)
  const [sliderDraftMinuteOffset, setSliderDraftMinuteOffset] = useState<number | null>(null)
  const sliderMinuteOffsetValue = sliderDraftMinuteOffset ?? requestedMinuteOffset

  const startTickLabel = formatValidTimeTickLabel(bounds?.startValidTimeMs) ?? 'Start'
  const appliedTickLabel = formatValidTimeLabel(appliedTimeMs) ?? 'Now'
  const endTickLabel = formatValidTimeTickLabel(bounds?.endValidTimeMs) ?? 'End'

  const commitSliderTime = (minuteOffset: number) => {
    if (timelineControlsDisabled) return
    requestTime(validTimeMsForMinuteOffset(cycle, forecastHours, minuteOffset))
  }

  const sliderMinuteOffset = (event: Pick<ChangeEvent<HTMLInputElement>, 'currentTarget'>) => (
    Number(event.currentTarget.value)
  )

  const finishSliderDrag = (minuteOffset: number) => {
    setIsDraggingSlider(false)
    setSliderDraftMinuteOffset(null)
    commitSliderTime(minuteOffset)
  }

  const handleSliderRelease = (event: SliderReleaseEvent) => {
    finishSliderDrag(sliderMinuteOffset(event))
  }

  return (
    <section className="timeline-panel wm-module-shell lower-third__module" aria-label="Forecast timeline">
      <div className="timeline-panel__body">
        <div className="timeline-panel__console lower-third__console">
          <div className="timeline-panel__control-row">
            <div className="timeline-panel__controls" aria-label="Timeline transport controls">
              <button
                className="panel-button wm-bevel-button panel-button--primary panel-button--play timeline-panel__play-button"
                type="button"
                onClick={togglePlay}
                disabled={timelineControlsDisabled}
                aria-label={isPlaying ? 'Pause playback' : 'Play forecast timeline'}
              >
                {isPlaying ? <FaPause aria-hidden="true" /> : <FaPlay aria-hidden="true" />}
              </button>
            </div>

            <div className="timeline-panel__timeline-well">
              <div className="timeline-panel__scrubber-header wm-mono-caps">
                <span>Local Timeline</span>
              </div>

              <input
                className="timeline-panel__slider"
                type="range"
                min={0}
                max={totalMinutes}
                step={FORECAST_TIME_STEP_MINUTES}
                value={sliderMinuteOffsetValue}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  const minuteOffset = sliderMinuteOffset(event)
                  if (isDraggingSlider) {
                    setSliderDraftMinuteOffset(minuteOffset)
                    return
                  }
                  commitSliderTime(minuteOffset)
                }}
                onPointerDown={(event: PointerEvent<HTMLInputElement>) => {
                  setIsDraggingSlider(true)
                  setSliderDraftMinuteOffset(sliderMinuteOffset(event))
                }}
                onPointerUp={handleSliderRelease}
                onMouseUp={handleSliderRelease}
                onTouchEnd={handleSliderRelease}
                onBlur={(event: FocusEvent<HTMLInputElement>) => {
                  if (!isDraggingSlider) return
                  finishSliderDrag(sliderMinuteOffset(event))
                }}
                disabled={timelineControlsDisabled}
                aria-label="Forecast time"
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
