import { describe, expect, it } from 'vitest'

import { parseCycleManifest } from './parse'
import { createCycleManifestPayloadFixture } from '../test/fixtures'

describe('parseCycleManifest', () => {
  it('rejects empty scalar variable lists', () => {
    const payload = createCycleManifestPayloadFixture({
      scalarVariables: [],
    })

    expect(() => parseCycleManifest(payload)).toThrow(
      'Invalid manifest field scalar_variables: expected non-empty string[]'
    )
  })

  it('rejects empty vector variable lists', () => {
    const payload = createCycleManifestPayloadFixture({
      vectorVariables: [],
    })

    expect(() => parseCycleManifest(payload)).toThrow(
      'Invalid manifest field vector_variables: expected non-empty string[]'
    )
  })

  it('rejects scalar list entries that are not scalar metadata', () => {
    const payload = createCycleManifestPayloadFixture({
      scalarVariables: ['wind10m_uv'],
    })

    expect(() => parseCycleManifest(payload)).toThrow(
      'Manifest scalar_variables entry wind10m_uv has invalid kind vector; expected scalar'
    )
  })

  it('rejects vector list entries that are not vector metadata', () => {
    const payload = createCycleManifestPayloadFixture({
      vectorVariables: ['tmp_surface'],
    })

    expect(() => parseCycleManifest(payload)).toThrow(
      'Manifest vector_variables entry tmp_surface has invalid kind scalar; expected vector'
    )
  })

  it('rejects payloads with missing variable metadata', () => {
    const payload = createCycleManifestPayloadFixture()
    delete (payload.variable_meta as Record<string, unknown>).tmp_surface

    expect(() => parseCycleManifest(payload)).toThrow(
      'Manifest variable_meta missing entry for tmp_surface'
    )
  })

  it('rejects payloads with missing grid references', () => {
    const payload = createCycleManifestPayloadFixture()
    delete (payload.grids as Record<string, unknown>).g0

    expect(() => parseCycleManifest(payload)).toThrow(
      'Manifest grids missing id g0 for tmp_surface'
    )
  })

  it('rejects payloads with missing encoding references', () => {
    const payload = createCycleManifestPayloadFixture()
    delete (payload.encodings as Record<string, unknown>).e0

    expect(() => parseCycleManifest(payload)).toThrow(
      'Manifest encodings missing id e0 for tmp_surface'
    )
  })

  it('accepts fixed temperature piecewise scalar encodings', () => {
    const baseManifest = createCycleManifestPayloadFixture()
    const payload = createCycleManifestPayloadFixture({
      encodings: {
        ...(baseManifest.encodings as Record<string, unknown>),
        e0: {
          format: 'scalar-i8-temp-c-piecewise-v1',
          dtype: 'int8',
          byte_order: 'none',
          nodata: -128,
        },
      },
    })

    const manifest = parseCycleManifest(payload)

    expect(manifest.encodings.e0).toEqual({
      format: 'scalar-i8-temp-c-piecewise-v1',
      dtype: 'int8',
      byte_order: 'none',
      nodata: -128,
    })
  })

  it('rejects temperature piecewise encodings without the reserved nodata value', () => {
    const baseManifest = createCycleManifestPayloadFixture()
    const payload = createCycleManifestPayloadFixture({
      encodings: {
        ...(baseManifest.encodings as Record<string, unknown>),
        e0: {
          format: 'scalar-i8-temp-c-piecewise-v1',
          dtype: 'int8',
          byte_order: 'none',
          nodata: -127,
        },
      },
    })

    expect(() => parseCycleManifest(payload)).toThrow('expected -128')
  })

  it('accepts packed cloud layer scalar component encodings', () => {
    const baseManifest = createCycleManifestPayloadFixture()
    const payload = createCycleManifestPayloadFixture({
      encodings: {
        ...(baseManifest.encodings as Record<string, unknown>),
        e0: {
          format: 'scalar-i8-linear-components-v1',
          dtype: 'int8',
          byte_order: 'none',
          nodata: -128,
          scale: 5,
          offset: 0,
          decode_formula: 'value = stored * scale + offset',
          components: ['low', 'medium', 'high'],
          component_count: 3,
          component_order: 'low_medium_high',
        },
      },
    })

    const manifest = parseCycleManifest(payload)

    expect(manifest.encodings.e0).toEqual({
      format: 'scalar-i8-linear-components-v1',
      dtype: 'int8',
      byte_order: 'none',
      nodata: -128,
      scale: 5,
      offset: 0,
      decode_formula: 'value = stored * scale + offset',
      components: ['low', 'medium', 'high'],
      component_count: 3,
      component_order: 'low_medium_high',
    })
  })

  it('rejects packed cloud layer scalar encodings with the wrong component order', () => {
    const baseManifest = createCycleManifestPayloadFixture()
    const payload = createCycleManifestPayloadFixture({
      encodings: {
        ...(baseManifest.encodings as Record<string, unknown>),
        e0: {
          format: 'scalar-i8-linear-components-v1',
          dtype: 'int8',
          byte_order: 'none',
          nodata: -128,
          scale: 5,
          offset: 0,
          decode_formula: 'value = stored * scale + offset',
          components: ['low', 'medium', 'high'],
          component_count: 3,
          component_order: 'low_medium_high',
        },
      },
    })
    ;((payload.encodings as Record<string, Record<string, unknown>>).e0).components = ['medium', 'low', 'high']

    expect(() => parseCycleManifest(payload)).toThrow("expected ['low', 'medium', 'high']")
  })

  it('parses explicit scalar variable groups', () => {
    const payload = createCycleManifestPayloadFixture()
    payload.scalar_variable_groups = [
      {
        id: 'temperature',
        label: 'Temperature',
        default_variable: 'tmp_surface',
        variables: ['tmp_surface'],
      },
    ]

    const manifest = parseCycleManifest(payload)

    expect(manifest.scalarVariableGroups).toEqual([
      {
        id: 'temperature',
        label: 'Temperature',
        defaultVariable: 'tmp_surface',
        variables: ['tmp_surface'],
      },
    ])
  })

  it('derives a fallback scalar variable group for older manifests', () => {
    const payload = createCycleManifestPayloadFixture()
    delete payload.scalar_variable_groups

    const manifest = parseCycleManifest(payload)

    expect(manifest.scalarVariableGroups).toEqual([
      {
        id: 'layers',
        label: 'Layers',
        defaultVariable: 'tmp_surface',
        variables: ['tmp_surface'],
      },
    ])
  })

  it('rejects scalar variable groups that omit a scalar variable', () => {
    const payload = createCycleManifestPayloadFixture({
      scalarVariables: ['tmp_surface', 'rh_surface'],
    })
    const variableMeta = payload.variable_meta as Record<string, Record<string, unknown>>
    variableMeta.rh_surface = {
      ...variableMeta.tmp_surface,
      units: '%',
      parameter: 'rh',
    }
    payload.scalar_variable_groups = [
      {
        id: 'temperature',
        label: 'Temperature',
        default_variable: 'tmp_surface',
        variables: ['tmp_surface'],
      },
    ]

    expect(() => parseCycleManifest(payload)).toThrow(
      'Manifest scalar_variable_groups missing scalar variables: rh_surface'
    )
  })

  it('rejects scalar variable groups with defaults outside the group', () => {
    const payload = createCycleManifestPayloadFixture()
    payload.scalar_variable_groups = [
      {
        id: 'temperature',
        label: 'Temperature',
        default_variable: 'rh_surface',
        variables: ['tmp_surface'],
      },
    ]

    expect(() => parseCycleManifest(payload)).toThrow('default_variable rh_surface is not in variables')
  })

  it('rejects scalar variable groups with unknown variables', () => {
    const payload = createCycleManifestPayloadFixture()
    payload.scalar_variable_groups = [
      {
        id: 'temperature',
        label: 'Temperature',
        default_variable: 'missing_surface',
        variables: ['missing_surface'],
      },
    ]

    expect(() => parseCycleManifest(payload)).toThrow('references unknown scalar variable missing_surface')
  })
})
