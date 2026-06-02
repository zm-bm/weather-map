import { describe, expect, it } from 'vitest'

import { createManifestPayloadFixture } from '@/test/fixtures'
import { parseManifest } from './schema'

type MutableManifestPayload = Record<string, unknown> & {
  datasets: {
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
  it('accepts the data manifest shape', () => {
    const payload = createManifestPayloadFixture()

    const manifest = parseManifest(payload)

    expect(manifest.schema).toBe('weather-map.data-manifest')
    expect(manifest.schema_version).toBe(1)
    expect(manifest.payload_contract).toBe('field-binary-v2')
    expect(manifest.datasets.gfs?.latest?.run.cycle).toBe('2026041312')
    expect(manifest.datasets.gfs?.latest?.artifacts.tmp_surface.byte_length).toBe(4)
  })

  it('accepts compact run payload references', () => {
    const payload = createManifestPayloadFixture()

    const manifest = parseManifest(payload)

    expect(manifest.datasets.gfs?.latest?.run.run_id).toBe('20260413T120000Z-abcdef12')
    expect(manifest.datasets.gfs?.latest?.run.payload_root)
      .toBe('runs/gfs/2026041312/20260413T120000Z-abcdef12/fields')
    expect(manifest.datasets.gfs?.latest?.artifacts.tmp_surface.payload_file).toBe('tmp_surface.field.i8.bin')
  })

  it('rejects manifests without run-first payload references', () => {
    const missingRunId = createManifestPayloadFixture() as MutableManifestPayload
    const latestWithoutRunId = missingRunId.datasets.gfs?.latest
    if (!latestWithoutRunId) throw new Error('Expected latest fixture')
    delete (latestWithoutRunId.run as Record<string, unknown>).run_id

    expect(() => parseManifest(missingRunId)).toThrow()

    const missingPayloadRoot = createManifestPayloadFixture() as MutableManifestPayload
    const latestWithoutPayloadRoot = missingPayloadRoot.datasets.gfs?.latest
    if (!latestWithoutPayloadRoot) throw new Error('Expected latest fixture')
    delete (latestWithoutPayloadRoot.run as Record<string, unknown>).payload_root

    expect(() => parseManifest(missingPayloadRoot)).toThrow()

    const missingPayloadFile = createManifestPayloadFixture() as MutableManifestPayload
    const latestWithoutPayloadFile = missingPayloadFile.datasets.gfs?.latest
    if (!latestWithoutPayloadFile) throw new Error('Expected latest fixture')
    delete (latestWithoutPayloadFile.artifacts.tmp_surface as Record<string, unknown>).payload_file

    expect(() => parseManifest(missingPayloadFile)).toThrow()
  })

  it('rejects payloads with the wrong schema', () => {
    const payload = {
      ...createManifestPayloadFixture(),
      schema: 'weather-map.other',
    }

    expect(() => parseManifest(payload)).toThrow()
  })

  it('rejects duplicate frames and mismatched artifact ids', () => {
    const duplicateTimes = createManifestPayloadFixture({
      frameIds: ['000', '000'],
    })

    expect(() => parseManifest(duplicateTimes)).toThrow(/duplicate frame id 000/)

    const mismatchedArtifact = createManifestPayloadFixture()
    const latest = (mismatchedArtifact.datasets as Record<string, { latest: { artifacts: Record<string, { id: string }> } }>).gfs.latest
    latest.artifacts.tmp_surface.id = 'other'

    expect(() => parseManifest(mismatchedArtifact)).toThrow(/artifact key tmp_surface does not match id other/)
  })
})
