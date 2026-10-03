#!/usr/bin/env python3
"""Calques OSM et carroyage DFCI pour une zone extraite.

Mêmes familles que le menu Loire (communes, urgence, santé, services,
toponymie, DFCI), limitées au rectangle de l'archive PMTiles.
Les fichiers vont dans ``geojson/zones/<nom>/`` avec un ``manifest.json``
que le menu de droite charge à la place des fichiers du département 42.
"""

from __future__ import annotations

import json
import math
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ZONES_DIR = ROOT / "geojson" / "zones"

OVERPASS_ENDPOINTS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]
USER_AGENT = "Cartoff/1.0 (crisis mapping)"

# Au-delà, le calque 2 km devient trop lourd pour le navigateur (la Loire en a ~5 000).
MAX_DFCI_2KM = 8000

DEG2RAD = math.pi / 180
RAD2DEG = 180 / math.pi
A_WGS = 6378137.0
B_WGS = 6356752.314245179
E_WGS = math.sqrt(1 - (B_WGS / A_WGS) ** 2)
A_NTF = 6378249.2
B_NTF = 6356515.0
E_NTF = math.sqrt(1 - (B_NTF / A_NTF) ** 2)
MERID_PARIS = 2.33722916666667
L2E_N = 0.7289686274
L2E_C = 11745793.39
L2E_XS = 600000.0
L2E_YS = 8199695.768

# (clé menu, nom affiché dans Cartoff, fichier, mode, sélecteurs Overpass)
OSM_LAYERS = [
    ("departement", "Contours communes (OSM)", "communes_contours.geojson", "commune", [
        'relation["boundary"="administrative"]["admin_level"="8"]',
    ]),
    ("departement", "Zones industrielles (OSM)", "zones_industrielles.geojson", "area", [
        'nwr["landuse"="industrial"]',
    ]),
    ("departement", "Sites industriels (OSM)", "sites_industriels.geojson", "area", [
        'nwr["man_made"="works"]',
    ]),
    ("departement", "Zones d'habitation (OSM)", "zones_habitation.geojson", "area", [
        'nwr["landuse"="residential"]',
    ]),
    ("aviation", "Aérodromes (OSM)", "aerodromes.geojson", "point", [
        'nwr["aeroway"="aerodrome"]',
    ]),
    ("aviation", "Héliports (OSM)", "heliports.geojson", "point", [
        'nwr["aeroway"="helipad"]',
        'nwr["aeroway"="heliport"]',
    ]),
    ("urgence", "Points de rassemblement (OSM)", "points_rassemblement.geojson", "point", [
        'nwr["emergency"="assembly_point"]',
    ]),
    ("urgence", "Bouches à incendie (OSM)", "bouches_incendie.geojson", "point", [
        'nwr["emergency"="fire_hydrant"]',
    ]),
    ("urgence", "Abris (OSM)", "abris.geojson", "point", [
        'nwr["amenity"="shelter"]',
    ]),
    ("sante", "Hôpitaux (OSM)", "hopitaux.geojson", "point", [
        'nwr["amenity"="hospital"]',
    ]),
    ("sante", "Cliniques (OSM)", "cliniques.geojson", "point", [
        'nwr["amenity"="clinic"]',
    ]),
    ("sante", "Pharmacies (OSM)", "pharmacies.geojson", "point", [
        'nwr["amenity"="pharmacy"]',
    ]),
    ("services", "Mairies (OSM)", "mairies.geojson", "point", [
        'nwr["amenity"="townhall"]',
    ]),
    ("services", "Gendarmerie (OSM)", "gendarmerie.geojson", "point", [
        'nwr["amenity"="police"]["police:FR"="gendarmerie"]',
        'nwr["amenity"="police"]["operator"="Gendarmerie nationale"]',
    ]),
    ("services", "Casernes sapeurs-pompiers (OSM)", "casernes.geojson", "point", [
        'nwr["amenity"="fire_station"]',
    ]),
    ("services", "Police nationale (OSM)", "police_nationale.geojson", "point", [
        'nwr["amenity"="police"]["police:FR"="police"]',
        'nwr["amenity"="police"]["operator"="Police nationale"]',
    ]),
    ("services", "Cimetières (OSM)", "cimetieres.geojson", "area", [
        'nwr["landuse"="cemetery"]',
    ]),
    ("services", "Administrations (OSM)", "administrations.geojson", "point", [
        'nwr["office"="government"]',
    ]),
    ("services", "Déchèteries (OSM)", "decheteries.geojson", "point", [
        'nwr["amenity"="waste_transfer_station"]',
    ]),
    ("services", "Décharges (OSM)", "decharges.geojson", "area", [
        'nwr["landuse"="landfill"]',
    ]),
    ("services", "Centres communaux (OSM)", "centres_communaux.geojson", "point", [
        'nwr["amenity"="community_centre"]',
    ]),
    ("services", "Écoles (OSM)", "ecoles.geojson", "point", [
        'nwr["amenity"="school"]',
    ]),
    ("toponymie", "Toponymes (OSM)", "toponymes.geojson", "point", [
        'nwr["name"]["natural"]',
        'nwr["name"]["waterway"]',
        'nwr["name"]["landform"]',
        'nwr["name"]["historic"]',
    ]),
    ("toponymie", "Lieux-dits (OSM)", "lieux_dits.geojson", "point", [
        'nwr["place"="locality"]',
        'nwr["place"="hamlet"]',
        'nwr["place"="isolated_dwelling"]',
    ]),
    ("contexte", "Puits / mines (OSM)", "puits_mines.geojson", "point", [
        'nwr["man_made"="mineshaft"]',
    ]),
    ("contexte", "Carrières (OSM)", "carrieres.geojson", "area", [
        'nwr["landuse"="quarry"]',
    ]),
    ("contexte", "Antennes / relais (OSM)", "antennes.geojson", "point", [
        'nwr["man_made"="mast"]',
        'nwr["man_made"="communications_tower"]',
        'nwr["tower:type"="communication"]',
    ]),
]

