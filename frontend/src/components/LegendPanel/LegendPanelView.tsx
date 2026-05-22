import type { LayerMeta } from '../../forecast-catalog'
import type { UnitOption } from '../../units'
import { getLegendTicks, toLegendSteppedGradient } from './legendScale'

type LegendPanelViewProps = {
  meta: LayerMeta
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
  const isCloudLayersLegend = meta.id === 'cloud_layers'

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

        {isCloudLayersLegend ? (
          <CloudLayersLegend />
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

function CloudLayersLegend() {
  return (
    <div className="legend-panel__cloud-layers-frame" aria-label="Cloud layer stacked decks and coverage opacity">
      <div className="legend-panel__cloud-layers-swatches" aria-label="Cloud layer stacked decks">
        <span className="legend-panel__cloud-layers-swatch legend-panel__cloud-layers-swatch--low" aria-label="Low darker lower cloud deck">
          <span>LOW</span>
        </span>
        <span className="legend-panel__cloud-layers-swatch legend-panel__cloud-layers-swatch--middle" aria-label="Middle bright cloud deck">
          <span>MID</span>
        </span>
        <span className="legend-panel__cloud-layers-swatch legend-panel__cloud-layers-swatch--high" aria-label="High pale upper cloud deck">
          <span>HIGH</span>
        </span>
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
