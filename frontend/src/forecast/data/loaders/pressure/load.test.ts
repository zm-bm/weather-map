import { describe, expect, it, vi } from 'vitest'

import {
  createActiveRunFixture,
  createGridFixture,
  createScalarArtifactFixture,
  createSingleTimeManifestFixture,
} from '@/test/fixtures'
import { createPressureDataLoad } from './load'

describe('createPressureDataLoad', () => {
  it('loads pressure from prmsl_msl and converts Pa to hPa', async () => {
    const grid = createGridFixture({ nx: 2, ny: 1 })
    const activeRun = createActiveRunFixture(createSingleTimeManifestFixture({
      artifacts: {
        tmp_surface: createScalarArtifactFixture({ id: 'tmp_surface' }),
        prmsl_msl: createScalarArtifactFixture({
          id: 'prmsl_msl',
          units: 'Pa',
          grid,
        }),
      },
    }))
    const loadScalar = vi.fn().mockResolvedValue({
      artifactId: 'prmsl_msl',
      hourToken: '003',
      grid,
      values: new Float32Array([100000, Number.NaN]),
    })

    const load = createPressureDataLoad({
      activeRun,
      artifacts: {
        canLoadScalar: vi.fn(() => true),
        canLoadVector: vi.fn(() => false),
        canLoadVectorComponents: vi.fn(() => false),
        loadScalar,
        loadVector: vi.fn(),
        loadVectorComponents: vi.fn(),
        loadRawVectorComponents: vi.fn(),
      },
    })

    const slice = await load?.loadTimeSlice('3')

    expect(slice).toMatchObject({
      hourToken: '003',
      artifactId: 'prmsl_msl',
      grid,
    })
    expect(Array.from(slice?.pressureHpa ?? [])).toEqual([1000, Number.NaN])
    expect(loadScalar).toHaveBeenCalledWith('prmsl_msl', '003')
  })
})