DFCI_LAYERS = [
    ("Carroyage DFCI 100 km (42)", "dfci_100km.geojson", 100, "Carroyage DFCI 100 km"),
    ("Carroyage DFCI 20 km (42)", "dfci_20km.geojson", 20, "Carroyage DFCI 20 km"),
    ("Carroyage DFCI 2 km (42)", "dfci_2km.geojson", 2, "Carroyage DFCI 2 km"),
]


def _lat_isom(lat_deg: float, ecc: float) -> float:
    lat = lat_deg * DEG2RAD
    sinus = ecc * math.sin(lat)
    ratio = math.log((1 - sinus) / (1 + sinus)) * (ecc / 2)
    return math.log(math.tan(math.pi / 4 + lat / 2) * math.exp(ratio))


def _to_geocentric(lat_deg: float, lon_deg: float, semi_major: float, ecc: float):
    phi = lat_deg * DEG2RAD
    lam = lon_deg * DEG2RAD
    e2 = ecc * ecc
    radius = semi_major / math.sqrt(1 - e2 * math.sin(phi) ** 2)
    return (
        radius * math.cos(phi) * math.cos(lam),
        radius * math.cos(phi) * math.sin(lam),
        (1 - e2) * radius * math.sin(phi),
    )


def _from_geocentric(x: float, y: float, z: float, semi_major: float, ecc: float):
    semi_minor = semi_major * math.sqrt(1 - ecc * ecc)
    e2 = ecc * ecc
    flattening = (semi_major - semi_minor) / semi_major
    plan = math.hypot(x, y)
    radius = math.hypot(plan, z)
    reduced = math.atan((z / plan) * ((1 - flattening) + (e2 * semi_major / radius)))
    lat = math.atan(
        (z * (1 - flattening) + e2 * semi_major * math.sin(reduced) ** 3)
        / ((1 - flattening) * (plan - e2 * semi_major * math.cos(reduced) ** 3))
    )
    return lat * RAD2DEG, math.atan2(y, x) * RAD2DEG


def _wgs_to_lambert(lat: float, lon: float) -> tuple[float, float]:
    x, y, z = _to_geocentric(lat, lon, A_WGS, E_WGS)
    lat_n, lon_n = _from_geocentric(x + 168, y + 60, z - 320, A_NTF, E_NTF)
    lon_n -= MERID_PARIS
    iso = _lat_isom(lat_n, E_NTF)
    easting = L2E_XS + L2E_C * math.exp(-L2E_N * iso) * math.sin(L2E_N * lon_n * DEG2RAD)
    northing = L2E_YS - L2E_C * math.exp(-L2E_N * iso) * math.cos(L2E_N * lon_n * DEG2RAD)
    return easting, northing


