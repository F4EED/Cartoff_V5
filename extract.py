#!/usr/bin/env python3
"""Extraction d'archives PMTiles depuis le fond mondial Protomaps.

Repris du dépôt https://github.com/F4EED/pmtiles et adapté à Cartoff :
le binaire go-pmtiles est cherché dans ``pmtiles/tools/`` (``pmtiles.exe``
sous Windows), et les archives atterrissent dans ``pmtiles/``.

Une seule extraction à la fois. Le navigateur crée un job via
``POST /api/extract``, puis interroge ``GET /api/jobs/<id>``.
"""

from __future__ import annotations

import json
import math
import re
import subprocess
import threading
import unicodedata
import urllib.request
import uuid
from datetime import date, timedelta
from pathlib import Path

import elevation_grid
import zone_layers

ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "pmtiles"
BUILD_BASE = "https://build.protomaps.com/{date}.pmtiles"
DEFAULT_MIN_ZOOM = 9
DEFAULT_MAX_ZOOM = 15
MAX_SPAN_DEG = 12.0
MIN_SPAN_DEG = 0.02

JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()
EXTRACT_LOCK = threading.Lock()


class ExtractError(ValueError):
    """Erreur attendue, message affichable tel quel dans l'interface."""


def pmtiles_bin() -> Path:
    """Premier binaire go-pmtiles trouvé, sinon le chemin Windows attendu."""
    candidates = [
        ROOT / "pmtiles" / "tools" / "pmtiles.exe",
        ROOT / "pmtiles" / "tools" / "pmtiles",
        ROOT / "tools" / "pmtiles.exe",
        ROOT / "tools" / "pmtiles",
    ]
    for path in candidates:
        if path.is_file():
            return path
    return candidates[0]


def sanitize_name(raw: str) -> str:
    """Nom de fichier sûr : ASCII, sans séparateur de chemin, 64 caractères max."""
    text = (raw or "").strip()
    if text.lower().endswith(".pmtiles"):
        text = text[: -len(".pmtiles")]
    normalized = unicodedata.normalize("NFKD", text)
    ascii_name = normalized.encode("ascii", "ignore").decode("ascii")
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "-", ascii_name).strip("-_")
    if not cleaned or len(cleaned) > 64:
        raise ExtractError("Nom invalide. Utilisez des lettres, chiffres, tirets (max 64).")
    return cleaned


