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

#pragma weather-map include pressure-contour-constants
#pragma weather-map include encoded-grid
#pragma weather-map include pressure-contour-style

EncodedSample sampleSmoothedPressureTexel(sampler2D pressureTex, int x, int y) {
  float value = texelFetch(pressureTex, ivec2(x, y), 0).r;
  if (isnan(value)) return encodedMissing();
  return encodedValue(value);
}

EncodedSample sampleSmoothedPressureBilinear(sampler2D pressureTex, EncodedGridLocation location) {
  return weightedEncodedSample(
    sampleSmoothedPressureTexel(pressureTex, location.x0, location.y0),
    sampleSmoothedPressureTexel(pressureTex, location.x1, location.y0),
    sampleSmoothedPressureTexel(pressureTex, location.x0, location.y1),
    sampleSmoothedPressureTexel(pressureTex, location.x1, location.y1),
    location.w00,
    location.w10,
    location.w01,
    location.w11
  );
}

void main() {
  if (u_grid_size.x < 2.0 || u_grid_size.y < 2.0) {
    outColor = vec4(0.0);
    return;
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
  float mixValue = clamp(u_time_mix, 0.0, 1.0);
  EncodedSample pressureSample = blendEncodedSamples(
    sampleSmoothedPressureBilinear(u_pressure_tex_lower, location),
    sampleSmoothedPressureBilinear(u_pressure_tex_upper, location),
    mixValue
  );

  if (pressureSample.valid <= 0.0) {
    outColor = vec4(0.0);
    return;
  }

  outColor = pressureContourColor(pressureSample.value);
}