def _lambert_to_wgs(easting: float, northing: float) -> tuple[float, float]:
    dx = easting - L2E_XS
    dy = L2E_YS - northing
    radius = math.hypot(dx, dy)
    gamma = math.atan2(dx, dy)
    lon_n = gamma / L2E_N * RAD2DEG
    lat_iso = -math.log(radius / L2E_C) / L2E_N
    phi = 2 * math.atan(math.exp(lat_iso)) - math.pi / 2
    for _ in range(8):
        sinus = E_NTF * math.sin(phi)
        phi = 2 * math.atan(((1 + sinus) / (1 - sinus)) ** (E_NTF / 2) * math.exp(lat_iso)) - math.pi / 2
    lat_n = phi * RAD2DEG
    x, y, z = _to_geocentric(lat_n, lon_n + MERID_PARIS, A_NTF, E_NTF)
    return _from_geocentric(x - 168, y - 60, z + 320, A_WGS, E_WGS)


def _dfci_letter(index: int) -> str:
    if index > 7:
        index += 2
    return chr(index + 65)


def _dfci_code(easting: float, northing: float, step_km: int) -> str:
    x_lamb = round(easting)
    y_lamb = round(northing) - 1_500_000
    code = ""
    column = math.floor(x_lamb / 100_000)
    x_lamb -= column * 100_000
    code += _dfci_letter(column)
    row = math.floor(y_lamb / 100_000)
    y_lamb -= row * 100_000
    code += _dfci_letter(row)
    if step_km >= 100:
        return code
    column = math.floor(x_lamb / 20_000)
    x_lamb -= column * 20_000
    code += str(column * 2)
    row = math.floor(y_lamb / 20_000)
    y_lamb -= row * 20_000
    code += str(row * 2)
    if step_km >= 20:
        return code
    column = math.floor(x_lamb / 2_000)
    row = math.floor(y_lamb / 2_000)
    code += _dfci_letter(column)
    code += str(row)
    return code


def _cell_polygon(x0: float, y0: float, step: float) -> dict:
    """Carré DFCI : x/y sont les coordonnées Lambert utilisées par le carroyage."""
    corners = []
    for easting, northing in (
        (x0, y0 + 1_500_000),
        (x0 + step, y0 + 1_500_000),
        (x0 + step, y0 + step + 1_500_000),
        (x0, y0 + step + 1_500_000),
        (x0, y0 + 1_500_000),
    ):
        lat, lon = _lambert_to_wgs(easting, northing)
        corners.append([round(lon, 6), round(lat, 6)])
    return {"type": "Polygon", "coordinates": [corners]}


def _overlaps(ring: list, west: float, south: float, east: float, north: float) -> bool:
    lons = [pt[0] for pt in ring]
    lats = [pt[1] for pt in ring]
    return not (max(lons) < west or min(lons) > east or max(lats) < south or min(lats) > north)


