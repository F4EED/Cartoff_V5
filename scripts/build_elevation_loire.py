#!/usr/bin/env python3
"""Construit la grille d'altitude Copernicus DEM pour la Loire."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import elevation_grid

# Même emprise que pmtiles/loire.json
SOUTH, WEST, NORTH, EAST = 45.0, 3.5, 46.5, 5.0


def build(output_dir: Path, force: bool) -> None:
    elevation_grid.build_elevation_grid(
        WEST, SOUTH, EAST, NORTH, output_dir, stem="loire_elev", force=force
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Télécharge et découpe le MNT Copernicus DEM pour la Loire."
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=ROOT / "elevation",
        help="Dossier de sortie (défaut : elevation/)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Écraser les fichiers existants",
    )
    args = parser.parse_args()
    build(args.output, args.force)


if __name__ == "__main__":
    main()
