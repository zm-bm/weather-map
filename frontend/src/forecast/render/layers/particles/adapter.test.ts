import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createRenderControllerFixture,
  createRenderLayerMapFixture,
  createCustomLayerRuntimeFixture,
  createRenderSettingsFixture,
  createParticlesWindowFixture,
} from '@/test/fixtures'
import { FORECAST_LAYER_BEFORE_ID } from '../../maplibre/customLayer'
import type { RenderControllerLifecycle } from '../../maplibre/layerAdapter'
import { particlesAdapter } from './adapter'
import type { ParticlesController } from './runtime'

const mocks = vi.hoisted(() => ({
  createParticlesRuntime: vi.fn(),
}))

vi.mock('./runtime', () => ({
  createParticlesRuntime: mocks.createParticlesRuntime,
}))

describe('particlesAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('installs the particle custom layer', () => {
    const renderSettings = createRenderSettingsFixture()
    mocks.createParticlesRuntime.mockReturnValue(createCustomLayerRuntimeFixture())
    const map = createRenderLayerMapFixture()

    particlesAdapter.install(map, renderSettings)

    expect(mocks.createParticlesRuntime).toHaveBeenCalledWith(expect.any(Object), renderSettings.particles)
    const [layer, beforeId] = map.addLayer.mock.calls[0] ?? []
    expect(layer.id).toBe('forecast-particles-layer')
    expect(layer.type).toBe('custom')
    expect(layer.renderingMode).toBe('2d')
    expect(beforeId).toBe(FORECAST_LAYER_BEFORE_ID)
  })

  it('skips install when the layer already exists', () => {
    const map = createRenderLayerMapFixture({ layerIds: ['forecast-particles-layer'] })

    particlesAdapter.install(map, createRenderSettingsFixture())

    expect(map.addLayer).not.toHaveBeenCalled()
    expect(mocks.createParticlesRuntime).not.toHaveBeenCalled()
  })

  it('applies a loaded particle frame to the runtime controller', () => {
    const frame = createParticlesWindowFixture()
    const applyFrame = vi.fn()
    const setEnabled = vi.fn()
    const map = createRenderLayerMapFixture()
    const unregister = registerParticlesControllerFixture(map, createRenderControllerFixture({
      applyFrame,
      setEnabled,
    }))

    try {
      particlesAdapter.apply(map, { particles: frame })
    } finally {
      unregister()
    }

    expect(setEnabled).toHaveBeenCalledWith(true)
    expect(applyFrame).toHaveBeenCalledWith(frame)
  })

  it('disables the particle controller when no particle frame is selected', () => {
    const setEnabled = vi.fn()
    const map = createRenderLayerMapFixture()
    const unregister = registerParticlesControllerFixture(map, createRenderControllerFixture({ setEnabled }))

    try {
      particlesAdapter.apply(map, {})
    } finally {
      unregister()
    }

    expect(setEnabled).toHaveBeenCalledWith(false)
  })

  it('throws when runtime is unavailable', () => {
    const map = createRenderLayerMapFixture()
    const unregister = registerParticlesControllerFixture(map, createRenderControllerFixture({ available: false }))

    try {
      expect(() => particlesAdapter.apply(map, { particles: createParticlesWindowFixture() }))
        .toThrow('Particle runtime unavailable (WebGL2 required)')
    } finally {
      unregister()
    }
  })

  it('disables particles without requiring an available runtime for empty frames', () => {
    const setEnabled = vi.fn()
    const map = createRenderLayerMapFixture()
    const unregister = registerParticlesControllerFixture(map, createRenderControllerFixture({
      available: false,
      setEnabled,
    }))

    try {
      particlesAdapter.apply(map, {})
    } finally {
      unregister()
    }

    expect(setEnabled).toHaveBeenCalledWith(false)
  })

  it('applies render settings to the particle controller', () => {
    const applySettings = vi.fn()
    const map = createRenderLayerMapFixture()
    const settings = {
      clearTrailsOnViewChange: false,
      fadeInAgeRatio: 0.2,
      fadeOutAgeRatio: 0.3,
    }
    const renderSettings = createRenderSettingsFixture()
    renderSettings.particles = {
      ...renderSettings.particles,
      ...settings,
    }
    const unregister = registerParticlesControllerFixture(map, createRenderControllerFixture({ applySettings }))

    try {
      particlesAdapter.configure?.(map, renderSettings)
    } finally {
      unregister()
    }

    expect(applySettings).toHaveBeenCalledWith(renderSettings.particles)
  })
})

function registerParticlesControllerFixture(
  map: ReturnType<typeof createRenderLayerMapFixture>,
  controller: ParticlesController,
): () => void {
  mocks.createParticlesRuntime.mockReturnValue(createCustomLayerRuntimeFixture())
  particlesAdapter.install(map, createRenderSettingsFixture())
  const lifecycle = mocks.createParticlesRuntime.mock.calls.at(-1)?.[0] as
    | RenderControllerLifecycle<ParticlesController>
    | undefined
  if (!lifecycle) throw new Error('Expected particle controller lifecycle')
  lifecycle.register(map, controller)
  return () => lifecycle.unregister(map)
}
