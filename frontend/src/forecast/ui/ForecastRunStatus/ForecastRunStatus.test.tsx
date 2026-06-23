import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { ForecastDatasetOption } from '@/forecast/manifest'
import {
  createCatalogManifestFixture,
  createManifestFixture,
  createMultiDatasetManifestFixture,
  createScalarArtifactFixture,
  renderWithForecastSelection,
} from '@/test/fixtures'
import ForecastRunStatus from './ForecastRunStatus'

const MODEL_OPTIONS: readonly ForecastDatasetOption[] = [
  { id: 'gfs', label: 'GFS' },
  { id: 'icon', label: 'ICON' },
]

function sourceRadio(name: string | RegExp): HTMLInputElement {
  return screen.getByRole('radio', { name }) as HTMLInputElement
}

function sourceRadios(): HTMLInputElement[] {
  return screen.getAllByRole('radio') as HTMLInputElement[]
}

function renderRunStatus(
  manifest = createManifestFixture({
    cycle: '2026041100',
    scalarArtifactIds: ['tmp_surface', 'rh_surface'],
    vectorArtifactIds: [],
    artifacts: {
      tmp_surface: createScalarArtifactFixture(),
      rh_surface: createScalarArtifactFixture({
        units: '%',
        parameter: 'rh',
      }),
    },
  }),
  options: {
    activeDatasetId?: string
    datasetOptions?: readonly ForecastDatasetOption[]
    selectedLayerId?: string
  } = {}
) {
  return renderWithForecastSelection(<ForecastRunStatus />, manifest, {
    activeDatasetId: options.activeDatasetId ?? 'gfs',
    datasetOptions: options.datasetOptions ?? MODEL_OPTIONS,
    selectedLayerId: options.selectedLayerId,
  })
}

describe('ForecastRunStatus', () => {
  it('renders available source choices as a compact segmented selector', () => {
    renderRunStatus()

    expect(screen.getByRole('radiogroup', { name: 'Forecast source' })).toBeInTheDocument()
    expect(sourceRadio('GFS')).toBeChecked()
    expect(sourceRadios()).toHaveLength(1)
    expect(screen.queryByRole('radio', { name: /ICON/ })).not.toBeInTheDocument()
    expect(screen.getByText('GFS')).toBeInTheDocument()
    expect(screen.getByText('17 mi')).toBeInTheDocument()
  })

  it('updates the active forecast dataset from the segmented selector', () => {
    const catalogManifest = createCatalogManifestFixture()
    const manifest = createMultiDatasetManifestFixture({
      gfsManifest: createManifestFixture({
        cycle: '2026041100',
        dataset: { id: 'gfs', label: 'GFS' },
        scalarArtifactIds: ['tmp_surface', 'rh_surface'],
        vectorArtifactIds: [],
      }),
      iconManifest: createManifestFixture({
        cycle: '2026041100',
        dataset: { id: 'icon', label: 'ICON' },
        scalarArtifactIds: ['tmp_surface', 'rh_surface'],
        vectorArtifactIds: [],
      }),
      layers: catalogManifest.layers,
    })

    renderRunStatus(manifest, {
      activeDatasetId: 'icon',
    })

    expect(sourceRadio('ICON')).toBeChecked()
    expect(sourceRadio('GFS')).not.toBeChecked()
    expect(sourceRadios()).toHaveLength(2)

    fireEvent.click(sourceRadio('GFS'))

    expect(sourceRadio('GFS')).toBeChecked()
  })

  it('omits incompatible source choices for the selected field', () => {
    const catalogManifest = createCatalogManifestFixture()
    const manifest = createMultiDatasetManifestFixture({
      gfsManifest: createManifestFixture({
        cycle: '2026041118',
        dataset: { id: 'gfs', label: 'GFS' },
        scalarArtifactIds: ['tmp_surface', 'tcdc'],
        vectorArtifactIds: [],
      }),
      iconManifest: createManifestFixture({
        cycle: '2026041118',
        dataset: { id: 'icon', label: 'ICON' },
        scalarArtifactIds: ['tmp_surface'],
        vectorArtifactIds: [],
      }),
      layers: catalogManifest.layers,
    })

    renderRunStatus(manifest, {
      activeDatasetId: 'gfs',
      selectedLayerId: 'cloud_cover',
    })

    expect(sourceRadio('GFS')).toBeChecked()
    expect(screen.queryByRole('radio', { name: /ICON/ })).not.toBeInTheDocument()
    expect(sourceRadios()).toHaveLength(1)
  })

  it('constrains observed radar source choices to MRMS', () => {
    renderRunStatus(createCatalogManifestFixture(), {
      activeDatasetId: 'gfs',
      datasetOptions: [
        ...MODEL_OPTIONS,
        { id: 'mrms', label: 'MRMS' },
      ],
      selectedLayerId: 'observed_radar_composite_reflectivity',
    })

    expect(screen.getByRole('radiogroup', { name: 'Forecast source' })).toBeInTheDocument()
    expect(sourceRadio('MRMS')).toBeChecked()
    expect(screen.queryByRole('radio', { name: /GFS/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /ICON/ })).not.toBeInTheDocument()
    expect(sourceRadios()).toHaveLength(1)
  })
})
