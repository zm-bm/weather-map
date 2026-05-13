import { describe, expect, it } from 'vitest'

import { parseCycleManifest } from './parse'
import {
  MANIFEST_PAYLOAD_CONTRACT,
  MANIFEST_SCHEMA,
  MANIFEST_SCHEMA_VERSION,
} from './types'
import { createCycleManifestPayloadFixture } from '../test/fixtures'

function products(payload: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return payload.products as Record<string, Record<string, unknown>>
}

function tmpProduct(payload: Record<string, unknown>): Record<string, unknown> {
  return products(payload).tmp_surface
}

describe('parseCycleManifest', () => {
  it('accepts the V4 artifact manifest shape and derives products by kind', () => {
    const payload = createCycleManifestPayloadFixture()

    const manifest = parseCycleManifest(payload)

    expect(manifest.schema).toBe(MANIFEST_SCHEMA)
    expect(manifest.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION)
    expect(manifest.payloadContract).toBe(MANIFEST_PAYLOAD_CONTRACT)
    expect(manifest.run.cycle).toBe('2026041312')
    expect(manifest.times.map((time) => time.id)).toEqual(['000'])
    expect(manifest.productsByKind.scalar).toEqual(['tmp_surface'])
    expect(manifest.productsByKind.vector).toEqual(['wind10m_uv'])
    expect(manifest.products.tmp_surface.kind).toBe('scalar')
    expect(manifest.products.tmp_surface.components).toEqual(['value'])
    expect(manifest.products.tmp_surface.grid.xWrap).toBe('repeat')
    expect(manifest.products.tmp_surface.encoding.byteOrder).toBe('little')
    expect(manifest.products.tmp_surface.frames['000']!.byteLength).toBe(8)
  })

  it('accepts optional product temporal metadata', () => {
    const payload = createCycleManifestPayloadFixture()
    tmpProduct(payload).temporalKind = 'average_rate'
    tmpProduct(payload).sourceIntervalHours = 1

    const manifest = parseCycleManifest(payload)

    expect(manifest.products.tmp_surface.temporalKind).toBe('average_rate')
    expect(manifest.products.tmp_surface.sourceIntervalHours).toBe(1)
  })

  it('rejects old manifests without the V4 schema marker', () => {
    const payload = {
      version: 4,
      contract: 'forecast-binary-v2',
      cycle: '2026041312',
      scalar_variables: ['tmp_surface'],
      vector_variables: ['wind10m_uv'],
    }

    expect(() => parseCycleManifest(payload)).toThrow('Invalid manifest field schema: expected string')

    const v3Payload = createCycleManifestPayloadFixture()
    v3Payload.schemaVersion = 3

    expect(() => parseCycleManifest(v3Payload)).toThrow('Invalid manifest field schemaVersion: expected 4')
  })

  it('accepts scalar-only and vector-only manifests but rejects empty product sets', () => {
    const scalarOnlyPayload = createCycleManifestPayloadFixture()
    delete products(scalarOnlyPayload).wind10m_uv

    const scalarOnlyManifest = parseCycleManifest(scalarOnlyPayload)
    expect(scalarOnlyManifest.productsByKind.scalar).toEqual(['tmp_surface'])
    expect(scalarOnlyManifest.productsByKind.vector).toBeUndefined()

    const vectorOnlyPayload = createCycleManifestPayloadFixture()
    delete products(vectorOnlyPayload).tmp_surface

    const vectorOnlyManifest = parseCycleManifest(vectorOnlyPayload)
    expect(vectorOnlyManifest.productsByKind.scalar).toBeUndefined()
    expect(vectorOnlyManifest.productsByKind.vector).toEqual(['wind10m_uv'])

    const emptyPayload = createCycleManifestPayloadFixture()
    emptyPayload.products = {}

    expect(() => parseCycleManifest(emptyPayload)).toThrow(
      'Invalid manifest field products: expected at least one product'
    )
  })

  it('rejects products missing required artifact metadata and frame refs', () => {
    const missingKind = createCycleManifestPayloadFixture()
    delete tmpProduct(missingKind).kind

    expect(() => parseCycleManifest(missingKind)).toThrow(
      'Invalid manifest field products.tmp_surface.kind: expected string'
    )

    const missingGridPayload = createCycleManifestPayloadFixture()
    delete tmpProduct(missingGridPayload).grid

    expect(() => parseCycleManifest(missingGridPayload)).toThrow(
      'Invalid manifest field products.tmp_surface.grid: expected object'
    )

    const missingFramePayload = createCycleManifestPayloadFixture()
    delete (tmpProduct(missingFramePayload).frames as Record<string, unknown>)['000']

    expect(() => parseCycleManifest(missingFramePayload)).toThrow(
      'Manifest product tmp_surface missing frame for hour 000'
    )
  })

  it('accepts fixed temperature piecewise scalar encodings', () => {
    const payload = createCycleManifestPayloadFixture()
    tmpProduct(payload).encoding = {
      id: 'e0',
      format: 'temp-c-piecewise-i8-v1',
      dtype: 'int8',
      byteOrder: 'none',
      nodata: -128,
    }

    const manifest = parseCycleManifest(payload)

    expect(manifest.products.tmp_surface.encoding).toEqual({
      id: 'e0',
      format: 'temp-c-piecewise-i8-v1',
      dtype: 'int8',
      byteOrder: 'none',
      nodata: -128,
    })
  })

  it('rejects temperature piecewise encodings without the reserved nodata value', () => {
    const payload = createCycleManifestPayloadFixture()
    tmpProduct(payload).encoding = {
      id: 'e0',
      format: 'temp-c-piecewise-i8-v1',
      dtype: 'int8',
      byteOrder: 'none',
      nodata: -127,
    }

    expect(() => parseCycleManifest(payload)).toThrow('expected -128')
  })

  it('preserves vector product component order as payload layout', () => {
    const payload = createCycleManifestPayloadFixture()
    const products = payload.products as Record<string, { components: string[] }>
    products.wind10m_uv.components = ['v', 'u']

    const manifest = parseCycleManifest(payload)

    expect(manifest.products.wind10m_uv.components).toEqual(['v', 'u'])
  })
})
