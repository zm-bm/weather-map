import { useMemo, useState } from 'react'

import type { ScalarLayerMeta } from '../../map/scalar'
import {
  getLegendTicks,
  getLegendUnitDisplay,
  toLegendSteppedGradient,
} from './legendFormatting'

type LegendPanelViewProps = {
  meta: ScalarLayerMeta
}

export function LegendPanelView({ meta }: LegendPanelViewProps) {
  const legendUnitDisplay = useMemo(() => getLegendUnitDisplay(meta), [meta])
  const [selectedUnitsByLayer, setSelectedUnitsByLayer] = useState<Record<string, string>>({})

  const options = legendUnitDisplay.options
  const canCycleUnits = options.length > 1
  const selectedOptionId = selectedUnitsByLayer[meta.id] ?? legendUnitDisplay.defaultOptionId
  const selectedOption = options.find((option) => option.id === selectedOptionId) ?? options[0]
  const unitPillClassName = [
    'legend-panel__unit-pill',
    selectedOption.casing === 'literal' ? 'legend-panel__unit-pill--literal' : '',
    canCycleUnits ? 'legend-panel__unit-pill--interactive' : '',
    !canCycleUnits ? 'legend-panel__unit-pill--static' : '',
  ].filter(Boolean).join(' ')
  const legendTicks = getLegendTicks(meta, selectedOption)

  const handleCycleUnits = () => {
    if (!canCycleUnits) return

    const currentIndex = options.findIndex((option) => option.id === selectedOption.id)
    const nextOption = options[(currentIndex + 1) % options.length]
    if (!nextOption) return

    setSelectedUnitsByLayer((prev) => ({ ...prev, [meta.id]: nextOption.id }))
  }

  return (
    <section className="legend-panel" aria-label={`${meta.label} legend`}>
      <div className="legend-panel__body">
        {canCycleUnits ? (
          <button
            type="button"
            className={unitPillClassName}
            aria-label={`Cycle ${meta.label} units. Current units ${selectedOption.units}.`}
            onClick={handleCycleUnits}
          >
            <span className="legend-panel__unit-current">{selectedOption.buttonLabel}</span>
          </button>
        ) : (
          <span className={unitPillClassName} aria-label={`${meta.label} units ${selectedOption.units}.`}>
            <span className="legend-panel__unit-current">{selectedOption.buttonLabel}</span>
          </span>
        )}

        <div className="legend-panel__scale-frame">
          <div className="legend-panel__scale-wrap">
            <div
              className="legend-panel__scale"
              style={{ backgroundImage: toLegendSteppedGradient(meta, 'to top') }}
            />
            <div className="legend-panel__ticks">
              <div className="legend-panel__annotations">
                {legendTicks.map((tick) => (
                  <div key={`${meta.id}-${selectedOption.id}-${tick.value}`} className="legend-panel__tick">
                    <span
                      className={`legend-panel__tick-mark${tick.variant === 'minor' ? ' legend-panel__tick-mark--minor' : ''}`}
                      style={{ bottom: `${tick.positionPct.toFixed(2)}%` }}
                    />
                    {tick.label != null && (
                      <span
                        className={[
                          'legend-panel__tick-label',
                          tick.positionPct >= 99.9 ? 'legend-panel__tick-label--top' : '',
                          tick.positionPct <= 0.1 ? 'legend-panel__tick-label--bottom' : '',
                        ].filter(Boolean).join(' ')}
                        style={{ bottom: `${tick.positionPct.toFixed(2)}%` }}
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
      </div>
    </section>
  )
}
