export const VECTOR_PARTICLE_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

layout(location = 0) in vec4 a_state; // lon, lat, age, speed_mps

uniform float u_bounds_west;
uniform float u_bounds_east;
uniform vec4 u_mercator_bounds; // west_x, east_x, north_y, south_y
uniform float u_dot_min_px;
uniform float u_dot_max_px;
uniform float u_speed_ramp_gamma;
uniform float u_max_age_sec;
uniform float u_fade_in_age_ratio;
uniform float u_fade_out_age_ratio;
uniform float u_stagnation_fade_start_mps;
uniform float u_stagnation_fade_end_mps;

out float v_dot_diameter;
out float v_speed_t;
out float v_life_alpha;
out float v_stagnation_alpha;

// Map longitude into the currently visible wrapped world copy.
float lon_to_view_interval(float lon) {
  float offset = lon - u_bounds_west;
  offset = offset - floor(offset / 360.0) * 360.0;
  return u_bounds_west + offset;
}

float mercator_x(float lon) {
  return (lon + 180.0) / 360.0;
}

float mercator_y(float lat) {
  float clamped_lat = clamp(lat, -85.05112878, 85.05112878);
  float s = sin(radians(clamped_lat));
  return 0.5 - 0.25 * log((1.0 + s) / (1.0 - s)) / 3.141592653589793;
}

// Convert lon/lat to the local map viewport's clip-space.
vec2 to_screen(float lon, float lat) {
  float x = mercator_x(lon);
  float y = mercator_y(lat);

  float nx = (x - u_mercator_bounds.x) / max(1e-6, (u_mercator_bounds.y - u_mercator_bounds.x));
  float ny = (y - u_mercator_bounds.z) / max(1e-6, (u_mercator_bounds.w - u_mercator_bounds.z));
  return vec2(nx * 2.0 - 1.0, 1.0 - ny * 2.0);
}

float age_fade_window(float life_t, float width, bool entering) {
  float clamped_width = clamp(width, 0.0, 1.0);
  if (clamped_width <= 1e-4) {
    return 1.0;
  }
  return entering
    ? smoothstep(0.0, clamped_width, life_t)
    : 1.0 - smoothstep(1.0 - clamped_width, 1.0, life_t);
}

float particle_life_alpha(float age) {
  float life_t = clamp(age / max(u_max_age_sec, 1e-4), 0.0, 1.0);
  float fade_in = age_fade_window(life_t, u_fade_in_age_ratio, true);
  float fade_out = age_fade_window(life_t, u_fade_out_age_ratio, false);
  return clamp(fade_in * fade_out, 0.0, 1.0);
}

float particle_stagnation_alpha(float speed_mps) {
  float fade_start = min(u_stagnation_fade_start_mps, u_stagnation_fade_end_mps);
  float fade_end = max(u_stagnation_fade_start_mps, u_stagnation_fade_end_mps);
  return smoothstep(fade_start, max(fade_end, fade_start + 1e-4), speed_mps);
}

void main() {
  float lon = lon_to_view_interval(a_state.x);
  float lat = a_state.y;

  float speed_mps = max(a_state.w, 0.0);
  float speed_t = smoothstep(1.5, 12.0, speed_mps);
  v_speed_t = pow(speed_t, max(0.01, u_speed_ramp_gamma));
  float dot_min = min(u_dot_min_px, u_dot_max_px);
  float dot_max = max(u_dot_min_px, u_dot_max_px);
  v_dot_diameter = mix(dot_min, dot_max, v_speed_t);
  v_life_alpha = particle_life_alpha(a_state.z);
  v_stagnation_alpha = particle_stagnation_alpha(speed_mps);

  vec2 screen = to_screen(lon, lat);

  gl_Position = vec4(screen, 0.0, 1.0);
  gl_PointSize = max(dot_max + 2.0, 1.0);
}
`

export const VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform vec4 u_core_color_slow;
uniform vec4 u_core_color_fast;
uniform float u_dot_min_px;
uniform float u_dot_max_px;
in float v_dot_diameter;
in float v_speed_t;
in float v_life_alpha;
in float v_stagnation_alpha;
out vec4 out_color;

void main() {
  float dot_extent = max(u_dot_min_px, u_dot_max_px);
  float point_size = max(dot_extent + 2.0, 1.0);
  vec2 px = (gl_PointCoord - vec2(0.5)) * point_size;
  float radius = max(v_dot_diameter * 0.5, 0.0);
  float aa = 0.6;
  float shape = 1.0 - smoothstep(radius - aa, radius + aa, length(px));

  if (shape <= 0.001) {
    discard;
  }

  // Store premultiplied alpha in the trail texture so fading preserves hue.
  vec4 color = mix(u_core_color_slow, u_core_color_fast, v_speed_t);
  float alpha = color.a * shape * v_life_alpha * v_stagnation_alpha;
  out_color = vec4(color.rgb * alpha, alpha);
}
`
