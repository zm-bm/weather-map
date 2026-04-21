import type { ReactNode } from 'react'

import type { CycleManifest } from '../map/manifest'
import MapProbeProvider from './MapProbeProvider'
import VariableProvider from './VariableProvider'
import TimelineProvider from './TimelineProvider'

type ForecastStateProviderProps = {
  manifest: CycleManifest | null
  children: ReactNode
}

export default function ForecastStateProvider({
  manifest,
  children,
}: ForecastStateProviderProps) {
  // Remount timeline state whenever cycle/hour list changes so initial index
  // is computed from the new manifest synchronously during mount.
  const timelineProviderKey = manifest == null
    ? 'timeline:none'
    : `timeline:${manifest.cycle}:${manifest.forecastHours.join(',')}`
  const mapProbeProviderKey = manifest == null
    ? 'probe:none'
    : `probe:${manifest.cycle}`

  return (
    <VariableProvider manifest={manifest}>
      <MapProbeProvider key={mapProbeProviderKey}>
        <TimelineProvider key={timelineProviderKey} manifest={manifest}>
          {children}
        </TimelineProvider>
      </MapProbeProvider>
    </VariableProvider>
  )
}
