import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  LegendPanelView,
  type LegendPanelDisplay,
} from './LegendPanelView'

const percentOption = {
  id: 'percent',
  label: '%',
  valueFormat: 'whole' as const,
  legendValueFormat: 'whole' as const,
  legendLabels: [0, 50, 100],
}

function createCloudDisplay(
  overrides: Partial<LegendPanelDisplay> = {},
): LegendPanelDisplay {
  return {
    id: 'renamed_cloud_decks',
    label: 'Cloud Decks',
    profile: {
      kind: 'cloud-layers',
      label: 'Cloud Decks',
      range: { min: 0, max: 100 },
      units: {
        options: [percentOption],
      },
      bandPalettes: {},
    },
    rasterBands: [
      { id: 'low', color: [96, 104, 112, 255] },
      { id: 'middle', color: [166, 172, 178, 255] },
      { id: 'high', color: [236, 244, 252, 255] },
    ],
    ...overrides,
  }
}

function createGradientDisplay(
  overrides: Partial<LegendPanelDisplay> = {},
): LegendPanelDisplay {
  return {
    id: 'renamed_cloud_decks',
    label: 'Cloud Decks',
    profile: {
      kind: 'gradient',
      label: 'Cloud Decks',
      range: { min: 0, max: 100 },
      units: {
        options: [percentOption],
      },
      palette: {
        id: 'test.palette',
        stops: [
          { value: 0, color: [0, 0, 0, 0] },
          { value: 100, color: [255, 255, 255, 255] },
        ],
      },
    },
    rasterBands: [
      { id: 'low', color: [96, 104, 112, 255] },
      { id: 'middle', color: [166, 172, 178, 255] },
      { id: 'high', color: [236, 244, 252, 255] },
    ],
    ...overrides,
  }
}

describe('LegendPanelView', () => {
  it('uses the cloud-layer legend when configured by display legend kind', () => {
    const { container } = render(
      <LegendPanelView
        display={createCloudDisplay()}
        unitSystem="imperial"
        onCycleUnits={vi.fn()}
      />
    )

    expect(screen.getByLabelText('Cloud layer stacked decks and coverage opacity')).toBeInTheDocument()
    expect(screen.getByLabelText('Low darker lower cloud deck')).toBeInTheDocument()
    expect(container.querySelector('.legend-panel__scale')).not.toBeInTheDocument()
  })

  it('renders a gradient legend for low/middle/high bands when configured as gradient', () => {
    const { container } = render(
      <LegendPanelView
        display={createGradientDisplay()}
        unitSystem="imperial"
        onCycleUnits={vi.fn()}
      />
    )

    expect(screen.queryByLabelText('Cloud layer stacked decks and coverage opacity')).not.toBeInTheDocument()
    expect(container.querySelector('.legend-panel__scale')).toBeInTheDocument()
  })
})
