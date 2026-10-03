# Base carto PMTiles — fichiers découpés

Sources et attributions : fond **OpenStreetMap** (PMTiles + calques GeoJSON), altitude **Copernicus DEM** — voir [sources.md](../sources.md).

Le fichier `loire.pmtiles` (~260 Mo, zoom 9–15) dépasse la limite GitHub de **100 Mo par fichier**. Il n’est donc **pas versionné** tel quel (voir `.gitignore`).

À la place, le dépôt contient :

| Fichier | Rôle |
|---------|------|
| `loire.pmtiles.part001` | 1er morceau (70 Mo max) |
| `loire.pmtiles.part002` | 2e morceau |
| `loire.pmtiles.part003` | … |
| `loire.pmtiles.manifest.json` | Manifeste (tailles, liste des morceaux, empreinte SHA-256) |

Les scripts de découpage et de restauration se trouvent dans `scripts/` :

- `build_loire_pmtiles.py` — extrait le fond depuis le build quotidien Protomaps
- `pack_large_file.py` — découpe un gros fichier en morceaux
- `unpack_large_file.py` — reconstitue le fichier original

Métadonnées d’emprise : `loire.json` (`min_zoom: 9`, `max_zoom: 15`, bbox 45,0°–46,5° N × 3,5°–5,0° E).

---

## Restauration après `git clone`

**Prérequis :** Python 3 (aucune dépendance externe).

Depuis la racine du projet :

```bash
python scripts/unpack_large_file.py
```

Cette commande :

1. lit `pmtiles/loire.pmtiles.manifest.json` ;
2. assemble les morceaux `loire.pmtiles.part001`, `loire.pmtiles.part002`, etc. ;
3. recrée `pmtiles/loire.pmtiles` ;
4. vérifie la taille et l’empreinte SHA-256.

En cas de succès, vous devriez voir :

```
Contrôle SHA-256 : OK
Fichier reconstitué : pmtiles\loire.pmtiles
```

### Si le fichier existe déjà

```bash
python scripts/unpack_large_file.py --force
```

### Options utiles

```bash
# Manifeste ou sortie personnalisés
python scripts/unpack_large_file.py pmtiles/loire.pmtiles.manifest.json
python scripts/unpack_large_file.py -o chemin/vers/sortie.pmtiles
```

---

## Lancer la carte

Placez une ou plusieurs archives `*.pmtiles` dans `pmtiles/`. Au démarrage, Cartoff charge **`loire.pmtiles`** s’il est présent, sinon l’archive la plus récente. Le menu **Fond de carte** permet d’en changer : l’emprise et les zooms sont lus dans l’en-tête du fichier.

Servez le projet via un serveur web (pas en `file://`) :

```bash
# Windows (recommandé) : libère le port 8000, vérifie loire.pmtiles, lance serve.py
start.bat

# Ou manuellement
python serve.py -p 8000
```

Depuis la racine du dépôt — voir aussi [README.md](../README.md).

Le serveur `serve.py` gère les requêtes **HTTP Range** (réponse 206) et l’API `/api/files`, `/api/extract`, `/api/jobs/<id>`. Au démarrage, il avertit s’il n’y a aucune archive.

⚠️ **Ne pas utiliser** `python -m http.server` : pas de support HTTP Range → fond gris.

### Chargement (`js/basemap.js`)

`protomapsL.leafletLayer` est créé avec **`levelDiff: 0`** et **`maxDataZoom`** pris dans l’en-tête. Sans `levelDiff: 0`, un extrait dont le zoom minimal est 9 demande des tuiles z8 et le fond reste gris.

La carte autorise le surzoom jusqu’au niveau **18** (`MAP_MAX_ZOOM`). Le zoom minimal de la vue suit `minZoom` de l’archive chargée.

Avant d’afficher un fond, le client sonde `Range: bytes=0-16383` et exige une réponse **206** avec `Accept-Ranges: bytes`. Sinon un message s’affiche dans la boîte de coordonnées.

### Extraire une zone depuis la carte

Dans le panneau **Fond de carte** : **Sélectionner une zone**. La carte quitte l’emprise Loire et affiche la France (réseau routier Protomaps, villes principales). Quatre clics, nom et zooms, puis **Extraire**. Annuler revient au fond précédent. `extract.py` appelle `pmtiles/tools/pmtiles.exe` sur le dernier build Protomaps (réseau requis, une extraction à la fois). Le fichier est ensuite proposé dans le menu et affiché.

### Autre gros fichier : altitude

Le MNT Copernicus (`elevation/loire_elev.bin`, ~58 Mo) suit le même principe : non versionné, à générer avec `python scripts/build_elevation_loire.py` — voir [elevation/README.md](../elevation/README.md).

---

## Créer un PMTiles pour votre région

La procédure ci-dessous généralise l’exemple Loire. Le dépôt fournit `scripts/build_loire_pmtiles.py` et `pmtiles/tools/pmtiles.exe` (go-pmtiles).

### 1. Emprise et niveaux de zoom

1. **BBox** : `ouest,sud,est,nord` en degrés décimaux WGS84 (ex. Loire : `3.5,45.0,5.0,46.5` — voir `pmtiles/loire.json`).
2. **`minzoom`** : premier niveau de tuiles **inclus** dans l’archive. Plus il est bas, plus le fichier grossit. Pour une région départementale, **9** est un bon compromis (comme Loire).
3. **`maxzoom`** : dernier niveau inclus. Le build Protomaps actuel s’arrête à **15** (pas de z16).

Documentez ces valeurs dans un fichier JSON (ex. `pmtiles/ma-region.json`) : `bounds`, `min_zoom`, `max_zoom`.

