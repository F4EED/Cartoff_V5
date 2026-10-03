#!/usr/bin/env bash
# Installation locale de Cartoff (Linux).
# Prérequis vérifiés puis installés : Python 3.10+, go-pmtiles, fond Loire reconstitué.
# L'altitude Copernicus de la Loire est toujours produite.
# --with-elevation reste accepté.
set -u

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
PMTILES_VERSION="1.31.2"
WITH_ELEVATION=0

for arg in "$@"; do
  case "$arg" in
    --with-elevation) WITH_ELEVATION=1 ;;
    -h|--help)
      echo "Usage : ./install.sh [--with-elevation]"
      echo "  --with-elevation   accepté ; l'altitude Copernicus est toujours installée"
      exit 0
      ;;
    *)
      echo "[Cartoff] ERREUR: option inconnue : $arg"
      exit 1
      ;;
  esac
done

step() { printf '\033[36m[Cartoff] %s\033[0m\n' "$1"; }
ok() { printf '\033[32m[Cartoff] %s\033[0m\n' "$1"; }
warn() { printf '\033[33m[Cartoff] %s\033[0m\n' "$1"; }
fail() { printf '\033[31m[Cartoff] ERREUR: %s\033[0m\n' "$1"; exit 1; }

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

install_packages() {
  if command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get update
    $SUDO apt-get install -y python3 python3-pip python3-venv curl ca-certificates tar
  elif command -v dnf >/dev/null 2>&1; then
    $SUDO dnf install -y python3 python3-pip curl ca-certificates tar
  elif command -v pacman >/dev/null 2>&1; then
    $SUDO pacman -Sy --needed --noconfirm python python-pip curl ca-certificates tar
  else
    fail "Gestionnaire de paquets inconnu (apt, dnf ou pacman). Installez Python 3.10+, curl et tar, puis relancez."
  fi
}

python_ok() {
  command -v "$1" >/dev/null 2>&1 || return 1
  "$1" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' >/dev/null 2>&1
}

find_python() {
  if python_ok python3; then
    PYTHON=python3
    return 0
  fi
  if python_ok python; then
    PYTHON=python
    return 0
  fi
  return 1
}

install_go_pmtiles() {
  dest_dir="$ROOT/pmtiles/tools"
  dest="$dest_dir/pmtiles"
  mkdir -p "$dest_dir"
  if [ -x "$dest" ] && "$dest" --help >/dev/null 2>&1; then
    ok "go-pmtiles déjà présent : $dest"
    return 0
  fi
  case "$(uname -m)" in
    x86_64|amd64) arch="x86_64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) fail "Architecture non prise en charge : $(uname -m). Il faut x86_64 ou arm64." ;;
  esac
  asset="Linux_${arch}"
  url="https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}/go-pmtiles_${PMTILES_VERSION}_${asset}.tar.gz"
  tmp="$(mktemp -d)"
  step "Téléchargement de go-pmtiles ${PMTILES_VERSION} (${asset})..."
  curl -fL "$url" -o "$tmp/pmtiles.tar.gz" || fail "Téléchargement impossible : $url"
  tar -xzf "$tmp/pmtiles.tar.gz" -C "$tmp" || fail "Archive go-pmtiles illisible."
  found="$(find "$tmp" -type f -name pmtiles | head -n 1)"
  if [ -z "$found" ]; then
    fail "Binaire pmtiles introuvable dans l'archive $url"
  fi
  cp "$found" "$dest"
  chmod +x "$dest"
  rm -rf "$tmp"
  "$dest" --help >/dev/null 2>&1 || fail "pmtiles installé mais l'exécution a échoué."
  ok "go-pmtiles installé : $dest"
}

install_loire() {
  archive="$ROOT/pmtiles/loire.pmtiles"
  manifest="$ROOT/pmtiles/loire.pmtiles.manifest.json"
  if [ -f "$archive" ]; then
    ok "Fond Loire déjà présent : pmtiles/loire.pmtiles"
    return 0
  fi
  if [ ! -f "$manifest" ]; then
    fail "Manifeste absent. Le clone est incomplet (pmtiles/loire.pmtiles.part00N)."
  fi
  step "Reconstitution de loire.pmtiles à partir des morceaux versionnés..."
  "$PYTHON" scripts/unpack_large_file.py || fail "La reconstitution de loire.pmtiles a échoué."
  [ -f "$archive" ] || fail "loire.pmtiles n'a pas été créé."
  ok "Fond Loire prêt."
}

install_elevation() {
  bin="$ROOT/elevation/loire_elev.bin"
  if [ -f "$bin" ]; then
    ok "Altitude déjà présente : elevation/loire_elev.bin"
    return 0
  fi
  step "Installation de rasterio, numpy et shapely, puis génération du MNT Loire..."
  "$PYTHON" -m pip install --upgrade pip || fail "pip n'a pas pu être mis à jour."
  "$PYTHON" -m pip install rasterio numpy shapely || fail "Installation des paquets d'altitude impossible."
  "$PYTHON" scripts/build_elevation_loire.py || fail "La génération de l'altitude a échoué."
  ok "Altitude Loire prête."
}

check_local_data() {
  if [ ! -f "$ROOT/geojson/D42/communes_contours_osm_42.geojson" ] || [ ! -f "$ROOT/geojson/D42/dfci_100km_42.geojson" ]; then
    fail "Calques Loire absents dans geojson/D42. Le clone est incomplet."
  fi
  "$PYTHON" -c "import extract, zone_layers, serve" || fail "Les modules Python de Cartoff ne se chargent pas."
  ok "Calques du département 42 et serveur prêts."
}

echo
step "Installation locale de Cartoff"
step "Dossier : $ROOT"

if ! find_python; then
  step "Python 3.10+ absent. Installation des paquets système..."
  install_packages
  hash -r
fi
if ! find_python; then
  fail "Python 3.10+ introuvable après installation."
fi
ok "Python $($PYTHON -c 'import sys; print(sys.version.split()[0])') ($PYTHON)"

if ! command -v curl >/dev/null 2>&1 || ! command -v tar >/dev/null 2>&1; then
  step "curl ou tar manquant. Installation des paquets système..."
  install_packages
fi

install_go_pmtiles
install_loire
check_local_data

if [ "$WITH_ELEVATION" -eq 1 ]; then
  step "Altitude demandée explicitement : elle fait déjà partie de l'installation."
fi
install_elevation

echo
ok "Cartoff est prêt en local."
echo "[Cartoff] Lancez : $PYTHON serve.py -p 8000"
echo "[Cartoff] Puis ouvrez http://localhost:8000/"
echo "[Cartoff] La carte, les calques et les missions fonctionnent sans réseau."
echo "[Cartoff] Extraire une nouvelle zone demande Internet le temps du téléchargement."
echo
