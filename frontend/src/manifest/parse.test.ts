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
})
