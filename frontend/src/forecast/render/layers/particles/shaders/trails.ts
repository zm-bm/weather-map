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
