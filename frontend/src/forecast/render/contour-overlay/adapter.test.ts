import { describe, expect, it, vi } from 'vitest'

import {
  createPressureWindowFixture,
  createRenderControllerFixture,
  createRenderLayerMapFixture,
  createRenderSettingsFixture,
} from '@/test/fixtures'
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

describe('contourOverlayAdapter', () => {
  it('installs a custom pressure contour layer in forecast render order', () => {
    const map = createRenderLayerMapFixture()

    contourOverlayAdapter.install(map, createRenderSettingsFixture())

    expect(map.addLayer).toHaveBeenCalledWith(
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
    const applyFrame = vi.fn()
    const map = createRenderLayerMapFixture()
    registerContourOverlayController(map, createRenderControllerFixture({ applyFrame }))

    try {
      applyPressureContourInterpolationWindow(map, null)
    } finally {
      unregisterContourOverlayController(map)
    }

    expect(applyFrame).toHaveBeenCalledWith(null)
  })

  it('clears contour data when texture application fails', () => {
    const map = createRenderLayerMapFixture()
    const error = new Error('texture upload failed')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const applyFrame = vi.fn()
      .mockImplementationOnce(() => {
        throw error
      })
      .mockImplementationOnce(() => undefined)
    registerContourOverlayController(map, createRenderControllerFixture({ applyFrame }))

    try {
      applyPressureContourInterpolationWindow(map, createPressureWindowFixture())
      expect(warn).toHaveBeenCalledWith('[contour-overlay] failed to apply pressure contours', error)
      expect(applyFrame).toHaveBeenNthCalledWith(2, null)
    } finally {
      unregisterContourOverlayController(map)
      warn.mockRestore()
    }
  })

  it('no-ops when the contour runtime is unavailable', () => {
    const map = createRenderLayerMapFixture()
    const applyFrame = vi.fn()
    registerContourOverlayController(map, createRenderControllerFixture({
      available: false,
      applyFrame,
    }))

    try {
      applyPressureContourInterpolationWindow(map, createPressureWindowFixture())
    } finally {
      unregisterContourOverlayController(map)
    }

    expect(applyFrame).not.toHaveBeenCalled()
  })

  it('removes the custom contour layer', () => {
    const map = createRenderLayerMapFixture({ layerIds: [CONTOUR_OVERLAY_LAYER_ID] })

    contourOverlayAdapter.uninstall?.(map)

    expect(map.removeLayer).toHaveBeenCalledWith(CONTOUR_OVERLAY_LAYER_ID)
  })
})
