export const VECTOR_UPDATE_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_state; // lon, lat, age

uniform float u_dt_sec;
uniform float u_seed;
uniform sampler2D u_vector_tex_lower;
uniform sampler2D u_vector_tex_upper;
uniform vec2 u_vector_size;
uniform float u_lon0;
uniform float u_lat0;
uniform float u_dx;
uniform float u_dy;
uniform float u_time_mix;
uniform float u_speed_multiplier;
uniform float u_zoom_scale;
uniform float u_deg_per_meter;
uniform float u_max_age_sec;
uniform float u_base_respawn_per_sec;
uniform float u_speed_respawn_per_mps;
uniform float u_stagnation_respawn_start_mps;
uniform float u_stagnation_respawn_end_mps;
uniform float u_stagnation_respawn_per_sec;
uniform float u_forced_respawn_frac;
uniform float u_motion_jitter_ratio;
uniform float u_motion_speed_floor_mps;
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

uint hash_u32(uint value) {
  value ^= value >> 16;
  value *= 0x7feb352du;
  value ^= value >> 15;
  value *= 0x846ca68bu;
  value ^= value >> 16;
  return value;
}

// Stable per-frame RNG. Avoid sin-based float hashes here; some GPUs produce
// biased low rolls for repeated large particle IDs.
float rand01(uint id, uint salt) {
  uint frame = uint(floor(max(u_seed, 0.0) * 1000.0));
  uint hashed = hash_u32(id ^ (frame * 0x9e3779b9u) ^ salt);
  return float(hashed & 0x00ffffffu) * (1.0 / 16777216.0);
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

// Respawn inside viewport. Initial CPU seeding staggers ages; runtime respawns
// restart at zero so a newly respawned particle cannot immediately expire.
vec3 respawn(uint id) {
  float r1 = rand01(id, 0x68bc21ebu);
  float r2 = rand01(id, 0x02e5be93u);
  float lon = mix(u_bounds_west, u_bounds_east, r1);
  if (lon > 180.0) lon -= 360.0;
  float lat = mix(u_bounds_south, u_bounds_north, r2);
  return vec3(lon, lat, 0.0);
}

// Decode U/V components (stored as packed int8 in RG channels).
vec2 decode_vector(sampler2D vectorTex, ivec2 coord) {
  vec2 texel = texelFetch(vectorTex, coord, 0).rg;
  return vec2(decode_i8(texel.r), decode_i8(texel.g)) * 0.5;
}

// Sample vector field in lon/lat space with wrap-aware bilinear filtering.
vec2 sample_vector_bilinear(sampler2D vectorTex, float lon, float lat) {
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

  vec2 w00 = decode_vector(vectorTex, ivec2(int(x0w), int(y0c)));
  vec2 w10 = decode_vector(vectorTex, ivec2(int(x1w), int(y0c)));
  vec2 w01 = decode_vector(vectorTex, ivec2(int(x0w), int(y1c)));
  vec2 w11 = decode_vector(vectorTex, ivec2(int(x1w), int(y1c)));

  return mix(mix(w00, w10, tx), mix(w01, w11, tx), ty);
}

void main() {
  uint id = uint(gl_VertexID);
  vec3 state = a_state;
  float time_mix = clamp(u_time_mix, 0.0, 1.0);
  vec2 vector_lower = sample_vector_bilinear(u_vector_tex_lower, state.x, state.y);
  vec2 vector_upper = sample_vector_bilinear(u_vector_tex_upper, state.x, state.y);
  vec2 vector_mps = mix(vector_lower, vector_upper, time_mix);
  float speed_mps = length(vector_mps);
  float age = state.z + u_dt_sec;

  if (age >= u_max_age_sec) {
    v_state = respawn(id);
    gl_Position = vec4(0.0);
    return;
  }

  // One-shot zoom-out recovery: quickly repopulate newly visible area.
  float forced_respawn_roll = rand01(id, 0x9e08f4a9u);
  if (forced_respawn_roll < clamp(u_forced_respawn_frac, 0.0, 1.0)) {
    v_state = respawn(id);
    gl_Position = vec4(0.0);
    return;
  }

  // Stochastic turnover: faster flow increases respawn probability.
  float respawn_per_sec = u_base_respawn_per_sec + speed_mps * u_speed_respawn_per_mps;
  float respawn_prob = clamp(1.0 - exp(-max(0.0, respawn_per_sec) * max(0.0, u_dt_sec)), 0.0, 1.0);
  float respawn_roll = rand01(id, 0x3c6ef35fu);
  if (respawn_roll < respawn_prob) {
    v_state = respawn(id);
    gl_Position = vec4(0.0);
    return;
  }

  // Drain particles that get trapped in stagnant or near-stagnant flow.
  float stagnation_start = min(u_stagnation_respawn_start_mps, u_stagnation_respawn_end_mps);
  float stagnation_end = max(u_stagnation_respawn_start_mps, u_stagnation_respawn_end_mps);
  float stagnation_t = 1.0 - smoothstep(
    stagnation_start,
    max(stagnation_end, stagnation_start + 1e-4),
    speed_mps
  );
  float stagnation_respawn_rate = max(0.0, u_stagnation_respawn_per_sec) * clamp(stagnation_t, 0.0, 1.0);
  float stagnation_respawn_prob = clamp(
    1.0 - exp(-stagnation_respawn_rate * max(0.0, u_dt_sec)),
    0.0,
    1.0
  );
  float stagnation_respawn_roll = rand01(id, 0x7f4a7c15u);
  if (stagnation_respawn_roll < stagnation_respawn_prob) {
    v_state = respawn(id);
    gl_Position = vec4(0.0);
    return;
  }

  // Integrate velocity from m/s into lon/lat delta for this timestep.
  float cos_lat = max(0.15, abs(cos(radians(state.y))));
  vec2 flow_dir = speed_mps > 1e-5 ? (vector_mps / speed_mps) : vec2(1.0, 0.0);
  vec2 flow_normal = vec2(-flow_dir.y, flow_dir.x);
  float jitter_sign = rand01(id, 0xa54ff53au) * 2.0 - 1.0;
  float motion_speed_mps = speed_mps > 0.25
    ? max(speed_mps, max(0.0, u_motion_speed_floor_mps))
    : 0.0;
  vec2 motion_vector_mps = flow_dir * motion_speed_mps;
  vec2 vector_step = motion_vector_mps + flow_normal * (motion_speed_mps * u_motion_jitter_ratio * jitter_sign);

  float speed = u_speed_multiplier * u_zoom_scale;
  float delta_lat = vector_step.y * u_dt_sec * u_deg_per_meter * speed;
  float delta_lon = vector_step.x * u_dt_sec * (u_deg_per_meter / cos_lat) * speed;

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

export const VECTOR_TRAIL_VERTEX_SHADER_SOURCE = `#version 300 es
precision mediump float;

layout(location = 0) in vec2 a_pos;
out vec2 v_tex_pos;

void main() {
  v_tex_pos = a_pos;
  gl_Position = vec4(1.0 - 2.0 * a_pos, 0.0, 1.0);
}
`

export const VECTOR_TRAIL_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision mediump float;

uniform sampler2D u_screen;
uniform float u_opacity;
uniform float u_quantize;
in vec2 v_tex_pos;
out vec4 out_color;

void main() {
  vec4 color = texture(u_screen, 1.0 - v_tex_pos);
  vec4 faded = color * u_opacity;
  vec4 quantized = floor(255.0 * faded) / 255.0;
  out_color = mix(faded, quantized, clamp(u_quantize, 0.0, 1.0));
}
`

export const VECTOR_PARTICLE_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_state; // lon, lat, age

uniform float u_bounds_west;
uniform float u_bounds_east;
uniform vec4 u_mercator_bounds; // west_x, east_x, north_y, south_y
uniform float u_dot_min_px;
uniform float u_dot_max_px;
uniform sampler2D u_vector_tex_lower;
uniform sampler2D u_vector_tex_upper;
uniform vec2 u_vector_size;
uniform float u_lon0;
uniform float u_lat0;
uniform float u_dx;
uniform float u_dy;
uniform float u_time_mix;
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

// Decode a normalized texture channel back to signed int8 range.
float decode_i8(float encoded) {
  float raw = floor(encoded * 255.0 + 0.5);
  return raw > 127.0 ? raw - 256.0 : raw;
}

// Decode U/V components (stored as packed int8 in RG channels).
vec2 decode_vector(sampler2D vectorTex, ivec2 coord) {
  vec2 texel = texelFetch(vectorTex, coord, 0).rg;
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
vec2 sample_vector_bilinear(sampler2D vectorTex, float lon, float lat) {
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

  vec2 w00 = decode_vector(vectorTex, ivec2(int(x0w), int(y0c)));
  vec2 w10 = decode_vector(vectorTex, ivec2(int(x1w), int(y0c)));
  vec2 w01 = decode_vector(vectorTex, ivec2(int(x0w), int(y1c)));
  vec2 w11 = decode_vector(vectorTex, ivec2(int(x1w), int(y1c)));

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

  float time_mix = clamp(u_time_mix, 0.0, 1.0);
  vec2 vector_now_lower = sample_vector_bilinear(u_vector_tex_lower, a_state.x, lat);
  vec2 vector_now_upper = sample_vector_bilinear(u_vector_tex_upper, a_state.x, lat);
  vec2 vector_now = mix(vector_now_lower, vector_now_upper, time_mix);
  float speed_mps = length(vector_now);
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
