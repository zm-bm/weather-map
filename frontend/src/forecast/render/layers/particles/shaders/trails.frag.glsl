#version 300 es
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
