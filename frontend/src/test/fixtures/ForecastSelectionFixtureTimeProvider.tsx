import type { ReactNode } from 'react'

import { useForecastSelectionContext } from '@/forecast/selection'
import { ForecastTimeProvider } from '@/forecast/time'

export default function ForecastSelectionFixtureTimeProvider({ children }: { children: ReactNode }) {
  const { activeRun } = useForecastSelectionContext()
  return (
    <ForecastTimeProvider activeRun={activeRun}>
      {children}
    </ForecastTimeProvider>
  )
}
