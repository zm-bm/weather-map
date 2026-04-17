node_keys = { "place" }
build_maxzoom = tonumber(os.getenv("BUILD_MAXZOOM") or "6")
include_water_polygons = os.getenv("INCLUDE_WATER_POLYGONS") == "1"
include_towns = build_maxzoom >= 8
include_motorways = build_maxzoom >= 6
include_trunks = build_maxzoom >= 7
include_rivers = build_maxzoom >= 7

way_keys = {
  "boundary=administrative",
  "bridge",
  "tunnel"
}

if include_motorways then
  table.insert(way_keys, "highway=motorway")
end

if include_trunks then
  table.insert(way_keys, "highway=trunk")
end

if include_rivers then
  table.insert(way_keys, "waterway=river")
end

if include_water_polygons then
  table.insert(way_keys, "natural=water")
  table.insert(way_keys, "natural=coastline")
  table.insert(way_keys, "water")
  table.insert(way_keys, "waterway=riverbank")
end

function relation_scan_function()
  if not include_water_polygons then
    if Find("boundary") == "administrative" then
      Accept()
    end
    return
  end

  if Find("boundary") == "administrative" then
    Accept()
    return
  end

  if Find("natural") == "water" or Find("water") ~= "" or Find("waterway") == "riverbank" then
    Accept()
  end
end

function relation_function()
  if not include_water_polygons then
    return
  end

  local water_class = classify_water()
  if water_class == nil then
    return
  end

  Layer("water", true)
  Attribute("class", water_class)
  MinZoom(water_minzoom(water_class))
end

function set_name_attributes()
  local name = Find("name")
  local name_en = Find("name:en")
  local name_latin = Find("name:latin")

  if name ~= "" then
    Attribute("name", name)
  end

  if name_en ~= "" then
    Attribute("name:en", name_en)
  end

  if name_latin == "" then
    name_latin = name
  end

  if name_latin ~= "" then
    Attribute("name:latin", name_latin)
  end
end

function set_brunnel_attribute()
  local bridge = Find("bridge")
  local tunnel = Find("tunnel")

  if bridge ~= "" and bridge ~= "no" then
    Attribute("brunnel", "bridge")
    return
  end

  if tunnel ~= "" and tunnel ~= "no" then
    Attribute("brunnel", "tunnel")
  end
end

function country_rank(population)
  if population >= 50000000 then
    return 1
  end

  if population >= 20000000 then
    return 2
  end

  return 3
end

function settlement_rank(population)
  if population >= 3000000 then
    return 1
  end

  if population >= 1000000 then
    return 2
  end

  if population >= 500000 then
    return 3
  end

  if population >= 200000 then
    return 4
  end

  if population >= 100000 then
    return 5
  end

  if population >= 50000 then
    return 6
  end

  if population >= 25000 then
    return 7
  end

  return 8
end

function place_minzoom(place, population, rank)
  if place == "country" then
    if rank == 1 then
      return 0
    end

    if rank == 2 then
      return 1
    end

    return 2
  end

  if place == "city" then
    if population >= 1000000 then
      return 5
    end

    if population >= 200000 then
      return 6
    end

    return 7
  end

  if place == "town" then
    if population >= 50000 then
      return 7
    end

    return 8
  end

  return 9
end

function node_function()
  local place = Find("place")
  if place ~= "country" and place ~= "city" and place ~= "town" then
    return
  end

  if place == "town" and not include_towns then
    return
  end

  local population = tonumber(Find("population")) or 0
  local rank

  if place == "country" then
    rank = country_rank(population)
  else
    rank = settlement_rank(population)
  end

  Layer("place", false)
  Attribute("class", place)
  AttributeInteger("rank", rank)
  MinZoom(place_minzoom(place, population, rank))
  set_name_attributes()
end

function classify_water()
  local water = Find("water")
  local natural = Find("natural")
  local waterway = Find("waterway")

  if waterway == "riverbank" then
    return "riverbank"
  end

  if water == "reservoir" then
    return "reservoir"
  end

  if water == "ocean" then
    return "ocean"
  end

  if water == "sea" then
    return "sea"
  end

  if natural == "water" or water ~= "" then
    return "lake"
  end

  return nil
end

function water_minzoom(water_class)
  if water_class == "riverbank" then
    return 4
  end

  return 0
end

function base_highway_class(highway)
  if highway == "motorway" then
    return "motorway"
  end

  if highway == "trunk" then
    return "trunk"
  end

  return nil
end

function highway_minzoom(highway_class)
  if highway_class == "motorway" then
    return 6
  end

  if highway_class == "trunk" then
    return 7
  end

  return 9
end

function boundary_minzoom(admin_level)
  if admin_level == 2 then
    return 0
  end

  if admin_level == 4 then
    return 3
  end

  return 5
end

function is_maritime_boundary(maritime_value, border_type_value)
  return maritime_value == "yes"
    or maritime_value == "1"
    or maritime_value == "true"
    or border_type_value == "territorial"
end

function way_function()
  local boundary = Find("boundary")
  local border_type = Find("border_type")
  local highway = Find("highway")
  local waterway = Find("waterway")
  local is_area = IsClosed() or IsMultiPolygon()

  local admin_level = 99
  local maritime = false
  local is_boundary = false

  while true do
    local relation = NextRelation()
    if not relation then
      break
    end

    if FindInRelation("boundary") == "administrative" then
      is_boundary = true
      admin_level = math.min(admin_level, tonumber(FindInRelation("admin_level")) or 99)
      maritime = maritime or is_maritime_boundary(FindInRelation("maritime"), FindInRelation("border_type"))
    end
  end

  maritime = maritime or is_maritime_boundary(Find("maritime"), border_type)

  if boundary == "administrative" then
    is_boundary = true
    admin_level = math.min(admin_level, tonumber(Find("admin_level")) or 99)
  end

  if is_boundary and not maritime and (admin_level == 2 or admin_level == 4) then
    Layer("boundary", false)
    AttributeInteger("admin_level", admin_level)
    AttributeInteger("maritime", 0)
    MinZoom(boundary_minzoom(admin_level))
  end

  if include_water_polygons then
    local water_class = classify_water()
    if water_class ~= nil and is_area then
      Layer("water", true)
      Attribute("class", water_class)
      MinZoom(water_minzoom(water_class))
    end
  end

  if include_rivers and waterway == "river" then
    Layer("waterway", false)
    Attribute("class", "river")
    set_brunnel_attribute()
    MinZoom(7)
  end

  local highway_class = base_highway_class(highway)
  if highway_class ~= nil then
    Layer("transportation", false)
    Attribute("class", highway_class)
    set_brunnel_attribute()
    MinZoom(highway_minzoom(highway_class))
  end
end
