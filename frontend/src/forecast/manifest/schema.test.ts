import { describe, expect, it } from 'vitest'

import { createManifestPayloadFixture } from '@/test/fixtures'
import { parseManifest } from './schema'

describe('parseManifest', () => {
  it('accepts the forecast manifest shape', () => {
    const payload = createManifestPayloadFixture()

    const manifest = parseManifest(payload)

    expect(manifest.schema).toBe('weather-map.forecast-manifest')
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.payloadContract).toBe('forecast-binary-v2')
    expect(manifest.models.gfs?.latest?.run.cycle).toBe('2026041312')
    expect(manifest.models.gfs?.latest?.artifacts.tmp_surface.byteLength).toBe(4)
  })

  it('rejects payloads with the wrong schema', () => {
    const payload = {
      ...createManifestPayloadFixture(),
      schema: 'weather-map.other',
    }

    expect(() => parseManifest(payload)).toThrow()
  })

  it('rejects duplicate times and mismatched artifact ids', () => {
    const duplicateTimes = createManifestPayloadFixture({
      forecastHours: ['000', '000'],
    })

    expect(() => parseManifest(duplicateTimes)).toThrow(/duplicate time id 000/)

    const mismatchedArtifact = createManifestPayloadFixture()
    const latest = (mismatchedArtifact.models as Record<string, { latest: { artifacts: Record<string, { id: string }> } }>).gfs.latest
    latest.artifacts.tmp_surface.id = 'other'

    expect(() => parseManifest(mismatchedArtifact)).toThrow(/artifact key tmp_surface does not match id other/)
  })
})
