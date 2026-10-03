# Cartoff

## Comprendre le terrain, décider plus vite.

![Solution de cartographie Cartoff](images/Solution_de_cartographie_Cartoff.png)

**Cartoff** est une cartographie open source pour la **gestion de crise**, prévue pour tourner **hors ligne** une fois les données préparées.

Ce dépôt réunit deux projets :

| Projet d’origine | Ce qu’il apporte ici |
|------------------|----------------------|
| [F4EED/cartoff](https://github.com/F4EED/cartoff) | La carte opérationnelle : calques du département de la Loire (42), coordonnées, DFCI, altitude, constats, missions SAR, imports locaux. |
| [F4EED/pmtiles](https://github.com/F4EED/pmtiles) | Le chargement des archives PMTiles et leur usage : liste des fonds, lecture de l’en-tête, HTTP Range, extraction d’une zone en quatre clics, aperçu France pour choisir l’emprise. |

Le fond opérationnel par défaut reste **la Loire** (`loire.pmtiles`), avec les calques OSM, le DFCI et l’altitude Copernicus du département 42. Choisir une nouvelle zone ouvre un aperçu de la France. Une fois l’archive extraite, le menu de droite charge les calques OSM, le DFCI et l’altitude Copernicus de cette emprise.

> Pensé pour les environnements dégradés.  
> Après préparation, la carte, les constats et les missions fonctionnent sans réseau.  
> L’extraction d’un nouveau fond, elle, a besoin d’Internet le temps du téléchargement des tuiles.

---

## Pourquoi Cartoff

En situation de crise (inondation, feu, incident industriel), les réseaux tombent souvent. Les décisions, elles, ne peuvent pas attendre.

Cartoff fournit une carte opérationnelle simple, disponible sans Internet, utilisable sur le terrain : zones impactées, routes coupées, points critiques, périmètres, recherche de personnes ou d’aéronef.

Le cas de départ est une **crue de la Loire** : visualiser le secteur, poser des constats (point, tronçon, zone) et continuer à se coordonner une fois la connexion perdue.

---

## Démarrage

```bash
git clone https://github.com/F4EED/Cartoff_V5.git
cd Cartoff_V5
```

Installation locale (Python 3.10+, go-pmtiles, reconstitution de `loire.pmtiles`, contrôle des calques du 42) :

```bat
install.bat
```

```bash
chmod +x install.sh
./install.sh
```

Les deux scripts vérifient les prérequis et les installent s’ils manquent (winget sous Windows, apt/dnf/pacman sous Linux). Une connexion est nécessaire pendant cette étape. Ensuite :

```bat
start.bat
```

```bash
python3 serve.py -p 8000
```

Ouvrir **http://localhost:8000/** dans le navigateur.

Image Docker (`Dockerfile`, Python 3.12) : à la construction, `scripts/unpack_large_file.py` reconstitue `loire.pmtiles`. Le conteneur lance `serve.py` sur le port 8000. L’image embarque la page, les scripts, `css/leaflet.css`, `js/leaflet.js` et les calques `geojson/D42/`.

```bash
docker build -t cartoff .
docker run --rm -p 8000:8000 cartoff
```

La grille d’altitude, le binaire go-pmtiles et les zones déjà extraites restent sur l’hôte (`.dockerignore`). Pour les avoir dans le conteneur, les préparer avec `install.bat` ou `./install.sh`, puis monter `elevation/` et `pmtiles/tools/`.

L’installation télécharge aussi le MNT Copernicus de la Loire (`elevation/loire_elev.bin`, environ 58 Mo). Pour le régénérer seul :

```bash
pip install rasterio numpy shapely
python scripts/build_elevation_loire.py
```

Le binaire **go-pmtiles** (v1.31.2) est téléchargé par le script d’installation. Il sert à **créer** une archive. Consulter `loire.pmtiles` ou une archive déjà présente n’en a pas besoin. S’il manque encore :

```text
https://github.com/protomaps/go-pmtiles/releases/download/v1.31.2/go-pmtiles_1.31.2_Windows_x86_64.zip
```

Le placer dans `pmtiles/tools/pmtiles.exe` (ou `pmtiles/tools/pmtiles` sous Linux / macOS).

Détail de l’altitude : [elevation/README.md](elevation/README.md).

Depuis la carte, le bouton **Documentation** ouvre ce fichier (`docs.html` ; `readme.html` redirige les anciens signets).

### Serveur obligatoire

Une archive PMTiles est un seul fichier, parfois très gros. Le navigateur n’en lit que les plages d’octets des tuiles visibles (HTTP `Range`, réponse **206**). Le serveur standard de Python ne le fait pas : c’est le rôle de `serve.py`.

| Méthode | HTTP Range | Fond de carte |
|---------|------------|---------------|
| `start.bat` ou `python serve.py` | Oui | OK |
| Image Docker (`docker run -p 8000:8000`) | Oui | OK (`loire.pmtiles` reconstitué dans l’image) |
| `python -m http.server` | Non | Fond gris |
| Fichier local (`file://`) | Non | Fond gris |

`serve.py` répond avec l’en-tête `Server: Cartoff/1.0 (PMTiles+Range)`. Avant d’afficher un fond, le client sonde `Range: bytes=0-16383` et exige une réponse 206 avec `Accept-Ranges: bytes`. Sinon un message s’affiche dans la boîte de coordonnées.

---

## Fond de carte

### Au démarrage

Le menu **Fond de carte** est rempli par `GET /api/files` (fichiers `pmtiles/*.pmtiles`, du plus récent au plus ancien). S’il existe, **`loire.pmtiles` est affiché** et la vue reste sur la Loire. Sinon, l’archive la plus récente est chargée et la carte s’ajuste à son emprise.

Pour chaque archive, le client lit l’en-tête PMTiles (emprise, `minZoom`, `maxZoom`) :

- `levelDiff: 0` — sans cela, un extrait dont le zoom minimal est 9 demanderait des tuiles z8 absentes, et le fond resterait gris ;
- `maxDataZoom` pris dans l’en-tête (15 pour le build Protomaps actuel) ;
- la carte peut **surzoomer jusqu’au niveau 18** : le rendu est vectoriel, les tuiles s’arrêtent à 15 ;
- le zoom minimal et le déplacement suivent l’emprise de l’archive affichée.

`loire.pmtiles` (~261 Mo, tuiles 9–15, emprise 45,0°–46,5° N × 3,5°–5,0° E) dépasse la limite GitHub. Il est livré en morceaux (`loire.pmtiles.part00N` + manifeste SHA-256) et reconstitué par `scripts/unpack_large_file.py`. Détail : [pmtiles/README.md](pmtiles/README.md).

### Choisir une nouvelle zone

1. **Sélectionner une zone.** La carte quitte l’emprise du fond local. Elle affiche la France : réseau routier Protomaps (le chevelu) et les villes principales (préfectures dès l’aperçu, sous-préfectures en zoomant). Les contours de départements restent en surimpression.
2. Quatre clics délimitent le secteur. L’ordre est sans importance : les sommets sont réordonnés.
3. Donner un nom et une plage de zooms, puis **Extraire**.
4. L’avancement s’affiche dans le panneau. À la fin, le nouveau fichier est proposé dans le menu et affiché. Les calques OSM (communes, urgence, santé, services, toponymie) et le carroyage DFCI de la même emprise sont écrits dans `geojson/zones/<nom>/`. Cette interrogation Overpass a lieu une fois, pendant l’extraction. Ensuite, choisir ce fond relit ces fichiers. L’altitude Copernicus de la même emprise est écrite dans `elevation/zones/<nom>/`. Le menu et l’altitude suivent l’archive. Revenir sur `loire` restaure les calques et la grille de la Loire.
5. **Annuler** (ou Échap dans la fenêtre) revient au fond et à la vue précédents.

Hors ligne, ou si le relais vers Protomaps échoue, l’aperçu retombe sur un atlas : départements en aplat et les mêmes villes. On peut encore dessiner la zone ; l’extraction, elle, a besoin du réseau.

Le chevelu n’est pas téléchargé en entier. Le navigateur demande de petites plages d’octets à `GET /pmtiles/overview.pmtiles`. Le serveur les relaie vers le dernier build quotidien Protomaps (`build.protomaps.com`), parce que ce CDN ne renvoie pas d’en-tête CORS lisible depuis `localhost`.

Compter quelques minutes et de l’ordre de 20 à 200 Mo pour un département aux zooms 9–15. Une seule extraction à la fois. La zone est bornée à **12° de côté**. Les zooms de tuiles vont de 0 à **15**.

Les calques OSM, le DFCI et l’altitude Copernicus suivent la zone extraite (`geojson/zones/<nom>/`, `elevation/zones/<nom>/`). Les calques légers partagent une requête Overpass. Si l’emprise est refusée, elle est coupée en quatre, jusqu’à deux fois. Le carroyage DFCI 2 km est omis au-delà de 8 000 mailles ; les grilles 100 km et 20 km restent. Changer de fond ensuite ne rappelle pas Overpass. L’altitude est lue une fois par archive, puis la souris interroge la grille déjà en mémoire.

### Fichiers et routes

| Chemin | Rôle |
|--------|------|
| `index.html` | Balisage de la page : menus, panneaux, balises de script |
| `css/leaflet.css`, `js/leaflet.js` | Leaflet 1.9.4, une seule copie, sans fichiers `.map` |
| `css/cartoff.css` | Style de l’interface |
| `js/cartoff-app.js` | Carte, calques, constats, recherche, menus |
| `Dockerfile` | Image Python 3.12 : copie l’application, reconstitue `loire.pmtiles`, lance `serve.py` |
| `js/basemap.js` | Liste, sonde Range, lit l’en-tête, affiche le fond (`levelDiff: 0`), suspend la vue locale pendant la sélection |
| `js/zone-overview.js` | Aperçu France (chevelu + villes, atlas en secours) |
| `js/zone-extract.js` | Quatre clics, fenêtre, suivi du job |
| `extract.py` | Validation, un job à la fois, appel de go-pmtiles, archives produites dans `pmtiles/` |
| `zone_layers.py` | Après une extraction réussie : calques OSM (Overpass groupé, emprise découpée si elle est trop lourde) et carroyage DFCI |
| `elevation_grid.py` | Grille Copernicus DEM de la Loire à l’installation, et de la zone à l’extraction |
| `serve.py` | Fichiers statiques, HTTP Range, API JSON |
| `js/jspdf.umd.min.js`, `js/jspdf.plugin.autotable.min.js` | Export PDF de mission, sans CDN |
| `data/france-departements.geojson` | Contours des départements (aperçu de sélection) |
| `data/france-villes.geojson` | Villes principales de France (aperçu de sélection) |
| `pmtiles/tools/pmtiles.exe` | CLI go-pmtiles — absente du clone si non téléchargée |
| `pmtiles/*.pmtiles` | Archives — `loire.pmtiles` est reconstitué, les extraits sont produits sur place |

| Route | Rôle |
|-------|------|
| `GET /api/files` | Archives disponibles |
| `POST /api/extract` | Lance une extraction (202 + identifiant de job) |
| `GET /api/jobs/<id>` | Avancement |
| `GET /api/download/<nom>.pmtiles` | Téléchargement du résultat |
| `GET /api/layers/<nom>` | Manifeste OSM et DFCI d’une zone extraite (`loire` ou inconnu : calques du 42) |
| `GET /pmtiles/overview.pmtiles` | Relais Range vers le build Protomaps (aperçu France, réseau) |
| `GET /pmtiles/<nom>.pmtiles` | Archive locale, avec `Range` |

```
  Navigateur                         Serveur Python
  index.html · css/cartoff.css
  js/cartoff-app.js                  serve.py
  Leaflet · PMTiles · Protomaps · jsPDF
        |                                  |
        |  GET /pmtiles/*.pmtiles (Range)  |
        |  GET /api/files                  |
        |--------------------------------->|  fichiers locaux
        |                                  |
        |  Sélection d'une zone            |
        |  GET /pmtiles/overview.pmtiles   |
        |--------------------------------->|  relais Range
        |                                  |       |
        |                                  |       v
        |                                  |  build.protomaps.com
        |                                  |
        |  POST /api/extract               |
        |  GET  /api/jobs/<id>             |
        |--------------------------------->|  extract.py
        |                                  |       |
        |                                  |       v
        |                                  |  pmtiles/tools/pmtiles.exe
        |                                  |  (tuiles de la zone seulement)
        |                                  |  zone_layers.py
        |                                  |  (OSM + DFCI, réseau Overpass)
        |                                  |  elevation_grid.py
        |                                  |  (Copernicus DEM)
        |                                  v
        |                            pmtiles/<nom>.pmtiles
        |                            geojson/zones/<nom>/
```

Les jobs vivent en mémoire : redémarrer le serveur efface l’historique. Les fichiers produits restent dans `pmtiles/`. Il n’y a pas d’authentification : le serveur est prévu pour un poste ou un réseau de confiance (`0.0.0.0`, port 8000).

---

## Carte opérationnelle

Ces fonctions viennent de Cartoff. Au démarrage elles portent sur le **département 42**. Après l’extraction d’une zone, les mêmes cases du menu lisent les fichiers OSM et DFCI produits pour cette emprise.

### Coordonnées

Boîte au survol : WGS84, UTM, code **DFCI**, commune, altitude (MNT Copernicus de la Loire, ou de la zone extraite).

### Calques GeoJSON (OSM)

Calques thématiques du 42 : urgence, santé, aviation, toponymie, communes, zones industrielles et d’habitation, etc. **Chargement à la demande** (un calque n’est lu que lorsqu’il est coché). Rendu **canvas** pour les calques lourds. Provenance : [sources.md](sources.md).

### Carroyage DFCI

Grilles **2 km**, **20 km** et **100 km**, découpées sur le département. Le calque 2 km (~5 000 mailles) est marqué lourd et n’apparaît qu’à partir du zoom 11. **Recherche par code DFCI** (ex. `HF26H4`, `HF`) dans la section Recherche.

### Constats / événements

| Géométrie | Saisie | Exemples |
|-----------|--------|----------|
| Point (panneau) | Clic droit | Accident, route barrée, incendie |
| Tronçon (ligne) | Clic droit, clics, **Terminer** | Route inondée, déviation |
| Zone (polygone) | Clic droit, clics, **Terminer** | Zone inondée, périmètre |

Menu contextuel pour ajouter, modifier, activer/désactiver ou supprimer. **Échap** annule un dessin en cours. Types dans `js/poi-types.js`. Persistance `localStorage` (`cartoff_situation_constats`) et **export GeoJSON**. Le calque se charge quand on coche « Constats / événements ».

### Missions SAR

Guide opérationnel : **[SAR.md](SAR.md)**.

**Personne** — points (dernière position connue, indice, repère), polyligne (axe probable), polygone (zone fouillée).

**Aéronef** — station DF (marqueur orange) et relèvement : azimut 0–360°, portée en km (défaut 30). Un relevé pris à la boussole se choisit en **magnétique** ; la déclinaison Est (environ 2 à 3° en France, modifiable) est ajoutée pour obtenir l’azimut vrai utilisé par la carte et l’intersection. La carte trace la ligne de réception (pleine) et la réciproque (pointillée, +180°), avec aperçu pendant la saisie. L’export PDF de mission utilise jsPDF embarqué dans `js/`, sans CDN.

**Intersection** — à partir de deux stations distinctes, calcul des fixes estimés (le meilleur est marqué), cercle d’incertitude (défaut 2 km), liste de visibilité, rapport texte ou GeoJSON.

Persistance `localStorage` (`cartoff_sar_missions`). Propriétés GeoJSON : `sar:mission_id`, `sar:role`, `sar:mission_type`, et pour les fixes `sar:fix_index`, `sar:fix_is_best`, `sar:fix_color`.

### Import local

Section **Importer données externes** : GeoJSON (`.geojson`, `.json`), KML (conversion dans le navigateur), KMZ (décompression puis KML). Chaque calque a un nom, une case de visibilité, une couleur et un bouton supprimer. Option **Zoomer sur le calque à l'import**.

Persistance `sessionStorage` (~4 Mo) : le rechargement de la page conserve les imports, la fermeture de l’onglet les efface. Pas de KML 3D. Les très gros fichiers ralentissent la carte.

### Recherche

Communes, zones industrielles, sites industriels, zones d’habitation, codes DFCI (si un calque DFCI est coché), constats (si le calque situation est coché).

### Affichage

Calques en chargement différé, canvas pour les polygones denses, simplification géométrique sur les gros calques, coordonnées au survol décalées dans le temps, animations de zoom désactivées. Les calques opérationnels restent au-dessus du fond PMTiles.

---

## Cas d’usage

- Services de secours (pompiers, sécurité civile)
- Collectivités
- ONG et humanitaire
- Cellules de crise
- Équipes terrain sans connectivité
- Préparer, avant le départ, le fond PMTiles d’un autre secteur que la Loire

---

## Versionnement

Semver (`MAJEUR.MINEUR.PATCH`), centralisé dans **`version.json`**.

```json
{
  "version": "5.0.3",
  "commit": "adfe3e5",
  "date": "2026-10-03",
  "build": "2026-10-03"
}
```

| Champ | Rôle |
|-------|------|
| `version` | Numéro affiché dans l’interface |
| `commit` | Hash court du commit Git |
| `date` | Date de la dernière mise à jour de version |
| `build` | Date du dernier bump |

Par défaut, chaque commit **incrémente le patch**. Les sauts **minor** et **major** sont manuels.

La version s’affiche dans `docs.html` (bannière) et dans `index.html` (pied du panneau, `#appVersion`). Les deux pages lisent `version.json` via HTTP.

### Hooks

`.githooks/` appelle `scripts/bump_version.py` :

| Hook | Rôle |
|------|------|
| `pre-commit` | Incrémente le semver, met à jour les dates, `git add version.json` |
| `post-commit` | Écrit le hash du commit dans `version.json`, puis amende une seule fois |

Activation, une fois par clone :

```bash
git config core.hooksPath .githooks
```

Sous Windows, `run-python.sh` cherche `py -3`, puis `python` / `python3`, puis `.git-hook-bin/python.exe`.

### Incrément manuel

```bash
py -3 scripts/bump_version.py
python scripts/bump_version.py
```

| Variable `BUMP` | Depuis `1.2.3` |
|-----------------|----------------|
| absente ou `patch` | `1.2.4` |
| `minor` | `1.3.0` |
| `major` | `2.0.0` |

PowerShell : `$env:BUMP="minor"; py -3 scripts/bump_version.py`

Création initiale sans incrément : `py -3 scripts/bump_version.py --init`

---

## Documentation

| Fichier | Contenu |
|---------|---------|
| [SAR.md](SAR.md) | Guide opérationnel des missions SAR |
| [sources.md](sources.md) | Provenance des données, calques, constats, DFCI |
| [pmtiles/README.md](pmtiles/README.md) | Découpage de `loire.pmtiles`, création d’un fond pour une autre région, fond gris |
| [elevation/README.md](elevation/README.md) | MNT Copernicus |
| [pmtiles/tools/README.md](pmtiles/tools/README.md) | CLI go-pmtiles |

---

## Limites

- Tant qu’aucune zone n’a été extraite, les calques, le DFCI, la recherche communale et l’altitude couvrent la **Loire (42)**. Une zone extraite remplace les calques OSM, le DFCI et l’altitude du menu. Si la grille de la zone manque, l’altitude Loire est utilisée là où elle couvre.
- **Une extraction à la fois.** Zone max **12°** de côté. Tuiles jusqu’au zoom **15**, surzoom d’affichage jusqu’à **18**. Overpass n’est rappelé qu’à cette extraction, ou si l’archive est remplacée.
- Le carroyage DFCI 2 km d’une zone est omis au-delà de **8 000** mailles.
- L’aperçu France et l’extraction demandent Internet. La consultation d’une archive déjà sur le disque, les calques, les constats, les missions et l’export PDF, non.
- La déclinaison proposée est une approximation pour la France (Est positif, époque 2026). Elle se corrige dans le panneau de relèvement.
- Redémarrer `serve.py` oublie les jobs en cours. Les `.pmtiles` déjà écrits restent.
- Pas d’authentification sur le serveur.

---

## Licence et crédits

GNU General Public License v3.0 — [LICENSE](LICENSE). Les bibliothèques embarquées gardent leur licence.

- **Cartoff** — [F4EED/cartoff](https://github.com/F4EED/cartoff) : carte de crise, constats, SAR, calques 42.
- **Chargement et extraction PMTiles** — adaptés de [F4EED/pmtiles](https://github.com/F4EED/pmtiles).
- **Fond** — [Protomaps](https://protomaps.com), données [OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL).
- **Villes de l’aperçu** — [Natural Earth](https://www.naturalearthdata.com/), domaine public.
- **Départements de l’aperçu** — [france-geojson](https://github.com/gregoiredavid/france-geojson), Grégoire David, d’après l’IGN.
- **Altitude** — [Copernicus DEM](https://spacedata.copernicus.eu/).
- **Leaflet** — BSD 2-Clause. **pmtiles.js**, **protomaps-leaflet**, **go-pmtiles** — BSD 3-Clause.
