export const VECTOR_UPDATE_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_state; // lon, lat, age

uniform float u_dt_sec;
uniform float u_seed;
uniform sampler2D u_vector_tex;
uniform vec2 u_vector_size;
uniform float u_lon0;
uniform float u_lat0;
uniform float u_dx;
uniform float u_dy;
uniform float u_speed_multiplier;
uniform float u_zoom_scale;
uniform float u_deg_per_meter;
uniform float u_max_age_sec;
uniform float u_bounds_west;
uniform float u_bounds_east;
uniform float u_bounds_south;
uniform float u_bounds_north;

out vec3 v_state;

// Decode a normalized texture channel back to signed int8 range.
float decode_i8(float encoded) {
  float raw = floor(encoded * 255.0 + 0.5);
  return raw > 127.0 ? raw - 256.0 : raw;
}

// Small deterministic hash used for respawn jitter.
float rand(float value) {
  return fract(sin(value) * 43758.5453123);
}

// Keep longitudes in [-180, 180).
float wrap_lon(float lon) {
  float shifted = lon + 180.0;
  shifted = shifted - floor(shifted / 360.0) * 360.0;
  return shifted - 180.0;
}

// Map longitude into the currently visible wrapped world copy.
float lon_to_view_interval(float lon) {
  float offset = lon - u_bounds_west;
  offset = offset - floor(offset / 360.0) * 360.0;
  return u_bounds_west + offset;
}

// Cull particles outside the viewport bounds.
bool in_bounds(float lon, float lat) {
  float span = u_bounds_east - u_bounds_west;
  if (span >= 359.5) {
    return lat >= u_bounds_south && lat <= u_bounds_north;
  }
  float lon_view = lon_to_view_interval(lon);
  return lon_view >= u_bounds_west && lon_view <= u_bounds_east &&
         lat >= u_bounds_south && lat <= u_bounds_north;
}

// Respawn inside viewport with randomized age so lifecycle is staggered.
vec3 respawn(float id) {
  float r1 = rand(id * 12.9898 + u_seed * 0.121);
  float r2 = rand(id * 78.233 + u_seed * 0.173);
  float r3 = rand(id * 37.719 + u_seed * 0.411);
  float lon = mix(u_bounds_west, u_bounds_east, r1);
  if (lon > 180.0) lon -= 360.0;
  float lat = mix(u_bounds_south, u_bounds_north, r2);
  float age = r3 * u_max_age_sec;
  return vec3(lon, lat, age);
}

// Decode U/V components (stored as packed int8 in RG channels).
vec2 decode_vector(ivec2 coord) {
  vec4 texel = texelFetch(u_vector_tex, coord, 0);
  return vec2(decode_i8(texel.r), decode_i8(texel.g)) * 0.5;
}

// Sample vector field in lon/lat space with wrap-aware bilinear filtering.
vec2 sample_vector_bilinear(float lon, float lat) {
  float lon_norm = lon - u_lon0;
  lon_norm = lon_norm - floor(lon_norm / 360.0) * 360.0;
  float lon_wrapped = u_lon0 + lon_norm;

  float gx = (lon_wrapped - u_lon0) / u_dx;
  float gy = (lat - u_lat0) / u_dy;

  float x0 = floor(gx);
  float y0 = floor(gy);
  float tx = fract(gx);
  float ty = clamp(gy - y0, 0.0, 1.0);

  float nx = u_vector_size.x;
  float ny = u_vector_size.y;

  float x0w = mod(x0, nx);
  if (x0w < 0.0) x0w += nx;
  float x1w = mod(x0 + 1.0, nx);
  if (x1w < 0.0) x1w += nx;

  float y0c = clamp(y0, 0.0, ny - 1.0);
  float y1c = clamp(y0 + 1.0, 0.0, ny - 1.0);

  vec2 w00 = decode_vector(ivec2(int(x0w), int(y0c)));
  vec2 w10 = decode_vector(ivec2(int(x1w), int(y0c)));
  vec2 w01 = decode_vector(ivec2(int(x0w), int(y1c)));
  vec2 w11 = decode_vector(ivec2(int(x1w), int(y1c)));

  return mix(mix(w00, w10, tx), mix(w01, w11, tx), ty);
}

