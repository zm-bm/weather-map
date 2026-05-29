import type { ChangeEvent } from 'react'
import { useEffect, useRef, useState } from 'react'

import {
  RASTER_COLOR_SAMPLING_MODES,
  type RasterColorSamplingMode,
  type ForecastSettings,
  type ForecastSettingsActions,
} from '@/forecast/settings'

export type MapOptionsButtonProps = {
  settings: ForecastSettings
  settingsActions: ForecastSettingsActions
}

export default function MapOptionsButton({
  settings,
  settingsActions,
}: MapOptionsButtonProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)

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

  const handleParticlesEnabledChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.currentTarget.checked
    settingsActions.updateParticles({ enabled: nextValue })
  }

  const handlePressureContoursEnabledChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.currentTarget.checked
    settingsActions.updatePressureContours({ enabled: nextValue })
  }

  const handleLayerColorSamplingModeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.currentTarget.value as RasterColorSamplingMode
    settingsActions.updateRaster({ colorSamplingMode: nextValue })
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
            {RASTER_COLOR_SAMPLING_MODES.map((mode) => (
              <label className="map-control-options-row wm-mono-caps" key={mode}>
                <input
                  type="radio"
                  name="layer-color-sampling-mode"
                  value={mode}
                  checked={settings.raster.colorSamplingMode === mode}
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
              checked={settings.pressureContours.enabled}
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
              checked={settings.particles.enabled}
              onChange={handleParticlesEnabledChange}
            />
            <span>Show particles</span>
          </label>
        </div>
      </div>
    </div>
  )
}
