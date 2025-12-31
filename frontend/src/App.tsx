import { useEffect } from 'react'
import L from "leaflet";
import "./leafletIconFix";
import './App.css'

function App() {
  
  useEffect(() => {
    // Initialize map once
    const map = L.map("map", {
      center: [39.5, -98.35],
      zoom: 4,
      zoomControl: true,
    });

    // Base map (Carto light)
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 19,
    }).addTo(map);

    return () => {
      map.remove(); // cleanup on unmount
    };
  }, []);

  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      <div id="map" style={{ height: "100%", width: "100%" }} />
    </div>
  );
}

export default App;
