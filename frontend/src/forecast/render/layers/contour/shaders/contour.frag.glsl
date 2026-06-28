#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp isampler2DArray;

in vec2 v_mercator;
out vec4 outColor;

uniform sampler2D u_pressure_tex_lower;
uniform sampler2D u_pressure_tex_upper;
uniform vec2 u_grid_size;
uniform float u_time_mix;
uniform float u_lon0;
uniform float u_lat0;
uniform float u_dx;
uniform float u_dy;
uniform int u_x_wrap;
uniform int u_y_mode;

#pragma weather-map include globe-fragment-clip
#pragma weather-map include contour-constants
#pragma weather-map include encoded-grid
#pragma weather-map include pressure-field
#pragma weather-map include marching-squares
#pragma weather-map include contour-line

void main() {
  if (u_grid_size.x < 2.0 || u_grid_size.y < 2.0) {
    outColor = vec4(0.0);
    return;
  }
  if (globeFragmentOutsideVisibleHemisphere(v_mercator)) {
    discard;
  }

  EncodedGridLocation location = encodedGridLocationForMercator(
    v_mercator,
    u_grid_size,
    u_lon0,
    u_lat0,
    u_dx,
    u_dy,
    u_x_wrap,
    u_y_mode
  );
  vec2 cellUv = vec2(location.w10 + location.w11, location.w01 + location.w11);
  vec2 gridCoord = vec2(location.gridX, location.gridY);
  vec2 gridDx = dFdx(gridCoord);
  vec2 gridDy = dFdy(gridCoord);
  float gridDeterminant = (gridDx.x * gridDy.y) - (gridDy.x * gridDx.y);
  float mixValue = clamp(u_time_mix, 0.0, 1.0);
  PressureFieldCell pressureCell = blendPressureFieldCells(
    samplePressureFieldCell(u_pressure_tex_lower, location),
    samplePressureFieldCell(u_pressure_tex_upper, location),
    mixValue
  );

  if (pressureCell.valid <= 0.0 || abs(gridDeterminant) <= 1e-8) {
    outColor = vec4(0.0);
    return;
  }

  float cellMinHpa = pressureCellMinHpa(pressureCell);
  float cellMaxHpa = pressureCellMaxHpa(pressureCell);
  if (!pressureCellCanContour(cellMinHpa, cellMaxHpa)) {
    outColor = vec4(0.0);
    return;
  }

  float firstContourLevelHpa = firstContourLevelForCell(cellMinHpa);
  float bestDistancePx = 1e20;
  for (int contourLevelIndex = 0; contourLevelIndex < MAX_CONTOUR_LEVELS_PER_CELL; contourLevelIndex++) {
    float contourLevelHpa = firstContourLevelHpa + (float(contourLevelIndex) * CONTOUR_INTERVAL_HPA);
    if (contourLevelHpa > cellMaxHpa + CONTOUR_EDGE_EPSILON_HPA) break;

    PressureContourSegments segments = pressureMarchingSquareSegments(pressureCell, contourLevelHpa);
    if (segments.count <= 0) continue;

    float distancePx = pressureSegmentDistancePx(
      cellUv,
      segments.p0,
      segments.p1,
      gridDx,
      gridDy,
      gridDeterminant
    );
    if (segments.count > 1) {
      distancePx = min(
        distancePx,
        pressureSegmentDistancePx(
          cellUv,
          segments.p2,
          segments.p3,
          gridDx,
          gridDy,
          gridDeterminant
        )
      );
    }
    bestDistancePx = min(bestDistancePx, distancePx);
  }

  if (bestDistancePx >= 1e19) {
    outColor = vec4(0.0);
    return;
  }

  outColor = pressureContourLineColor(bestDistancePx);
}
