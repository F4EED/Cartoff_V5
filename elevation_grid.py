"""Grille d'altitude Copernicus DEM GLO-30, découpée sur une emprise.

Le pas natif est d'environ 30 m. Au-delà de 5 400 pixels de côté, le pas
s'élargit pour rester dans cette limite (une zone de 12° reste sous ~70 Mo).
"""

from __future__ import annotations

import math
from pathlib import Path

NODATA = -32768
NATIVE_RES = 1 / 3600
MAX_SIDE = 5400
COG_BASE = (
    "https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/"
    "{name}/{name}.tif"
)


def tile_name(lat_deg: int, lon_deg: int) -> str:
    lat_hem = "N" if lat_deg >= 0 else "S"
    lon_hem = "E" if lon_deg >= 0 else "W"
    return (
        f"Copernicus_DSM_COG_10_{lat_hem}{abs(lat_deg):02d}_00_"
        f"{lon_hem}{abs(lon_deg):03d}_00_DEM"
    )


def needed_tiles(south: float, west: float, north: float, east: float) -> list[str]:
    tiles: list[str] = []
    for lat in range(math.floor(south), math.floor(north) + 1):
        for lon in range(math.floor(west), math.floor(east) + 1):
            tiles.append(tile_name(lat, lon))
    return sorted(set(tiles))


def target_resolution(west: float, south: float, east: float, north: float) -> float:
    span = max(east - west, north - south, NATIVE_RES)
    if span / NATIVE_RES <= MAX_SIDE:
        return NATIVE_RES
    return span / MAX_SIDE


def build_elevation_grid(
    west: float,
    south: float,
    east: float,
    north: float,
    output_dir: Path,
    stem: str = "elev",
    force: bool = False,
    log=None,
) -> dict:
    """Écrit ``<stem>.meta.json`` et ``<stem>.bin``. Retourne les métadonnées."""
    if east <= west or north <= south:
        raise ValueError("Emprise d'altitude invalide.")

    def emit(message: str) -> None:
        text = message if message.endswith("\n") else message + "\n"
        if log:
            log(text)
        else:
            print(text, end="")

    try:
        import numpy as np
        import rasterio
        from rasterio.enums import Resampling
        from rasterio.merge import merge
    except ImportError as exc:
        raise RuntimeError(
            "Altitude Copernicus : installez rasterio, numpy et shapely "
            "(install.bat ou ./install.sh)."
        ) from exc

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    meta_path = output_dir / f"{stem}.meta.json"
    bin_path = output_dir / f"{stem}.bin"
    if meta_path.is_file() and bin_path.is_file() and not force:
        emit(f"Altitude déjà présente : {bin_path}")
        import json
        return json.loads(meta_path.read_text(encoding="utf-8"))

    tiles = needed_tiles(south, west, north, east)
    res = target_resolution(west, south, east, north)
    resampling = Resampling.average if res > NATIVE_RES * 1.01 else Resampling.nearest
    emit(
        f"Altitude Copernicus : {len(tiles)} dalle(s), pas {res * 111_320:.0f} m environ…"
    )
    datasets = []
    try:
        for name in tiles:
            url = COG_BASE.format(name=name)
            emit(f"  · {name}")
            datasets.append(rasterio.open(url))
        mosaic, transform = merge(
            datasets,
            bounds=(west, south, east, north),
            res=(res, res),
            nodata=NODATA,
            resampling=resampling,
        )
    finally:
        for ds in datasets:
            ds.close()

    band = mosaic[0].astype("float32")
    band[~np.isfinite(band)] = NODATA
    heights = np.rint(band).astype(np.int16)
    heights[heights < -500] = NODATA
    heights[heights > 5000] = NODATA
    rows, cols = heights.shape
    import json
    meta = {
        "source": "Copernicus DEM GLO-30",
        "license": "Copernicus — usage libre (voir https://spacedata.copernicus.eu/)",
        "south": south,
        "west": west,
        "north": north,
        "east": east,
        "rows": int(rows),
        "cols": int(cols),
        "nodata": NODATA,
        "resolution_deg": res,
        "crs": "EPSG:4326",
        "transform": [
            transform.a, transform.b, transform.c,
            transform.d, transform.e, transform.f,
        ],
    }
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    heights.tofile(bin_path)
    size_mb = bin_path.stat().st_size / 1024 / 1024
    emit(f"Grille : {cols} x {rows} ({size_mb:.1f} Mo)")
    emit(f"Écrit : {meta_path}")
    emit(f"Écrit : {bin_path}")
    return meta