### 2. Extraction

**Depuis la carte** (recommandé) : panneau **Fond de carte** → **Sélectionner une zone**. Quatre clics délimitent le rectangle ; le serveur écrit `pmtiles/<nom>.pmtiles`.

**Script** (emprise Loire codée en dur) — ou CLI :

```bash
python scripts/build_loire_pmtiles.py --min-zoom 9 --max-zoom 15 -o pmtiles/ma-region.pmtiles --force
```

**CLI manuel** (bbox libre sans modifier le script) :

```bash
pmtiles/tools/pmtiles.exe extract https://build.protomaps.com/YYYYMMDD.pmtiles pmtiles/ma-region.pmtiles ^
  --bbox=OUEST,SUD,EST,NORD --minzoom=9 --maxzoom=15 --download-threads=8
```

Dates récentes : [maps.protomaps.com/builds](https://maps.protomaps.com/builds/).

### 3. Fichier > 100 Mo (GitHub)

```bash
python scripts/pack_large_file.py pmtiles/ma-region.pmtiles
```

Génère `ma-region.pmtiles.part001`, … et `ma-region.pmtiles.manifest.json`. Versionnez les morceaux et le manifeste (pas le `.pmtiles` complet). Restauration :

```bash
python scripts/unpack_large_file.py pmtiles/ma-region.pmtiles.manifest.json
```

### 4. Utiliser l’archive

Déposez le `.pmtiles` dans `pmtiles/` (ou laissez l’extraction carte l’y écrire) puis rechargez la page. Le menu **Fond de carte** le liste via `GET /api/files`. L’emprise et le zoom minimal viennent de l’en-tête : il n’y a plus d’URL ni de bbox à coder dans `index.html`.

`start.bat` reconstitue toujours `loire.pmtiles` s’il manque. Les calques GeoJSON, le DFCI et l’altitude restent ceux de la Loire : pour une autre région, il faut encore préparer ces données à part.

`.gitignore` ignore déjà `pmtiles/*.pmtiles`. Versionnez les morceaux et le manifeste, pas l’archive complète.

---

## Regénérer `loire.pmtiles` (zoom 15)

Le fond est extrait du **build quotidien Protomaps** (basemap OSM v4) pour l’emprise **45,0°–46,5° N**, **3,5°–5,0° E** — identique à `pmtiles/loire.json`.

> **Note :** le build Protomaps actuel couvre les niveaux **0 à 15** (pas de tuiles z16). C’est le maximum disponible pour ce fond vectoriel.

**Prérequis :** connexion Internet, `pmtiles/tools/pmtiles.exe` (go-pmtiles).

```bash
python scripts/build_loire_pmtiles.py --force
```

Le script détecte automatiquement le dernier build disponible sur `build.protomaps.com`, télécharge les tuiles nécessaires (~260 Mo, quelques minutes) et écrit `pmtiles/loire.pmtiles`.

Options utiles :

```bash
python scripts/build_loire_pmtiles.py --build-url https://build.protomaps.com/20260629.pmtiles
python scripts/build_loire_pmtiles.py --max-zoom 15 --min-zoom 9
```

Équivalent manuel avec le CLI :

```bash
pmtiles/tools/pmtiles.exe extract https://build.protomaps.com/YYYYMMDD.pmtiles pmtiles/loire.pmtiles ^
  --bbox=3.5,45.0,5.0,46.5 --minzoom=9 --maxzoom=15 --download-threads=8
```

Remplacez `YYYYMMDD` par une date récente listée sur [maps.protomaps.com/builds](https://maps.protomaps.com/builds/).

---

## Découper pour GitHub (mise à jour des morceaux)

Une fois `loire.pmtiles` généré en local :

```bash
python scripts/pack_large_file.py
```

Par défaut, le script découpe `pmtiles/loire.pmtiles` en morceaux de **70 Mo** maximum, supprime les anciens `.part*` et régénère le manifeste.

Puis versionnez les nouveaux morceaux et le manifeste (pas le `.pmtiles` complet) :

```bash
git add pmtiles/loire.pmtiles.part* pmtiles/loire.pmtiles.manifest.json
```

---

## Dépannage

| Problème | Piste |
|----------|-------|
| `Morceau manquant` | Vérifiez que tous les fichiers `.part00X` listés dans le manifeste sont présents (clone incomplet ?). |
| `Contrôle d'intégrité SHA-256 échoué` | Un morceau est corrompu ou tronqué ; retéléchargez depuis le dépôt ou regénérez avec `pack_large_file.py`. |
| `existe déjà` | Utilisez `--force` ou supprimez l’ancien `loire.pmtiles` avant de relancer. |
| Fond gris, protocole `file://` | Ouvrez **http://localhost:8000/** — lancez `start.bat` ou `python serve.py`. |
| Fond gris, `python -m http.server` | Fermez ce serveur ; utilisez `serve.py` (HTTP Range requis). |
| Fond gris, bon serveur Cartoff | Vérifiez `levelDiff: 0` dans `index.html` ; confirmez que `loire.pmtiles` existe (`unpack_large_file.py`). |
| Message « HTTP Range requis » | Le serveur ne renvoie pas 206 ; utilisez `serve.py` ou `start.bat`. |
| Zoom trop faible (fond gris) | Les tuiles détaillées commencent au zoom **9** ; la carte ne descend pas en dessous. |
| Port 8000 occupé | `start.bat` tue les processus sur ce port ; sinon `netstat -ano \| findstr :8000`. |

---

## Note sur la compression

Une compression gzip du PMTiles n’apporte pas de gain (le format est déjà optimisé). Seul le **découpage** permet de rester sous la limite GitHub.
