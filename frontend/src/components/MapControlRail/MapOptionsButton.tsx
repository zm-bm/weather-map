import type { ChangeEvent } from 'react'
import { useEffect, useRef, useState } from 'react'

import {
  SCALAR_COLOR_SAMPLING_MODES,
  type ScalarColorSamplingMode,
  type ScalarRuntimeOptions,
} from '../../forecast-layers/options'
import type { VectorRuntimeOptions } from '../../forecast-layers/options'

export type MapOptionsButtonProps = {
  scalarOptions: ScalarRuntimeOptions,
  vectorOptions: VectorRuntimeOptions,
  onScalarColorSamplingModeChange: (nextValue: ScalarColorSamplingMode) => void
  onClearTrailsOnViewChange: (nextValue: boolean) => void
}

export default function MapOptionsButton({
  scalarOptions,
  vectorOptions,
  onScalarColorSamplingModeChange,
  onClearTrailsOnViewChange,
}: MapOptionsButtonProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [scalarColorSamplingMode, setScalarColorSamplingMode] = useState(scalarOptions.colorSamplingMode)
  const [clearTrailsOnViewChange, setClearTrailsOnViewChange] = useState(vectorOptions.clearTrailsOnViewChange)

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      const root = rootRef.current
      if (!root || !(event.target instanceof Node)) return
      if (root.contains(event.target)) return

      setIsOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown, true)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [isOpen])

  const handleToggle = () => {
    setIsOpen((value) => !value)
  }

  const handleClearTrailsOnViewChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.currentTarget.checked
    setClearTrailsOnViewChange(nextValue)
    onClearTrailsOnViewChange(nextValue)
  }

  const handleScalarColorSamplingModeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.currentTarget.value as ScalarColorSamplingMode
    setScalarColorSamplingMode(nextValue)
    onScalarColorSamplingModeChange(nextValue)
  }

  return (
    <div ref={rootRef} className="map-control-group map-control-options">
      <button
        type="button"
        className="map-control-button map-control-button--options"
        title="Map options"
        aria-label="Map options"
        aria-pressed={isOpen}
        aria-expanded={isOpen}
        onClick={handleToggle}
      >
        <span className="map-control-icon map-control-icon--options" />
      </button>
      <div className="map-control-options-panel" hidden={!isOpen}>
        <div className="map-control-options-section">
          <div className="map-control-options-heading wm-mono-caps">Scalar</div>
          <div className="map-control-options-radio-group" role="radiogroup" aria-label="Scalar color sampling mode">
            {SCALAR_COLOR_SAMPLING_MODES.map((mode) => (
              <label className="map-control-options-row wm-mono-caps" key={mode}>
                <input
                  type="radio"
                  name="scalar-color-sampling-mode"
                  value={mode}
                  checked={scalarColorSamplingMode === mode}
                  onChange={handleScalarColorSamplingModeChange}
                />
                <span>{mode === 'interpolated' ? 'Interpolated' : 'Banded'}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="map-control-options-divider" />
        <div className="map-control-options-section">
          <div className="map-control-options-heading wm-mono-caps">Vector</div>
          <label className="map-control-options-row wm-mono-caps">
            <input
              type="checkbox"
              checked={clearTrailsOnViewChange}
              onChange={handleClearTrailsOnViewChange}
            />
            <span>Clear trails on view change</span>
          </label>
        </div>
      </div>
    </div>
  )
}
