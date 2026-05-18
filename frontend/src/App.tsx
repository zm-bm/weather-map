import './styles/index.css'

import { BrowserRouter, Route, Routes } from 'react-router-dom'

import ForecastApp from './ForecastApp'
import HealthPage from './health/HealthPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/health/*" element={<HealthPage />} />
        <Route path="*" element={<ForecastApp />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
