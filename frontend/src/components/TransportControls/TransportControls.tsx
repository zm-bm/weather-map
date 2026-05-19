import { useEffect, useRef } from 'react'
import { FaPause, FaPlay, FaStepBackward, FaStepForward } from 'react-icons/fa'

import { allowsSpaceShortcut, isSpaceKey } from '../../keyboard'
import { useForecastTimeContext } from '../../forecast-time'
import { forecastTimeBounds } from '../../forecast-time'

function shouldIgnoreShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false

  const interactiveTarget = target.closest(
    'a[href], button, input, select, textarea, [contenteditable="true"], [role="textbox"]'
  )
  if (interactiveTarget instanceof HTMLSelectElement) {
    return !allowsSpaceShortcut(interactiveTarget)
  }

  return Boolean(interactiveTarget)
}

function TransportControls() {
  const {
    times,
    state: { isPlaying },
    controls: { togglePlay },
  } = useForecastTimeContext()
  const transportDisabled = times.length <= 1 || forecastTimeBounds(times) == null
  const playButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isSpaceKey(event)) return
      if (event.repeat || event.defaultPrevented) return
      if (shouldIgnoreShortcutTarget(event.target)) return
      if (transportDisabled) return

      event.preventDefault()
      playButtonRef.current?.click()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [transportDisabled])

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
          ref={playButtonRef}
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
