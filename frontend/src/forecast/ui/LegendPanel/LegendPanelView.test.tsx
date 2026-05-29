import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LegendPanelView, type LegendPanelDisplay } from './LegendPanelView'

const percentOption = {
  id: 'percent',
  buttonLabel: '%',
  units: '%',
  convert: (value: number) => value,
  casing: 'literal' as const,
}

function createDisplay(overrides: Partial<LegendPanelDisplay> = {}): LegendPanelDisplay {
  return {
    id: 'renamed_cloud_decks',
    label: 'Cloud Decks',
    units: '%',
    parameter: 'cloud_layers',
    min: 0,
    max: 100,
    paletteId: 'cloud.layers.low.v1',
    unitBehavior: 'percent',
    legendScale: 'percent',
    stops: [
      { value: 0, color: [0, 0, 0, 0] },
      { value: 100, color: [255, 255, 255, 255] },
    ],
    rasterBands: [
      { id: 'low', paletteId: 'cloud.layers.low.v1', color: [96, 104, 112, 255] },
      { id: 'middle', paletteId: 'cloud.layers.middle.v1', color: [166, 172, 178, 255] },
      { id: 'high', paletteId: 'cloud.layers.high.v1', color: [236, 244, 252, 255] },
    ],
    ...overrides,
  }
}

describe('LegendPanelView', () => {
  it('uses the cloud-layer legend for low/middle/high raster bands regardless of display id', () => {
    const { container } = render(
      <LegendPanelView
        display={createDisplay()}
        selectedOption={percentOption}
        colorSamplingMode="interpolated"
        canCycleUnits={false}
        onCycleUnits={vi.fn()}
      />
    )

    expect(screen.getByLabelText('Cloud layer stacked decks and coverage opacity')).toBeInTheDocument()
    expect(screen.getByLabelText('Low darker lower cloud deck')).toBeInTheDocument()
    expect(container.querySelector('.legend-panel__scale')).not.toBeInTheDocument()
  })
})
