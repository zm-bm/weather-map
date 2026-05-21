import type { ChangeEvent } from 'react'
import { useEffect, useRef, useState } from 'react'

import {
  FIELD_COLOR_SAMPLING_MODES,
  type FieldColorSamplingMode,
  type FieldRuntimeOptions,
  type ParticleRuntimeOptions,
} from '../../forecast-render/options'

export type MapOptionsButtonProps = {
  layerColorOptions: FieldRuntimeOptions,
  particleOptions: ParticleRuntimeOptions,
  particlesEnabled: boolean
  pressureContoursEnabled: boolean
  onLayerColorSamplingModeChange: (nextValue: FieldColorSamplingMode) => void
  onClearTrailsOnViewChange: (nextValue: boolean) => void
  onParticlesEnabledChange: (nextValue: boolean) => void
  onPressureContoursEnabledChange: (nextValue: boolean) => void
}

export default function MapOptionsButton({
  layerColorOptions,
  particleOptions,
  particlesEnabled,
  pressureContoursEnabled,
  onLayerColorSamplingModeChange,
  onClearTrailsOnViewChange,
  onParticlesEnabledChange,
  onPressureContoursEnabledChange,
}: MapOptionsButtonProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [layerColorSamplingMode, setLayerColorSamplingMode] = useState(layerColorOptions.colorSamplingMode)
  const [clearTrailsOnViewChange, setClearTrailsOnViewChange] = useState(particleOptions.clearTrailsOnViewChange)

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

  const handleParticlesEnabledChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.currentTarget.checked
    onParticlesEnabledChange(nextValue)
  }

  const handlePressureContoursEnabledChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.currentTarget.checked
    onPressureContoursEnabledChange(nextValue)
  }

  const handleLayerColorSamplingModeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.currentTarget.value as FieldColorSamplingMode
    setLayerColorSamplingMode(nextValue)
    onLayerColorSamplingModeChange(nextValue)
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
          <div className="map-control-options-heading wm-mono-caps">Layer Color</div>
          <div className="map-control-options-radio-group" role="radiogroup" aria-label="Layer color sampling mode">
            {FIELD_COLOR_SAMPLING_MODES.map((mode) => (
              <label className="map-control-options-row wm-mono-caps" key={mode}>
                <input
                  type="radio"
                  name="layer-color-sampling-mode"
                  value={mode}
                  checked={layerColorSamplingMode === mode}
                  onChange={handleLayerColorSamplingModeChange}
                />
                <span>{mode === 'interpolated' ? 'Interpolated' : 'Banded'}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="map-control-options-divider" />
        <div className="map-control-options-section">
          <div className="map-control-options-heading wm-mono-caps">Overlays</div>
          <label className="map-control-options-row wm-mono-caps">
            <input
              type="checkbox"
              checked={pressureContoursEnabled}
              onChange={handlePressureContoursEnabledChange}
            />
            <span>Show pressure contours</span>
          </label>
        </div>
        <div className="map-control-options-divider" />
        <div className="map-control-options-section">
          <div className="map-control-options-heading wm-mono-caps">Particles</div>
          <label className="map-control-options-row wm-mono-caps">
            <input
              type="checkbox"
              checked={particlesEnabled}
              onChange={handleParticlesEnabledChange}
            />
            <span>Show particles</span>
          </label>
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
