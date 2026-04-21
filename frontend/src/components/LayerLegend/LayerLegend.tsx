import { useMemo, useState } from 'react'

import {
  formatLegendValue,
  getLegendTicks,
  getLegendUnitDisplay,
  toLegendSteppedGradient,
} from './legendFormatting'
import { useLoadedVariableContext } from '../../state/VariableContext'
import { getScalarLayerMeta } from '../../map/scalar'

export default function LayerLegend() {
  const { activeScalar, variableMeta } = useLoadedVariableContext()
  const meta = getScalarLayerMeta(activeScalar, variableMeta)
  const legendUnitDisplay = useMemo(() => getLegendUnitDisplay(meta), [meta])
  const [selectedUnitsByLayer, setSelectedUnitsByLayer] = useState<Record<string, string>>({})

  const selectedOptionId = selectedUnitsByLayer[meta.id] ?? legendUnitDisplay.defaultOptionId
  const selectedOption =
    legendUnitDisplay.options.find((option) => option.id === selectedOptionId) ?? legendUnitDisplay.options[0]
  const legendTicks = getLegendTicks(meta, selectedOption)

  return (
    <section className="legend-card wm-panel-shell wm-module-shell lower-third__module" aria-label={`${meta.label} legend`}>
      <div className="legend-card__titlebar wm-titlebar wm-module-titlebar">
        <span className="legend-card__eyebrow wm-eyebrow">Legend</span>
      </div>

      <div className="legend-card__body legend-card__body--vertical">
        <div className="legend-card__header">
          <strong className="wm-display-caps">{meta.label}</strong>

          {legendUnitDisplay.options.length > 1 ? (
            <div className="legend-card__unit-toggle" role="group" aria-label={`${meta.label} units`}>
              {legendUnitDisplay.options.map((option) => {
                const isActive = option.id === selectedOption.id
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={`legend-card__unit-button wm-bevel-button${isActive ? ' legend-card__unit-button--active' : ''}`}
                    aria-pressed={isActive}
                    onClick={() => {
                      setSelectedUnitsByLayer((prev) => ({ ...prev, [meta.id]: option.id }))
                    }}
                  >
                    {option.buttonLabel}
                  </button>
                )
              })}
            </div>
          ) : (
            <span className="legend-card__units wm-mono-meta wm-text-truncate">{selectedOption.units}</span>
          )}
        </div>

        <div className="legend-card__scale-wrap legend-card__scale-wrap--vertical">
          <div
            className="legend-card__scale legend-card__scale--vertical"
            style={{ backgroundImage: toLegendSteppedGradient(meta, 'to top') }}
          />
          <div className="legend-card__ticks">
            {legendTicks.map((tick) => (
              <div key={`${meta.id}-${selectedOption.id}-${tick.value}`} className="legend-card__tick">
                <span className="legend-card__tick-mark" style={{ bottom: `${tick.positionPct.toFixed(2)}%` }} />
                <span className="legend-card__tick-label" style={{ bottom: `${tick.positionPct.toFixed(2)}%` }}>
                  {formatLegendValue(tick.value, selectedOption.units)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
