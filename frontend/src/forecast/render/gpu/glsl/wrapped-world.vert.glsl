#version 300 es
layout(location = 0) in vec2 a_mercator_pos;
uniform float u_world_offset_x;
out vec2 v_mercator;

void main() {
  vec2 worldPos = vec2(a_mercator_pos.x + u_world_offset_x, a_mercator_pos.y);
  v_mercator = worldPos;
  gl_Position = projectTile(worldPos);
}
