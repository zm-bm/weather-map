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
} from '@/forecast/display/units'

type LegendRasterBandDisplay = {
  id: string
  color: SampledPaletteColor
}

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
  const selectedOption = getUnitOptionForSystem(display.units, settings.units.system)
  const canCycleUnits = canToggleUnitSystem(display.units)
  const unitPillClassName = [
    'legend-panel__unit-pill',
    canCycleUnits ? 'legend-panel__unit-pill--interactive' : '',
    !canCycleUnits ? 'legend-panel__unit-pill--static' : '',
  ].filter(Boolean).join(' ')
  const panelClassName = [
    'legend-panel',
    display.kind === 'cloud-layers'
      ? 'legend-panel--cloud-layers'
      : 'legend-panel--gradient',
  ].join(' ')

  return (
    <section className={panelClassName} aria-label={`${display.label} legend`}>
      <div className="legend-panel__body">
        {canCycleUnits ? (
          <button
            type="button"
            className={unitPillClassName}
            aria-label={`Cycle ${display.label} units. Current units ${selectedOption.label}.`}
            onClick={actions.toggleUnitSystem}
          >
            <span className="legend-panel__unit-current">{selectedOption.label}</span>
          </button>
        ) : (
          <span className={unitPillClassName} aria-label={`${display.label} units ${selectedOption.label}.`}>
            <span className="legend-panel__unit-current">{selectedOption.label}</span>
          </span>
        )}

        {display.kind === 'cloud-layers' ? (
          <CloudLayersLegend bands={rasterBandDisplays(layer)} />
        ) : (
          <GradientLegend
            layerId={layer.id}
            paletteStops={display.palette.stops}
            selectedOption={getUnitOptionForSystem(display.units, settings.units.system)}
          />
        )}
      </div>
    </section>
  )
}

function GradientLegend({
  layerId,
  paletteStops,
  selectedOption,
}: {
  layerId: string
  paletteStops: readonly PaletteColorStop[]
  selectedOption: GradientUnitOption
}) {
  const legendTicks = getLegendTicks(selectedOption)
  const legendGradient = toLegendContinuousGradient(
    paletteStops,
    selectedOption,
    'to top'
  )

  return (
    <div className="legend-panel__scale-frame">
      <div className="legend-panel__scale-wrap">
        <div
          className="legend-panel__scale"
          style={{ backgroundImage: legendGradient }}
        >
          {legendTicks.map((tick) => (
            <span
              key={`${layerId}-${selectedOption.id}-${tick.value}`}
              className="legend-panel__tick-label"
              style={{ bottom: `${tick.positionPct.toFixed(2)}%` }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function CloudLayersLegend({ bands }: { bands: readonly LegendRasterBandDisplay[] }) {
  const swatches = [
    { id: 'low', label: 'LOW', ariaLabel: 'Low darker lower cloud deck' },
    { id: 'middle', label: 'MID', ariaLabel: 'Middle bright cloud deck' },
    { id: 'high', label: 'HIGH', ariaLabel: 'High pale upper cloud deck' },
  ] as const

  return (
    <div className="legend-panel__cloud-layers-frame" aria-label="Cloud layer stacked decks and coverage opacity">
      <div className="legend-panel__cloud-layers-swatches" aria-label="Cloud layer stacked decks">
        {swatches.map((swatch) => (
          <span
            key={swatch.id}
            className={`legend-panel__cloud-layers-swatch legend-panel__cloud-layers-swatch--${swatch.id}`}
            aria-label={swatch.ariaLabel}
            style={{ background: cloudSwatchBackground(bands.find((band) => band.id === swatch.id)?.color) }}
          >
            <span>{swatch.label}</span>
          </span>
        ))}
      </div>
      <div className="legend-panel__cloud-layers-opacity-scale" aria-label="Composite coverage opacity from 0 to 100 percent">
        <div className="legend-panel__cloud-layers-opacity-wrap">
          <div className="legend-panel__cloud-layers-opacity" aria-hidden="true" />
        </div>
        <div className="legend-panel__cloud-layers-ticks" aria-hidden="true">
          <span>100%</span>
          <span>50%</span>
          <span>0%</span>
        </div>
      </div>
    </div>
  )
}

function rasterBandDisplays(layer: ForecastRasterLayer): LegendRasterBandDisplay[] {
  return layer.source.bands.map((band) => {
    const palette = layer.display.kind === 'cloud-layers'
      ? layer.display.bandPalettes[band.id]
      : layer.display.palette
    if (!palette) {
      throw new Error(`Display profile ${layer.display.label} has no palette for band ${band.id}`)
    }
    return {
      id: band.id,
      color: samplePaletteColor(palette.stops, 100, 'interpolated'),
    }
  })
}

function cloudSwatchBackground(color: LegendRasterBandDisplay['color'] | undefined): string | undefined {
  if (!color) return undefined
  const lower: [number, number, number, number] = [
    Math.round(color[0] * 0.72),
    Math.round(color[1] * 0.72),
    Math.round(color[2] * 0.72),
    color[3],
  ]
  return `linear-gradient(180deg, ${rgba(color, 0.96)}, ${rgba(lower, 0.92)})`
}

function rgba(color: readonly [number, number, number, number], alphaScale: number): string {
  const alpha = Math.max(0, Math.min(1, (color[3] / 255) * alphaScale))
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha.toFixed(3)})`
}
