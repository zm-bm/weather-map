import type { CSSProperties } from 'react'

import { useLoadedForecastSelectionContext } from '@/forecast/selection'
import { useForecastSettings } from '@/forecast/settings'
import {
  getForecastRasterLayer,
  type ForecastRasterLayer,
} from '@/forecast/catalog'
import {
  getLegendTicks,
  toLegendContinuousGradient,
} from '@/forecast/display/legend'
import {
  samplePaletteColor,
  type PaletteColorStop,
  type SampledPaletteColor,
} from '@/forecast/display/palette'
import {
  canToggleUnitSystem,
  getUnitOptionForSystem,
  type GradientUnitOption,
  type UnitSystem,
} from '@/forecast/display/units'

type LegendScaleTick = {
  id: string
  label: string
  positionPct: number
}

type ScaleSpec = {
  id: string
  ariaLabel: string
  backgroundImage: string
  unitLabel: string
  ticks?: readonly LegendScaleTick[]
  footerLabel?: string
  onClick?: () => void
}

type CloudLayerDisplay = Extract<ForecastRasterLayer['display'], { kind: 'cloud-layers' }>

const LEGEND_LABEL_INPUT_MIN_PCT = 6
const LEGEND_LABEL_INPUT_MAX_PCT = 94
const LEGEND_LABEL_OUTPUT_MIN_PCT = 6
const LEGEND_LABEL_OUTPUT_MAX_PCT = 86
const CLOUD_LAYER_SCALE_GROUP_LABEL = 'Low, middle, and high cloud layer opacity from 0 to 100 percent'
const CLOUD_LAYER_SCALES = [
  { id: 'low', label: 'LOW', ariaName: 'Low' },
  { id: 'middle', label: 'MID', ariaName: 'Middle' },
  { id: 'high', label: 'HIGH', ariaName: 'High' },
] as const

export default function LegendPanel() {
  const { selectedLayerId } = useLoadedForecastSelectionContext()
  const {
    settings,
    actions,
  } = useForecastSettings()
  if (selectedLayerId == null) return null

  const layer = getForecastRasterLayer(selectedLayerId)
  if (layer == null) return null

  const display = layer.display
  const scaleSpecs = legendScaleSpecsForLayer({
    layer,
    unitSystem: settings.units.system,
    onToggleUnitSystem: actions.toggleUnitSystem,
  })
  const scales = scaleSpecs.map((spec) => (
    <LegendScale key={spec.id} spec={spec} />
  ))
  const panelClassName = display.kind === 'cloud-layers'
    ? 'legend-panel legend-panel--cloud-layers'
    : 'legend-panel'

  return (
    <section
      className={panelClassName}
      aria-label={`${display.label} legend`}
    >
      {scaleSpecs.length === 1 ? (
        scales
      ) : (
        <div className="legend-panel__scale-group" aria-label={CLOUD_LAYER_SCALE_GROUP_LABEL}>
          {scales}
        </div>
      )}
    </section>
  )
}

function legendScaleSpecsForLayer({
  layer,
  unitSystem,
  onToggleUnitSystem,
}: {
  layer: ForecastRasterLayer
  unitSystem: UnitSystem
  onToggleUnitSystem: () => void
}): readonly ScaleSpec[] {
  const display = layer.display
  if (display.kind === 'cloud-layers') {
    const selectedOption = getUnitOptionForSystem(display.units, unitSystem)
    return cloudLayerScales(display, selectedOption.label)
  }

  const selectedOption = getUnitOptionForSystem(display.units, unitSystem)
  const canCycleUnits = canToggleUnitSystem(display.units)
  return [gradientScale({
    layerId: layer.id,
    label: display.label,
    canCycleUnits,
    onToggleUnitSystem,
    paletteStops: display.palette.stops,
    selectedOption,
  })]
}

