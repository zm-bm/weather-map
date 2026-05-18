import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { asParticleLayerId, asLayerId } from '../forecast-catalog'
import {
  createAvailabilityIndexFixture,
  createAvailabilityLayerFixture,
  createCatalogAvailabilityIndexFixture,
  createLayerModelAvailabilityFixture,
  createManifestFixture,
} from '../test/fixtures'
import { useForecastSelectionContext } from './ForecastSelectionContext'
import ForecastSelectionProvider from './ForecastSelectionProvider'

function ForecastSelectionProbe() {
  const context = useForecastSelectionContext()

  return (
    <div>
      <div data-testid="selected-layer">{context.selectedLayerId}</div>
      <div data-testid="selected-particle">{context.selectedParticleLayerId}</div>
      <div data-testid="selected-layer-renderable">{String(context.selectedLayerIsRenderable)}</div>
      <div data-testid="unit-system">{context.unitSystem}</div>
      <button type="button" onClick={() => context.setSelectedLayer(asLayerId('relative_humidity'))}>
        set-layer-rh
      </button>
      <button type="button" onClick={() => context.setSelectedLayer(asLayerId('precipitation_rate'))}>
        set-layer-prate
      </button>
      <button type="button" onClick={() => context.setSelectedLayer(asLayerId('accumulated_precipitation'))}>
        set-layer-accum
      </button>
      <button type="button" onClick={() => context.setSelectedLayer(asLayerId('visibility'))}>
        set-layer-visibility
      </button>
      <button type="button" onClick={() => context.setActiveModel('gfs')}>
        set-model-gfs
      </button>
      <button type="button" onClick={() => context.setActiveModel('icon')}>
        set-model-icon
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

type SelectionProviderProps = Omit<ComponentProps<typeof ForecastSelectionProvider>, 'children'>

function selectionProvider(props: SelectionProviderProps) {
  return (
    <ForecastSelectionProvider {...props}>
      <ForecastSelectionProbe />
    </ForecastSelectionProvider>
  )
}

function renderSelection(props: SelectionProviderProps) {
  return render(selectionProvider(props))
}

describe('ForecastSelectionContext', () => {
  it('preserves selected layer choices when forecast cycle changes', () => {
    const firstManifest = createManifestFixture({
      cycle: '2026040900',
      scalarArtifactIds: ['tmp_surface', 'rh_surface'],
      vectorArtifactIds: ['wind10m_uv', 'gust10m_uv'],
    })

    const { rerender } = renderSelection({ manifest: firstManifest })

    expect(screen.getByTestId('selected-layer')).toHaveTextContent('temperature')
    expect(screen.getByTestId('selected-particle')).toHaveTextContent('wind')

    fireEvent.click(screen.getByRole('button', { name: 'set-layer-rh' }))
    expect(screen.getByTestId('selected-layer')).toHaveTextContent('relative_humidity')

    const secondManifest = createManifestFixture({
      cycle: '2026040912',
      scalarArtifactIds: ['tmp_surface', 'rh_surface'],
      vectorArtifactIds: ['gust10m_uv', 'wind10m_uv'],
    })

    rerender(selectionProvider({ manifest: secondManifest }))

    expect(screen.getByTestId('selected-layer')).toHaveTextContent('relative_humidity')
    expect(screen.getByTestId('selected-particle')).toHaveTextContent('wind')
  })

  it('uses one global unit system and omits per-layer unit APIs', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      scalarArtifactIds: ['tmp_surface', 'rh_surface'],
      vectorArtifactIds: ['wind10m_uv', 'gust10m_uv'],
    })

    renderSelection({ manifest })

    expect(screen.getByTestId('unit-system')).toHaveTextContent('imperial')

    fireEvent.click(screen.getByRole('button', { name: 'set-metric' }))
    expect(screen.getByTestId('unit-system')).toHaveTextContent('metric')

    fireEvent.click(screen.getByRole('button', { name: 'toggle-unit-system' }))
    expect(screen.getByTestId('unit-system')).toHaveTextContent('imperial')
  })

  it('uses availability renderability when loaded and manifest renderability as fallback', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      scalarArtifactIds: ['tmp_surface'],
      vectorArtifactIds: [],
    })
    const availabilityIndex = createAvailabilityIndexFixture({
      gfsManifest: null,
      iconManifest: null,
      layers: {
        temperature: createAvailabilityLayerFixture({
          gfs: createLayerModelAvailabilityFixture({
            state: 'temporarily_unavailable',
            requiredArtifacts: ['tmp_surface'],
          }),
        }),
      },
    })

    const { rerender } = renderSelection({
      manifest,
      availabilityIndex,
      activeModelId: 'gfs',
    })

    expect(screen.getByTestId('selected-layer')).toHaveTextContent('temperature')
    expect(screen.getByTestId('selected-layer-renderable')).toHaveTextContent('false')

    rerender(selectionProvider({ manifest }))

    expect(screen.getByTestId('selected-layer')).toHaveTextContent('temperature')
    expect(screen.getByTestId('selected-layer-renderable')).toHaveTextContent('true')
  })

  it('preserves selected layer and particle choices when the manifest changes within the same cycle', () => {
    const firstManifest = createManifestFixture({
      cycle: '2026040900',
      scalarArtifactIds: ['tmp_surface', 'rh_surface'],
      vectorArtifactIds: ['gust10m_uv', 'wind10m_uv'],
    })

    const { rerender } = renderSelection({ manifest: firstManifest })

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

    rerender(selectionProvider({ manifest: secondManifest }))

    expect(screen.getByTestId('selected-layer')).toHaveTextContent('relative_humidity')
    expect(screen.getByTestId('selected-particle')).toHaveTextContent('wind')
  })

  it('preserves the selected layer when switching models without the same layer in the manifest', () => {
    const gfsManifest = createManifestFixture({
      model: { id: 'gfs', label: 'GFS' },
      cycle: '2026040900',
      scalarArtifactIds: ['tmp_surface', 'prate_surface'],
    })

    const { rerender } = renderSelection({ manifest: gfsManifest })

    fireEvent.click(screen.getByRole('button', { name: 'set-layer-prate' }))
    expect(screen.getByTestId('selected-layer')).toHaveTextContent('precipitation_rate')

    const iconManifest = createManifestFixture({
      model: { id: 'icon', label: 'ICON' },
      cycle: '2026040900',
      scalarArtifactIds: ['tmp_surface', 'precip_total_surface'],
    })

    rerender(selectionProvider({ manifest: iconManifest }))

    expect(screen.getByTestId('selected-layer')).toHaveTextContent('precipitation_rate')
  })

  it.each([
    {
      activeModelId: 'gfs',
      activeModelLabel: 'GFS',
      buttonName: 'set-layer-accum',
      expectedLayerId: 'accumulated_precipitation',
      expectedModelId: 'icon',
    },
    {
      activeModelId: 'icon',
      activeModelLabel: 'ICON',
      buttonName: 'set-layer-visibility',
      expectedLayerId: 'visibility',
      expectedModelId: 'gfs',
    },
  ] as const)('auto-switches to a compatible model for unavailable selected layers', async ({
    activeModelId,
    activeModelLabel,
    buttonName,
    expectedLayerId,
    expectedModelId,
  }) => {
    const onActiveModelChange = vi.fn()
    const manifest = createManifestFixture({
      model: { id: activeModelId, label: activeModelLabel },
      cycle: '2026040900',
      scalarArtifactIds: ['tmp_surface'],
    })

    renderSelection({
      manifest,
      availabilityIndex: createCatalogAvailabilityIndexFixture(),
      activeModelId,
      onActiveModelChange,
    })

    fireEvent.click(screen.getByRole('button', { name: buttonName }))

    expect(screen.getByTestId('selected-layer')).toHaveTextContent(expectedLayerId)
    await waitFor(() => {
      expect(onActiveModelChange).toHaveBeenCalledWith(expectedModelId)
    })
  })

  it('does not let an incompatible model choice replace the selected layer', () => {
    const onActiveModelChange = vi.fn()
    const iconManifest = createManifestFixture({
      model: { id: 'icon', label: 'ICON' },
      cycle: '2026040900',
      scalarArtifactIds: ['tmp_surface', 'precip_total_surface'],
    })

    renderSelection({
      manifest: iconManifest,
      availabilityIndex: createCatalogAvailabilityIndexFixture(),
      activeModelId: 'icon',
      onActiveModelChange,
    })

    fireEvent.click(screen.getByRole('button', { name: 'set-layer-accum' }))
    expect(screen.getByTestId('selected-layer')).toHaveTextContent('accumulated_precipitation')

    fireEvent.click(screen.getByRole('button', { name: 'set-model-gfs' }))

    expect(onActiveModelChange).not.toHaveBeenCalledWith('gfs')
    expect(screen.getByTestId('selected-layer')).toHaveTextContent('accumulated_precipitation')
  })

  it('preserves selected layer intent while repairing incompatible active model props', async () => {
    const onActiveModelChange = vi.fn()
    const iconManifest = createManifestFixture({
      model: { id: 'icon', label: 'ICON' },
      cycle: '2026040900',
      scalarArtifactIds: ['tmp_surface', 'precip_total_surface'],
    })

    const { rerender } = renderSelection({
      manifest: iconManifest,
      availabilityIndex: createCatalogAvailabilityIndexFixture(),
      activeModelId: 'icon',
      onActiveModelChange,
    })

    fireEvent.click(screen.getByRole('button', { name: 'set-layer-accum' }))
    expect(screen.getByTestId('selected-layer')).toHaveTextContent('accumulated_precipitation')

    const gfsManifest = createManifestFixture({
      model: { id: 'gfs', label: 'GFS' },
      cycle: '2026040900',
      scalarArtifactIds: ['tmp_surface', 'prate_surface'],
    })

    rerender(selectionProvider({
      manifest: gfsManifest,
      availabilityIndex: createCatalogAvailabilityIndexFixture(),
      activeModelId: 'gfs',
      onActiveModelChange,
    }))

    expect(screen.getByTestId('selected-layer')).toHaveTextContent('accumulated_precipitation')
    await waitFor(() => {
      expect(onActiveModelChange).toHaveBeenCalledWith('icon')
    })
  })

  it('defaults particle selection to wind particles when the wind vector artifact is available', () => {
    const manifest = createManifestFixture({
      vectorArtifactIds: ['wind10m_uv'],
    })

    renderSelection({ manifest })

    expect(screen.getByTestId('selected-particle')).toHaveTextContent('wind')
  })

  it('leaves particle selection empty when no compatible particle artifact is available', () => {
    const manifest = createManifestFixture({
      vectorArtifactIds: [],
    })

    renderSelection({ manifest })

    expect(screen.getByTestId('selected-particle')).toBeEmptyDOMElement()
  })
})
