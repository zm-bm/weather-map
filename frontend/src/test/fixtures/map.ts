import type { IControl, Map as MapLibreMap } from 'maplibre-gl'
import { vi } from 'vitest'

export type ControllableMapFixture = MapLibreMap & {
  addControl: ReturnType<typeof vi.fn>
  getMaxZoom: ReturnType<typeof vi.fn>
  getMinZoom: ReturnType<typeof vi.fn>
  getZoom: ReturnType<typeof vi.fn>
  hasControl: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  removeControl: ReturnType<typeof vi.fn>
  zoomIn: ReturnType<typeof vi.fn>
  zoomOut: ReturnType<typeof vi.fn>
}

export function createMapFixture(): ControllableMapFixture {
  const controls = new Set<IControl>()
  let zoom = 3
  const minZoom = 2
  const maxZoom = 6.99
  const listeners = new Map<string, Set<() => void>>()

  const emit = (eventName: string) => {
    listeners.get(eventName)?.forEach((listener) => {
      listener()
    })
  }

  return {
    addControl: vi.fn((control: IControl) => {
      controls.add(control)
      return undefined
    }),
    getMaxZoom: vi.fn(() => maxZoom),
    getMinZoom: vi.fn(() => minZoom),
    getZoom: vi.fn(() => zoom),
    hasControl: vi.fn((control: IControl) => controls.has(control)),
    off: vi.fn((eventName: string, listener: () => void) => {
      listeners.get(eventName)?.delete(listener)
      return undefined
    }),
    on: vi.fn((eventName: string, listener: () => void) => {
      let eventListeners = listeners.get(eventName)
      if (!eventListeners) {
        eventListeners = new Set()
        listeners.set(eventName, eventListeners)
      }
      eventListeners.add(listener)
      return undefined
    }),
    removeControl: vi.fn((control: IControl) => {
      controls.delete(control)
      return undefined
    }),
    zoomIn: vi.fn(() => {
      zoom = Math.min(maxZoom, zoom + 1)
      emit('zoom')
      emit('zoomend')
      return undefined
    }),
    zoomOut: vi.fn(() => {
      zoom = Math.max(minZoom, zoom - 1)
      emit('zoom')
      emit('zoomend')
      return undefined
    }),
  } as unknown as ControllableMapFixture
}
