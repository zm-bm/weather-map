import { describe, expect, it } from 'vitest'

import { createManifestPayloadFixture } from '@/test/fixtures'
import type { Manifest } from './schema'
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

  it('accepts compact run payload references', () => {
    const payload = createManifestPayloadFixture() as Manifest
    const model = payload.models.gfs
    if (!model) throw new Error('Expected gfs fixture')
    const latest = model.latest
    if (!latest) throw new Error('Expected latest fixture')
    latest.run.runId = '20260413T120000Z-abcdef12'
    latest.run.payloadRoot = 'fields/gfs/2026041312'
    latest.artifacts.tmp_surface.payloadFile = 'tmp_surface.field.i8.bin'

    const manifest = parseManifest(payload)

    expect(manifest.models.gfs?.latest?.run.runId).toBe('20260413T120000Z-abcdef12')
    expect(manifest.models.gfs?.latest?.run.payloadRoot).toBe('fields/gfs/2026041312')
    expect(manifest.models.gfs?.latest?.artifacts.tmp_surface.payloadFile).toBe('tmp_surface.field.i8.bin')
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
