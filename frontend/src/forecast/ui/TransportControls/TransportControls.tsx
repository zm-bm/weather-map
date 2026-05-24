import { useEffect, useRef } from 'react'
import { FaPause, FaPlay, FaStepBackward, FaStepForward } from 'react-icons/fa'

import {
  clearPointerShortcut,
  isSpaceKey,
  markPointerShortcut,
  shouldIgnoreSpaceShortcut,
} from '@/core/keyboard'
import { useForecastTimeContext } from '@/forecast/time'
import { forecastTimeBounds } from '@/forecast/time'

function TransportControls() {
  const {
    times,
    state: { isPlaying },
    controls: {
      requestNext,
      requestPrev,
      togglePlay,
    },
  } = useForecastTimeContext()
  const transportDisabled = times.length <= 1 || forecastTimeBounds(times) == null
  const playButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isSpaceKey(event)) return
      if (event.repeat || event.defaultPrevented) return
      if (shouldIgnoreSpaceShortcut(event.target)) return
      if (transportDisabled) return

      event.preventDefault()
      playButtonRef.current?.click()
    }

    const handlePointerDown = (event: PointerEvent) => {
      markPointerShortcut(event.target)
    }

    const handleFocusOut = (event: FocusEvent) => {
      clearPointerShortcut(event.target)
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('focusout', handleFocusOut, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('focusout', handleFocusOut, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [transportDisabled])

  return (
    <section className="transport-controls timeline-bar__zone timeline-bar__zone--transport" aria-label="Timeline transport controls">
      <div className="transport-controls__row">
        <button
          className="panel-button wm-bevel-button transport-controls__button transport-controls__step-button"
          type="button"
          onClick={requestPrev}
          disabled={transportDisabled}
          aria-label="Step back ten minutes"
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
          onClick={requestNext}
          disabled={transportDisabled}
          aria-label="Step forward ten minutes"
        >
          <FaStepForward aria-hidden="true" />
        </button>
      </div>
    </section>
  )
}

export default TransportControls
