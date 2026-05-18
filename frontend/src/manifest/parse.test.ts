import { describe, expect, it } from 'vitest'

import { parseCycleManifest } from './parse'
import {
  MANIFEST_PAYLOAD_CONTRACT,
  MANIFEST_SCHEMA,
  MANIFEST_SCHEMA_VERSION,
} from './constants'
import { createCycleManifestPayloadFixture } from '../test/fixtures'

function manifestArtifacts(payload: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return payload.artifacts as Record<string, Record<string, unknown>>
}

function tmpArtifact(payload: Record<string, unknown>): Record<string, unknown> {
  return manifestArtifacts(payload).tmp_surface
}

describe('parseCycleManifest', () => {
  it('accepts the V5 artifact manifest shape and derives artifact ids by kind', () => {
    const payload = createCycleManifestPayloadFixture()

    const manifest = parseCycleManifest(payload)

    expect(manifest.schema).toBe(MANIFEST_SCHEMA)
    expect(manifest.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION)
    expect(manifest.payloadContract).toBe(MANIFEST_PAYLOAD_CONTRACT)
    expect(manifest.run.cycle).toBe('2026041312')
    expect(manifest.times.map((time) => time.id)).toEqual(['000'])
    expect(manifest.artifactsByKind.scalar).toEqual(['tmp_surface'])
    expect(manifest.artifactsByKind.vector).toEqual(['wind10m_uv'])
    expect(manifest.artifacts.tmp_surface.kind).toBe('scalar')
    expect(manifest.artifacts.tmp_surface.components).toEqual(['value'])
    expect(manifest.artifacts.tmp_surface.grid.xWrap).toBe('repeat')
    expect(manifest.artifacts.tmp_surface.encoding.byteOrder).toBe('little')
    expect(manifest.artifacts.tmp_surface.frames['000']!.byteLength).toBe(8)
  })

  it('accepts optional artifact temporal metadata', () => {
    const payload = createCycleManifestPayloadFixture()
    tmpArtifact(payload).temporalKind = 'average_rate'
    tmpArtifact(payload).sourceIntervalHours = 1

    const manifest = parseCycleManifest(payload)

    expect(manifest.artifacts.tmp_surface.temporalKind).toBe('average_rate')
    expect(manifest.artifacts.tmp_surface.sourceIntervalHours).toBe(1)
  })

  it('rejects old manifests without the V5 schema marker', () => {
    const payload = {
      version: 4,
      contract: 'forecast-binary-v2',
      cycle: '2026041312',
      scalar_variables: ['tmp_surface'],
      vector_variables: ['wind10m_uv'],
    }

    expect(() => parseCycleManifest(payload)).toThrow('Invalid manifest field schema:')

    const v3Payload = createCycleManifestPayloadFixture()
    v3Payload.schemaVersion = 3

    expect(() => parseCycleManifest(v3Payload)).toThrow(/Invalid manifest field schemaVersion: .*5/)
  })

  it('accepts scalar-only and vector-only manifests but rejects empty artifact sets', () => {
    const scalarOnlyPayload = createCycleManifestPayloadFixture()
    delete manifestArtifacts(scalarOnlyPayload).wind10m_uv

    const scalarOnlyManifest = parseCycleManifest(scalarOnlyPayload)
    expect(scalarOnlyManifest.artifactsByKind.scalar).toEqual(['tmp_surface'])
    expect(scalarOnlyManifest.artifactsByKind.vector).toBeUndefined()

    const vectorOnlyPayload = createCycleManifestPayloadFixture()
    delete manifestArtifacts(vectorOnlyPayload).tmp_surface

    const vectorOnlyManifest = parseCycleManifest(vectorOnlyPayload)
    expect(vectorOnlyManifest.artifactsByKind.scalar).toBeUndefined()
    expect(vectorOnlyManifest.artifactsByKind.vector).toEqual(['wind10m_uv'])

    const emptyPayload = createCycleManifestPayloadFixture()
    emptyPayload.artifacts = {}

    expect(() => parseCycleManifest(emptyPayload)).toThrow(
      'Invalid manifest field artifacts: expected at least one artifact'
    )
  })

  it('rejects artifact entries missing required metadata and frame refs', () => {
    const missingKind = createCycleManifestPayloadFixture()
    delete tmpArtifact(missingKind).kind

    expect(() => parseCycleManifest(missingKind)).toThrow(
      'Invalid manifest field artifacts.tmp_surface.kind:'
    )

    const missingGridPayload = createCycleManifestPayloadFixture()
    delete tmpArtifact(missingGridPayload).grid

    expect(() => parseCycleManifest(missingGridPayload)).toThrow(
      'Invalid manifest field artifacts.tmp_surface.grid:'
    )

    const missingNodataPayload = createCycleManifestPayloadFixture()
    delete (tmpArtifact(missingNodataPayload).encoding as Record<string, unknown>).nodata

    expect(() => parseCycleManifest(missingNodataPayload)).toThrow(
      'Invalid manifest field artifacts.tmp_surface.encoding.nodata:'
    )

    const missingFramePayload = createCycleManifestPayloadFixture()
    delete (tmpArtifact(missingFramePayload).frames as Record<string, unknown>)['000']

    expect(() => parseCycleManifest(missingFramePayload)).toThrow(
      'Invalid manifest field artifacts.tmp_surface.frames.000: missing frame for hour 000'
    )
  })

  it('strips ignored legacy frame sha metadata', () => {
    const payload = createCycleManifestPayloadFixture()
    const frame = (tmpArtifact(payload).frames as Record<string, Record<string, unknown>>)['000']!
    frame.sha256 = 'a'.repeat(64)

    const manifest = parseCycleManifest(payload)

    expect(manifest.artifacts.tmp_surface.frames['000']).not.toHaveProperty('sha256')
  })

  it('accepts fixed temperature piecewise scalar encodings', () => {
    const payload = createCycleManifestPayloadFixture()
    tmpArtifact(payload).encoding = {
      id: 'e0',
      format: 'temp-c-piecewise-i8-v1',
      dtype: 'int8',
      byteOrder: 'none',
      nodata: -128,
    }

    const manifest = parseCycleManifest(payload)

    expect(manifest.artifacts.tmp_surface.encoding).toEqual({
      id: 'e0',
      format: 'temp-c-piecewise-i8-v1',
      dtype: 'int8',
      byteOrder: 'none',
      nodata: -128,
    })
  })

  it('rejects temperature piecewise encodings without the reserved nodata value', () => {
    const payload = createCycleManifestPayloadFixture()
    tmpArtifact(payload).encoding = {
      id: 'e0',
      format: 'temp-c-piecewise-i8-v1',
      dtype: 'int8',
      byteOrder: 'none',
      nodata: -127,
    }

    expect(() => parseCycleManifest(payload)).toThrow('expected -128')
  })

  it('preserves vector artifact component order as payload layout', () => {
    const payload = createCycleManifestPayloadFixture()
    const artifacts = payload.artifacts as Record<string, { components: string[] }>
    artifacts.wind10m_uv.components = ['v', 'u']

    const manifest = parseCycleManifest(payload)

    expect(manifest.artifacts.wind10m_uv.components).toEqual(['v', 'u'])
  })
})
