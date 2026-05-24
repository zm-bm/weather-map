import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createRenderControllerFixture,
  createRenderLayerMapFixture,
  createRenderRuntimeFixture,
  createRenderSettingsFixture,
  createWindVectorWindowFixture,
} from '@/test/fixtures'
import { FORECAST_LAYER_BEFORE_ID } from '../layer'
import { applyParticleInterpolationWindow, applyParticleRenderSettings, particleAdapter } from './adapter'

const mocks = vi.hoisted(() => ({
  getParticleController: vi.fn(),
  createParticleRuntime: vi.fn(),
}))

vi.mock('./controller', () => ({
  getParticleController: mocks.getParticleController,
}))

vi.mock('./engine/runtime', () => ({
  createParticleRuntime: mocks.createParticleRuntime,
}))

describe('particleAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getParticleController.mockReturnValue(createRenderControllerFixture())
  })

  it('installs the particle custom layer', () => {
    const renderSettings = createRenderSettingsFixture()
    mocks.createParticleRuntime.mockReturnValue(createRenderRuntimeFixture())
    const map = createRenderLayerMapFixture()

    particleAdapter.install(map, renderSettings)

    expect(mocks.createParticleRuntime).toHaveBeenCalledWith(renderSettings.particles)
    const [layer, beforeId] = map.addLayer.mock.calls[0] ?? []
    expect(layer.id).toBe('particle-renderer-layer-id')
    expect(layer.type).toBe('custom')
    expect(layer.renderingMode).toBe('2d')
    expect(beforeId).toBe(FORECAST_LAYER_BEFORE_ID)
  })

  it('skips install when the layer already exists', () => {
    const map = createRenderLayerMapFixture({ layerIds: ['particle-renderer-layer-id'] })

    particleAdapter.install(map, createRenderSettingsFixture())

    expect(map.addLayer).not.toHaveBeenCalled()
    expect(mocks.createParticleRuntime).not.toHaveBeenCalled()
  })

  it('applies a loaded particle frame to the runtime controller', () => {
    const frame = createWindVectorWindowFixture()
    const applyFrame = vi.fn()
    const setEnabled = vi.fn()
    const map = createRenderLayerMapFixture()
    mocks.getParticleController.mockReturnValue(createRenderControllerFixture({
      applyFrame,
      setEnabled,
    }))

    applyParticleInterpolationWindow(map, frame)

    expect(setEnabled).toHaveBeenCalledWith(true)
    expect(applyFrame).toHaveBeenCalledWith(frame)
  })

  it('disables the particle controller when no particle frame is selected', () => {
    const setEnabled = vi.fn()
    mocks.getParticleController.mockReturnValue(createRenderControllerFixture({ setEnabled }))

    applyParticleInterpolationWindow(createRenderLayerMapFixture(), null)

    expect(setEnabled).toHaveBeenCalledWith(false)
  })

  it('throws when runtime is unavailable', () => {
    mocks.getParticleController.mockReturnValue(createRenderControllerFixture({ available: false }))

    expect(() => applyParticleInterpolationWindow(createRenderLayerMapFixture(), createWindVectorWindowFixture()))
      .toThrow('Particle runtime unavailable (WebGL2 required)')
  })

  it('disables particles without requiring an available runtime for empty frames', () => {
    const setEnabled = vi.fn()
    mocks.getParticleController.mockReturnValue(createRenderControllerFixture({
      available: false,
      setEnabled,
    }))

    applyParticleInterpolationWindow(createRenderLayerMapFixture(), null)

    expect(setEnabled).toHaveBeenCalledWith(false)
  })

  it('applies render settings to the particle controller', () => {
    const applySettings = vi.fn()
    const map = createRenderLayerMapFixture()
    const settings = { clearTrailsOnViewChange: false }
    mocks.getParticleController.mockReturnValue(createRenderControllerFixture({ applySettings }))

    applyParticleRenderSettings(map, settings)

    expect(applySettings).toHaveBeenCalledWith(settings)
  })
})
