import { AppStatusProvider } from './app-status'
import ForecastShell from './components/ForecastShell/ForecastShell'
import {
  AppStartupStatus,
  useForecastManifest,
} from './forecast-manifest'

export default function ForecastApp() {
  const forecast = useForecastManifest()

  return (
    <AppStatusProvider>
      <div className="app-root">
        <ForecastShell forecast={forecast.data} />
        <AppStartupStatus state={forecast} />
      </div>
    </AppStatusProvider>
  )
}
