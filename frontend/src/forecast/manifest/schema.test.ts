import { describe, expect, it } from 'vitest'

import { createManifestPayloadFixture } from '@/test/fixtures'
import { parseManifest } from './schema'

type MutableManifestPayload = Record<string, unknown> & {
  models: {
    gfs?: {
      latest?: {
        run: Record<string, unknown>
        artifacts: {
          tmp_surface: Record<string, unknown>
        }
      }
    }
  }
}

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
    const payload = createManifestPayloadFixture()

    const manifest = parseManifest(payload)

    expect(manifest.models.gfs?.latest?.run.runId).toBe('20260413T120000Z-abcdef12')
    expect(manifest.models.gfs?.latest?.run.payloadRoot)
      .toBe('runs/gfs/2026041312/20260413T120000Z-abcdef12/fields')
    expect(manifest.models.gfs?.latest?.artifacts.tmp_surface.payloadFile).toBe('tmp_surface.field.i8.bin')
  })

  it('rejects manifests without run-first payload references', () => {
    const missingRunId = createManifestPayloadFixture() as MutableManifestPayload
    const latestWithoutRunId = missingRunId.models.gfs?.latest
    if (!latestWithoutRunId) throw new Error('Expected latest fixture')
    delete (latestWithoutRunId.run as Record<string, unknown>).runId

    expect(() => parseManifest(missingRunId)).toThrow()

    const missingPayloadRoot = createManifestPayloadFixture() as MutableManifestPayload
    const latestWithoutPayloadRoot = missingPayloadRoot.models.gfs?.latest
    if (!latestWithoutPayloadRoot) throw new Error('Expected latest fixture')
    delete (latestWithoutPayloadRoot.run as Record<string, unknown>).payloadRoot

    expect(() => parseManifest(missingPayloadRoot)).toThrow()

    const missingPayloadFile = createManifestPayloadFixture() as MutableManifestPayload
    const latestWithoutPayloadFile = missingPayloadFile.models.gfs?.latest
    if (!latestWithoutPayloadFile) throw new Error('Expected latest fixture')
    delete (latestWithoutPayloadFile.artifacts.tmp_surface as Record<string, unknown>).payloadFile

    expect(() => parseManifest(missingPayloadFile)).toThrow()
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
