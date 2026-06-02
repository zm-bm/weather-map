import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import type { ForecastDatasetId, Manifest } from '@/forecast/manifest'
import { datasetOptionsFromManifest } from '@/forecast/manifest'
import {
  createCatalogManifestFixture,
  createManifestFixture,
} from '@/test/fixtures'
import { useForecastSelectionContext } from './ForecastSelectionContext'
import ForecastSelectionProvider from './ForecastSelectionProvider'
import { ACTIVE_DATASET_STORAGE_KEY } from './activeDatasetPersistence'
import { SELECTED_LAYER_STORAGE_KEY } from './selectedLayerPersistence'

function ForecastSelectionProbe() {
  const context = useForecastSelectionContext()
  const location = useLocation()

  return (
    <div>
      <div data-testid="selected-layer">{context.selectedLayerId}</div>
      <div data-testid="selected-particle">{context.selectedParticleLayerId}</div>
      <div data-testid="active-dataset">{context.activeDatasetId}</div>
      <div data-testid="location-search">{location.search}</div>
      <button type="button" onClick={() => context.setSelectedLayer('relative_humidity')}>
        set-layer-rh
      </button>
      <button type="button" onClick={() => context.setSelectedLayer('precipitation_rate')}>
        set-layer-prate
      </button>
      <button type="button" onClick={() => context.setSelectedLayer('accumulated_precipitation')}>
        set-layer-accum
      </button>
      <button type="button" onClick={() => context.setSelectedLayer('visibility')}>
        set-layer-visibility
      </button>
      <button type="button" onClick={() => context.setActiveDataset('gfs')}>
        set-dataset-gfs
      </button>
      <button type="button" onClick={() => context.setActiveDataset('icon')}>
        set-dataset-icon
      </button>
      <button type="button" onClick={() => context.setSelectedParticleLayer('wind')}>
        set-particle-wind
      </button>
    </div>
  )
}

type SelectionProviderProps =
  Omit<ComponentProps<typeof ForecastSelectionProvider>, 'children' | 'manifest'> & {
    manifest: Manifest | null
    activeDatasetId?: ForecastDatasetId | null
    route?: string
  }

function selectionProvider(props: SelectionProviderProps) {
  const {
    manifest,
    activeDatasetId,
    datasetOptions,
    route = '/',
    ...providerProps
  } = props
  if (activeDatasetId != null) {
    localStorage.setItem(ACTIVE_DATASET_STORAGE_KEY, activeDatasetId)
  }

  return (
    <MemoryRouter initialEntries={[route]}>
      <ForecastSelectionProvider
        {...providerProps}
        manifest={manifest}
        datasetOptions={datasetOptions ?? datasetOptionsFromManifest(manifest)}
      >
        <ForecastSelectionProbe />
      </ForecastSelectionProvider>
    </MemoryRouter>
  )
}

function renderSelection(props: SelectionProviderProps) {
  return render(selectionProvider(props))
}

