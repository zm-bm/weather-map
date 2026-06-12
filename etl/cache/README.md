# Local ETL Cache

Use this for local-only GRIB inputs that are useful during ETL development.

Conventions:

- `grib/gfs/<cycle>/...` is the GFS run-local download cache
- `grib/icon/<cycle>/<fhour>/...` is the ICON download and regrid cache
- `samples/` is for hand-kept local GRIB files used for config/debug work

Everything here except this README is ignored.
