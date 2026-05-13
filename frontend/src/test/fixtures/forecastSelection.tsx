import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { vi } from 'vitest'

import type { CycleManifest } from '../../manifest'
import {
  asVectorProductId,
} from '../../manifest'
import { asScalarLayerId, buildAvailableScalarCatalog } from '../../forecast-catalog'
import {
  ForecastSelectionProvider,
  type ForecastSelectionContextValue,
} from '../../forecast-selection'
import type { UnitSystem } from '../../units'


type ForecastSelectionContextOptions = Partial<{
  activeScalar: string
  activeVector: string
  unitSystem: UnitSystem
}>

export function createForecastSelectionContextValue(
  manifest: CycleManifest | null,
  options: ForecastSelectionContextOptions = {}
): ForecastSelectionContextValue {
  const shared = {
    unitSystem: options.unitSystem ?? ('imperial' as UnitSystem),
    setActiveScalar: vi.fn(),
    setActiveVector: vi.fn(),
    setUnitSystem: vi.fn(),
    toggleUnitSystem: vi.fn(),
  }

  return (
    manifest == null
      ? {
          manifest: null,
          groups: [],
          scalarLayers: null,
          products: null,
          activeScalar: null,
          activeVector: null,
          ...shared,
        }
      : {
          manifest,
          groups: buildAvailableScalarCatalog(manifest).groups,
          scalarLayers: buildAvailableScalarCatalog(manifest).layers,
          products: manifest.products,
          activeScalar: options.activeScalar
            ? asScalarLayerId(options.activeScalar)
            : buildAvailableScalarCatalog(manifest).groups[0]?.defaultLayer ?? null,
          activeVector: options.activeVector
            ? asVectorProductId(options.activeVector)
            : manifest.productsByKind.vector?.[0] ?? null,
          ...shared,
        }
  ) satisfies ForecastSelectionContextValue
}

export function renderWithForecastSelection(
  ui: ReactNode,
  manifest: CycleManifest
) {
  return render(
    <ForecastSelectionProvider manifest={manifest}>
      {ui}
    </ForecastSelectionProvider>
  )
}
