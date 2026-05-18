import { describe, expect, it } from 'vitest'

import {
  createAvailabilityIndexFixture,
  createFrameManifestFixture,
} from '../test/fixtures'
import {
  createCycleManifestFromAvailability,
} from './availabilityManifest'

describe('availability manifest conversion', () => {
  it('converts embedded latest data into a renderable cycle manifest', () => {
    const availabilityIndex = createAvailabilityIndexFixture({
      gfsManifest: createFrameManifestFixture({
        model: { id: 'gfs', label: 'GFS' },
        cycle: '2026040900',
        forecastHours: ['000', '003'],
      }),
    })

    const manifest = createCycleManifestFromAvailability({
      availabilityIndex,
      modelId: 'gfs',
    })

    expect(manifest.model).toEqual({ id: 'gfs', label: 'GFS' })
    expect(manifest.run.cycle).toBe('2026040900')
    expect(manifest.artifactsByKind.scalar).toContain('tmp_surface')
    expect(manifest.artifacts.tmp_surface.frames['000']).toEqual({
      path: 'fields/gfs/2026040900/000/tmp_surface.field.i16.bin',
      byteLength: 8,
    })
    expect(manifest.artifacts.tmp_surface.frames['003']).toEqual({
      path: 'fields/gfs/2026040900/003/tmp_surface.field.i16.bin',
      byteLength: 8,
    })
    expect(manifest.artifacts.wind10m_uv.frames['000']?.path)
      .toBe('fields/gfs/2026040900/000/wind10m_uv.field.i8.bin')
  })
})
