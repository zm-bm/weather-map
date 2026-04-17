# tileserver

## Layout

Keep the tileserver split into three areas:

- `tileserver/data/`
  raw inputs only
- `tileserver/static/`
  generated MBTiles outputs only
- `tileserver/build/`
  build scripts and build config only

Recommended tree:

```text
tileserver/
├── build/
│   ├── build-basemap-vector.sh
│   ├── build.sh
│   ├── build-coastline.sh
│   ├── build-lake-shoreline.sh
│   ├── common.sh
│   ├── merge-basemap.sh
│   ├── tilemaker-basemap.json
│   └── tilemaker-basemap.lua
├── data/
│   ├── coastline.mbtiles
│   ├── louisiana-260415.osm.pbf
│   └── planet-202604.osm.pbf
└── static/
    ├── basemap-vector.mbtiles
    ├── coastline-simplified.mbtiles
    ├── lake-shoreline.mbtiles
    └── basemap.mbtiles
```

## Workflow

Yes, this is the right workflow for the current problem:

1. build the basemap vector core from OSM, without coastline
2. simplify coastline in its own experiment loop
3. derive inland shoreline from large water polygons
4. merge those products into the final `basemap.mbtiles`

If you want one entrypoint, use `build/build.sh` and edit the constants at the top of that file.

That separation lets you iterate on coastline and inland shoreline fidelity without rerunning the slow OSM tiling step every time.

## Scripts

### `build/build.sh`

Runs the whole pipeline in order:

1. `build-basemap-vector.sh`
2. `build-coastline.sh`
3. `build-lake-shoreline.sh`
4. `merge-basemap.sh`

This wrapper intentionally does not take build arguments. Instead, edit the variables at the top of:

- [build.sh](/home/rick/code/weather-map/tileserver/build/build.sh)

Useful variables there:

- `PLANET_INPUT`
- `COASTLINE_INPUT`
- `BBOX`
- `THREADS`
- `VECTOR_MAXZOOM`
- `COASTLINE_SIMPLIFY_METERS`
- `COASTLINE_MIN_FEATURE_LENGTH_METERS`
- `LAKE_SIMPLIFY_METERS`
- `LAKE_MIN_FEATURE_LENGTH_METERS`
- `LAKE_MIN_AREA_KM2`

Example:

```bash
./tileserver/build/build.sh
```

### `build/build-basemap-vector.sh`

Builds the planet-derived basemap core, without coastline.

Output:

- `tileserver/static/basemap-vector.mbtiles`

Default behavior:

- `maxzoom=6`
- national + state/province boundaries only (`admin_level=2` and `4`)
- `country` and `city` places only
- `motorway` visible at `z6`
- no rivers at `z6`
- water polygons disabled by default

Layer policy by max zoom:

- `z6`: boundaries + country/city places + `motorway`
- `z7`: add `trunk` and `river`
- `z8`: add `town`

Example:

```bash
./tileserver/build/build-basemap-vector.sh \
  --planet-input ./tileserver/data/louisiana-260415.osm.pbf \
  --threads 4
```

Optional water polygons:

```bash
./tileserver/build/build-basemap-vector.sh \
  --planet-input ./tileserver/data/louisiana-260415.osm.pbf \
  --include-water-polygons \
  --threads 4
```

### `build/build-coastline.sh`

Builds a simplified coastline MBTiles from `tileserver/data/coastline.mbtiles`.

Output:

- `tileserver/static/coastline-simplified.mbtiles`

Default behavior:

- `simplify-meters=7000`
- `min-feature-length-meters=0`
- `maxzoom=6`

Example:

```bash
./tileserver/build/build-coastline.sh
```

Less aggressive simplification:

```bash
./tileserver/build/build-coastline.sh \
  --simplify-meters 1200 \
  --maxzoom 7
```

For the lean `z6` preview map, start around:

```bash
./tileserver/build/build-coastline.sh \
  --simplify-meters 7000
```

If it is still too busy, try `9000-12000`. If it starts looking too blocky, back down toward `4000-6000`.

If overzoom inspection still shows lots of tiny junk fragments, add a minimum retained line length:

```bash
./tileserver/build/build-coastline.sh \
  --simplify-meters 7000 \
  --min-feature-length-meters 1500
```

Start around `1000-2500`. This removes short leftover fragments after simplification, which `simplify-meters` alone does not reliably do.

### `build/build-lake-shoreline.sh`

Builds a dedicated `lake_shoreline` line layer from large inland water polygons in the OSM PBF.

Output:

- `tileserver/static/lake-shoreline.mbtiles`

Default behavior:

- `simplify-meters=1200`
- `min-feature-length-meters=800`
- `min-area-km2=20`
- `minzoom=4`
- `maxzoom=9`

Example:

```bash
./tileserver/build/build-lake-shoreline.sh \
  --planet-input ./tileserver/data/louisiana-260415.osm.pbf
```

For a smoke test around Lake Pontchartrain:

```bash
./tileserver/build/build-lake-shoreline.sh \
  --planet-input ./tileserver/data/louisiana-260415.osm.pbf \
  --bbox -91.8,29.5,-89.3,30.7
```

Tune these together:

- lower `simplify-meters` to keep more shoreline shape
- raise `min-feature-length-meters` to drop tiny leftover fragments
- raise `min-area-km2` to keep only major lakes/reservoirs

### `build/merge-basemap.sh`

Merges the vector core, simplified coastline, and optional inland shoreline into the final basemap.

Output:

- `tileserver/static/basemap.mbtiles`

Example:

```bash
./tileserver/build/merge-basemap.sh
```

## Full sequence

For a normal preview build:

```bash
./tileserver/build/build-basemap-vector.sh \
  --planet-input ./tileserver/data/louisiana-260415.osm.pbf \
  --threads 4

./tileserver/build/build-coastline.sh \
  --simplify-meters 7000

./tileserver/build/build-lake-shoreline.sh \
  --planet-input ./tileserver/data/louisiana-260415.osm.pbf

./tileserver/build/merge-basemap.sh
```

## Requirements

Required tools:

- `osmium`
- `tilemaker`
- `tippecanoe`
- `tile-join`
- `ogr2ogr`
- `sqlite3`

## Notes

- `build-basemap-vector.sh` is the expensive step
- `build-coastline.sh` is where you should tune coastline fidelity
- `build-lake-shoreline.sh` is where you should tune inland shoreline fidelity
- `merge-basemap.sh` should be relatively cheap
- the final merged `basemap.mbtiles` is what Martin and the frontend should point at
- hillshade should remain a separate workflow
