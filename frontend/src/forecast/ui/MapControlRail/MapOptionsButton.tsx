import type { CSSProperties } from 'react'
import { useCallback, useRef } from 'react'

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
  RASTER_GRID_SAMPLING_MODES,
  RASTER_OPACITY_MAX,
  RASTER_OPACITY_MIN,
  RASTER_OPACITY_STEP,
  particleSizeRatioForSettings,
  particleSizeSettingsForRatio,
  particleTrailFadeFromLength,
  particleTrailLengthFromFade,
  useForecastSettings,
  type RasterColorSamplingMode,
  type RasterGridSamplingMode,
} from '@/forecast/settings'
import { useDismissablePanel } from '../useDismissablePanel'

export type MapOptionsButtonProps = {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
}

export default function MapOptionsButton({
  isOpen,
  onOpenChange,
}: MapOptionsButtonProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const { settings, actions } = useForecastSettings()
  const particleSpeedRatio = settings.particles.flowSpeedScale /
    DEFAULT_PARTICLE_RENDER_SETTINGS.flowSpeedScale
  const particleSizeRatio = particleSizeRatioForSettings(settings.particles)
  const particleTrailLength = particleTrailLengthFromFade(settings.particles.trailFade)
  const windControlsDisabled = !settings.particles.enabled
  const closePanel = useCallback(() => onOpenChange(false), [onOpenChange])

  useDismissablePanel(isOpen, rootRef, closePanel)

  const handleToggle = () => {
    onOpenChange(!isOpen)
  }

  return (
    <div ref={rootRef} className="map-control-group map-control-options">
      <button
        type="button"
        className="map-control-button map-control-button--options"
        title="Map display options"
        aria-label="Map display options"
        aria-pressed={isOpen}
        aria-expanded={isOpen}
        onClick={handleToggle}
      >
        <span className="map-control-icon map-control-icon--options" />
      </button>
      {isOpen ? (
        <div className="map-control-options-panel">
          <div className="map-control-options-header">
            <strong className="map-control-options-title wm-display-caps">Display Options</strong>
            <button
              type="button"
              className="map-control-options-close"
              aria-label="Close display options"
              onClick={closePanel}
            >
              <span className="map-control-options-close-icon" aria-hidden="true" />
            </button>
          </div>
          <section className="map-control-options-section">
            <div className="map-control-options-heading wm-mono-caps">Layer</div>
            <div className="map-control-options-subheading wm-mono-caps">Color style</div>
            <div className="map-control-options-radio-group" role="radiogroup" aria-label="Color sampling mode">
              {RASTER_COLOR_SAMPLING_MODES.map((mode) => (
                <label className="map-control-options-row wm-mono-caps" key={mode}>
                  <input
                    type="radio"
                    name="color-sampling-mode"
                    value={mode}
                    checked={settings.raster.colorSamplingMode === mode}
                    onChange={(event) => actions.updateRaster({
                      colorSamplingMode: event.currentTarget.value as RasterColorSamplingMode,
                    })}
                  />
                  <span>{colorSamplingModeLabel(mode)}</span>
                </label>
              ))}
            </div>
            <div className="map-control-options-subheading wm-mono-caps">Grid</div>
            <div className="map-control-options-radio-group" role="radiogroup" aria-label="Grid sampling mode">
              {RASTER_GRID_SAMPLING_MODES.map((mode) => (
                <label className="map-control-options-row wm-mono-caps" key={mode}>
                  <input
                    type="radio"
                    name="grid-sampling-mode"
                    value={mode}
                    checked={settings.raster.gridSamplingMode === mode}
                    onChange={(event) => actions.updateRaster({
                      gridSamplingMode: event.currentTarget.value as RasterGridSamplingMode,
                    })}
                  />
                  <span>{gridSamplingModeLabel(mode)}</span>
                </label>
              ))}
            </div>
            <OptionSlider
              label="Opacity"
              name="layer-opacity"
              value={settings.raster.opacity}
              valueText={formatPercent(settings.raster.opacity)}
              min={RASTER_OPACITY_MIN}
              max={RASTER_OPACITY_MAX}
              step={RASTER_OPACITY_STEP}
              onChange={(value) => actions.updateRaster({ opacity: value })}
            />
          </section>
          <div className="map-control-options-divider" />
          <section className="map-control-options-section">
            <div className="map-control-options-heading wm-mono-caps">Effects</div>
            <label className="map-control-options-row wm-mono-caps">
              <input
                type="checkbox"
                name="pressure-contours-enabled"
                checked={settings.pressureContours.enabled}
                onChange={(event) => actions.updatePressureContours({
                  enabled: event.currentTarget.checked,
                })}
              />
              <span>Pressure contours</span>
            </label>
            <label className="map-control-options-row wm-mono-caps">
              <input
                type="checkbox"
                name="particles-enabled"
                checked={settings.particles.enabled}
                onChange={(event) => actions.updateParticles({
                  enabled: event.currentTarget.checked,
                })}
              />
              <span>Wind animation</span>
            </label>
          </section>
          <div className="map-control-options-divider" />
          <section className="map-control-options-section">
            <div className="map-control-options-heading wm-mono-caps">Wind</div>
            <OptionSlider
              label="Density"
              name="particle-density"
              value={settings.particles.particleCount}
              valueText={formatParticleCount(settings.particles.particleCount)}
              min={PARTICLE_COUNT_MIN}
              max={PARTICLE_COUNT_MAX}
              step={PARTICLE_COUNT_STEP}
              disabled={windControlsDisabled}
              onChange={(value) => actions.updateParticles({ particleCount: value })}
            />
            <OptionSlider
              label="Speed"
              name="particle-speed"
              value={particleSpeedRatio}
              valueText={formatRatio(particleSpeedRatio)}
              min={PARTICLE_FLOW_SPEED_RATIO_MIN}
              max={PARTICLE_FLOW_SPEED_RATIO_MAX}
              step={PARTICLE_FLOW_SPEED_RATIO_STEP}
              disabled={windControlsDisabled}
              onChange={(value) => actions.updateParticles({
                flowSpeedScale: Math.round(DEFAULT_PARTICLE_RENDER_SETTINGS.flowSpeedScale * value),
              })}
            />
            <OptionSlider
              label="Size"
              name="particle-size"
              value={particleSizeRatio}
              valueText={formatRatio(particleSizeRatio)}
              min={PARTICLE_SIZE_RATIO_MIN}
              max={PARTICLE_SIZE_RATIO_MAX}
              step={PARTICLE_SIZE_RATIO_STEP}
              disabled={windControlsDisabled}
              onChange={(value) => actions.updateParticles(particleSizeSettingsForRatio(value))}
            />
            <OptionSlider
              label="Trail length"
              name="particle-trail-length"
              value={particleTrailLength}
              valueText={formatTrailLength(particleTrailLength)}
              min={PARTICLE_TRAIL_LENGTH_MIN}
              max={PARTICLE_TRAIL_LENGTH_MAX}
              step={PARTICLE_TRAIL_LENGTH_STEP}
              disabled={windControlsDisabled}
              onChange={(value) => actions.updateParticles({
                trailFade: particleTrailFadeFromLength(value),
              })}
            />
            <OptionSlider
              label="Trail opacity"
              name="particle-trail-opacity"
              value={settings.particles.trailCompositeOpacity}
              valueText={formatPercent(settings.particles.trailCompositeOpacity)}
              min={PARTICLE_TRAIL_OPACITY_MIN}
              max={PARTICLE_TRAIL_OPACITY_MAX}
              step={PARTICLE_TRAIL_OPACITY_STEP}
              disabled={windControlsDisabled}
              onChange={(value) => actions.updateParticles({ trailCompositeOpacity: value })}
            />
          </section>
        </div>
      ) : null}
    </div>
  )
}

type OptionSliderProps = {
  label: string
  name: string
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
  name,
  value,
  valueText,
  min,
  max,
  step,
  disabled = false,
  onChange,
}: OptionSliderProps) {
  const valuePercent = max === min
    ? 0
    : Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
  const sliderStyle = {
    '--wm-map-options-slider-value': `${valuePercent.toFixed(2)}%`,
  } as CSSProperties

  return (
    <label className="map-control-options-slider-row wm-mono-caps">
      <span className="map-control-options-slider-label">
        <span>{label}</span>
        <span className="map-control-options-value">{valueText}</span>
      </span>
      <input
        aria-valuetext={valueText}
        className="map-control-options-slider"
        type="range"
        name={name}
        min={min}
        max={max}
        step={step}
        value={value}
        style={sliderStyle}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  )
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function gridSamplingModeLabel(mode: RasterGridSamplingMode): string {
  return mode === 'smooth' ? 'Interpolated' : 'Nearest'
}

function colorSamplingModeLabel(mode: RasterColorSamplingMode): string {
  return mode === 'gradient' ? 'Gradient' : 'Banded'
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
