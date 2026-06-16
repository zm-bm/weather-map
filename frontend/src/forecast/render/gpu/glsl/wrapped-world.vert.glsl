#version 300 es
layout(location = 0) in vec2 a_mercator_pos; // unit quad in [0, 1] mercator coordinates
uniform mat4 u_matrix;
uniform float u_world_offset_x;
uniform float u_world_size;
out vec2 v_mercator;

void main() {
  // Shift this quad into one wrapped-world copy and pass mercator coords through.
  vec2 worldPos = vec2(a_mercator_pos.x + u_world_offset_x, a_mercator_pos.y);
  v_mercator = worldPos;
  gl_Position = u_matrix * vec4(worldPos * u_world_size, 0.0, 1.0);
}
