import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

import {
  activeForecastRunForDataset,
  type ForecastDatasetOption,
  datasetOptionsFromManifest,
  type ForecastDatasetId,
  type Manifest,
} from '@/forecast/manifest'
import {
  getDefaultRasterLayerId,
} from '@/forecast/catalog'
import {
  ForecastSelectionProvider,
  type ForecastSelectionContextValue,
} from '@/forecast/selection'
import { ACTIVE_DATASET_STORAGE_KEY } from '@/forecast/selection/activeDatasetPersistence'
import { ForecastSettingsProvider } from '@/forecast/settings'
import ForecastSelectionFixtureTimeProvider from './ForecastSelectionFixtureTimeProvider'
import { createActiveRunFixture } from './manifest'

type ForecastSelectionContextOptions = Partial<{
  selectedLayerId: string
}>

export function createForecastSelectionContextValue(
  manifest: Manifest | null,
  options: ForecastSelectionContextOptions = {},
  activeDatasetId: ForecastDatasetId | null = 'gfs',
): ForecastSelectionContextValue {
  const activeRun = activeForecastRunForDataset(manifest, activeDatasetId)
  const shared = {
    datasetOptions: datasetOptionsFromManifest(manifest),
    setActiveDataset: vi.fn(),
    setSelectedLayer: vi.fn(),
  }
  const selectedLayerId = options.selectedLayerId
    ? options.selectedLayerId
    : getDefaultRasterLayerId()

  return (
    activeRun == null
      ? {
          activeRun: null,
          activeDatasetId: null,
          selectedLayerId: null,
          ...shared,
        }
      : {
          activeRun,
          activeDatasetId: activeRun.datasetId,
          selectedLayerId,
          ...shared,
        }
  ) satisfies ForecastSelectionContextValue
}

export function renderWithForecastSelection(
  ui: ReactNode,
  manifest: Manifest,
  options: ForecastDatasetId | {
    activeDatasetId?: ForecastDatasetId
    datasetOptions?: readonly ForecastDatasetOption[]
    selectedLayerId?: string
  } = 'gfs'
) {
  const activeDatasetId = typeof options === 'string'
    ? options
    : options.activeDatasetId ?? 'gfs'
  const selectedLayerId = typeof options === 'string'
    ? getDefaultRasterLayerId()
    : options.selectedLayerId ?? getDefaultRasterLayerId()
  const activeRun = createActiveRunFixture(manifest, activeDatasetId)
  localStorage.setItem(ACTIVE_DATASET_STORAGE_KEY, activeDatasetId)
  return render(
    <MemoryRouter initialEntries={[`/?layer=${selectedLayerId ?? 'temperature'}`]}>
      <ForecastSettingsProvider>
        <ForecastSelectionProvider
          manifest={manifest}
          datasetOptions={typeof options === 'string' ? [{
            id: activeDatasetId,
            label: activeRun.label,
          }] : options.datasetOptions ?? [{
            id: activeDatasetId,
            label: activeRun.label,
          }]}
        >
          <ForecastSelectionFixtureTimeProvider>
            {ui}
          </ForecastSelectionFixtureTimeProvider>
        </ForecastSelectionProvider>
      </ForecastSettingsProvider>
    </MemoryRouter>
  )
}
