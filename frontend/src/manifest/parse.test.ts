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
  it('accepts the V3 layer-driven manifest shape and derives products by layer', () => {
    const payload = createCycleManifestPayloadFixture()

    const manifest = parseCycleManifest(payload)

    expect(manifest.schema).toBe(MANIFEST_SCHEMA)
    expect(manifest.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION)
    expect(manifest.payloadContract).toBe(MANIFEST_PAYLOAD_CONTRACT)
    expect(manifest.run.cycle).toBe('2026041312')
    expect(manifest.times.map((time) => time.id)).toEqual(['000'])
    expect(manifest.productsByLayerId.scalar).toEqual(['tmp_surface'])
    expect(manifest.productsByLayerId.vector).toEqual(['wind10m_uv'])
    expect(manifest.productStyleBindings.tmp_surface).toEqual({
      productId: 'tmp_surface',
      layerId: 'scalar',
      paletteId: 'temperature.air.c.v1',
    })
    expect(manifest.products.tmp_surface.components).toEqual(['value'])
    expect(manifest.products.tmp_surface.style).toEqual({
      layerId: 'scalar',
      paletteId: 'temperature.air.c.v1',
    })
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

  it('rejects old manifests without the V3 schema marker', () => {
    const payload = {
      version: 4,
      contract: 'forecast-binary-v2',
      cycle: '2026041312',
      scalar_variables: ['tmp_surface'],
      vector_variables: ['wind10m_uv'],
    }

    expect(() => parseCycleManifest(payload)).toThrow('Invalid manifest field schema: expected string')

    const v2Payload = createCycleManifestPayloadFixture()
    v2Payload.schemaVersion = 2

    expect(() => parseCycleManifest(v2Payload)).toThrow('Invalid manifest field schemaVersion: expected 3')
  })

  it('accepts scalar-only and vector-only manifests but rejects empty product sets', () => {
    const scalarOnlyPayload = createCycleManifestPayloadFixture()
    delete products(scalarOnlyPayload).wind10m_uv

    const scalarOnlyManifest = parseCycleManifest(scalarOnlyPayload)
    expect(scalarOnlyManifest.productsByLayerId.scalar).toEqual(['tmp_surface'])
    expect(scalarOnlyManifest.productsByLayerId.vector).toBeUndefined()

    const vectorOnlyPayload = createCycleManifestPayloadFixture()
    delete products(vectorOnlyPayload).tmp_surface
    vectorOnlyPayload.groups = []

    const vectorOnlyManifest = parseCycleManifest(vectorOnlyPayload)
    expect(vectorOnlyManifest.productsByLayerId.scalar).toBeUndefined()
    expect(vectorOnlyManifest.productsByLayerId.vector).toEqual(['wind10m_uv'])
    expect(vectorOnlyManifest.groups).toEqual([])

    const emptyPayload = createCycleManifestPayloadFixture()
    emptyPayload.products = {}
    emptyPayload.groups = []

    expect(() => parseCycleManifest(emptyPayload)).toThrow(
      'Invalid manifest field products: expected at least one product'
    )
  })

  it('rejects products missing required components or style', () => {
    const missingComponents = createCycleManifestPayloadFixture()
    delete tmpProduct(missingComponents).components

    expect(() => parseCycleManifest(missingComponents)).toThrow(
      'Invalid manifest field products.tmp_surface.components: expected non-empty string[]'
    )

    const missingStyle = createCycleManifestPayloadFixture()
    delete tmpProduct(missingStyle).style

    expect(() => parseCycleManifest(missingStyle)).toThrow(
      'Invalid manifest field products.tmp_surface.style: expected object'
    )

    const missingLayerId = createCycleManifestPayloadFixture()
    ;(tmpProduct(missingLayerId).style as Record<string, unknown>).layerId = ''

    expect(() => parseCycleManifest(missingLayerId)).toThrow(
      'Invalid manifest field products.tmp_surface.style.layerId: expected non-empty string'
    )
  })

  it('rejects payloads with missing inline metadata and frame refs', () => {
    const missingGridPayload = createCycleManifestPayloadFixture()
    delete tmpProduct(missingGridPayload).grid

    expect(() => parseCycleManifest(missingGridPayload)).toThrow(
      'Invalid manifest field products.tmp_surface.grid: expected object'
    )

    const missingEncodingPayload = createCycleManifestPayloadFixture()
    delete tmpProduct(missingEncodingPayload).encoding

    expect(() => parseCycleManifest(missingEncodingPayload)).toThrow(
      'Invalid manifest field products.tmp_surface.encoding: expected object'
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

  it('accepts packed cloud layer scalar products with product-level components', () => {
    const payload = createCycleManifestPayloadFixture()
    tmpProduct(payload).components = ['low', 'medium', 'high']
    tmpProduct(payload).style = {
      layerId: 'scalar',
      paletteId: 'cloud.layers.percent.v1',
    }
    tmpProduct(payload).encoding = {
      id: 'e0',
      format: 'linear-i8-v1',
      dtype: 'int8',
      byteOrder: 'none',
      nodata: -128,
      scale: 5,
      offset: 0,
      decodeFormula: 'value = stored * scale + offset',
    }

    const manifest = parseCycleManifest(payload)

    expect(manifest.products.tmp_surface.components).toEqual(['low', 'medium', 'high'])
    expect(manifest.products.tmp_surface.encoding).toEqual({
      id: 'e0',
      format: 'linear-i8-v1',
      dtype: 'int8',
      byteOrder: 'none',
      nodata: -128,
      scale: 5,
      offset: 0,
      decodeFormula: 'value = stored * scale + offset',
    })
  })

  it('preserves packed product component order as payload layout', () => {
    const payload = createCycleManifestPayloadFixture()
    tmpProduct(payload).components = ['medium', 'low', 'high']

    const manifest = parseCycleManifest(payload)

    expect(manifest.products.tmp_surface.components).toEqual(['medium', 'low', 'high'])
  })

  it('parses explicit scalar product groups', () => {
    const payload = createCycleManifestPayloadFixture()
    payload.groups = [
      {
        id: 'temperature',
        layerId: 'scalar',
        label: 'Temperature',
        defaultProductId: 'tmp_surface',
        productIds: ['tmp_surface'],
      },
    ]

    const manifest = parseCycleManifest(payload)

    expect(manifest.groups).toEqual([
      {
        id: 'temperature',
        layerId: 'scalar',
        label: 'Temperature',
        defaultProduct: 'tmp_surface',
        products: ['tmp_surface'],
      },
    ])
  })

  it('rejects scalar product groups that omit a scalar product', () => {
    const payload = createCycleManifestPayloadFixture({
      scalarProducts: ['tmp_surface', 'rh_surface'],
    })
    payload.groups = [
      {
        id: 'temperature',
        layerId: 'scalar',
        label: 'Temperature',
        defaultProductId: 'tmp_surface',
        productIds: ['tmp_surface'],
      },
    ]

    expect(() => parseCycleManifest(payload)).toThrow('Manifest groups missing scalar products: rh_surface')
  })

  it('rejects scalar product groups with defaults outside the group', () => {
    const payload = createCycleManifestPayloadFixture()
    payload.groups = [
      {
        id: 'temperature',
        layerId: 'scalar',
        label: 'Temperature',
        defaultProductId: 'rh_surface',
        productIds: ['tmp_surface'],
      },
    ]

    expect(() => parseCycleManifest(payload)).toThrow(
      'Manifest groups entry temperature defaultProductId rh_surface is not in productIds'
    )
  })

  it('rejects scalar product groups with unknown products or duplicate assignments', () => {
    const unknownPayload = createCycleManifestPayloadFixture()
    unknownPayload.groups = [
      {
        id: 'temperature',
        layerId: 'scalar',
        label: 'Temperature',
        defaultProductId: 'missing_surface',
        productIds: ['missing_surface'],
      },
    ]

    expect(() => parseCycleManifest(unknownPayload)).toThrow(
      'references product missing_surface outside layer scalar'
    )

    const duplicatePayload = createCycleManifestPayloadFixture()
    duplicatePayload.groups = [
      {
        id: 'temperature',
        layerId: 'scalar',
        label: 'Temperature',
        defaultProductId: 'tmp_surface',
        productIds: ['tmp_surface'],
      },
      {
        id: 'more-temperature',
        layerId: 'scalar',
        label: 'More Temperature',
        defaultProductId: 'tmp_surface',
        productIds: ['tmp_surface'],
      },
    ]

    expect(() => parseCycleManifest(duplicatePayload)).toThrow(
      'Manifest groups assigns product tmp_surface to multiple scalar groups'
    )
  })
})
