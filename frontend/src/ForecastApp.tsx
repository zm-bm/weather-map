import { AppStatusProvider } from './app-status'
import ForecastShell from './components/ForecastShell/ForecastShell'
import {
  AppStartupStatus,
  useForecastBootstrap,
} from './forecast-bootstrap'

export default function ForecastApp() {
  const forecast = useForecastBootstrap()

  return (
    <AppStatusProvider>
      <div className="app-root">
        <ForecastShell forecast={forecast.data} />
        <AppStartupStatus state={forecast} />
      </div>
    </AppStatusProvider>
  )
}
