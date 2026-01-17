import { type StyleSpecification } from 'maplibre-gl';

import { tilesUrl, serverUrl, language } from './config';

// Hardcoded for now, get from manifest later
const cycle = '2026011412'
const layer = 'temp2m'

export const WEATHER_LAYER_T000_ID = 'weather-t000-layer'
export const WEATHER_LAYER_T003_ID = 'weather-t003-layer'

const style: StyleSpecification = {
  "version": 8,
  "name": "ZMBM - Weather Map",
  "metadata": {
    "mapbox:type": "template",
    "mapbox:groups": {},
    "mapbox:autocomposite": true,
    "openmaptiles:version": "3.x"
  },
  "projection": {
    "type": "globe"
  },
  "sources": {
    "openmaptiles": {
      "type": "vector",
      "tiles": [`${tilesUrl}/data/openmaptiles/{z}/{x}/{y}.pbf`],
    },
    "coastline": {
      "type": "vector",
      "tiles": [`${tilesUrl}/data/coastline/{z}/{x}/{y}.pbf`],
    },
    "weather_t000": {
      "type": "raster",
      "tiles": [`${serverUrl}/tiles/${cycle}/${layer}/000/{z}/{x}/{y}.png`],
      "tileSize": 256,
      "minzoom": 0,
      "maxzoom": 5,
    },
    "weather_t003": {
      "type": "raster",
      "tiles": [`${serverUrl}/tiles/${cycle}/${layer}/003/{z}/{x}/{y}.png`],
      "tileSize": 256,
      "minzoom": 0,
      "maxzoom": 5,
    },
    "esri-hillshade": {
      "type": "raster",
      "tiles": [
        "https://services.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}"
      ],
      "tileSize": 256,
      "attribution": "esri"
    },
  },
  "sprite": `${tilesUrl}/styles/weather-map/sprite`,
  "glyphs": `${tilesUrl}/fonts/{fontstack}/{range}.pbf`,
  "layers": [
    {
      "id": "background",
      "type": "background",
      "paint": {
        "background-color": "#ffffff"
      }
    },
    {
      "id": "esri-hillshade",
      "type": "raster",
      "source": "esri-hillshade",
      "minzoom": 0,
      "maxzoom": 10,
      "paint": {
        "raster-opacity": 1.0,
        "raster-saturation": -1,
        "raster-contrast": 0.05,
        "raster-brightness-min": 0.0,
        "raster-brightness-max": 1.0
      }
    },
    {
      "id": "water-fill",
      "type": "fill",
      "source": "openmaptiles",
      "source-layer": "water",
      "filter": ["==", "$type", "Polygon"],
      "paint": {
        "fill-color": "#d8d8d8"
      }
    },
    {
      "id": "weather-t000-layer",
      "type": "raster",
      "source": "weather_t000",
      "layout": { "visibility": "visible" },
      "paint": { 'raster-opacity': 0.90 }
    },
    {
      "id": "weather-t003-layer",
      "type": "raster",
      "source": "weather_t003",
      "layout": { "visibility": "none" },
      "paint": { 'raster-opacity': 0.90 }
    },
    {
      "id": "boundary-land-level-2",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "boundary",
      "filter": [
        "all",
        ["==", "admin_level", 2],
        ["!=", "maritime", 1]
      ],
      "layout": {
        "line-cap": "round",
        "line-join": "round",
        "visibility": "visible"
      },
      "paint": {
        "line-color": "#000000",
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.6, 9, 0.8],
        "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.6, 5, 1.2, 10, 1.8]
      }
    },
    {
      "id": "boundary-land-level-4",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "boundary",
      "minzoom": 2,
      "filter": [
        "all",
        [">=", "admin_level", 3],
        ["<=", "admin_level", 4],
        ["!=", "maritime", 1]
      ],
      "layout": {
        "line-join": "round",
        "visibility": "visible"
      },
      "paint": {
        "line-color": "#000000",
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.6, 9, 0.8],
        "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.5, 5, 1.0, 10, 1.5],
        "line-dasharray": [3, 1, 1, 1]
      }
    },
    {
      "id": "coast-shadow",
      "type": "line",
      "source": "coastline",
      "source-layer": "coastline",
      "filter": ["==", "$type", "LineString"],
      "layout": {
        "line-cap": "butt",
        "line-join": "miter",
        "visibility": "none"
      },
      "paint": {
        "line-color": "rgba(0,0,0,0.3)",
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.10, 9, 0.05],
        "line-width": ["interpolate", ["linear"], ["zoom"], 0, 1.0, 9, 4.0],
        "line-offset": ["interpolate", ["linear"], ["zoom"], 0, -0.5, 9, -2.0],
        "line-blur": 4.0
      }
    },
    {
      "id": "coast-outline",
      "type": "line",
      "source": "coastline",
      "source-layer": "coastline",
      "filter": ["==", "$type", "LineString"],
      "layout": {
        "line-cap": "butt",
        "line-join": "miter",
        "visibility": "visible"
      },
      "paint": {
        "line-color": "rgba(0,0,0,1)",
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.25, 5, 0.50],
        "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.40, 5, 0.80, 9, 1.2]
      }
    },
    {
      "id": "lake-shadow",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "water",
      "filter": [
        "all",
        ["==", "$type", "Polygon"],
        ["==", "class", "lake"]
      ],
      "layout": {
        "line-cap": "butt",
        "line-join": "miter",
        "visibility": "none"
      },
      "paint": {
        "line-color": "rgba(0,0,0,0.3)",
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.10, 9, 0.05],
        "line-width": ["interpolate", ["linear"], ["zoom"], 0, 1.0, 9, 5.0],
        "line-offset": ["interpolate", ["linear"], ["zoom"], 0, -0.5, 9, -2.5],
        "line-blur": 4.0
      }
    },
    {
      "id": "lake-outline",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "water",
      "filter": [
        "all",
        ["==", "$type", "Polygon"],
        ["in", "class", "lake"]
      ],
      "layout": {
        "line-cap": "butt",
        "line-join": "miter",
        "visibility": "visible"
      },
      "paint": {
        "line-color": "rgba(0,0,0,1)",
        "line-opacity": [
          "interpolate", ["linear"], ["zoom"],
          0, 0.08,
          5, 0.12,
          7, 0.10,
          9, 0.06
        ],
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          0, 0.20,
          5, 0.35,
          7, 0.45,
          9, 0.50
        ]
      }
    },
    {
      "id": "river-outline",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "waterway",
      "minzoom": 6,
      "filter": [
        "all",
        ["==", "class", "river"],
        ["!=", "brunnel", "tunnel"]
      ],
      "layout": {
        "line-cap": "round",
        "line-join": "round",
        "visibility": "visible"
      },
      "paint": {
        "line-color": "rgba(0,0,0,1)",
         "line-opacity": [
          "interpolate", ["linear"], ["zoom"],
          4, 0.00,
          6, 0.08,
          8, 0.12,
          9, 0.10
        ],
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          4, 0.00,
          6, 0.25,
          8, 0.45,
          9, 0.55
        ]
      }
    },
    {
      "id": "highway-casing",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "transportation",
      "minzoom": 5,
      "filter": [
        "all",
        ["==", "$type", "LineString"],
        ["!in", "brunnel", "tunnel"],
        ["!=", "ramp", 1],
        ["in", "class", "motorway", "trunk", "primary"]
      ],
      "layout": {
        "line-cap": "butt",
        "line-join": "round",
        "visibility": "none"
      },
      "paint": {
        "line-color": "rgba(64,64,64,0.22)",
        "line-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          4, 0,
          5, 0.1,
          9, 0.2
        ],
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          4, 0,
          5, ["match", ["get", "class"], "motorway", 0.7, 0],
          6, ["match", ["get", "class"], "motorway", 1.1, "trunk", 0.95, "primary", 0.8, 0],
          7, ["match", ["get", "class"], "motorway", 1.6, "trunk", 1.35, "primary", 1.15, 0],
          9, ["match", ["get", "class"], "motorway", 2.4, "trunk", 2.0, "primary", 1.65, 0]
        ]
      }
    },
    {
      "id": "highway",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "transportation",
      "minzoom": 5,
      "filter": [
        "all",
        ["==", "$type", "LineString"],
        ["!in", "brunnel", "tunnel"],
        ["!=", "ramp", 1],
        ["in", "class", "motorway", "trunk", "primary"]
      ],
      "layout": {
        "line-cap": "round",
        "line-join": "round",
        "visibility": "visible"
      },
      "paint": {
        "line-color": "rgba(32,32,32,0.75)",
        "line-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          4, 0,
          5, 0.2,
          9, 0.30
        ],
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          4, 0,
          5, ["match", ["get", "class"], "motorway", 0.4, 0],
          6, ["match", ["get", "class"], "motorway", 0.7, "trunk", 0.6, "primary", 0.5, 0],
          7, ["match", ["get", "class"], "motorway", 0.95, "trunk", 0.82, "primary", 0.7, 0],
          9, ["match", ["get", "class"], "motorway", 1.4, "trunk", 1.2, "primary", 1.0, 0]
        ]
      }
    },
    {
      "id": "place-country",
      "type": "symbol",
      "source": "openmaptiles",
      "source-layer": "place",
      "filter": ["==", "class", "country"],
      "layout": {
        "text-field": ["coalesce", ["get", `name:${language}`], ["get", "name:latin"], ["get", "name"]],
        "text-font": ["Open Sans Bold"],
        "text-max-width": 6.25,
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          0, 12,
          7, 16
        ],
        "text-transform": "uppercase",
        "text-allow-overlap": false,
        "symbol-sort-key": ["coalesce", ["get","rank"], 1000],
        "visibility": "visible"
      },
      "paint": {
        "text-color": "#ffffff",
        "text-opacity": 0.75,
        "text-halo-width": [
          "interpolate", ["linear"], ["zoom"],
          0, 1.2,
          6, 1.4,
          9, 1.8
        ],
        "text-halo-color": "rgba(0,0,0,0.85)",
        "text-halo-blur": 0
      }
    },
    {
      "id": "place-city",
      "type": "symbol",
      "source": "openmaptiles",
      "source-layer": "place",
      "filter": ["in", "class", "city", "town"],
      "layout": {
        "text-anchor": "center",
        "text-field": ["coalesce", ["get", `name:${language}`], ["get", "name:latin"], ["get", "name"]],
        "text-font": ["Open Sans Regular"],
        "text-max-width": 8,
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          0, 12,
          9, 18
        ],
        "text-allow-overlap": false,
        "symbol-sort-key": ["coalesce", ["get","rank"], 1000],
        "visibility": "visible"
      },
      "paint": {
        "text-color": "#ffffff",
        "text-halo-width": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          1.6,
          1.4
        ],
        "text-halo-color": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          "rgba(0,0,0,1.0)",
          "rgba(0,0,0,0.75)"
        ],
        "text-halo-blur": 0
      }
    }
  ]
};

export default style;