def build_dfci(west: float, south: float, east: float, north: float, step_km: int) -> dict:
    samples = []
    for lat_index in range(9):
        lat = south + (north - south) * lat_index / 8
        for lon_index in range(9):
            lon = west + (east - west) * lon_index / 8
            samples.append(_wgs_to_lambert(lat, lon))
    xs = [round(pt[0]) for pt in samples]
    ys = [round(pt[1]) - 1_500_000 for pt in samples]
    step = step_km * 1000
    x_start = math.floor(min(xs) / step) * step
    x_stop = math.ceil(max(xs) / step) * step
    y_start = math.floor(min(ys) / step) * step
    y_stop = math.ceil(max(ys) / step) * step
    estimated = max(1, (x_stop - x_start) // step) * max(1, (y_stop - y_start) // step)
    if step_km == 2 and estimated > MAX_DFCI_2KM:
        raise RuntimeError(
            f"Zone trop grande pour le carroyage 2 km ({estimated} mailles, max {MAX_DFCI_2KM}). "
            "Les grilles 100 km et 20 km sont tout de même produites."
        )
    features = []
    x = x_start
    while x < x_stop:
        y = y_start
        while y < y_stop:
            polygon = _cell_polygon(x, y, step)
            ring = polygon["coordinates"][0]
            if _overlaps(ring, west, south, east, north):
                code = _dfci_code(x + step / 2, y + step / 2 + 1_500_000, step_km)
                features.append({
                    "type": "Feature",
                    "properties": {
                        "dfci": code,
                        "resolution_km": step_km,
                        "label": f"DFCI {code} ({step_km} km)",
                    },
                    "geometry": polygon,
                })
            y += step
        x += step
    features.sort(key=lambda feature: feature["properties"]["dfci"])
    return {"type": "FeatureCollection", "features": features}


def _fetch_overpass(query: str) -> dict:
    payload = urllib.parse.urlencode({"data": query}).encode("utf-8")
    headers = {"User-Agent": USER_AGENT}
    last_error = None
    for url in OVERPASS_ENDPOINTS:
        request = urllib.request.Request(url, data=payload, method="POST", headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            time.sleep(1)
    raise RuntimeError(f"Overpass indisponible : {last_error}")


def _way_coords(geometry: list) -> list:
    return [[pt["lon"], pt["lat"]] for pt in geometry or []]


def _stitch(segments: list) -> list:
    remaining = [list(seg) for seg in segments if len(seg) >= 2]
    rings = []
    while remaining:
        ring = remaining.pop(0)
        changed = True
        while changed:
            changed = False
            for index, other in enumerate(remaining):
                if ring[-1] == other[0]:
                    ring.extend(other[1:])
                elif ring[-1] == other[-1]:
                    ring.extend(reversed(other[:-1]))
                elif ring[0] == other[-1]:
                    ring = other + ring[1:]
                elif ring[0] == other[0]:
                    ring = list(reversed(other))[:-1] + ring
                else:
                    continue
                remaining.pop(index)
                changed = True
                break
        if len(ring) >= 4:
            if ring[0] != ring[-1]:
                ring.append(ring[0])
            rings.append(ring)
    return rings


def _relation_polygon(relation: dict):
    outers, inners = [], []
    for member in relation.get("members") or []:
        if member.get("type") != "way":
            continue
        coords = _way_coords(member.get("geometry"))
        if len(coords) < 2:
            continue
        if member.get("role") == "inner":
            inners.append(coords)
        else:
            outers.append(coords)
    outer_rings = _stitch(outers)
    inner_rings = _stitch(inners)
    if not outer_rings:
        return None
    if len(outer_rings) == 1:
        return {"type": "Polygon", "coordinates": [outer_rings[0]] + inner_rings}
    return {"type": "MultiPolygon", "coordinates": [[ring] for ring in outer_rings]}


def _closed_polygon(coords: list):
    if len(coords) < 3:
        return None
    if coords[0] != coords[-1]:
        coords = coords + [coords[0]]
    if len(coords) < 4:
        return None
    return {"type": "Polygon", "coordinates": [coords]}


def _geometry(element: dict, mode: str):
    if mode == "point":
        if element.get("type") == "node" and "lon" in element:
            return {"type": "Point", "coordinates": [element["lon"], element["lat"]]}
        center = element.get("center")
        if center:
            return {"type": "Point", "coordinates": [center["lon"], center["lat"]]}
        return None
    if element.get("type") == "relation":
        return _relation_polygon(element)
    if element.get("geometry"):
        polygon = _closed_polygon(_way_coords(element["geometry"]))
        if polygon:
            return polygon
    if element.get("type") == "node" and "lon" in element:
        return {"type": "Point", "coordinates": [element["lon"], element["lat"]]}
    center = element.get("center")
    if center:
        return {"type": "Point", "coordinates": [center["lon"], center["lat"]]}
    return None


def _address(tags: dict) -> str:
    if tags.get("addr:full"):
        return tags["addr:full"]
    return " ".join(
        part
        for part in (
            tags.get("addr:housenumber"),
            tags.get("addr:street"),
            tags.get("addr:postcode"),
            tags.get("addr:city"),
        )
        if part
    )


def _properties(element: dict, mode: str) -> dict:
    tags = element.get("tags") or {}
    props = {
        "osm_id": element.get("id"),
        "osm_type": element.get("type"),
        "nom": tags.get("name") or "",
        "adresse": _address(tags),
        "telephone": tags.get("phone") or tags.get("contact:phone") or "",
        "email": tags.get("email") or tags.get("contact:email") or "",
        "website": tags.get("website") or tags.get("contact:website") or "",
        "horaires": tags.get("opening_hours") or "",
        "operateur": tags.get("operator") or "",
        "type": (
            tags.get("place")
            or tags.get("emergency")
            or tags.get("amenity")
            or tags.get("aeroway")
            or tags.get("man_made")
            or tags.get("landuse")
            or tags.get("natural")
            or tags.get("waterway")
            or tags.get("historic")
            or ""
        ),
    }
    if mode == "commune":
        props["code_insee"] = tags.get("ref:INSEE") or tags.get("ref") or ""
        props["code_postal"] = tags.get("addr:postcode") or ""
        props["population"] = tags.get("population") or ""
    return {key: value for key, value in props.items() if value not in ("", None)}


def _elements_to_geojson(elements: list, mode: str) -> dict:
    seen = set()
    features = []
    for element in elements:
        if mode == "commune" and element.get("type") != "relation":
            continue
        key = (element.get("type"), element.get("id"))
        if key in seen:
            continue
        seen.add(key)
        geometry = _geometry(element, mode)
        if not geometry:
            continue
        features.append({
            "type": "Feature",
            "properties": _properties(element, mode),
            "geometry": geometry,
        })
    features.sort(key=lambda feature: (feature["properties"].get("nom") or "").upper())
    return {"type": "FeatureCollection", "features": features}


def _overpass_query(selectors: list[str], west, south, east, north, mode: str) -> str:
    box = f"({south},{west},{north},{east})"
    body = "\n".join(f"  {selector}{box};" for selector in selectors)
    timeout = 300 if mode in {"area", "commune"} else 180
    output = "out geom;" if mode == "commune" else ("out geom tags;" if mode == "area" else "out center tags;")
    return f"[out:json][timeout:{timeout}];\n(\n{body}\n);\n{output}\n"


def _write(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def build_zone_layers(name: str, west: float, south: float, east: float, north: float, log=None) -> dict:
    """Écrit les GeoJSON et le manifeste. ``log`` reçoit des lignes de suivi."""

    def note(message: str) -> None:
        if log:
            log(message if message.endswith("\n") else message + "\n")

    folder = ZONES_DIR / name
    folder.mkdir(parents=True, exist_ok=True)
    layers: dict[str, list] = {}
    errors: list[str] = []

    note(f"Calques OSM pour {name} ({west:.3f},{south:.3f} → {east:.3f},{north:.3f})…")
    for index, (group, title, filename, mode, selectors) in enumerate(OSM_LAYERS, start=1):
        note(f"  OSM {index}/{len(OSM_LAYERS)} : {title}")
        entry = {
            "name": title,
            "file": f"geojson/zones/{name}/{filename}",
            "count": 0,
        }
        try:
            payload = _fetch_overpass(_overpass_query(selectors, west, south, east, north, mode))
            collection = _elements_to_geojson(payload.get("elements") or [], mode)
            _write(folder / filename, collection)
            entry["count"] = len(collection["features"])
            note(f"    {entry['count']} objets")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{title} : {exc}")
            _write(folder / filename, {"type": "FeatureCollection", "features": []})
            note(f"    échec : {exc}")
        layers.setdefault(group, []).append(entry)
        time.sleep(1)

    note("Carroyage DFCI…")
    dfci_entries = []
    for title, filename, step_km, label in DFCI_LAYERS:
        entry = {
            "name": title,
            "label": label,
            "file": f"geojson/zones/{name}/{filename}",
            "count": 0,
        }
        try:
            collection = build_dfci(west, south, east, north, step_km)
            _write(folder / filename, collection)
            entry["count"] = len(collection["features"])
            note(f"  {label} : {entry['count']} mailles")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{label} : {exc}")
            _write(folder / filename, {"type": "FeatureCollection", "features": []})
            note(f"  {label} : {exc}")
        dfci_entries.append(entry)
    layers["urgence"] = dfci_entries + layers.get("urgence", [])

    manifest = {
        "name": name,
        "title": name,
        "bbox": {"west": west, "south": south, "east": east, "north": north},
        "layers": layers,
        "errors": errors,
    }
    _write(folder / "manifest.json", manifest)
    note(
        "Calques prêts pour le menu."
        if not errors
        else f"Calques partiels ({len(errors)} échec(s)). Le fond PMTiles reste utilisable."
    )
    return manifest


def manifest_for(name: str) -> dict | None:
    path = (ZONES_DIR / name / "manifest.json").resolve()
    if ZONES_DIR.resolve() not in path.parents or not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))
