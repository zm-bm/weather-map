import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_FIELD_RENDER_SETTINGS,
  DEFAULT_PARTICLE_RENDER_SETTINGS,
} from '../../forecast-settings/settings'
import { FORECAST_LAYER_BEFORE_ID } from '../layer'
import { applyParticleInterpolationWindow, applyParticleRenderSettings, particleAdapter } from './adapter'

const DEFAULT_RENDER_SETTINGS = {
  field: DEFAULT_FIELD_RENDER_SETTINGS,
  particles: DEFAULT_PARTICLE_RENDER_SETTINGS,
}

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
    mocks.getParticleController.mockReturnValue({
      isAvailable: () => true,
      applyFrame: vi.fn(),
      setEnabled: vi.fn(),
      applySettings: vi.fn(),
    })
  })

  it('installs the particle custom layer', () => {
    mocks.createParticleRuntime.mockReturnValue({
      onAdd: vi.fn(),
      render: vi.fn(),
      onRemove: vi.fn(),
    })
    const addLayer = vi.fn()
    const map = {
      getLayer: vi.fn((layerId: string) => (
        layerId === FORECAST_LAYER_BEFORE_ID ? { id: FORECAST_LAYER_BEFORE_ID } : undefined
      )),
      addLayer,
    }

    particleAdapter.install(map as never, DEFAULT_RENDER_SETTINGS)

    expect(mocks.createParticleRuntime).toHaveBeenCalledWith(DEFAULT_RENDER_SETTINGS.particles)
    const [layer, beforeId] = addLayer.mock.calls[0] ?? []
    expect(layer.id).toBe('particle-renderer-layer-id')
    expect(layer.type).toBe('custom')
    expect(layer.renderingMode).toBe('2d')
    expect(beforeId).toBe(FORECAST_LAYER_BEFORE_ID)
  })

  it('skips install when the layer already exists', () => {
    const map = {
      getLayer: vi.fn(() => ({ id: 'particle-renderer-layer-id' })),
      addLayer: vi.fn(),
    }

    particleAdapter.install(map as never, DEFAULT_RENDER_SETTINGS)

    expect(map.addLayer).not.toHaveBeenCalled()
    expect(mocks.createParticleRuntime).not.toHaveBeenCalled()
  })

  it('applies a loaded particle frame to the runtime controller', () => {
    const frame = { lower: { artifactId: 'wind10m_uv' } }
    const applyFrame = vi.fn()
    const setEnabled = vi.fn()
    const map = {}
    mocks.getParticleController.mockReturnValue({
      isAvailable: () => true,
      applyFrame,
      setEnabled,
      applySettings: vi.fn(),
    })

    applyParticleInterpolationWindow(map as never, frame as never)

    expect(setEnabled).toHaveBeenCalledWith(true)
    expect(applyFrame).toHaveBeenCalledWith(frame)
  })

  it('disables the particle controller when no particle frame is selected', () => {
    const setEnabled = vi.fn()
    mocks.getParticleController.mockReturnValue({
      isAvailable: () => true,
      applyFrame: vi.fn(),
      setEnabled,
      applySettings: vi.fn(),
    })

    applyParticleInterpolationWindow({} as never, null)

    expect(setEnabled).toHaveBeenCalledWith(false)
  })

  it('throws when runtime is unavailable', () => {
    mocks.getParticleController.mockReturnValue({
      isAvailable: () => false,
      applyFrame: vi.fn(),
      setEnabled: vi.fn(),
      applySettings: vi.fn(),
    })

    expect(() => applyParticleInterpolationWindow({} as never, { lower: { artifactId: 'wind10m_uv' } } as never))
      .toThrow('Particle runtime unavailable (WebGL2 required)')
  })

  it('disables particles without requiring an available runtime for empty frames', () => {
    const setEnabled = vi.fn()
    mocks.getParticleController.mockReturnValue({
      isAvailable: () => false,
      applyFrame: vi.fn(),
      setEnabled,
      applySettings: vi.fn(),
    })

    applyParticleInterpolationWindow({} as never, null)

    expect(setEnabled).toHaveBeenCalledWith(false)
  })

  it('applies render settings to the particle controller', () => {
    const applySettings = vi.fn()
    const map = {}
    const settings = { clearTrailsOnViewChange: false }
    mocks.getParticleController.mockReturnValue({
      isAvailable: () => true,
      applyFrame: vi.fn(),
      setEnabled: vi.fn(),
      applySettings,
    })

    applyParticleRenderSettings(map as never, settings)

    expect(applySettings).toHaveBeenCalledWith(settings)
  })
})
