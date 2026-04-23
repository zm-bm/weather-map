import type { ChangeEvent } from 'react'
import { useState } from 'react'

import {
  SCALAR_COLOR_SAMPLING_MODES,
  type ScalarColorSamplingMode,
} from '../../../forecast-layers/scalar'

type OptionsControlViewProps = {
  scalarColorSamplingMode: ScalarColorSamplingMode
  onScalarColorSamplingModeChange: (nextValue: ScalarColorSamplingMode) => void
  reseedOnFrameChange: boolean
  onReseedOnFrameChange: (nextValue: boolean) => void
}

export function OptionsControlView({
  scalarColorSamplingMode: initialScalarColorSamplingMode,
  onScalarColorSamplingModeChange,
  reseedOnFrameChange: initialReseedOnFrameChange,
  onReseedOnFrameChange,
}: OptionsControlViewProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [scalarColorSamplingMode, setScalarColorSamplingMode] = useState(initialScalarColorSamplingMode)
  const [reseedOnFrameChange, setReseedOnFrameChange] = useState(initialReseedOnFrameChange)

  const handleToggle = () => {
    setIsOpen((value) => !value)
  }

  const handleReseedChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.currentTarget.checked
    setReseedOnFrameChange(nextValue)
    onReseedOnFrameChange(nextValue)
  }

  const handleScalarColorSamplingModeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.currentTarget.value as ScalarColorSamplingMode
    setScalarColorSamplingMode(nextValue)
    onScalarColorSamplingModeChange(nextValue)
  }

  return (
    <div className="maplibregl-ctrl maplibregl-ctrl-group maplibregl-ctrl-options">
      <button
        type="button"
        className="maplibregl-ctrl-options-toggle"
        title="Map options"
        aria-label="Map options"
        aria-pressed={isOpen}
        aria-expanded={isOpen}
        onClick={handleToggle}
      >
        <span className="maplibregl-ctrl-icon maplibregl-ctrl-icon--options" />
      </button>
      <div className="maplibregl-ctrl-options-panel" hidden={!isOpen}>
        <div className="maplibregl-ctrl-options-section">
          <div className="maplibregl-ctrl-options-heading wm-mono-caps">Scalar</div>
          <div className="maplibregl-ctrl-options-radio-group" role="radiogroup" aria-label="Scalar color sampling mode">
            {SCALAR_COLOR_SAMPLING_MODES.map((mode) => (
              <label className="maplibregl-ctrl-options-row wm-mono-caps" key={mode}>
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
        <div className="maplibregl-ctrl-options-divider" />
        <div className="maplibregl-ctrl-options-section">
          <div className="maplibregl-ctrl-options-heading wm-mono-caps">Vector</div>
          <label className="maplibregl-ctrl-options-row wm-mono-caps">
            <input
              type="checkbox"
              checked={reseedOnFrameChange}
              onChange={handleReseedChange}
            />
            <span>Reseed on frame change</span>
          </label>
        </div>
      </div>
    </div>
  )
}
