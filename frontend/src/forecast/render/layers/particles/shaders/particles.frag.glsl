#version 300 es
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
