import { describe, expect, it } from 'vitest'

import type { CycleManifest } from '../../manifest/types'
import { createFrameManifestFixture } from '../../test/fixtures'
import { resolveFrameSpec } from './spec'

const BASE_MANIFEST = createFrameManifestFixture({ forecastHours: ['000'] })

describe('resolveFrameSpec', () => {
  it('resolves scalar and vector frame specs from the manifest', () => {
    const scalarSpec = resolveFrameSpec(BASE_MANIFEST, '000', 'tmp_surface', 'scalar')
    const vectorSpec = resolveFrameSpec(BASE_MANIFEST, '000', 'wind10m_uv', 'vector')

    expect(scalarSpec.variableMeta.kind).toBe('scalar')
    expect(scalarSpec.encoding.format).toBe('scalar-i16-linear-v1')
    expect(vectorSpec.variableMeta.kind).toBe('vector')
    expect(vectorSpec.encoding.format).toBe('uv-i8-q0p5-v1')
  })

  it('fails on missing frame, metadata, encoding, and grid references', () => {
    expect(() =>
      resolveFrameSpec(
        createFrameManifestFixture({ forecastHours: ['000'], frames: {} }),
        '000',
        'tmp_surface',
        'scalar'
      )
    ).toThrow('No scalar frame ref')

    expect(() =>
      resolveFrameSpec(
        createFrameManifestFixture({ forecastHours: ['000'], variableMeta: {} }),
        '000',
        'tmp_surface',
        'scalar'
      )
    ).toThrow('No scalar variable metadata')

    expect(() =>
      resolveFrameSpec(
        createFrameManifestFixture({
          forecastHours: ['000'],
          variableMeta: {
            tmp_surface: {
              kind: 'scalar',
              units: 'C',
              parameter: 'tmp',
              level: 'surface',
              valid_min: -45,
              valid_max: 50,
              grid_id: 'g0',
              encoding_id: 'missing',
            },
            wind10m_uv: BASE_MANIFEST.variableMeta.wind10m_uv,
          },
        }),
        '000',
        'tmp_surface',
        'scalar'
      )
    ).toThrow('No scalar encoding missing')

    expect(() =>
      resolveFrameSpec(
        createFrameManifestFixture({
          forecastHours: ['000'],
          variableMeta: {
            tmp_surface: {
              kind: 'scalar',
              units: 'C',
              parameter: 'tmp',
              level: 'surface',
              valid_min: -45,
              valid_max: 50,
              grid_id: 'missing',
              encoding_id: 'e0',
            },
            wind10m_uv: BASE_MANIFEST.variableMeta.wind10m_uv,
          },
        }),
        '000',
        'tmp_surface',
        'scalar'
      )
    ).toThrow('No scalar grid missing')
  })

  it('fails on domain kind mismatch', () => {
    expect(() =>
      resolveFrameSpec(BASE_MANIFEST, '000', 'wind10m_uv', 'scalar')
    ).toThrow('is not scalar')

    expect(() =>
      resolveFrameSpec(BASE_MANIFEST, '000', 'tmp_surface', 'vector')
    ).toThrow('is not vector')
  })

  it('returns the raw manifest encoding for domain-specific validation later', () => {
    const manifest = createFrameManifestFixture({
      forecastHours: ['000'],
      encodings: {
        ...BASE_MANIFEST.encodings,
        e0: {
          ...BASE_MANIFEST.encodings.e0,
          format: 'bad-format',
        } as unknown as CycleManifest['encodings'][string],
      },
    })

    const spec = resolveFrameSpec(manifest, '000', 'tmp_surface', 'scalar')

    expect(spec.encoding.format).toBe('bad-format')
  })
})
