export const SCALAR_VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec2 a_mercator_pos;
uniform mat4 u_matrix;
uniform float u_world_offset_x;
uniform float u_world_size;
out vec2 v_mercator;

void main() {
  vec2 worldPos = vec2(a_mercator_pos.x + u_world_offset_x, a_mercator_pos.y);
  v_mercator = worldPos;
  gl_Position = u_matrix * vec4(worldPos * u_world_size, 0.0, 1.0);
}
`

export const SCALAR_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp isampler2D;

in vec2 v_mercator;
out vec4 outColor;

uniform isampler2D u_scalar_tex;
uniform sampler2D u_colormap_tex;
uniform vec2 u_grid_size;
uniform vec2 u_display_range;
uniform float u_scale;
uniform float u_offset;
uniform int u_nodata;
uniform float u_lon0;
uniform float u_lat0;
uniform float u_dx;
uniform float u_dy;
uniform float u_opacity;

float mercatorYToLatitude(float y) {
  float normalized = (0.5 - y) * (2.0 * 3.14159265358979323846);
  float latitudeRad = 2.0 * atan(exp(normalized)) - (3.14159265358979323846 * 0.5);
  return latitudeRad * 180.0 / 3.14159265358979323846;
}

float wrapRepeat(float value, float span) {
  if (span <= 0.0) return value;
  float wrapped = mod(value, span);
  return wrapped < 0.0 ? wrapped + span : wrapped;
}

vec2 sampleDecoded(int x, int y) {
  int stored = texelFetch(u_scalar_tex, ivec2(x, y), 0).r;
  if (stored == u_nodata) {
    return vec2(0.0, 0.0);
  }
  return vec2(float(stored) * u_scale + u_offset, 1.0);
}

void main() {
  float nx = u_grid_size.x;
  float ny = u_grid_size.y;
  if (nx < 2.0 || ny < 2.0 || u_opacity <= 0.0) {
    outColor = vec4(0.0);
    return;
  }

  float mercatorX = v_mercator.x;
  float mercatorY = v_mercator.y;
  float lon = mercatorX * 360.0 - 180.0;
  float lat = mercatorYToLatitude(mercatorY);

  float gridX = wrapRepeat((lon - u_lon0) / u_dx, nx);
  float gridY = clamp((lat - u_lat0) / u_dy, 0.0, ny - 1.0);

  int x0 = int(floor(gridX));
  int y0 = int(floor(gridY));
  int x1 = int(wrapRepeat(float(x0 + 1), nx));
  int y1 = min(y0 + 1, int(ny) - 1);

  float tx = fract(gridX);
  float ty = fract(gridY);
  float w00 = (1.0 - tx) * (1.0 - ty);
  float w10 = tx * (1.0 - ty);
  float w01 = (1.0 - tx) * ty;
  float w11 = tx * ty;

  vec2 s00 = sampleDecoded(x0, y0);
  vec2 s10 = sampleDecoded(x1, y0);
  vec2 s01 = sampleDecoded(x0, y1);
  vec2 s11 = sampleDecoded(x1, y1);

  float totalWeight =
    w00 * s00.y +
    w10 * s10.y +
    w01 * s01.y +
    w11 * s11.y;

  if (totalWeight <= 0.0) {
    outColor = vec4(0.0);
    return;
  }

  float value =
    (w00 * s00.x * s00.y +
      w10 * s10.x * s10.y +
      w01 * s01.x * s01.y +
      w11 * s11.x * s11.y) / totalWeight;

  float range = max(1e-6, u_display_range.y - u_display_range.x);
  float t = clamp((value - u_display_range.x) / range, 0.0, 1.0);
  vec4 color = texture(u_colormap_tex, vec2(t, 0.5));
  outColor = vec4(color.rgb, color.a * u_opacity);
}
`
