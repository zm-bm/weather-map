import { FaPause, FaPlay, FaStepBackward, FaStepForward } from 'react-icons/fa'

import { useForecastTimeContext } from '../../forecast-time/ForecastTimeContext'
import { forecastTimeBounds } from '../../forecast-time/time'

function TransportControls() {
  const {
    cycle,
    forecastHours,
    state: { isPlaying },
    controls: { togglePlay },
  } = useForecastTimeContext()
  const transportDisabled = forecastHours.length <= 1 || forecastTimeBounds(cycle, forecastHours) == null

  return (
    <section className="transport-controls timeline-bar__zone timeline-bar__zone--transport" aria-label="Timeline transport controls">
      <div className="transport-controls__row">
        <button
          className="panel-button wm-bevel-button transport-controls__button transport-controls__step-button"
          type="button"
          disabled
          aria-label="Step back one hour"
        >
          <FaStepBackward aria-hidden="true" />
        </button>

        <button
          className="panel-button wm-bevel-button panel-button--primary panel-button--play transport-controls__button transport-controls__play-button"
          type="button"
          onClick={togglePlay}
          disabled={transportDisabled}
          aria-label={isPlaying ? 'Pause playback' : 'Play forecast timeline'}
        >
          {isPlaying ? <FaPause aria-hidden="true" /> : <FaPlay aria-hidden="true" />}
        </button>

        <button
          className="panel-button wm-bevel-button transport-controls__button transport-controls__step-button"
          type="button"
          disabled
          aria-label="Step forward one hour"
        >
          <FaStepForward aria-hidden="true" />
        </button>
      </div>
    </section>
  )
}

export default TransportControls