void main() {
  float id = float(gl_VertexID);
  vec3 state = a_state;

  // Age particle and respawn when lifetime expires.
  float age = state.z + u_dt_sec;

  if (age >= u_max_age_sec) {
    v_state = respawn(id);
    gl_Position = vec4(0.0);
    return;
  }

  // Integrate velocity from m/s into lon/lat delta for this timestep.
  vec2 vector_mps = sample_vector_bilinear(state.x, state.y);
  float cos_lat = max(0.15, abs(cos(radians(state.y))));

  float speed = u_speed_multiplier * u_zoom_scale;
  float delta_lat = vector_mps.y * u_dt_sec * u_deg_per_meter * speed;
  float delta_lon = vector_mps.x * u_dt_sec * (u_deg_per_meter / cos_lat) * speed;

  float next_lon = wrap_lon(state.x + delta_lon);
  float next_lat = state.y + delta_lat;

  // Respawn on invalid motion, polar escape, or when leaving viewport.
  bool invalid = isnan(next_lon) || isnan(next_lat) || isinf(next_lon) || isinf(next_lat);
  if (invalid || abs(next_lat) > 89.5 || !in_bounds(next_lon, next_lat)) {
    v_state = respawn(id);
    gl_Position = vec4(0.0);
    return;
  }

  // Emit next simulation state via transform feedback.
  v_state = vec3(next_lon, next_lat, age);
  gl_Position = vec4(0.0);
}
`

export const VECTOR_UPDATE_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision mediump float;
out vec4 out_color;

// Update pass writes only transform feedback; fragment output is unused.
void main() {
  out_color = vec4(0.0);
}
`

export const VECTOR_PARTICLE_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_state; // lon, lat, age

uniform float u_bounds_west;
uniform float u_bounds_east;
uniform vec4 u_mercator_bounds; // west_x, east_x, north_y, south_y
uniform float u_point_size;
uniform sampler2D u_vector_tex;
uniform vec2 u_vector_size;
uniform float u_lon0;
uniform float u_lat0;
uniform float u_dx;
uniform float u_dy;
uniform float u_deg_per_meter;
uniform float u_dir_step_sec;
uniform float u_speed_multiplier;
uniform float u_zoom_scale;
uniform float u_dash_min_len_px;
uniform float u_dash_max_len_px;
uniform float u_dash_len_per_mps;

out vec2 v_dir;
out float v_dash_len;
out float v_visible;

// Decode a normalized texture channel back to signed int8 range.
float decode_i8(float encoded) {
  float raw = floor(encoded * 255.0 + 0.5);
  return raw > 127.0 ? raw - 256.0 : raw;
}

// Decode U/V components (stored as packed int8 in RG channels).
vec2 decode_vector(ivec2 coord) {
  vec4 texel = texelFetch(u_vector_tex, coord, 0);
  return vec2(decode_i8(texel.r), decode_i8(texel.g)) * 0.5;
}

// Keep longitudes in [-180, 180).
float wrap_lon(float lon) {
  float shifted = lon + 180.0;
  shifted = shifted - floor(shifted / 360.0) * 360.0;
  return shifted - 180.0;
}

// Map longitude into the currently visible wrapped world copy.
float lon_to_view_interval(float lon) {
  float offset = lon - u_bounds_west;
  offset = offset - floor(offset / 360.0) * 360.0;
  return u_bounds_west + offset;
}

