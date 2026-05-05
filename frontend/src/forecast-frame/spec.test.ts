import { describe, expect, it } from 'vitest'

import type { ScalarEncodingSpec, ScalarProductSpec } from '../manifest/types'
import { createFrameManifestFixture } from '../test/fixtures'
import { resolveFrameSpec } from './spec'

const BASE_MANIFEST = createFrameManifestFixture({ forecastHours: ['000'] })

describe('resolveFrameSpec', () => {
  it('resolves scalar and vector frame specs from the manifest', () => {
    const scalarSpec = resolveFrameSpec(BASE_MANIFEST, '000', 'tmp_surface', 'scalar')
    const vectorSpec = resolveFrameSpec(BASE_MANIFEST, '000', 'wind10m_uv', 'vector')

    expect(scalarSpec.variable.style.layerId).toBe('scalar')
    expect(scalarSpec.variable.encoding.format).toBe('linear-i16-v1')
    expect(vectorSpec.variable.style.layerId).toBe('vector')
    expect(vectorSpec.variable.encoding.format).toBe('linear-i8-v1')
  })

  it('fails on missing frame and metadata', () => {
    const missingFrameManifest = createFrameManifestFixture({ forecastHours: ['000'] })
    missingFrameManifest.products.tmp_surface = {
      ...missingFrameManifest.products.tmp_surface,
      frames: {},
    }

    expect(() =>
      resolveFrameSpec(
        missingFrameManifest,
        '000',
        'tmp_surface',
        'scalar'
      )
    ).toThrow('No scalar frame ref')

    const missingVariableManifest = createFrameManifestFixture({ forecastHours: ['000'] })
    delete missingVariableManifest.products.tmp_surface

    expect(() =>
      resolveFrameSpec(
        missingVariableManifest,
        '000',
        'tmp_surface',
        'scalar'
      )
    ).toThrow('No scalar variable metadata')
  })

  it('fails on domain layer mismatch', () => {
    expect(() =>
      resolveFrameSpec(BASE_MANIFEST, '000', 'wind10m_uv', 'scalar')
    ).toThrow('is not scalar')

    expect(() =>
      resolveFrameSpec(BASE_MANIFEST, '000', 'tmp_surface', 'vector')
    ).toThrow('is not vector')
  })

  it('returns the raw manifest encoding for domain-specific validation later', () => {
    const manifest = createFrameManifestFixture({ forecastHours: ['000'] })
    manifest.products.tmp_surface = {
      ...manifest.products.tmp_surface,
      encoding: {
        ...manifest.products.tmp_surface.encoding,
        format: 'bad-format',
      } as unknown as ScalarEncodingSpec,
    } as ScalarProductSpec

    const spec = resolveFrameSpec(manifest, '000', 'tmp_surface', 'scalar')

    expect(spec.variable.encoding.format).toBe('bad-format')
  })
})
