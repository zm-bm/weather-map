import { describe, expect, it } from 'vitest'

import { parseCycleManifest, parseLatestManifest } from './parse'
import {
  createCycleManifestPayloadFixture,
  createLatestManifestPayloadFixture,
} from '../test/fixtures'

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
})

describe('parseLatestManifest', () => {
  it('rejects payloads missing required fields', () => {
    const payload = createLatestManifestPayloadFixture() as Record<string, unknown>
    delete payload.revision

    expect(() => parseLatestManifest(payload)).toThrow(
      'latest.json missing valid { cycle, generated_at, revision }'
    )
  })
})
