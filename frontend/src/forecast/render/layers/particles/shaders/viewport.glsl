// Map longitude into the currently visible wrapped world copy.
float lon_to_view_interval(float lon) {
  float offset = lon - u_bounds_west;
  offset = offset - floor(offset / 360.0) * 360.0;
  return u_bounds_west + offset;
}