// Sample vector field in lon/lat space with wrap-aware bilinear filtering.
vec2 sample_vector_bilinear(float lon, float lat) {
  float lon_norm = lon - u_lon0;
  lon_norm = lon_norm - floor(lon_norm / 360.0) * 360.0;
  float lon_wrapped = u_lon0 + lon_norm;

  float gx = (lon_wrapped - u_lon0) / u_dx;
  float gy = (lat - u_lat0) / u_dy;

  float x0 = floor(gx);
  float y0 = floor(gy);
  float tx = fract(gx);
  float ty = clamp(gy - y0, 0.0, 1.0);

  float nx = u_vector_size.x;
  float ny = u_vector_size.y;

  float x0w = mod(x0, nx);
  if (x0w < 0.0) x0w += nx;
  float x1w = mod(x0 + 1.0, nx);
  if (x1w < 0.0) x1w += nx;

  float y0c = clamp(y0, 0.0, ny - 1.0);
  float y1c = clamp(y0 + 1.0, 0.0, ny - 1.0);

  vec2 w00 = decode_vector(ivec2(int(x0w), int(y0c)));
  vec2 w10 = decode_vector(ivec2(int(x1w), int(y0c)));
  vec2 w01 = decode_vector(ivec2(int(x0w), int(y1c)));
  vec2 w11 = decode_vector(ivec2(int(x1w), int(y1c)));

  return mix(mix(w00, w10, tx), mix(w01, w11, tx), ty);
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

void main() {
  float lon = lon_to_view_interval(a_state.x);
  float lat = a_state.y;

  // Dash length scales with speed but is clamped by style bounds.
  vec2 vector_mps = sample_vector_bilinear(a_state.x, lat);
  float speed_mps = length(vector_mps);
  v_dash_len = clamp(
    u_dash_min_len_px + speed_mps * u_dash_len_per_mps,
    u_dash_min_len_px,
    u_dash_max_len_px
  );

  vec2 screen = to_screen(lon, lat);
  float cos_lat = max(0.15, abs(cos(radians(lat))));
  float speed = u_speed_multiplier * u_zoom_scale;
  float delta_lat = vector_mps.y * u_dir_step_sec * u_deg_per_meter * speed;
  float delta_lon = vector_mps.x * u_dir_step_sec * (u_deg_per_meter / cos_lat) * speed;
  float next_lon = lon_to_view_interval(wrap_lon(a_state.x + delta_lon));
  float next_lat = clamp(lat + delta_lat, -89.5, 89.5);

  // Estimate on-screen flow direction from a short forward step.
  vec2 next_screen = to_screen(next_lon, next_lat);
  vec2 dir = next_screen - screen;
  float len = length(dir);

  // Preserve minimum dash visibility; use a fallback direction near calm flow.
  v_visible = 1.0;
  v_dir = len > 1e-6 ? dir / len : vec2(1.0, 0.0);

  gl_Position = vec4(screen, 0.0, 1.0);
  gl_PointSize = u_point_size;
}
`

export const VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform vec4 u_color;
uniform float u_point_size;
uniform float u_dash_width_px;
in vec2 v_dir;
in float v_dash_len;
in float v_visible;
out vec4 out_color;

void main() {
  // Optional visibility gate from vertex stage.
  if (v_visible < 0.5) {
    discard;
  }

  // WebGL point coords are top-left origin; flip Y so px matches the
  // same y-up screen basis used for v_dir in the vertex shader.
  vec2 point_uv = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y);
  vec2 px = point_uv * u_point_size - vec2(0.5 * u_point_size);
  vec2 tangent = normalize(v_dir);
  vec2 normal = vec2(-tangent.y, tangent.x);

  float along = dot(px, tangent);
  float across = dot(px, normal);

  // Build an oriented, anti-aliased dash from tangent/normal distances.
  float half_len = v_dash_len * 0.5;
  float half_width = u_dash_width_px * 0.5;
  float aa = 0.35;

  float along_mask = 1.0 - smoothstep(half_len - aa, half_len + aa, abs(along));
  float across_mask = 1.0 - smoothstep(half_width - aa, half_width + aa, abs(across));
  float shape = along_mask * across_mask;

  if (shape <= 0.001) {
    discard;
  }

  // Apply style color and use shape as alpha coverage.
  out_color = vec4(u_color.rgb, u_color.a * shape);
}
`
