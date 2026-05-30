import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  createManifestFixture,
  createScalarArtifactFixture,
  createVectorArtifactFixture,
  renderWithForecastSelection,
} from '@/test/fixtures'
import ForecastPanel from '../ForecastPanel'
import LegendPanel from './LegendPanel'

function createLegendSelectionManifest(
  selectedArtifactId: 'tmp_surface' | 'prmsl_msl' | 'prate_surface' | 'tcdc' | 'cloud_layers'
) {
  const scalarArtifactIds = selectedArtifactId === 'tmp_surface'
    ? ['tmp_surface', 'prate_surface']
    : selectedArtifactId === 'cloud_layers'
      ? []
      : [selectedArtifactId]
  return createManifestFixture({
    cycle: '2026041100',
    scalarArtifactIds,
    vectorArtifactIds: selectedArtifactId === 'cloud_layers' ? ['cloud_layers'] : [],
    artifacts: {
      tmp_surface: createScalarArtifactFixture({
      }),
      prmsl_msl: createScalarArtifactFixture({
        id: 'prmsl_msl',
        units: 'Pa',
        parameter: 'prmsl',
      }),
      prate_surface: createScalarArtifactFixture({
        units: 'mm/hr',
        parameter: 'prate',
      }),
      tcdc: createScalarArtifactFixture({
        id: 'tcdc',
        units: '%',
        parameter: 'tcdc',
      }),
      cloud_layers: createVectorArtifactFixture({
        id: 'cloud_layers',
        units: '%',
        parameter: 'cloud_layers',
        components: ['low', 'middle', 'high'],
      }),
    },
  })
}

function renderLegendHarness(selectedArtifactId: 'tmp_surface' | 'prmsl_msl' | 'prate_surface' | 'tcdc' | 'cloud_layers' = 'tmp_surface') {
  const result = renderWithForecastSelection(
    <>
      <ForecastPanel />
      <LegendPanel />
    </>,
    createLegendSelectionManifest(selectedArtifactId)
  )

  if (selectedArtifactId === 'prmsl_msl') {
    fireEvent.change(screen.getByLabelText('Measurement'), {
      target: { value: 'air_pressure' },
    })
  }
  if (selectedArtifactId === 'prate_surface') {
    fireEvent.change(screen.getByLabelText('Measurement'), {
      target: { value: 'precipitation_rate' },
    })
  }
  if (selectedArtifactId === 'tcdc') {
    fireEvent.change(screen.getByLabelText('Measurement'), {
      target: { value: 'cloud_cover' },
    })
  }
  if (selectedArtifactId === 'cloud_layers') {
    fireEvent.change(screen.getByLabelText('Measurement'), {
      target: { value: 'cloud_layers' },
    })
  }

  return result
}

describe('LegendPanel', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('uses the legend pill as the global imperial/metric unit toggle', () => {
    const { container } = renderLegendHarness('tmp_surface')

    expect(screen.getByRole('button', { name: /cycle temperature units/i })).toHaveTextContent('F')

    fireEvent.click(screen.getByRole('button', { name: /cycle temperature units/i }))
    expect(screen.getByRole('button', { name: /cycle temperature units/i })).toHaveTextContent('C')

    const tickLabelsAfterSelect = Array.from(container.querySelectorAll('.legend-panel__tick-label'))
      .map((element) => element.textContent ?? '')
      .join(' ')
    expect(tickLabelsAfterSelect).toContain('50')
    expect(tickLabelsAfterSelect).not.toContain(' C')
    expect(container.querySelector('.legend-panel__scale .legend-panel__tick-label')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Measurement'), {
      target: { value: 'precipitation_rate' },
    })
    expect(screen.getByRole('button', { name: /cycle precipitation rate units/i })).toHaveTextContent('mm/hr')

    fireEvent.click(screen.getByRole('button', { name: /cycle precipitation rate units/i }))
    expect(screen.getByRole('button', { name: /cycle precipitation rate units/i })).toHaveTextContent('in/hr')
  })

  it('shows a static hPa unit readout for air pressure', () => {
    renderLegendHarness('prmsl_msl')

    expect(screen.queryByRole('button', { name: /cycle air pressure units/i })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Air Pressure units hPa.')).toBeInTheDocument()
  })

  it('uses rounded imperial precipitation tick labels without repeated units by default', () => {
    const { container } = renderLegendHarness('prate_surface')

    const tickLabels = Array.from(container.querySelectorAll('.legend-panel__tick-label'))
      .map((element) => element.textContent ?? '')
      .join(' ')

    expect(tickLabels).toContain('1')
    expect(tickLabels).toContain('0.7')
    expect(tickLabels).toContain('0.3')
    expect(tickLabels).not.toContain('in/hr')
    expect(tickLabels).not.toContain('mm/hr')
    expect(tickLabels).not.toContain('0.000')
    expect(container.querySelector('.legend-panel__scale-frame .legend-panel__scale')).toBeInTheDocument()
  })

  it('shows normal layer legend for total sky cover', () => {
    const { container } = renderLegendHarness('tcdc')

    expect(screen.getByLabelText('Total/Sky Cover units %.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Cloud layer stacked decks and coverage opacity')).not.toBeInTheDocument()
    expect(container.querySelector('.legend-panel__scale')).toBeInTheDocument()
    expect((container.querySelector('.legend-panel__scale') as HTMLElement).style.backgroundImage)
      .toContain('to top')
    expect(container.querySelector('.legend-panel__' + 'ticks')).not.toBeInTheDocument()
  })

  it('shows a custom layer-tone legend for cloud layers', () => {
    const { container } = renderLegendHarness('cloud_layers')

    expect(screen.getByLabelText('Cloud Layers units %.')).toBeInTheDocument()
    expect(screen.getByLabelText('Cloud layer stacked decks and coverage opacity')).toBeInTheDocument()
    expect(screen.getByLabelText('Cloud layer stacked decks')).toBeInTheDocument()
    expect(screen.getByLabelText('Composite coverage opacity from 0 to 100 percent')).toBeInTheDocument()
    expect(screen.getByLabelText('Low darker lower cloud deck')).toBeInTheDocument()
    expect(screen.getByLabelText('Middle bright cloud deck')).toBeInTheDocument()
    expect(screen.getByLabelText('High pale upper cloud deck')).toBeInTheDocument()
    expect((screen.getByLabelText('Low darker lower cloud deck') as HTMLElement).style.background).toContain('96, 104, 112')
    expect((screen.getByLabelText('Middle bright cloud deck') as HTMLElement).style.background).toContain('166, 172, 178')
    expect((screen.getByLabelText('High pale upper cloud deck') as HTMLElement).style.background).toContain('236, 244, 252')
    expect(screen.getByText('LOW')).toBeInTheDocument()
    expect(screen.getByText('MID')).toBeInTheDocument()
    expect(screen.getByText('HIGH')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(container.querySelector('.legend-panel__scale')).not.toBeInTheDocument()
  })
})
