import {
  getLegendTicks,
  toLegendContinuousGradient,
  toLegendSteppedGradient,
  type LegendScale,
} from '@/forecast/legend'
import type {
  PaletteColorStop,
  SampledPaletteColor,
} from '@/forecast/palette'
import type { RasterColorSamplingMode } from '@/forecast/settings'
import type { UnitBehavior, UnitOption } from '@/forecast/units'

export type LegendRasterBandDisplay = {
  id: string
  paletteId: string
  color: SampledPaletteColor
}

export type LegendPanelDisplay = {
  id: string
  label: string
  units: string
  parameter: string
  min: number
  max: number
  paletteId: string
  unitBehavior: UnitBehavior
  legendScale: LegendScale
  stops: readonly PaletteColorStop[]
  rasterBands: readonly LegendRasterBandDisplay[]
}

type LegendPanelViewProps = {
  display: LegendPanelDisplay
  selectedOption: UnitOption
  colorSamplingMode: RasterColorSamplingMode
  canCycleUnits: boolean
  onCycleUnits: () => void
}

export function LegendPanelView({
  display,
  selectedOption,
  colorSamplingMode,
  canCycleUnits,
  onCycleUnits,
}: LegendPanelViewProps) {
  const unitPillClassName = [
    'legend-panel__unit-pill',
    selectedOption.casing === 'literal' ? 'legend-panel__unit-pill--literal' : '',
    canCycleUnits ? 'legend-panel__unit-pill--interactive' : '',
    !canCycleUnits ? 'legend-panel__unit-pill--static' : '',
  ].filter(Boolean).join(' ')
  const legendTicks = getLegendTicks(display, selectedOption)
  const legendScaleGradient = colorSamplingMode === 'interpolated'
    ? toLegendContinuousGradient(display, 'to top')
    : toLegendSteppedGradient(display, 'to top')
  const isCloudLayersLegend = hasRasterBands(display.rasterBands, ['low', 'middle', 'high'])

  return (
    <section className="legend-panel" aria-label={`${display.label} legend`}>
      <div className="legend-panel__body">
        {canCycleUnits ? (
          <button
            type="button"
            className={unitPillClassName}
            aria-label={`Cycle ${display.label} units. Current units ${selectedOption.units}.`}
            onClick={onCycleUnits}
          >
            <span className="legend-panel__unit-current">{selectedOption.buttonLabel}</span>
          </button>
        ) : (
          <span className={unitPillClassName} aria-label={`${display.label} units ${selectedOption.units}.`}>
            <span className="legend-panel__unit-current">{selectedOption.buttonLabel}</span>
          </span>
        )}

        {isCloudLayersLegend ? (
          <CloudLayersLegend bands={display.rasterBands} />
        ) : (
          <div className="legend-panel__scale-frame">
            <div className="legend-panel__scale-wrap">
              <div
                className="legend-panel__scale"
                style={{ backgroundImage: legendScaleGradient }}
              />
              <div className="legend-panel__ticks">
                <div className="legend-panel__annotations">
                  {legendTicks.map((tick) => (
                    <div
                      key={`${display.id}-${selectedOption.id}-${tick.value}`}
                      className="legend-panel__tick"
                      style={{ bottom: `${tick.positionPct.toFixed(2)}%` }}
                    >
                      <span
                        className={`legend-panel__tick-mark${tick.variant === 'minor' ? ' legend-panel__tick-mark--minor' : ''}`}
                      />
                      {tick.label != null && (
                        <span
                          className={[
                            'legend-panel__tick-label',
                            tick.positionPct >= 99.9 ? 'legend-panel__tick-label--top' : '',
                            tick.positionPct <= 0.1 ? 'legend-panel__tick-label--bottom' : '',
                          ].filter(Boolean).join(' ')}
                        >
                          {tick.label}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function CloudLayersLegend({ bands }: { bands: LegendPanelDisplay['rasterBands'] }) {
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

function hasRasterBands(
  bands: LegendPanelDisplay['rasterBands'],
  expectedBandIds: readonly string[],
): boolean {
  if (bands.length !== expectedBandIds.length) return false
  return bands.every((band, index) => band.id === expectedBandIds[index])
}

function cloudSwatchBackground(color: LegendPanelDisplay['rasterBands'][number]['color'] | undefined): string | undefined {
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
