import {
  getLegendTicks,
  toLegendContinuousGradient,
} from '@/forecast/display/legend'
import type {
  SampledPaletteColor,
} from '@/forecast/display/palette'
import type { ForecastDisplayProfile } from '@/forecast/display'
import {
  canToggleUnitSystem,
  getUnitOptionForSystem,
  type UnitSystem,
} from '@/forecast/display/units'

export type LegendRasterBandDisplay = {
  id: string
  color: SampledPaletteColor
}

export type LegendPanelDisplay = {
  id: string
  label: string
  profile: ForecastDisplayProfile
  rasterBands: readonly LegendRasterBandDisplay[]
}

type LegendPanelViewProps = {
  display: LegendPanelDisplay
  unitSystem: UnitSystem
  onCycleUnits: () => void
}

export function LegendPanelView({
  display,
  unitSystem,
  onCycleUnits,
}: LegendPanelViewProps) {
  const selectedOption = getUnitOptionForSystem(display.profile.units, unitSystem)
  const canCycleUnits = canToggleUnitSystem(display.profile.units)
  const unitPillClassName = [
    'legend-panel__unit-pill',
    canCycleUnits ? 'legend-panel__unit-pill--interactive' : '',
    !canCycleUnits ? 'legend-panel__unit-pill--static' : '',
  ].filter(Boolean).join(' ')
  let legendTicks: ReturnType<typeof getLegendTicks> = []
  let legendGradient: string | undefined
  if (display.profile.kind === 'gradient') {
    const gradientOption = getUnitOptionForSystem(display.profile.units, unitSystem)
    legendTicks = getLegendTicks(gradientOption)
    legendGradient = toLegendContinuousGradient(
      display.profile.palette.stops,
      gradientOption,
      'to top'
    )
  }

  return (
    <section className="legend-panel" aria-label={`${display.label} legend`}>
      <div className="legend-panel__body">
        {canCycleUnits ? (
          <button
            type="button"
            className={unitPillClassName}
            aria-label={`Cycle ${display.label} units. Current units ${selectedOption.label}.`}
            onClick={onCycleUnits}
          >
            <span className="legend-panel__unit-current">{selectedOption.label}</span>
          </button>
        ) : (
          <span className={unitPillClassName} aria-label={`${display.label} units ${selectedOption.label}.`}>
            <span className="legend-panel__unit-current">{selectedOption.label}</span>
          </span>
        )}

        {display.profile.kind === 'cloud-layers' ? (
          <CloudLayersLegend bands={display.rasterBands} />
        ) : (
          <div className="legend-panel__scale-frame">
            <div className="legend-panel__scale-wrap">
              <div
                className="legend-panel__scale"
                style={{ backgroundImage: legendGradient }}
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
                        className="legend-panel__tick-mark"
                      />
                      <span
                        className={[
                          'legend-panel__tick-label',
                          tick.positionPct >= 99.9 ? 'legend-panel__tick-label--top' : '',
                          tick.positionPct <= 0.1 ? 'legend-panel__tick-label--bottom' : '',
                        ].filter(Boolean).join(' ')}
                      >
                        {tick.label}
                      </span>
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
