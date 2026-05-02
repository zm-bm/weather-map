import { forwardRef } from 'react'

import ForecastControls from '../ForecastControls'

const ForecastPanel = forwardRef<HTMLElement>(function ForecastPanel(_props, ref) {
  return (
    <section ref={ref} className="forecast-panel wm-panel-shell" aria-label="Local forecast panel">
      <ForecastControls />
    </section>
  )
})

export default ForecastPanel
