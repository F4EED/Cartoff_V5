# Altitude offline — Copernicus DEM (Loire)

Grille d'altitude (~30 m, dérivée **EU-DEM / Copernicus GLO-30**) pour l'emprise Cartoff : **45,0°–46,5° N**, **3,5°–5,0° E** (même borne que `pmtiles/loire.pmtiles`).

## Fichiers

| Fichier | Rôle | Versionné ? |
|---------|------|-------------|
| `loire_elev.meta.json` | Bornes, dimensions, nodata, transform raster | Oui |
| `loire_elev.bin` | Altitudes en **Int16** (mètres ; nodata = `-32768`) | Non (`.gitignore`, ~58 Mo) |

Dimensions typiques après génération : **5401 × 5400** cellules (~58 Mo).

## Génération (avec Internet)

`install.bat` (Windows) et `./install.sh` (Linux) produisent la grille Loire. Ils installent `rasterio` et `numpy`, puis appellent le script ci-dessous.

Une extraction PMTiles depuis la carte produit en plus `elevation/zones/<nom>/elev.meta.json` et `elev.bin` pour l’emprise choisie (dossier non versionné). Le pas reste d’environ 30 m tant que le côté tient dans 5 400 pixels ; au-delà il s’élargit. Revenir sur le fond Loire recharge `elevation/loire_elev.bin`. Si la grille de zone manque, la Loire est utilisée là où elle couvre.

L’image Docker sert la carte et les calques du 42. `elevation/loire_elev.bin` et `elevation/zones/` sont exclus du build (`.dockerignore`) : l’altitude se prépare sur l’hôte avec `install.bat` ou `./install.sh`.

Pour régénérer seulement la Loire :

**Prérequis :** Python 3, `rasterio`, `numpy`

```bash
pip install rasterio numpy shapely
python scripts/build_elevation_loire.py
```

Options :

```bash
python scripts/build_elevation_loire.py --force          # écraser les fichiers existants
python scripts/build_elevation_loire.py -o autre/dossier  # autre répertoire de sortie
```

Le script :

1. télécharge les dalles COG Copernicus DEM 30 m nécessaires depuis `copernicus-dem-30m.s3.eu-central-1.amazonaws.com` ;
2. fusionne et découpe l'emprise Loire ;
3. écrit `loire_elev.meta.json` et `loire_elev.bin` dans `elevation/` (par défaut).

Si les fichiers existent déjà, le script s'arrête sauf avec `--force`. La logique commune est dans `elevation_grid.py`.

## Utilisation dans Cartoff

1. Lancer `install.bat` ou `./install.sh`, ou copier `loire_elev.bin` depuis une autre installation.
2. Lancer l'application via **`start.bat`** (Windows) ou **`python serve.py`** à la racine du projet — le chargement via `fetch` ne fonctionne pas en `file://`, et `python -m http.server` ne gère pas correctement PMTiles (HTTP Range).
3. Ouvrir **http://localhost:8000/** dans le navigateur.
4. Déplacer la souris sur la carte : la boîte en bas à gauche affiche **Alt.** (interpolation bilinéaire sur la grille, via `js/coords-utils.js`, debounce 250 ms).

Hors emprise ou sans fichier binaire : affichage « — » ou « … » selon l'état de chargement.

## Licence et attribution

| Élément | Détail |
|---------|--------|
| Données | [Copernicus DEM GLO-30](https://spacedata.copernicus.eu/) (EU-DEM ~30 m) |
| Conditions | [Conditions d'utilisation Copernicus](https://spacedata.copernicus.eu/) — usage libre avec attribution |
| Attribution carte | « MNT [Copernicus DEM](https://spacedata.copernicus.eu/) » (voir `js/cartoff-app.js` et [sources.md](../sources.md)) |
| Métadonnées | Champs `source` et `license` dans `loire_elev.meta.json` |