def order_ring(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Ordonne 4 points (lat, lon) en anneau autour du centroïde."""
    if len(points) != 4:
        raise ExtractError("Il faut exactement 4 points.")
    lat0 = sum(p[0] for p in points) / 4
    lon0 = sum(p[1] for p in points) / 4
    return sorted(points, key=lambda p: math.atan2(p[0] - lat0, p[1] - lon0))


def bbox_of(points: list[tuple[float, float]]) -> tuple[float, float, float, float]:
    """Rectangle englobant (ouest, sud, est, nord), borné en taille."""
    lats = [p[0] for p in points]
    lons = [p[1] for p in points]
    south, north = min(lats), max(lats)
    west, east = min(lons), max(lons)
    if east - west > MAX_SPAN_DEG or north - south > MAX_SPAN_DEG:
        raise ExtractError(
            f"Zone trop large (max {MAX_SPAN_DEG:g}° de côté). Zoomez et resserrez les 4 points."
        )
    if east - west < MIN_SPAN_DEG or north - south < MIN_SPAN_DEG:
        raise ExtractError("Zone trop petite. Écartez davantage les 4 points.")
    return west, south, east, north


def write_region_geojson(ring: list[tuple[float, float]], dest: Path) -> None:
    """Écrit un polygone GeoJSON (lon, lat) fermé, pour ``pmtiles extract --region``."""
    coords = [[lon, lat] for lat, lon in ring]
    coords.append(coords[0])
    geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {},
                "geometry": {"type": "Polygon", "coordinates": [coords]},
            }
        ],
    }
    dest.write_text(json.dumps(geojson), encoding="utf-8")


_BUILD_URL: str | None = None


def find_latest_build(max_days_back: int = 14) -> str:
    """URL du build Protomaps le plus récent qui répond en HEAD."""
    global _BUILD_URL
    if _BUILD_URL:
        return _BUILD_URL
    today = date.today()
    for offset in range(max_days_back):
        day = today - timedelta(days=offset)
        url = BUILD_BASE.format(date=day.strftime("%Y%m%d"))
        req = urllib.request.Request(
            url,
            method="HEAD",
            headers={"User-Agent": "Cartoff/1.0"},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                if resp.status == 200:
                    _BUILD_URL = url
                    return url
        except OSError:
            continue
    raise ExtractError("Aucun build Protomaps trouvé (réseau ou service indisponible).")


def _append_log(job: dict, line: str) -> None:
    job["log"] = (job.get("log") or "") + line
    if len(job["log"]) > 8000:
        job["log"] = job["log"][-6000:]


def _run_extract(job: dict) -> None:
    output = Path(job["path"])
    region_path = OUTPUT_DIR / f".{job['name']}-{job['id']}.geojson"
    bin_path = pmtiles_bin()
    try:
        if not EXTRACT_LOCK.acquire(blocking=False):
            raise ExtractError("Une extraction est déjà en cours. Réessayez ensuite.")
        try:
            job["status"] = "running"
            _append_log(job, "Recherche du build Protomaps…\n")
            build_url = find_latest_build()
            job["source"] = build_url
            _append_log(job, f"Source : {build_url}\n")
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            write_region_geojson(job["ring"], region_path)
            if output.exists():
                output.unlink()
            cmd = [
                str(bin_path),
                "extract",
                build_url,
                str(output),
                f"--region={region_path}",
                f"--minzoom={job['minzoom']}",
                f"--maxzoom={job['maxzoom']}",
                "--download-threads=8",
            ]
            _append_log(job, "Extraction des tuiles…\n")
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                cwd=str(ROOT),
            )
            job["pid"] = proc.pid
            assert proc.stdout is not None
            for line in proc.stdout:
                _append_log(job, line)
            code = proc.wait()
            if code != 0:
                raise ExtractError(job.get("log") or f"pmtiles extract a échoué ({code}).")
            verify = subprocess.run(
                [str(bin_path), "verify", str(output)],
                capture_output=True,
                text=True,
            )
            if verify.returncode != 0:
                output.unlink(missing_ok=True)
                raise ExtractError(verify.stderr or "Vérification PMTiles échouée.")
            job["size"] = output.stat().st_size
            bbox = job["bbox"]
            try:
                manifest = zone_layers.build_zone_layers(
                    job["name"],
                    bbox["west"],
                    bbox["south"],
                    bbox["east"],
                    bbox["north"],
                    log=lambda line: _append_log(job, line),
                )
                job["layers"] = {
                    "ok": not manifest.get("errors"),
                    "errors": manifest.get("errors") or [],
                }
            except Exception as exc:  # noqa: BLE001
                job["layers"] = {"ok": False, "errors": [str(exc)]}
                _append_log(job, f"Calques OSM/DFCI : {exc}\n")
            try:
                meta = elevation_grid.build_elevation_grid(
                    bbox["west"],
                    bbox["south"],
                    bbox["east"],
                    bbox["north"],
                    ROOT / "elevation" / "zones" / job["name"],
                    stem="elev",
                    log=lambda line: _append_log(job, line),
                )
                job["elevation"] = {
                    "ok": True,
                    "rows": meta.get("rows"),
                    "cols": meta.get("cols"),
                }
            except Exception as exc:  # noqa: BLE001
                job["elevation"] = {"ok": False, "error": str(exc)}
                _append_log(job, f"Altitude Copernicus : {exc}\n")
            job["status"] = "done"
            job["download"] = f"/api/download/{job['name']}.pmtiles"
            _append_log(job, f"Terminé : {output.name} ({job['size']} octets)\n")
        finally:
            EXTRACT_LOCK.release()
            region_path.unlink(missing_ok=True)
    except ExtractError as exc:
        job["status"] = "error"
        job["error"] = str(exc)
        _append_log(job, f"Erreur : {exc}\n")
        Path(job["path"]).unlink(missing_ok=True)
    except Exception as exc:  # noqa: BLE001
        job["status"] = "error"
        job["error"] = f"Échec inattendu : {exc}"
        _append_log(job, f"Erreur : {exc}\n")
        Path(job["path"]).unlink(missing_ok=True)


def public_job(job: dict) -> dict:
    return {
        "id": job["id"],
        "name": job["name"],
        "status": job["status"],
        "error": job.get("error"),
        "log": job.get("log", ""),
        "size": job.get("size"),
        "download": job.get("download"),
        "bbox": job.get("bbox"),
        "minzoom": job.get("minzoom"),
        "maxzoom": job.get("maxzoom"),
        "layers": job.get("layers"),
        "elevation": job.get("elevation"),
    }


def start_extract(payload: dict) -> dict:
    bin_path = pmtiles_bin()
    if not bin_path.is_file():
        raise ExtractError(
            "Binaire go-pmtiles introuvable (attendu : pmtiles/tools/pmtiles.exe)."
        )

    name = sanitize_name(str(payload.get("name") or ""))
    raw_points = payload.get("points")
    if not isinstance(raw_points, list) or len(raw_points) != 4:
        raise ExtractError("Fournissez 4 points [lat, lon].")

    points: list[tuple[float, float]] = []
    for item in raw_points:
        if not (isinstance(item, (list, tuple)) and len(item) == 2):
            raise ExtractError("Chaque point doit être [lat, lon].")
        lat, lon = float(item[0]), float(item[1])
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise ExtractError("Coordonnées hors limites.")
        points.append((lat, lon))

    try:
        minzoom = int(payload.get("minzoom", DEFAULT_MIN_ZOOM))
        maxzoom = int(payload.get("maxzoom", DEFAULT_MAX_ZOOM))
    except (TypeError, ValueError) as exc:
        raise ExtractError("Zooms invalides.") from exc
    if not 0 <= minzoom <= maxzoom <= DEFAULT_MAX_ZOOM:
        raise ExtractError(f"Zooms autorisés : 0 à {DEFAULT_MAX_ZOOM}, avec min ≤ max.")

    ring = order_ring(points)
    west, south, east, north = bbox_of(ring)
    overwrite = bool(payload.get("overwrite"))
    output = OUTPUT_DIR / f"{name}.pmtiles"
    if output.exists() and not overwrite:
        raise ExtractError(
            f"Le fichier {name}.pmtiles existe déjà. Cochez « remplacer » ou changez de nom."
        )

    job_id = uuid.uuid4().hex[:12]
    job = {
        "id": job_id,
        "name": name,
        "status": "queued",
        "path": str(output),
        "ring": ring,
        "bbox": {"west": west, "south": south, "east": east, "north": north},
        "minzoom": minzoom,
        "maxzoom": maxzoom,
        "log": "",
        "error": None,
        "size": None,
        "download": None,
    }
    with JOBS_LOCK:
        if any(j["status"] in {"queued", "running"} for j in JOBS.values()):
            raise ExtractError("Une extraction est déjà en cours.")
        JOBS[job_id] = job
    thread = threading.Thread(target=_run_extract, args=(job,), daemon=True)
    thread.start()
    return public_job(job)


def get_job(job_id: str) -> dict | None:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    return public_job(job) if job else None


def list_archives() -> list[dict]:
    """Archives ``*.pmtiles`` du dossier, de la plus récente à la plus ancienne.

    Les morceaux ``.pmtiles.partNNN`` ne correspondent pas à ce motif.
    """
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    files = []
    for path in sorted(OUTPUT_DIR.glob("*.pmtiles"), key=lambda p: p.stat().st_mtime, reverse=True):
        if path.name.startswith("."):
            continue
        files.append(
            {
                "name": path.stem,
                "file": path.name,
                "size": path.stat().st_size,
                "url": f"/pmtiles/{path.name}",
            }
        )
    return files


def download_path(filename: str) -> Path | None:
    if not filename.endswith(".pmtiles"):
        return None
    try:
        name = sanitize_name(filename)
    except ExtractError:
        return None
    path = (OUTPUT_DIR / f"{name}.pmtiles").resolve()
    if OUTPUT_DIR.resolve() not in path.parents:
        return None
    return path if path.is_file() else None
