import { useEffect } from 'react'
import L from "leaflet";
import "./leafletIconFix";
import './App.css'

function App() {
  
  useEffect(() => {
    const map = L.map("map", {
      center: [39.5, -98.35],
      zoom: 4,
      maxZoom: 7,
      zoomControl: true,
    });

    L.tileLayer("/temp/{z}/{x}/{y}.png", {
      tms: true,
    }).addTo(map);

    // Base map layer
    L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      opacity: 0.3,
    }).addTo(map);

    // Label layer
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 19,
    }).addTo(map);

    return () => {
      map.remove();
    };
  }, []);

  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      <div id="map" style={{ height: "100%", width: "100%" }} />
    </div>
  );
}

export default App;
