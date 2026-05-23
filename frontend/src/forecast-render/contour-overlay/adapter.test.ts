import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_FIELD_RENDER_SETTINGS,
  DEFAULT_PARTICLE_RENDER_SETTINGS,
} from '../../forecast-settings/settings'
import { FORECAST_LAYER_BEFORE_ID } from '../layer'
import {
  applyPressureContourInterpolationWindow,
  CONTOUR_OVERLAY_LAYER_ID,
  contourOverlayAdapter,
} from './adapter'
import {
  registerContourOverlayController,
  unregisterContourOverlayController,
} from './controller'

const DEFAULT_RENDER_SETTINGS = {
  field: DEFAULT_FIELD_RENDER_SETTINGS,
  particles: DEFAULT_PARTICLE_RENDER_SETTINGS,
}

describe('contourOverlayAdapter', () => {
  it('installs a custom pressure contour layer in forecast render order', () => {
    const addLayer = vi.fn()
    const map = {
      getLayer: vi.fn((layerId: string) => (
        layerId === FORECAST_LAYER_BEFORE_ID ? { id: FORECAST_LAYER_BEFORE_ID } : undefined
      )),
      addLayer,
    }

    contourOverlayAdapter.install(map as never, DEFAULT_RENDER_SETTINGS)

    expect(addLayer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: CONTOUR_OVERLAY_LAYER_ID,
        type: 'custom',
        renderingMode: '2d',
        onAdd: expect.any(Function),
        render: expect.any(Function),
        onRemove: expect.any(Function),
      }),
      FORECAST_LAYER_BEFORE_ID,
    )
  })

  it('applies pressure contour frames through the registered controller', () => {
    const map = {}
    const applyFrame = vi.fn()
    registerContourOverlayController(map as never, {
      isAvailable: () => true,
      applyFrame,
      setEnabled: vi.fn(),
    })

    try {
      applyPressureContourInterpolationWindow(map as never, null)
    } finally {
      unregisterContourOverlayController(map as never)
    }

    expect(applyFrame).toHaveBeenCalledWith(null)
  })

  it('clears contour data when texture application fails', () => {
    const map = {}
    const error = new Error('texture upload failed')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const applyFrame = vi.fn()
      .mockImplementationOnce(() => {
        throw error
      })
      .mockImplementationOnce(() => undefined)
    registerContourOverlayController(map as never, {
      isAvailable: () => true,
      applyFrame,
      setEnabled: vi.fn(),
    })

    try {
      applyPressureContourInterpolationWindow(map as never, {} as never)
      expect(warn).toHaveBeenCalledWith('[contour-overlay] failed to apply pressure contours', error)
      expect(applyFrame).toHaveBeenNthCalledWith(2, null)
    } finally {
      unregisterContourOverlayController(map as never)
      warn.mockRestore()
    }
  })

  it('no-ops when the contour runtime is unavailable', () => {
    const map = {}
    const applyFrame = vi.fn()
    registerContourOverlayController(map as never, {
      isAvailable: () => false,
      applyFrame,
      setEnabled: vi.fn(),
    })

    try {
      applyPressureContourInterpolationWindow(map as never, {} as never)
    } finally {
      unregisterContourOverlayController(map as never)
    }

    expect(applyFrame).not.toHaveBeenCalled()
  })

  it('removes the custom contour layer', () => {
    const removeLayer = vi.fn()
    const map = {
      getLayer: vi.fn(() => ({ id: CONTOUR_OVERLAY_LAYER_ID })),
      removeLayer,
    }

    contourOverlayAdapter.uninstall?.(map as never)

    expect(removeLayer).toHaveBeenCalledWith(CONTOUR_OVERLAY_LAYER_ID)
  })
})
