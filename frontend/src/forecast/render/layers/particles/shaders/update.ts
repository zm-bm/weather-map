import { ENCODED_GRID_LOCATION_GLSL } from '../../../encodedGrid'

export const VECTOR_UPDATE_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;
precision highp isampler2D;

layout(location = 0) in vec4 a_state; // lon, lat, age, speed_mps

uniform float u_dt_sec;
uniform float u_seed;
uniform isampler2D u_vector_tex_lower;
uniform isampler2D u_vector_tex_upper;
uniform vec2 u_vector_size;
uniform float u_lon0;
uniform float u_lat0;
uniform float u_dx;
uniform float u_dy;
uniform float u_vector_scale;
uniform float u_vector_offset;
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

out vec4 v_state;

${ENCODED_GRID_LOCATION_GLSL}

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
vec4 respawn(uint id) {
  float r1 = rand01(id, 0x68bc21ebu);
  float r2 = rand01(id, 0x02e5be93u);
  float lon = mix(u_bounds_west, u_bounds_east, r1);
  if (lon > 180.0) lon -= 360.0;
  float lat = mix(u_bounds_south, u_bounds_north, r2);
  return vec4(lon, lat, 0.0, 0.0);
}

// Decode U/V components from signed int8 RG channels.
vec2 decode_vector(isampler2D vectorTex, ivec2 coord) {
  ivec2 stored = texelFetch(vectorTex, coord, 0).rg;
  return (vec2(stored) * u_vector_scale) + u_vector_offset;
}

// Sample vector field in lon/lat space with wrap-aware bilinear filtering.
vec2 sample_vector_bilinear(isampler2D vectorTex, float lon, float lat) {
  EncodedGridLocation location = encodedGridLocationForLonLat(
    vec2(lon, lat),
    u_vector_size,
    u_lon0,
    u_lat0,
    u_dx,
    u_dy
  );

  vec2 w00 = decode_vector(vectorTex, ivec2(location.x0, location.y0));
  vec2 w10 = decode_vector(vectorTex, ivec2(location.x1, location.y0));
  vec2 w01 = decode_vector(vectorTex, ivec2(location.x0, location.y1));
  vec2 w11 = decode_vector(vectorTex, ivec2(location.x1, location.y1));

  return (w00 * location.w00) +
    (w10 * location.w10) +
    (w01 * location.w01) +
    (w11 * location.w11);
}

void main() {
  uint id = uint(gl_VertexID);
  vec4 state = a_state;
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
  v_state = vec4(next_lon, next_lat, age, speed_mps);
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
