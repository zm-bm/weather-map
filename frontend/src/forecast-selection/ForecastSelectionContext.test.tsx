import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { asParticleLayerId, asLayerId } from '../forecast-catalog'
import { createManifestFixture } from '../test/fixtures'
import { useForecastSelectionContext } from './ForecastSelectionContext'
import ForecastSelectionProvider from './ForecastSelectionProvider'

function ForecastSelectionProbe() {
  const context = useForecastSelectionContext()

  return (
    <div>
      <div data-testid="selected-layer">{context.selectedLayerId}</div>
      <div data-testid="selected-particle">{context.selectedParticleLayerId}</div>
      <div data-testid="unit-system">{context.unitSystem}</div>
      <button type="button" onClick={() => context.setSelectedLayer(asLayerId('relative_humidity'))}>
        set-layer-rh
      </button>
      <button type="button" onClick={() => context.setSelectedLayer(asLayerId('precipitation_rate'))}>
        set-layer-prate
      </button>
      <button type="button" onClick={() => context.setSelectedParticleLayer(asParticleLayerId('wind'))}>
        set-particle-wind
      </button>
      <button type="button" onClick={() => context.setUnitSystem('metric')}>
        set-metric
      </button>
      <button type="button" onClick={context.toggleUnitSystem}>
        toggle-unit-system
      </button>
    </div>
  )
}

describe('ForecastSelectionContext', () => {
  it('resets selected layer defaults when forecast cycle changes', () => {
    const firstManifest = createManifestFixture({
      cycle: '2026040900',
      scalarArtifactIds: ['tmp_surface', 'rh_surface'],
      vectorArtifactIds: ['wind10m_uv', 'gust10m_uv'],
    })

    const { rerender } = render(
      <ForecastSelectionProvider manifest={firstManifest}>
        <ForecastSelectionProbe />
      </ForecastSelectionProvider>
    )

    expect(screen.getByTestId('selected-layer')).toHaveTextContent('temperature')
    expect(screen.getByTestId('selected-particle')).toHaveTextContent('wind')

    fireEvent.click(screen.getByRole('button', { name: 'set-layer-rh' }))
    expect(screen.getByTestId('selected-layer')).toHaveTextContent('relative_humidity')

    const secondManifest = createManifestFixture({
      cycle: '2026040912',
      scalarArtifactIds: ['tmp_surface', 'rh_surface'],
      vectorArtifactIds: ['gust10m_uv', 'wind10m_uv'],
    })

    rerender(
      <ForecastSelectionProvider manifest={secondManifest}>
        <ForecastSelectionProbe />
      </ForecastSelectionProvider>
    )

    expect(screen.getByTestId('selected-layer')).toHaveTextContent('temperature')
    expect(screen.getByTestId('selected-particle')).toHaveTextContent('wind')
  })

  it('uses one global unit system and omits per-layer unit APIs', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      scalarArtifactIds: ['tmp_surface', 'rh_surface'],
      vectorArtifactIds: ['wind10m_uv', 'gust10m_uv'],
    })

    render(
      <ForecastSelectionProvider manifest={manifest}>
        <ForecastSelectionProbe />
      </ForecastSelectionProvider>
    )

    expect(screen.getByTestId('unit-system')).toHaveTextContent('imperial')

    fireEvent.click(screen.getByRole('button', { name: 'set-metric' }))
    expect(screen.getByTestId('unit-system')).toHaveTextContent('metric')

    fireEvent.click(screen.getByRole('button', { name: 'toggle-unit-system' }))
    expect(screen.getByTestId('unit-system')).toHaveTextContent('imperial')
  })

  it('preserves selected layer and particle choices when the manifest changes within the same cycle', () => {
    const firstManifest = createManifestFixture({
      cycle: '2026040900',
      scalarArtifactIds: ['tmp_surface', 'rh_surface'],
      vectorArtifactIds: ['gust10m_uv', 'wind10m_uv'],
    })

    const { rerender } = render(
      <ForecastSelectionProvider manifest={firstManifest}>
        <ForecastSelectionProbe />
      </ForecastSelectionProvider>
    )

    expect(screen.getByTestId('selected-layer')).toHaveTextContent('temperature')
    expect(screen.getByTestId('selected-particle')).toHaveTextContent('wind')

    fireEvent.click(screen.getByRole('button', { name: 'set-layer-rh' }))
    fireEvent.click(screen.getByRole('button', { name: 'set-particle-wind' }))

    const secondManifest = createManifestFixture({
      cycle: '2026040900',
      scalarArtifactIds: ['tmp_surface', 'rh_surface'],
      vectorArtifactIds: ['gust10m_uv', 'wind10m_uv'],
      revision: 'same-cycle-new-revision',
    })

    rerender(
      <ForecastSelectionProvider manifest={secondManifest}>
        <ForecastSelectionProbe />
      </ForecastSelectionProvider>
    )

    expect(screen.getByTestId('selected-layer')).toHaveTextContent('relative_humidity')
    expect(screen.getByTestId('selected-particle')).toHaveTextContent('wind')
  })

  it('falls back to the matching layer group default when switching models without the same layer', () => {
    const gfsManifest = createManifestFixture({
      model: { id: 'gfs', label: 'GFS' },
      cycle: '2026040900',
      scalarArtifactIds: ['tmp_surface', 'prate_surface'],
    })

    const { rerender } = render(
      <ForecastSelectionProvider manifest={gfsManifest}>
        <ForecastSelectionProbe />
      </ForecastSelectionProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'set-layer-prate' }))
    expect(screen.getByTestId('selected-layer')).toHaveTextContent('precipitation_rate')

    const iconManifest = createManifestFixture({
      model: { id: 'icon', label: 'ICON' },
      cycle: '2026040900',
      scalarArtifactIds: ['tmp_surface', 'precip_total_surface'],
    })

    rerender(
      <ForecastSelectionProvider manifest={iconManifest}>
        <ForecastSelectionProbe />
      </ForecastSelectionProvider>
    )

    expect(screen.getByTestId('selected-layer')).toHaveTextContent('accumulated_precipitation')
  })

  it('defaults particle selection to wind particles when the wind vector artifact is available', () => {
    const manifest = createManifestFixture({
      vectorArtifactIds: ['wind10m_uv'],
    })

    render(
      <ForecastSelectionProvider manifest={manifest}>
        <ForecastSelectionProbe />
      </ForecastSelectionProvider>
    )

    expect(screen.getByTestId('selected-particle')).toHaveTextContent('wind')
  })

  it('leaves particle selection empty when no compatible particle artifact is available', () => {
    const manifest = createManifestFixture({
      vectorArtifactIds: [],
    })

    render(
      <ForecastSelectionProvider manifest={manifest}>
        <ForecastSelectionProbe />
      </ForecastSelectionProvider>
    )

    expect(screen.getByTestId('selected-particle')).toBeEmptyDOMElement()
  })
})
