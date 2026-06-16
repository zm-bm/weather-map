#version 300 es
precision highp float;
precision highp int;
precision highp isampler2DArray;
precision highp sampler2D;

in vec2 v_mercator;
out vec4 outColor;

uniform isampler2DArray u_encoded_tex_lower;
uniform isampler2DArray u_encoded_tex_upper;
uniform sampler2D u_colormap_tex;
uniform vec2 u_grid_size;
uniform vec2 u_display_range;
uniform float u_time_mix;
uniform int u_source_mode;
uniform int u_source_sampling_mode;
uniform int u_has_nodata;
uniform int u_nodata;
uniform float u_scale;
uniform float u_offset;
uniform float u_lon0;
uniform float u_lat0;
uniform float u_dx;
uniform float u_dy;
uniform int u_x_wrap;
uniform int u_y_mode;
uniform float u_opacity;

#pragma weather-map include colormap-source-modes
#pragma weather-map include source-sampling-modes
#pragma weather-map include encoded-grid

EncodedSample sampleColormapRaster(EncodedGridLocation location, float mixValue) {
  if (u_source_mode == SOURCE_MODE_TEMP_C) {
    if (u_source_sampling_mode == SOURCE_SAMPLING_MODE_NEAREST) {
      return sampleTempCNearestTemporalLayer(
        u_encoded_tex_lower,
        u_encoded_tex_upper,
        0,
        location,
        u_grid_size,
        u_nodata,
        mixValue
      );
    }

    return sampleTempCTemporalLayer(
      u_encoded_tex_lower,
      u_encoded_tex_upper,
      0,
      location,
      u_nodata,
      mixValue
    );
  }

  if (u_source_mode == SOURCE_MODE_WIND_SPEED) {
    if (u_source_sampling_mode == SOURCE_SAMPLING_MODE_NEAREST) {
      return sampleWindSpeedNearestTemporalLayer(
        u_encoded_tex_lower,
        u_encoded_tex_upper,
        location,
        u_grid_size,
        u_has_nodata,
        u_nodata,
        u_scale,
        u_offset,
        mixValue
      );
    }

    return sampleWindSpeedTemporalLayer(
      u_encoded_tex_lower,
      u_encoded_tex_upper,
      location,
      u_has_nodata,
      u_nodata,
      u_scale,
      u_offset,
      mixValue
    );
  }

  if (u_source_sampling_mode == SOURCE_SAMPLING_MODE_NEAREST) {
    return sampleLinearNearestTemporalLayer(
      u_encoded_tex_lower,
      u_encoded_tex_upper,
      0,
      location,
      u_grid_size,
      u_has_nodata,
      u_nodata,
      u_scale,
      u_offset,
      mixValue
    );
  }

  return sampleLinearTemporalLayer(
    u_encoded_tex_lower,
    u_encoded_tex_upper,
    0,
    location,
    u_has_nodata,
    u_nodata,
    u_scale,
    u_offset,
    mixValue
  );
}

vec4 sampleColormap(float t) {
  return texture(u_colormap_tex, vec2(t, 0.5));
}

void main() {
  float nx = u_grid_size.x;
  float ny = u_grid_size.y;
  // Skip rendering when frame or opacity is invalid.
  if (nx < 2.0 || ny < 2.0 || u_opacity <= 0.0) {
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

  EncodedSample sampleValue = sampleColormapRaster(location, mixValue);
  if (sampleValue.valid <= 0.0) {
    outColor = vec4(0.0);
    return;
  }

  float value = sampleValue.value;

  // Normalize value into display range and sample color LUT.
  float range = max(1e-6, u_display_range.y - u_display_range.x);
  float t = clamp((value - u_display_range.x) / range, 0.0, 1.0);
  vec4 color = sampleColormap(t);
  outColor = vec4(color.rgb, color.a * u_opacity);
}
