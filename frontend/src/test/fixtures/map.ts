import type { IControl, Map as MapLibreMap } from 'maplibre-gl'

export function createMapFixture(): MapLibreMap {
  const controls = new Set<IControl>()

  return {
    addControl: (control: IControl) => {
      controls.add(control)
      return undefined
    },
    hasControl: (control: IControl) => controls.has(control),
    removeControl: (control: IControl) => {
      controls.delete(control)
      return undefined
    },
  } as unknown as MapLibreMap
}
