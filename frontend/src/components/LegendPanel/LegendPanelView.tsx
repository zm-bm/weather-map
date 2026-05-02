import type { ScalarMeta } from '../../forecast-metadata/scalar'
import type { UnitOption } from '../../units'
import { getLegendTicks, toLegendSteppedGradient } from './legendScale'

type LegendPanelViewProps = {
  meta: ScalarMeta
  selectedOption: UnitOption
  canCycleUnits: boolean
  onCycleUnits: () => void
}

export function LegendPanelView({
  meta,
  selectedOption,
  canCycleUnits,
  onCycleUnits,
}: LegendPanelViewProps) {
  const unitPillClassName = [
    'legend-panel__unit-pill',
    selectedOption.casing === 'literal' ? 'legend-panel__unit-pill--literal' : '',
    canCycleUnits ? 'legend-panel__unit-pill--interactive' : '',
    !canCycleUnits ? 'legend-panel__unit-pill--static' : '',
  ].filter(Boolean).join(' ')
  const legendTicks = getLegendTicks(meta, selectedOption)
  const cloudLayerSwatches = meta.legendKind === 'cloud_layers'
    ? meta.cloudLayerSwatches ?? []
    : []
  const showCloudLayerLegend = cloudLayerSwatches.length > 0

  return (
    <section className="legend-panel" aria-label={`${meta.label} legend`}>
      <div className="legend-panel__body">
        {canCycleUnits ? (
          <button
            type="button"
            className={unitPillClassName}
            aria-label={`Cycle ${meta.label} units. Current units ${selectedOption.units}.`}
            onClick={onCycleUnits}
          >
            <span className="legend-panel__unit-current">{selectedOption.buttonLabel}</span>
          </button>
        ) : (
          <span className={unitPillClassName} aria-label={`${meta.label} units ${selectedOption.units}.`}>
            <span className="legend-panel__unit-current">{selectedOption.buttonLabel}</span>
          </span>
        )}

        {showCloudLayerLegend ? (
          <div className="legend-panel__scale-frame legend-panel__scale-frame--clouds">
            <div className="legend-panel__cloud-layers" aria-label="Cloud layer tones">
              {cloudLayerSwatches.map((swatch) => (
                <div key={swatch.id} className="legend-panel__cloud-layer">
                  <span
                    className="legend-panel__cloud-swatch"
                    style={{ backgroundColor: swatch.color }}
                  />
                  <span className="legend-panel__cloud-label">{swatch.label}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="legend-panel__scale-frame">
            <div className="legend-panel__scale-wrap">
              <div
                className="legend-panel__scale"
                style={{ backgroundImage: toLegendSteppedGradient(meta, 'to top') }}
              />
              <div className="legend-panel__ticks">
                <div className="legend-panel__annotations">
                  {legendTicks.map((tick) => (
                    <div
                      key={`${meta.id}-${selectedOption.id}-${tick.value}`}
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
