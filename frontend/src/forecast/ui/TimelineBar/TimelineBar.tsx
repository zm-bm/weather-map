import { FaClock, FaPause, FaPlay } from 'react-icons/fa'

import {
  forecastTimeBounds,
  useForecastTimeContext,
} from '@/forecast/time'
import TimelineScrubber from '../TimelineScrubber'

function TimelineBar() {
  const {
    times,
    state: {
      targetTimeMs,
      pendingTimeMs,
      isPlaying,
    },
    controls: {
      requestTime,
      resetToNow,
      togglePlay,
    },
  } = useForecastTimeContext()
  const bounds = forecastTimeBounds(times)
  const disabled = times.length <= 1 || bounds == null

  return (
    <section
      className="timeline-bar wm-docked-band-shell"
      aria-label="Forecast timeline controls"
    >
      <div className="timeline-bar__grid">
        <section className="timeline-bar__control timeline-bar__zone timeline-bar__zone--transport" aria-label="Timeline playback controls">
          <div className="timeline-bar__control-row">
            <button
              className="panel-button wm-bevel-button panel-button--primary timeline-bar__button timeline-bar__button--play"
              type="button"
              onClick={togglePlay}
              disabled={disabled}
              aria-label={isPlaying ? 'Pause playback' : 'Play forecast timeline'}
              data-playback-state={isPlaying ? 'playing' : 'idle'}
            >
              {isPlaying ? <FaPause aria-hidden="true" /> : <FaPlay aria-hidden="true" />}
            </button>
          </div>
        </section>

        <TimelineScrubber
          times={times}
          bounds={bounds}
          requestedTimeMs={pendingTimeMs ?? targetTimeMs}
          disabled={disabled}
          onRequestTime={requestTime}
        />

        <section className="timeline-bar__control timeline-bar__zone timeline-bar__zone--reset" aria-label="Timeline reset controls">
          <div className="timeline-bar__control-row">
            <button
              className="panel-button wm-bevel-button timeline-bar__button timeline-bar__button--reset"
              type="button"
              onClick={resetToNow}
              disabled={disabled}
              aria-label="Reset timeline to now"
            >
              <FaClock aria-hidden="true" />
            </button>
          </div>
        </section>
      </div>
    </section>
  )
}

export default TimelineBar
