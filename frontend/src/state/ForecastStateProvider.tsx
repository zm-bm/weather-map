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
  return (
    <VariableProvider manifest={manifest}>
      <TimelineProvider manifest={manifest}>
        {children}
      </TimelineProvider>
    </VariableProvider>
  )
}