describe('ForecastSelectionContext', () => {
  beforeEach(() => {
    localStorage.clear()
  })

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

  it('preserves the selected layer when switching datasets without the same layer in the manifest', () => {
    const gfsManifest = createManifestFixture({
      dataset: { id: 'gfs', label: 'GFS' },
      cycle: '2026040900',
      scalarArtifactIds: ['tmp_surface', 'prate_surface'],
    })

    const { rerender } = renderSelection({ manifest: gfsManifest })

    fireEvent.click(screen.getByRole('button', { name: 'set-layer-prate' }))
    expect(screen.getByTestId('selected-layer')).toHaveTextContent('precipitation_rate')

    const iconManifest = createManifestFixture({
      dataset: { id: 'icon', label: 'ICON' },
      cycle: '2026040900',
      scalarArtifactIds: ['tmp_surface', 'precip_total_surface'],
    })

    rerender(selectionProvider({ manifest: iconManifest }))

    expect(screen.getByTestId('selected-layer')).toHaveTextContent('precipitation_rate')
  })

  it.each([
    {
      activeDatasetId: 'icon',
      activeDatasetLabel: 'ICON',
      buttonName: 'set-layer-visibility',
      expectedLayerId: 'visibility',
      expectedDatasetId: 'gfs',
    },
  ] as const)('auto-switches to a compatible model for unavailable selected layers', async ({
    activeDatasetId,
    activeDatasetLabel,
    buttonName,
    expectedLayerId,
    expectedDatasetId,
  }) => {
    void activeDatasetLabel
    const manifest = createCatalogManifestFixture()

    renderSelection({
      manifest,
      activeDatasetId,
    })

    fireEvent.click(screen.getByRole('button', { name: buttonName }))

    expect(screen.getByTestId('selected-layer')).toHaveTextContent(expectedLayerId)
    await waitFor(() => {
      expect(screen.getByTestId('active-dataset')).toHaveTextContent(expectedDatasetId)
    })
    expect(localStorage.getItem(ACTIVE_DATASET_STORAGE_KEY)).toBe(expectedDatasetId)
  })

  it('does not let an incompatible model choice replace the selected layer', () => {
    const manifest = createCatalogManifestFixture()

    renderSelection({
      manifest,
      activeDatasetId: 'gfs',
    })

    fireEvent.click(screen.getByRole('button', { name: 'set-layer-visibility' }))
    expect(screen.getByTestId('selected-layer')).toHaveTextContent('visibility')

    fireEvent.click(screen.getByRole('button', { name: 'set-dataset-icon' }))

    expect(screen.getByTestId('active-dataset')).toHaveTextContent('gfs')
    expect(localStorage.getItem(ACTIVE_DATASET_STORAGE_KEY)).toBe('gfs')
    expect(screen.getByTestId('selected-layer')).toHaveTextContent('visibility')
  })

  it('preserves selected layer intent while repairing an incompatible stored active dataset', async () => {
    const manifest = createCatalogManifestFixture()
    localStorage.setItem(ACTIVE_DATASET_STORAGE_KEY, 'icon')

    renderSelection({
      manifest,
      route: '/?layer=visibility',
    })

    expect(screen.getByTestId('selected-layer')).toHaveTextContent('visibility')
    await waitFor(() => {
      expect(screen.getByTestId('active-dataset')).toHaveTextContent('gfs')
    })
    expect(localStorage.getItem(ACTIVE_DATASET_STORAGE_KEY)).toBe('gfs')
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

  it('uses a valid layer query param before localStorage', async () => {
    const manifest = createCatalogManifestFixture()
    localStorage.setItem(SELECTED_LAYER_STORAGE_KEY, 'wind_speed')

    renderSelection({
      manifest,
      route: '/?layer=relative_humidity',
    })

    expect(screen.getByTestId('selected-layer')).toHaveTextContent('relative_humidity')
    await waitFor(() => {
      expect(localStorage.getItem(SELECTED_LAYER_STORAGE_KEY)).toBe('relative_humidity')
    })
    expect(searchParam('layer')).toBe('relative_humidity')
  })

  it('uses localStorage when no layer query param is present', async () => {
    const manifest = createCatalogManifestFixture()
    localStorage.setItem(SELECTED_LAYER_STORAGE_KEY, 'wind_speed')

    renderSelection({
      manifest,
      route: '/?mode=debug',
    })

    expect(screen.getByTestId('selected-layer')).toHaveTextContent('wind_speed')
    await waitFor(() => {
      expect(searchParam('layer')).toBe('wind_speed')
    })
    expect(searchParam('mode')).toBe('debug')
    expect(localStorage.getItem(SELECTED_LAYER_STORAGE_KEY)).toBe('wind_speed')
  })

  it('falls back to temperature when query and localStorage values are invalid', async () => {
    const manifest = createCatalogManifestFixture()
    localStorage.setItem(SELECTED_LAYER_STORAGE_KEY, 'missing_layer')

    renderSelection({
      manifest,
      route: '/?mode=debug&layer=missing_layer',
    })

    expect(screen.getByTestId('selected-layer')).toHaveTextContent('temperature')
    await waitFor(() => {
      expect(searchParam('layer')).toBe('temperature')
    })
    expect(searchParam('mode')).toBe('debug')
    expect(localStorage.getItem(SELECTED_LAYER_STORAGE_KEY)).toBe('temperature')
  })

  it('updates localStorage and replaces the layer query param when selection changes', async () => {
    const manifest = createCatalogManifestFixture()

    renderSelection({
      manifest,
      route: '/?mode=debug&layer=temperature',
    })

    fireEvent.click(screen.getByRole('button', { name: 'set-layer-rh' }))

    expect(screen.getByTestId('selected-layer')).toHaveTextContent('relative_humidity')
    await waitFor(() => {
      expect(localStorage.getItem(SELECTED_LAYER_STORAGE_KEY)).toBe('relative_humidity')
    })
    expect(searchParam('layer')).toBe('relative_humidity')
    expect(searchParam('mode')).toBe('debug')
  })

  it('uses a valid stored active dataset when the manifest supports it', async () => {
    const manifest = createCatalogManifestFixture()
    localStorage.setItem(ACTIVE_DATASET_STORAGE_KEY, 'icon')

    renderSelection({ manifest })

    expect(screen.getByTestId('active-dataset')).toHaveTextContent('icon')
    await waitFor(() => {
      expect(localStorage.getItem(ACTIVE_DATASET_STORAGE_KEY)).toBe('icon')
    })
  })

  it('falls back to the first latest dataset when stored active dataset is invalid', async () => {
    const manifest = createCatalogManifestFixture()
    localStorage.setItem(ACTIVE_DATASET_STORAGE_KEY, 'missing')

    renderSelection({ manifest })

    expect(screen.getByTestId('active-dataset')).toHaveTextContent('gfs')
    await waitFor(() => {
      expect(localStorage.getItem(ACTIVE_DATASET_STORAGE_KEY)).toBe('gfs')
    })
  })

  it('saves active dataset changes to localStorage', () => {
    const manifest = createCatalogManifestFixture()

    renderSelection({ manifest })

    fireEvent.click(screen.getByRole('button', { name: 'set-dataset-icon' }))

    expect(screen.getByTestId('active-dataset')).toHaveTextContent('icon')
    expect(localStorage.getItem(ACTIVE_DATASET_STORAGE_KEY)).toBe('icon')
  })
})

function searchParam(name: string): string | null {
  return new URLSearchParams(screen.getByTestId('location-search').textContent ?? '').get(name)
}
