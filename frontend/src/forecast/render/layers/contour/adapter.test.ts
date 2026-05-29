import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createContourWindowFixture,
  createRenderControllerFixture,
  createRenderLayerMapFixture,
  createCustomLayerRuntimeFixture,
  createRenderSettingsFixture,
} from '@/test/fixtures'
import { FORECAST_LAYER_BEFORE_ID } from '../../maplibre/customLayer'
import type { RenderControllerLifecycle } from '../../maplibre/layerAdapter'
import {
  CONTOUR_LAYER_ID,
  contourAdapter,
} from './adapter'
import type { ContourController } from './runtime'

const mocks = vi.hoisted(() => ({
  createContourRuntime: vi.fn(),
}))

vi.mock('./runtime', () => ({
  createContourRuntime: mocks.createContourRuntime,
}))

describe('contourAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createContourRuntime.mockReturnValue(createCustomLayerRuntimeFixture())
  })

  it('installs a custom pressure contour layer in forecast render order', () => {
    const map = createRenderLayerMapFixture()

    contourAdapter.install(map, createRenderSettingsFixture())

    expect(map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: CONTOUR_LAYER_ID,
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
    const unregister = registerContourControllerFixture(map, createRenderControllerFixture({ applyFrame }))

    try {
      contourAdapter.apply(map, {})
    } finally {
      unregister()
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
    const unregister = registerContourControllerFixture(map, createRenderControllerFixture({ applyFrame }))

    try {
      contourAdapter.apply(map, { contour: createContourWindowFixture() })
      expect(warn).toHaveBeenCalledWith('[contour] failed to apply pressure contours', error)
      expect(applyFrame).toHaveBeenNthCalledWith(2, null)
    } finally {
      unregister()
      warn.mockRestore()
    }
  })

  it('no-ops when the contour runtime is unavailable', () => {
    const map = createRenderLayerMapFixture()
    const applyFrame = vi.fn()
    const unregister = registerContourControllerFixture(map, createRenderControllerFixture({
      available: false,
      applyFrame,
    }))

    try {
      contourAdapter.apply(map, { contour: createContourWindowFixture() })
    } finally {
      unregister()
    }

    expect(applyFrame).not.toHaveBeenCalled()
  })

  it('removes the custom contour layer', () => {
    const map = createRenderLayerMapFixture({ layerIds: [CONTOUR_LAYER_ID] })

    contourAdapter.uninstall(map)

    expect(map.removeLayer).toHaveBeenCalledWith(CONTOUR_LAYER_ID)
  })
})

function registerContourControllerFixture(
  map: ReturnType<typeof createRenderLayerMapFixture>,
  controller: ContourController,
): () => void {
  contourAdapter.install(map, createRenderSettingsFixture())
  const lifecycle = mocks.createContourRuntime.mock.calls.at(-1)?.[0] as
    | RenderControllerLifecycle<ContourController>
    | undefined
  if (!lifecycle) throw new Error('Expected contour overlay controller lifecycle')
  lifecycle.register(map, controller)
  return () => lifecycle.unregister(map)
}
