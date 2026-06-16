#version 300 es
precision mediump float;
out vec4 out_color;

// Update pass writes only transform feedback; fragment output is unused.
void main() {
  out_color = vec4(0.0);
}
