import type { IControl, Map as MapLibreMap } from 'maplibre-gl'
import { vi } from 'vitest'

export type ControllableMapFixture = MapLibreMap & {
  addControl: ReturnType<typeof vi.fn>
  hasControl: ReturnType<typeof vi.fn>
  removeControl: ReturnType<typeof vi.fn>
}

export function createMapFixture(): ControllableMapFixture {
  const controls = new Set<IControl>()

  return {
    addControl: vi.fn((control: IControl) => {
      controls.add(control)
      return undefined
    }),
    hasControl: vi.fn((control: IControl) => controls.has(control)),
    removeControl: vi.fn((control: IControl) => {
      controls.delete(control)
      return undefined
    }),
  } as unknown as ControllableMapFixture
}
