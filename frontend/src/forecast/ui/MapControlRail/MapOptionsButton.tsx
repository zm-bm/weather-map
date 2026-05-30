import type { ChangeEvent } from 'react'
import { useEffect, useRef, useState } from 'react'

import {
  DEFAULT_PARTICLE_RENDER_SETTINGS,
  PARTICLE_COUNT_MAX,
  PARTICLE_COUNT_MIN,
  PARTICLE_COUNT_STEP,
  PARTICLE_FLOW_SPEED_RATIO_MAX,
  PARTICLE_FLOW_SPEED_RATIO_MIN,
  PARTICLE_FLOW_SPEED_RATIO_STEP,
  PARTICLE_SIZE_RATIO_MAX,
  PARTICLE_SIZE_RATIO_MIN,
  PARTICLE_SIZE_RATIO_STEP,
  PARTICLE_TRAIL_LENGTH_MAX,
  PARTICLE_TRAIL_LENGTH_MIN,
  PARTICLE_TRAIL_LENGTH_STEP,
  PARTICLE_TRAIL_OPACITY_MAX,
  PARTICLE_TRAIL_OPACITY_MIN,
  PARTICLE_TRAIL_OPACITY_STEP,
  RASTER_COLOR_SAMPLING_MODES,
  RASTER_OPACITY_MAX,
  RASTER_OPACITY_MIN,
  RASTER_OPACITY_STEP,
  particleSizeRatioForSettings,
  particleSizeSettingsForRatio,
  particleTrailFadeFromLength,
  particleTrailLengthFromFade,
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
  const particleSpeedRatio = settings.particles.flowSpeedScale /
    DEFAULT_PARTICLE_RENDER_SETTINGS.flowSpeedScale
  const particleSizeRatio = particleSizeRatioForSettings(settings.particles)
  const particleTrailLength = particleTrailLengthFromFade(settings.particles.trailFade)

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

  const handleLayerOpacityChange = (value: number) => {
    settingsActions.updateRaster({ opacity: value })
  }

  const handleParticleDensityChange = (value: number) => {
    settingsActions.updateParticles({ particleCount: value })
  }

  const handleParticleSpeedChange = (value: number) => {
    settingsActions.updateParticles({
      flowSpeedScale: Math.round(
        DEFAULT_PARTICLE_RENDER_SETTINGS.flowSpeedScale * value
      ),
    })
  }

  const handleParticleSizeChange = (value: number) => {
    settingsActions.updateParticles(particleSizeSettingsForRatio(value))
  }

  const handleParticleTrailOpacityChange = (value: number) => {
    settingsActions.updateParticles({
      trailCompositeOpacity: value,
    })
  }

  const handleParticleTrailLengthChange = (value: number) => {
    settingsActions.updateParticles({
      trailFade: particleTrailFadeFromLength(value),
    })
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
          <OptionSlider
            label="Opacity"
            ariaLabel="Layer opacity"
            value={settings.raster.opacity}
            valueText={formatPercent(settings.raster.opacity)}
            min={RASTER_OPACITY_MIN}
            max={RASTER_OPACITY_MAX}
            step={RASTER_OPACITY_STEP}
            onChange={handleLayerOpacityChange}
          />
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
          <OptionSlider
            label="Density"
            ariaLabel="Particle density"
            value={settings.particles.particleCount}
            valueText={formatParticleCount(settings.particles.particleCount)}
            min={PARTICLE_COUNT_MIN}
            max={PARTICLE_COUNT_MAX}
            step={PARTICLE_COUNT_STEP}
            disabled={!settings.particles.enabled}
            onChange={handleParticleDensityChange}
          />
          <OptionSlider
            label="Speed"
            ariaLabel="Particle speed"
            value={particleSpeedRatio}
            valueText={formatRatio(particleSpeedRatio)}
            min={PARTICLE_FLOW_SPEED_RATIO_MIN}
            max={PARTICLE_FLOW_SPEED_RATIO_MAX}
            step={PARTICLE_FLOW_SPEED_RATIO_STEP}
            disabled={!settings.particles.enabled}
            onChange={handleParticleSpeedChange}
          />
          <OptionSlider
            label="Size"
            ariaLabel="Particle size"
            value={particleSizeRatio}
            valueText={formatRatio(particleSizeRatio)}
            min={PARTICLE_SIZE_RATIO_MIN}
            max={PARTICLE_SIZE_RATIO_MAX}
            step={PARTICLE_SIZE_RATIO_STEP}
            disabled={!settings.particles.enabled}
            onChange={handleParticleSizeChange}
          />
          <OptionSlider
            label="Trail opacity"
            ariaLabel="Particle trail opacity"
            value={settings.particles.trailCompositeOpacity}
            valueText={formatPercent(settings.particles.trailCompositeOpacity)}
            min={PARTICLE_TRAIL_OPACITY_MIN}
            max={PARTICLE_TRAIL_OPACITY_MAX}
            step={PARTICLE_TRAIL_OPACITY_STEP}
            disabled={!settings.particles.enabled}
            onChange={handleParticleTrailOpacityChange}
          />
          <OptionSlider
            label="Trail length"
            ariaLabel="Particle trail length"
            value={particleTrailLength}
            valueText={formatTrailLength(particleTrailLength)}
            min={PARTICLE_TRAIL_LENGTH_MIN}
            max={PARTICLE_TRAIL_LENGTH_MAX}
            step={PARTICLE_TRAIL_LENGTH_STEP}
            disabled={!settings.particles.enabled}
            onChange={handleParticleTrailLengthChange}
          />
        </div>
      </div>
    </div>
  )
}

type OptionSliderProps = {
  label: string
  ariaLabel: string
  value: number
  valueText: string
  min: number
  max: number
  step: number
  disabled?: boolean
  onChange: (value: number) => void
}

function OptionSlider({
  label,
  ariaLabel,
  value,
  valueText,
  min,
  max,
  step,
  disabled = false,
  onChange,
}: OptionSliderProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(Number(event.currentTarget.value))
  }

  return (
    <label className="map-control-options-slider-row wm-mono-caps">
      <span className="map-control-options-slider-label">
        <span>{label}</span>
        <span className="map-control-options-value">{valueText}</span>
      </span>
      <input
        aria-label={ariaLabel}
        className="map-control-options-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={handleChange}
      />
    </label>
  )
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function formatParticleCount(value: number): string {
  return `${Math.round(value / 1000)}k`
}

function formatRatio(value: number): string {
  return `${value.toFixed(1)}x`
}

function formatTrailLength(value: number): string {
  return `${value}/10`
}
