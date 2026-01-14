# tileserver

## Generate coastline vector tiles

OSM coastline Shapefile → GeoJSON → tippecanoe → MBTiles.

- Download shapefile: https://osmdata.openstreetmap.de/data/coastlines.html
- Convert to GeoJSON (WGS84), from the folder containing the .shp
```
ogr2ogr -f GeoJSON -t_srs EPSG:4326 -lco RFC7946=YES \
    coastline.geojson \
    lines.shp
```
- Build vector MBTiles (cap at z10)
```
tippecanoe \
    -o coastline.mbtiles \
    -l coastline \
    -Z 0 -z 10 \
    --drop-densest-as-needed \
    --extend-zooms-if-still-dropping \
    coastline.geojson
```
- Move `coastline.mbtiles` into `tileserver/` folder.
