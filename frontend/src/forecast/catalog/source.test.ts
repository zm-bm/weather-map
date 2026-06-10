import { describe, expect, it } from 'vitest'

import {
  hasExactBandIds,
  sourceBandIds,
  type ContourSource,
  type OverlaySource,
  type ParticleSource,
  type RasterSource,
} from './source'

describe('catalog source helpers', () => {
  it('derives required raster band ids on non-base render layer sources', () => {
    const overlaySource = {
      id: 'precipitation_type',
      style: 'precipitation-type-pattern',
      source: {
        artifactId: 'precip_type_surface',
        bands: [{ id: 'snow_frac' }, { id: 'mix_frac' }],
      },
      optional: true,
    } satisfies OverlaySource
    const contourSource = {
      id: 'pressure_contours',
      source: {
        artifactId: 'prmsl_msl',
        bands: [{ id: 'value' }],
      },
    } satisfies ContourSource
    const particleSource = {
      id: 'wind',
      source: {
        artifactId: 'wind10m_uv',
        bands: [{ id: 'u' }, { id: 'v' }],
      },
    } satisfies ParticleSource

    expect(sourceBandIds(overlaySource.source)).toEqual(['snow_frac', 'mix_frac'])
    expect(sourceBandIds(contourSource.source)).toEqual(['value'])
    expect(sourceBandIds(particleSource.source)).toEqual(['u', 'v'])
  })

  it('derives raster band semantics from direct source bands', () => {
    const valueSource = {
      artifactId: 'tmp_surface',
      bands: [{ id: 'value' }],
    } satisfies RasterSource
    const wind = {
      artifactId: 'wind10m_uv',
      bands: [
        { id: 'u' },
        { id: 'v' },
      ],
    } satisfies RasterSource
    const cloud = {
      artifactId: 'cloud_layers',
      bands: [
        { id: 'low' },
        { id: 'middle' },
        { id: 'high' },
      ],
    } satisfies RasterSource

    expect(sourceBandIds(valueSource)).toEqual(['value'])
    expect(sourceBandIds(wind)).toEqual(['u', 'v'])
    expect(sourceBandIds(cloud)).toEqual(['low', 'middle', 'high'])
  })

  it('validates exact band ids', () => {
    expect(hasExactBandIds(['u', 'v'], ['u', 'v'])).toBe(true)
    expect(hasExactBandIds(['v', 'u'], ['u', 'v'])).toBe(false)
  })
})
