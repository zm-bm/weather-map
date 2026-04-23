import { describe, expect, it } from 'vitest'

import { createMapControllerRegistry } from './controllers'
import { createMapFixture } from '../test/fixtures'

describe('createMapControllerRegistry', () => {
  it('registers and retrieves controllers per-map', () => {
    const registry = createMapControllerRegistry<{ value: string }>()
    const map = createMapFixture()

    expect(registry.get(map)).toBeNull()

    const controller = { value: 'x' }
    registry.register(map, controller)

    expect(registry.get(map)).toBe(controller)
  })

  it('unregister removes controllers', () => {
    const registry = createMapControllerRegistry<{ value: string }>()
    const map = createMapFixture()

    registry.register(map, { value: 'x' })
    registry.unregister(map)

    expect(registry.get(map)).toBeNull()
  })
})