function gradientScale({
  layerId,
  label,
  canCycleUnits,
  onToggleUnitSystem,
  paletteStops,
  selectedOption,
}: {
  layerId: string
  label: string
  canCycleUnits: boolean
  onToggleUnitSystem: () => void
  paletteStops: readonly PaletteColorStop[]
  selectedOption: GradientUnitOption
}): ScaleSpec {
  const legendGradient = toLegendContinuousGradient(
    paletteStops,
    'to top'
  )
  const legendTicks = getLegendTicks(selectedOption).map((tick) => ({
    id: `${layerId}-${selectedOption.id}-${tick.value}`,
    label: tick.label,
    positionPct: insetTickPositionPct(tick.positionPct),
  }))

  return {
    id: layerId,
    ariaLabel: canCycleUnits
      ? `Cycle ${label} units. Current units ${selectedOption.label}.`
      : `${label} units ${selectedOption.label}.`,
    backgroundImage: legendGradient,
    unitLabel: selectedOption.label,
    ticks: legendTicks,
    onClick: canCycleUnits ? onToggleUnitSystem : undefined,
  }
}

function cloudLayerScales(
  display: CloudLayerDisplay,
  unitLabel: string,
): readonly ScaleSpec[] {
  return CLOUD_LAYER_SCALES.map(({ id, label, ariaName }) => {
    const palette = display.bandPalettes[id]
    if (!palette) {
      throw new Error(`Display profile ${display.label} has no palette for band ${id}`)
    }

    return {
      id,
      ariaLabel: `${ariaName} cloud layer opacity units ${unitLabel}.`,
      backgroundImage: toLegendContinuousGradient(
        cloudLayerOpacityStops(samplePaletteColor(palette.stops, 100, 'interpolated')),
        'to top',
      ),
      unitLabel,
      footerLabel: label,
    }
  })
}

function LegendScale({
  spec,
}: {
  spec: ScaleSpec
}) {
  const {
    ariaLabel,
    backgroundImage,
    footerLabel,
    onClick,
    ticks = [],
    unitLabel,
  } = spec
  const interactive = onClick != null
  const scaleClassName = interactive
    ? 'legend-panel__scale legend-panel__scale--interactive'
    : 'legend-panel__scale'
  const scaleStyle = { backgroundImage } satisfies CSSProperties
  const scaleContent = (
    <>
      <span className="legend-panel__scale-unit">{unitLabel}</span>
      {ticks.map((tick) => (
        <span
          key={tick.id}
          className="legend-panel__tick-label"
          style={{ bottom: `${tick.positionPct.toFixed(2)}%` }}
        >
          {tick.label}
        </span>
      ))}
    </>
  )

  return (
    <div className="legend-panel__scale-wrap">
      {interactive ? (
        <button
          type="button"
          className={scaleClassName}
          style={scaleStyle}
          aria-label={ariaLabel}
          onClick={onClick}
        >
          {scaleContent}
        </button>
      ) : (
        <div
          className={scaleClassName}
          style={scaleStyle}
          aria-label={ariaLabel}
        >
          {scaleContent}
        </div>
      )}
      {footerLabel ? (
        <span className="legend-panel__scale-footer">{footerLabel}</span>
      ) : null}
    </div>
  )
}

function insetTickPositionPct(positionPct: number): number {
  const normalized = (
    positionPct - LEGEND_LABEL_INPUT_MIN_PCT
  ) / (
    LEGEND_LABEL_INPUT_MAX_PCT - LEGEND_LABEL_INPUT_MIN_PCT
  )
  const clamped = Math.max(0, Math.min(1, normalized))
  return LEGEND_LABEL_OUTPUT_MIN_PCT + (clamped * (LEGEND_LABEL_OUTPUT_MAX_PCT - LEGEND_LABEL_OUTPUT_MIN_PCT))
}

function cloudLayerOpacityStops(color: SampledPaletteColor): readonly PaletteColorStop[] {
  return [
    { value: 0, color: colorWithAlphaScale(color, 0.06) },
    { value: 52, color: colorWithAlphaScale(color, 0.42) },
    { value: 100, color: colorWithAlphaScale(color, 0.96) },
  ]
}

function colorWithAlphaScale(
  color: SampledPaletteColor,
  alphaScale: number,
): PaletteColorStop['color'] {
  const alpha = Math.max(0, Math.min(1, (color[3] / 255) * alphaScale))
  return [color[0], color[1], color[2], Math.round(alpha * 255)]
}
