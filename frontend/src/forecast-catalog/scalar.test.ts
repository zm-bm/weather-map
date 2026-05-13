import { describe, expect, it } from 'vitest'

import { createFrameManifestFixture } from '../test/fixtures'
import { buildAvailableScalarCatalog } from './scalar'

describe('buildAvailableScalarCatalog', () => {
  it('filters layers whose artifacts are unavailable and falls back group defaults', () => {
    const manifest = createFrameManifestFixture({
      scalarProducts: ['tmp_surface', 'prmsl_surface', 'tcdc', 'low_clouds'],
      vectorProducts: ['wind10m_uv'],
    })

    const catalog = buildAvailableScalarCatalog(manifest)

    expect(catalog.layers.visibility_surface).toBeUndefined()
    expect(catalog.groups.map((group) => group.id)).toEqual(['temperature', 'wind', 'atmosphere'])
    expect(catalog.groups.find((group) => group.id === 'wind')?.defaultLayer).toBe('prmsl_surface')
    expect(catalog.groups.find((group) => group.id === 'atmosphere')?.layers).toEqual(['tcdc', 'low_clouds'])
  })

  it('rejects catalog layers backed by non-scalar artifacts', () => {
    const manifest = createFrameManifestFixture({
      products: {
        tmp_surface: {
          ...createFrameManifestFixture().products.wind10m_uv,
          id: 'tmp_surface',
        },
      },
      scalarProducts: ['tmp_surface'],
      vectorProducts: [],
    })

    expect(() => buildAvailableScalarCatalog(manifest)).toThrow(
      'Scalar catalog layer tmp_surface requires scalar artifact tmp_surface, got vector'
    )
  })
})
