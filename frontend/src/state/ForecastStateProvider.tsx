import type { ReactNode } from 'react'

import type { CycleManifest } from '../map/manifest'
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

  return (
    <VariableProvider manifest={manifest}>
      <TimelineProvider key={timelineProviderKey} manifest={manifest}>
        {children}
      </TimelineProvider>
    </VariableProvider>
  )
}
