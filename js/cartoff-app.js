const LOIRE_BOUNDS = L.latLngBounds([45.0, 3.5], [46.5, 5.0]);
const PMTILES_MIN_ZOOM = 9;
/* Dernier niveau de tuiles du build Protomaps. La carte peut surzoomer jusqu'à MAP_MAX_ZOOM. */
const PMTILES_DATA_MAX_ZOOM = 15;
const MAP_MAX_ZOOM = 18;
const COORDS_DEBOUNCE_MS = 250;
const map = L.map('map', {
  minZoom: PMTILES_MIN_ZOOM,
  maxZoom: MAP_MAX_ZOOM,
  zoomAnimation: false,
  fadeAnimation: false,
  markerZoomAnimation: false
});
window.map = map;
map.setView([45.7885, 4.1830], 9);
map.setMaxBounds(LOIRE_BOUNDS.pad(0.05));

map.whenReady(() => {
  map.invalidateSize({ animate: false });
});
map.attributionControl.addAttribution(
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributeurs'
);
map.attributionControl.addAttribution(
  'MNT <a href="https://spacedata.copernicus.eu/" title="Copernicus DEM GLO-30">Copernicus DEM</a>'
);

map.createPane('situationPane');
map.getPane('situationPane').style.zIndex = 610;
map.createPane('operationPane');
map.getPane('operationPane').style.zIndex = 615;
map.createPane('sarPane');
map.getPane('sarPane').style.zIndex = 620;

// Sidebar draggable
const sidebar = document.getElementById('layerMenu');
const dragHandle = document.getElementById('dragHandle');
document.getElementById('openDocBtn').addEventListener('click', () => {
  window.open('docs.html', '_blank', 'noopener');
});
const coordsDiv = document.getElementById('coords');
let communeIndex = [];
let communeSearchEntries = [];
let searchHighlightOverlay = null;
let searchHighlightTimer = null;
const SEARCH_HIGHLIGHT_MS = 4000;
const COMMUNE_LAYER_NAME = 'Contours communes (OSM)';
const ZONES_INDUSTRIELLES_LAYER = 'Zones industrielles (OSM)';
const SITES_INDUSTRIELS_LAYER = 'Sites industriels (OSM)';
const ZONES_HABITATION_LAYER = 'Zones d\'habitation (OSM)';
const SITUATION_LAYER_NAME = 'Constats / événements';
const DFCI_2KM_LAYER_NAME = 'Carroyage DFCI 2 km (42)';
const DFCI_LAYER_NAMES = new Set([
  'Carroyage DFCI 100 km (42)',
  'Carroyage DFCI 20 km (42)',
  DFCI_2KM_LAYER_NAME
]);
const polygonCanvasRenderer = L.canvas({ padding: 0.5 });
const layerSearchSetupDone = new Set();
const DFCI_SEARCH_SPECS = [
  { resolution: 2, file: 'geojson/D42/dfci_2km_42.geojson', layerName: 'Carroyage DFCI 2 km (42)' },
  { resolution: 20, file: 'geojson/D42/dfci_20km_42.geojson', layerName: 'Carroyage DFCI 20 km (42)' },
  { resolution: 100, file: 'geojson/D42/dfci_100km_42.geojson', layerName: 'Carroyage DFCI 100 km (42)' }
];
const DFCI_HIGHLIGHT_STYLE = { color: '#4527a0', weight: 3, fillColor: '#7e57c2', fillOpacity: 0.35 };
let dfciSearchIndex = new Map();
let dfciSearchReady = false;
let dfciSearchLoadPromise = null;
let dfciSearchMsgTimer = null;
const SITUATION_HIGHLIGHT = { color: '#c62828', weight: 3, fillColor: '#ef5350', fillOpacity: 0.55 };
const COMMUNE_HIGHLIGHT_STYLE = { color: '#3949ab', weight: 3, fillColor: '#5c6bc0', fillOpacity: 0.35 };
const ZONES_INDUSTRIELLES_HIGHLIGHT = { color: '#546e7a', weight: 3, fillColor: '#b0bec5', fillOpacity: 0.45 };
const SITES_INDUSTRIELS_HIGHLIGHT = { color: '#4e342e', weight: 3, fillColor: '#8d6e63', fillOpacity: 0.45 };
const ZONES_HABITATION_HIGHLIGHT = { color: '#ef6c00', weight: 3, fillColor: '#ffb74d', fillOpacity: 0.4 };
let lastPointer = null;
let coordsUpdateTimer = null;
let mapIsInteracting = false;
let elevationReady = false;
let elevationToken = 0;
let communeIndexLoadScheduled = false;
let communeLoadToken = 0;
let situationDataLoaded = false;

let elevationFor = '';

function useElevationForBasemap(name) {
  const key = name && name !== 'loire' ? name : 'loire';
  if (key === elevationFor) return;
  elevationFor = key;
  const token = ++elevationToken;
  elevationReady = false;
  const loadLoire = () => CartoffCoords.loadElevationGrid('elevation');
  const pending = key === 'loire'
    ? loadLoire()
    : CartoffCoords.loadElevationGrid('elevation/zones/' + encodeURIComponent(key))
      .then(ok => ok ? true : loadLoire());
  pending.then(ok => {
    if (token !== elevationToken) return;
    elevationReady = ok;
    if (lastPointer && !mapIsInteracting) refreshCoordsFromMap();
  });
}

function ensureElevationLoaded() {
  if (!elevationFor) useElevationForBasemap('loire');
}

window.cartoffUseElevation = useElevationForBasemap;

function scheduleCommuneIndexLoad() {
  if (communeIndexLoadScheduled || communeIndex.length) return;
  communeIndexLoadScheduled = true;
  const token = ++communeLoadToken;
  runWhenIdle(() => {
    if (token !== communeLoadToken) return;
    loadCommuneIndexOnly();
  });
}

function renderCoordsBox(latlng, options) {
  const opts = options || {};
  const lat = latlng.lat;
  const lon = latlng.lng;
  const zoom = map.getZoom();
  const utm = CartoffCoords.latLngToUtm(lat, lon);
  const dfci = CartoffCoords.latLngToDfci(lat, lon);
  const commune = CartoffCoords.findCommune(lat, lon, communeIndex);
  const communeLabel = commune || (communeIndex.length ? 'Hors commune' : 'Communes…');
  const dfciLabel = dfci.base;
  let altLabel = '…';
  if (!opts.skipAltitude) {
    const alt = CartoffCoords.getElevation(lat, lon);
    altLabel = alt !== null ? `${alt} m` : (elevationReady ? '—' : '…');
  }

  coordsDiv.innerHTML =
    `<div class="coords-commune">${communeLabel}</div>` +
    `<div class="coords-line">Lat ${lat.toFixed(5)} · Lon ${lon.toFixed(5)}</div>` +
    `<div class="coords-line">Zoom ${zoom} · UTM ${utm.zone}${utm.hemisphere} E ${utm.easting} N ${utm.northing}</div>` +
    `<div class="coords-line">DFCI ${dfciLabel} · Alt. ${altLabel}</div>`;
}

function scheduleCoordsUpdate(latlng) {
  lastPointer = latlng;
  scheduleCommuneIndexLoad();
  if (mapIsInteracting) return;
  clearTimeout(coordsUpdateTimer);
  coordsUpdateTimer = setTimeout(() => {
    if (lastPointer && !mapIsInteracting) renderCoordsBox(lastPointer);
  }, COORDS_DEBOUNCE_MS);
}

function refreshCoordsFromMap() {
  if (lastPointer) renderCoordsBox(lastPointer);
}

function runWhenIdle(fn) {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => fn(), { timeout: 2500 });
  } else {
    setTimeout(fn, 150);
  }
}
let isDragging = false, startX, startY;

function isMobileLayout() {
  return window.innerWidth <= 768;
}

function getMapFitPadding() {
  return {
    paddingTopLeft: L.point(10, 10),
    paddingBottomRight: L.point(
      isMobileLayout() ? sidebar.offsetHeight + 16 : coordsDiv.offsetHeight + 16,
      isMobileLayout() ? 10 : sidebar.offsetWidth + 16
    )
  };
}

function activeBasemapBounds() {
  if (window.cartoffZonePicking && window.cartoffFranceBounds) return window.cartoffFranceBounds;
  return (window.cartoffBasemap && window.cartoffBasemap.bounds) || LOIRE_BOUNDS;
}

function activeMinZoom() {
  if (window.cartoffZonePicking) return 5;
  const zoom = window.cartoffBasemap && window.cartoffBasemap.minZoom;
  return zoom == null ? PMTILES_MIN_ZOOM : zoom;
}

function fitMapToArea() {
  map.invalidateSize({ animate: false });
  const size = map.getSize();
  if (!size || size.x < 50 || size.y < 50) return;
  const bounds = activeBasemapBounds();
  map.fitBounds(bounds, {
    ...getMapFitPadding(),
    maxZoom: PMTILES_DATA_MAX_ZOOM,
    animate: false
  });
  if (map.getZoom() < activeMinZoom()) {
    map.setView(bounds.getCenter(), activeMinZoom());
  }
}

function applySidebarLayout() {
  if (isMobileLayout()) {
    sidebar.style.left = '';
    sidebar.style.top = '';
    sidebar.style.right = '';
    sidebar.style.bottom = '';
  } else {
    const savedX = localStorage.getItem('sidebarX');
    const savedY = localStorage.getItem('sidebarY');
    if (savedX && savedY) {
      sidebar.style.right = 'auto';
      sidebar.style.left = savedX + 'px';
      sidebar.style.top = savedY + 'px';
      const pos = clampSidebarPosition();
      if (pos) {
        localStorage.setItem('sidebarX', pos.x);
        localStorage.setItem('sidebarY', pos.y);
      }
    }
  }
}

function clampSidebarPosition() {
  if (isMobileLayout()) return null;
  let x = sidebar.offsetLeft;
  let y = sidebar.offsetTop;
  x = Math.min(Math.max(0, x), window.innerWidth - sidebar.offsetWidth);
  y = Math.min(Math.max(0, y), window.innerHeight - sidebar.offsetHeight);
  sidebar.style.left = x + 'px';
  sidebar.style.top = y + 'px';
  sidebar.style.right = 'auto';
  sidebar.style.bottom = 'auto';
  return { x, y };
}

function applyResponsiveLayout(options) {
  applySidebarLayout();
  map.invalidateSize({ animate: false });
  if (!(options && options.skipFit)) fitMapToArea();
}

applyResponsiveLayout({ skipFit: true });

function startDrag(clientX, clientY) {
  if (isMobileLayout()) return;
  isDragging = true;
  startX = clientX - sidebar.offsetLeft;
  startY = clientY - sidebar.offsetTop;
  dragHandle.style.cursor = 'grabbing';
}

function moveDrag(clientX, clientY) {
  if (!isDragging || isMobileLayout()) return;
  let x = clientX - startX;
  let y = clientY - startY;
  x = Math.min(Math.max(0, x), window.innerWidth - sidebar.offsetWidth);
  y = Math.min(Math.max(0, y), window.innerHeight - sidebar.offsetHeight);
  sidebar.style.left = x + 'px';
  sidebar.style.top = y + 'px';
  sidebar.style.right = 'auto';
  sidebar.style.bottom = 'auto';
  localStorage.setItem('sidebarX', x);
  localStorage.setItem('sidebarY', y);
}

function endDrag() {
  if (!isDragging) return;
  isDragging = false;
  dragHandle.style.cursor = 'grab';
  if (!isMobileLayout()) fitMapToArea();
}

dragHandle.addEventListener('mousedown', e => {
  startDrag(e.clientX, e.clientY);
  e.preventDefault();
});
dragHandle.addEventListener('touchstart', e => {
  const touch = e.touches[0];
  startDrag(touch.clientX, touch.clientY);
}, { passive: true });
document.addEventListener('mousemove', e => moveDrag(e.clientX, e.clientY));
document.addEventListener('touchmove', e => {
  if (!isDragging) return;
  const touch = e.touches[0];
  moveDrag(touch.clientX, touch.clientY);
}, { passive: true });
document.addEventListener('mouseup', endDrag);
document.addEventListener('touchend', endDrag);

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(applyResponsiveLayout, 150);
});
window.addEventListener('orientationchange', () => {
  setTimeout(applyResponsiveLayout, 200);
});

map.whenReady(() => {
  lastPointer = map.getCenter();
  ensureElevationLoaded();
  refreshCoordsFromMap();
});

function updateCoords(latlng) {
  scheduleCoordsUpdate(latlng);
}

map.on('mousemove', e => updateCoords(e.latlng));
map.on('touchmove', e => { if (e.latlng) updateCoords(e.latlng); });
map.on('movestart zoomstart', () => { mapIsInteracting = true; });
map.on('moveend zoomend', () => {
  mapIsInteracting = false;
  if (lastPointer) renderCoordsBox(lastPointer);
});

// Icônes personnalisées
const icons = {
  "Casernes sapeurs-pompiers (OSM)": L.divIcon({
    className: 'osm-fire-marker',
    html: '<div></div>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    popupAnchor: [0, -6]
  }),
  "Police nationale (OSM)": L.divIcon({
    className: 'osm-police-marker',
    html: '<div></div>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    popupAnchor: [0, -6]
  }),
  "Aérodromes (OSM)": L.divIcon({
    className: 'osm-aerodrome-marker',
    html: '<div></div>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    popupAnchor: [0, -6]
  }),
  "Héliports (OSM)": L.divIcon({
    className: 'osm-helipad-marker',
    html: '<div></div>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    popupAnchor: [0, -6]
  }),
  "Hôpitaux (OSM)": L.divIcon({
    className: 'osm-marker-hospital osm-square-marker',
    html: '<div></div>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    popupAnchor: [0, -6]
  }),
  "Cliniques (OSM)": L.divIcon({
    className: 'osm-marker-clinic osm-square-marker',
    html: '<div></div>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    popupAnchor: [0, -6]
  }),
  "Pharmacies (OSM)": L.divIcon({
    className: 'osm-marker-pharmacy osm-square-marker',
    html: '<div></div>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    popupAnchor: [0, -6]
  }),
  "Mairies (OSM)": L.divIcon({
    className: 'osm-marker-mairie osm-square-marker',
    html: '<div></div>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    popupAnchor: [0, -6]
  }),
  "Gendarmerie (OSM)": L.divIcon({
    className: 'osm-marker-gendarmerie osm-square-marker',
    html: '<div></div>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    popupAnchor: [0, -6]
  }),
  "Toponymes (OSM)": L.divIcon({
    className: 'osm-marker-toponyme osm-square-marker',
    html: '<div></div>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    popupAnchor: [0, -6]
  }),
  "Lieux-dits (OSM)": L.divIcon({
    className: 'osm-marker-lieuxdits osm-square-marker',
    html: '<div></div>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    popupAnchor: [0, -6]
  }),
  "Points de rassemblement (OSM)": L.divIcon({
    className: 'osm-marker-assembly osm-square-marker',
    html: '<div></div>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    popupAnchor: [0, -6]
  }),
  "Bouches à incendie (OSM)": L.divIcon({
    className: 'osm-marker-hydrant osm-square-marker',
    html: '<div></div>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    popupAnchor: [0, -6]
  }),
  "Centres communaux (OSM)": L.divIcon({
    className: 'osm-marker-community osm-square-marker',
    html: '<div></div>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    popupAnchor: [0, -6]
  }),
  "Écoles (OSM)": L.divIcon({
    className: 'osm-marker-school osm-square-marker',
    html: '<div></div>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    popupAnchor: [0, -6]
  }),
  "Abris (OSM)": L.divIcon({
    className: 'osm-marker-shelter osm-square-marker',
    html: '<div></div>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    popupAnchor: [0, -6]
  }),
  "Sites industriels (OSM)": L.divIcon({
    className: 'osm-marker-works osm-square-marker',
    html: '<div></div>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    popupAnchor: [0, -6]
  }),
  "Puits / mines (OSM)": L.divIcon({
    className: 'osm-marker-mineshaft osm-square-marker',
    html: '<div></div>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    popupAnchor: [0, -6]
  }),
  "Déchèteries (OSM)": L.divIcon({
    className: 'osm-marker-decheterie osm-square-marker',
    html: '<div></div>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    popupAnchor: [0, -6]
  }),
  "Antennes / relais (OSM)": L.divIcon({
    className: 'osm-marker-antenne osm-square-marker',
    html: '<div></div>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    popupAnchor: [0, -6]
  }),
  "Services publics (OSM)": L.divIcon({
    className: 'osm-marker-government osm-square-marker',
    html: '<div></div>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    popupAnchor: [0, -6]
  }),
  "Ets_SEVESO": L.icon({iconUrl:'images/SEVEZO.png', iconSize:[32,32], iconAnchor:[16,32], popupAnchor:[0,-32]}),
  "PR_Routier": L.icon({iconUrl:'images/PR.png', iconSize:[32,32], iconAnchor:[16,32], popupAnchor:[0,-32]})
};
const situationIconCache = {};
let situationLegendEntries = [];
let situationFeatures = [];
const SITUATION_STORAGE_KEY = 'cartoff_situation_constats';
const SITUATION_META_KEY = 'cartoff_situation_meta';
let situationPanelState = null;
let drawState = null;
let mapContextMenuState = null;
/** Position figée du dernier clic droit carte (secours Relevé DF). */
let lastRightClickLatLng = null;
let situationShowInactifs = false;
const situationLineDrawBanner = document.getElementById('situationLineDrawBanner');
const squareLegendLayers = {
  "Casernes sapeurs-pompiers (OSM)": "red",
  "Police nationale (OSM)": "blue",
  "Aérodromes (OSM)": "green",
  "Héliports (OSM)": "orange",
  "Hôpitaux (OSM)": "hospital",
  "Cliniques (OSM)": "clinic",
  "Pharmacies (OSM)": "pharmacy",
  "Mairies (OSM)": "mairie",
  "Gendarmerie (OSM)": "gendarmerie",
  "Toponymes (OSM)": "toponyme",
  "Lieux-dits (OSM)": "lieuxdits",
  "Points de rassemblement (OSM)": "assembly",
  "Bouches à incendie (OSM)": "hydrant",
  "Centres communaux (OSM)": "community",
  "Écoles (OSM)": "school",
  "Abris (OSM)": "shelter",
  "Sites industriels (OSM)": "works",
  "Puits / mines (OSM)": "mineshaft",
  "Carrières (OSM)": "quarry",
  "Déchèteries (OSM)": "decheterie",
  "Décharges (OSM)": "landfill",
  "Cimetières (OSM)": "cemetery",
  "Antennes / relais (OSM)": "antenne",
  "Administrations (OSM)": "government"
};

// GeoJSON
const geojsonFiles = {
  "departement":[
    { name:"Contours communes (OSM)", file:"geojson/D42/communes_contours_osm_42.geojson", style:{color:"#3949ab",weight:2,fillColor:"#3949ab",fillOpacity:0.08} },
    { name:"Zones industrielles (OSM)", file:"geojson/D42/zones_industrielles_osm_42.json", style:{color:"#78909c",weight:2,fillColor:"#78909c",fillOpacity:0.15} },
    { name:"Sites industriels (OSM)", file:"geojson/D42/sites_industriels_osm_42.json", style:{color:"#5d4037",weight:2,fillColor:"#5d4037",fillOpacity:0.2} },
    { name:"Zones d'habitation (OSM)", file:"geojson/D42/zones_habitation_osm_42.json", style:{color:"#ff8f00",weight:2,fillColor:"#ff8f00",fillOpacity:0.12} }
  ],
  "aviation":[
    { name:"Aérodromes (OSM)", file:"geojson/D42/aerodromes_osm_42.geojson", style:{color:"#388e3c",weight:2} },
    { name:"Héliports (OSM)", file:"geojson/D42/helipads_osm_42.geojson", style:{color:"#f57c00",weight:2} }
  ],
  "urgence":[
    { name:"Carroyage DFCI 100 km (42)", file:"geojson/D42/dfci_100km_42.geojson", style:{color:"#4527a0",weight:3,fill:false,fillOpacity:0} },
    { name:"Carroyage DFCI 20 km (42)", file:"geojson/D42/dfci_20km_42.geojson", style:{color:"#bf360c",weight:2,fill:false,fillOpacity:0} },
    { name:"Carroyage DFCI 2 km (42)", file:"geojson/D42/dfci_2km_42.geojson", style:{color:"#ff7043",weight:1,fill:false,fillOpacity:0} },
    { name:"Points de rassemblement (OSM)", file:"geojson/D42/points_rassemblement_osm_42.json", style:{color:"#e64a19",weight:2} },
    { name:"Bouches à incendie (OSM)", file:"geojson/D42/bouches_incendie_osm_42.json", style:{color:"#ff6f00",weight:2} },
    { name:"Abris (OSM)", file:"geojson/D42/abris_osm_42.json", style:{color:"#689f38",weight:2} }
  ],
  "sante":[
    { name:"Hôpitaux (OSM)", file:"geojson/D42/hopitaux_osm_42.geojson", style:{color:"#c2185b",weight:2} },
    { name:"Cliniques (OSM)", file:"geojson/D42/cliniques_osm_42.geojson", style:{color:"#0097a7",weight:2} },
    { name:"Pharmacies (OSM)", file:"geojson/D42/pharmacies_osm_42.geojson", style:{color:"#827717",weight:2} }
  ],
  "services":[
    { name:"Mairies (OSM)", file:"geojson/D42/Maire42.json", style:{color:"#8d6e63",weight:2} },
    { name:"Gendarmerie (OSM)", file:"geojson/D42/gendarmerie 42.json", style:{color:"#455a64",weight:2} },
    { name:"Casernes sapeurs-pompiers (OSM)", file:"geojson/D42/casernes_osm_42.geojson", style:{color:"red",weight:2} },
    { name:"Police nationale (OSM)", file:"geojson/D42/police_nationale_osm_42.geojson", style:{color:"#003399",weight:2} },
    { name:"Cimetières (OSM)", file:"geojson/D42/cimetieres_osm_42.json", style:{color:"#757575",weight:2,fillColor:"#bdbdbd",fillOpacity:0.25} },
    { name:"Administrations (OSM)", file:"geojson/D42/services_publics_osm_42.json", style:{color:"#1565c0",weight:2} },
    { name:"Déchèteries (OSM)", file:"geojson/D42/decheteries_osm_42.json", style:{color:"#33691e",weight:2} },
    { name:"Décharges (OSM)", file:"geojson/D42/decharges_osm_42.json", style:{color:"#558b2f",weight:2,fillColor:"#558b2f",fillOpacity:0.2} },
    { name:"Centres communaux (OSM)", file:"geojson/D42/centres_communaux_osm_42.json", style:{color:"#8e24aa",weight:2} },
    { name:"Écoles (OSM)", file:"geojson/D42/ecoles_osm_42.json", style:{color:"#039be5",weight:2} }
  ],
  "toponymie":[
    { name:"Toponymes (OSM)", file:"geojson/D42/toponymes_osm_42.json", style:{color:"#a1887f",weight:2} },
    { name:"Lieux-dits (OSM)", file:"geojson/D42/lieux_dits_osm_42.json", style:{color:"#bcaaa4",weight:2} }
  ],
  "contexte":[
    { name:"Puits / mines (OSM)", file:"geojson/D42/puits_mines_osm_42.json", style:{color:"#6d4c41",weight:2} },
    { name:"Carrières (OSM)", file:"geojson/D42/carrieres_osm_42.json", style:{color:"#8d6e63",weight:2,fillColor:"#8d6e63",fillOpacity:0.2} },
    { name:"Antennes / relais (OSM)", file:"geojson/D42/antennes_osm_42.json", style:{color:"#00838f",weight:2} }
  ]
};

const layers = {};
const layerStyles = {}; // pour mémoriser les styles des calques
const legendDiv = document.getElementById("legend");

function isSituationInactif(props) {
  return !!(props && props.statut === 'inactif');
}

function isLocallyCreatedSituationFeature(feature) {
  const props = feature && feature.properties;
  return !!(props && props.created_by === 'terrain');
}

function clearSituationStorage() {
  localStorage.removeItem(SITUATION_STORAGE_KEY);
  localStorage.removeItem(SITUATION_META_KEY);
}

function readSituationMeta() {
  try {
    const raw = localStorage.getItem(SITUATION_META_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.warn('Métadonnées constats invalides :', err);
    return null;
  }
}

function writeSituationMeta(fileFeatureCount) {
  localStorage.setItem(SITUATION_META_KEY, JSON.stringify({
    fileFeatureCount,
    syncedAt: new Date().toISOString()
  }));
}

function updateSituationInactifsFilterUI() {
  const label = document.getElementById('situationShowInactifsLabel');
  const checkbox = document.getElementById('situationShowInactifs');
  if (!label || !checkbox) return;
  const hasInactifs = situationFeatures.some((f) => isSituationInactif(f.properties));
  const showFilter = situationFeatures.length > 0 && hasInactifs;
  label.hidden = !showFilter;
  if (!showFilter && checkbox.checked) {
    checkbox.checked = false;
    situationShowInactifs = false;
  }
}

function situationStatutLabel(props) {
  return isSituationInactif(props) ? 'Inactif' : 'Actif';
}

function getSituationFeaturesForDisplay() {
  if (situationShowInactifs) return situationFeatures;
  return situationFeatures.filter((f) => !isSituationInactif(f.properties));
}

function getSituationIcon(imagePath, inactif) {
  const resolved = imagePath || CartoffPoi.DEFAULT_IMAGE;
  const iconUrl = encodeURI(resolved);
  const cacheKey = iconUrl + (inactif ? '|inactif' : '');
  if (!situationIconCache[cacheKey]) {
    situationIconCache[cacheKey] = L.icon({
      iconUrl: iconUrl,
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -32],
      className: inactif ? 'situation-marker-inactif' : ''
    });
  }
  return situationIconCache[cacheKey];
}

function buildSituationPopupContent(props) {
  const type = CartoffPoi.getType(props.sous_type);
  const typeLabel = (type && type.label) || props.sous_type || 'Constat';
  const libelle = props.libelle || typeLabel;
  let html = `<b>${libelle}</b><br>`;
  html += `<b>Type :</b> ${typeLabel}<br>`;
  html += `<b>Statut :</b> ${situationStatutLabel(props)}<br>`;
  if (props.commune) html += `<b>Commune :</b> ${props.commune}<br>`;
  if (props.dfci) html += `<b>DFCI :</b> ${props.dfci}<br>`;
  if (props.description) html += `<b>Description :</b> ${props.description}<br>`;
  return html;
}

function situationLegendLabel(props) {
  const type = CartoffPoi.getType(props.sous_type);
  const base = (type && type.label) || props.sous_type || 'Constat';
  const variante = props.variante;
  if (variante) {
    const suffix = (CartoffPoi.VARIANT_LABELS && CartoffPoi.VARIANT_LABELS[variante]) || variante;
    return `${base} (${suffix})`;
  }
  return base;
}

function collectSituationLegendEntries(features) {
  if (!features || !features.length) return [];
  const seen = new Map();
  features.forEach((feature) => {
    const props = feature.properties || {};
    const imagePath = CartoffPoi.resolveImagePath(props);
    const key = [props.sous_type || '', props.panneau || '', props.variante || '', imagePath].join('|');
    if (seen.has(key)) return;
    seen.set(key, { imagePath, label: situationLegendLabel(props) });
  });
  return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label, 'fr'));
}

function panneauBasenameFromType(typeId) {
  const path = CartoffPoi.resolveImagePath({ sous_type: typeId });
  const base = path.replace(/^images\//, '').split('/').pop();
  return base || 'panneau_vierge_à_compléter.png';
}

function newSituationId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'sit-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
}

function findSituationFeature(id) {
  return situationFeatures.find(f => f.properties && f.properties.id === id) || null;
}

function buildSituationTypeSelect(selectEl, geometryKind) {
  selectEl.innerHTML = '';
  const types = CartoffPoi.getTypesForGeometry(geometryKind);
  const byCat = {};
  types.forEach((t) => {
    if (!byCat[t.categorie]) byCat[t.categorie] = [];
    byCat[t.categorie].push(t);
  });
  ['secteur_routier', 'incendie_atmosphere', 'autre'].forEach((catId) => {
    const catTypes = byCat[catId];
    if (!catTypes || !catTypes.length) return;
    const og = document.createElement('optgroup');
    og.label = CartoffPoi.CATEGORIES[catId] || catId;
    catTypes.sort((a, b) => a.label.localeCompare(b.label, 'fr')).forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.label;
      og.appendChild(opt);
    });
    selectEl.appendChild(og);
  });
}

function getSituationLineStyle(props) {
  const base = CartoffPoi.getLineStyle(props && props.sous_type);
  const inactif = isSituationInactif(props);
  return {
    ...base,
    opacity: inactif ? 0.45 : 1
  };
}

function getSituationPolygonStyle(props) {
  const base = CartoffPoi.getPolygonStyle(props && props.sous_type);
  const inactif = isSituationInactif(props);
  const fillOpacity = base.fillOpacity != null ? base.fillOpacity : 0.3;
  return {
    ...base,
    opacity: inactif ? 0.45 : 1,
    fillOpacity: inactif ? fillOpacity * 0.45 : fillOpacity
  };
}

function polygonRingToLatLngs(ring) {
  if (!ring || !ring.length) return [];
  const coords = ring.slice();
  if (coords.length > 1) {
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) coords.pop();
  }
  return coords.map((c) => L.latLng(c[1], c[0]));
}

function situationGeomAnchorLatLng(geom) {
  if (!geom) return null;
  if (geom.type === 'Point' && geom.coordinates) {
    return L.latLng(geom.coordinates[1], geom.coordinates[0]);
  }
  if (geom.type === 'LineString' && geom.coordinates && geom.coordinates.length) {
    const c = geom.coordinates[0];
    return L.latLng(c[1], c[0]);
  }
  if (geom.type === 'Polygon' && geom.coordinates && geom.coordinates[0]) {
    const latlngs = polygonRingToLatLngs(geom.coordinates[0]);
    if (!latlngs.length) return null;
    return L.polygon(latlngs).getBounds().getCenter();
  }
  if (geom.type === 'MultiPolygon' && geom.coordinates && geom.coordinates[0] && geom.coordinates[0][0]) {
    const latlngs = polygonRingToLatLngs(geom.coordinates[0][0]);
    if (!latlngs.length) return null;
    return L.polygon(latlngs).getBounds().getCenter();
  }
  return null;
}

function bindSituationFeatureContextMenu(layer, feature) {
  const showMenu = (domEvent, clickLatLng) => {
    L.DomEvent.stop(domEvent);
    const geom = feature.geometry || {};
    const isLine = geom.type === 'LineString';
    const isPolygon = geom.type === 'Polygon' || geom.type === 'MultiPolygon';
    let latlng = clickLatLng || (layer.getLatLng ? layer.getLatLng() : null);
    if (!latlng) latlng = situationGeomAnchorLatLng(geom);
    openMapContextMenu(domEvent.clientX, domEvent.clientY, {
      type: isLine ? 'line' : (isPolygon ? 'polygon' : 'marker'),
      feature,
      latlng
    });
  };
  layer.on('contextmenu', (e) => {
    if (e.originalEvent) showMenu(e.originalEvent, e.latlng);
  });
  layer.on('add', () => {
    if (layer._icon) {
      L.DomEvent.on(layer._icon, 'contextmenu', showMenu);
    }
    if (layer._path) {
      L.DomEvent.on(layer._path, 'contextmenu', showMenu);
    }
  });
  layer.on('remove', () => {
    if (layer._icon) {
      L.DomEvent.off(layer._icon, 'contextmenu', showMenu);
    }
    if (layer._path) {
      L.DomEvent.off(layer._path, 'contextmenu', showMenu);
    }
  });
  if (layer._icon) {
    L.DomEvent.on(layer._icon, 'contextmenu', showMenu);
  }
  if (layer._path) {
    L.DomEvent.on(layer._path, 'contextmenu', showMenu);
  }
}

function buildSituationLayerFromFeatures(features) {
  const displayFeatures = features || [];
  const group = L.layerGroup([], { pane: 'situationPane' });

  displayFeatures.forEach((feature) => {
    const props = feature.properties || {};
    const geom = feature.geometry;
    if (!geom) return;

    if (geom.type === 'Point' && geom.coordinates) {
      const latlng = L.latLng(geom.coordinates[1], geom.coordinates[0]);
      const imagePath = CartoffPoi.resolveImagePath(props);
      const marker = L.marker(latlng, {
        icon: getSituationIcon(imagePath, isSituationInactif(props)),
        pane: 'situationPane'
      });
      marker._cartoffSituationFeature = feature;
      marker.bindPopup(buildSituationPopupContent(props));
      bindSituationFeatureContextMenu(marker, feature);
      group.addLayer(marker);
    } else if (geom.type === 'LineString' && geom.coordinates && geom.coordinates.length >= 2) {
      const latlngs = geom.coordinates.map((c) => L.latLng(c[1], c[0]));
      const lineStyle = getSituationLineStyle(props);
      const polyline = L.polyline(latlngs, {
        ...lineStyle,
        pane: 'situationPane'
      });
      polyline._cartoffSituationFeature = feature;
      polyline.bindPopup(buildSituationPopupContent(props));
      bindSituationFeatureContextMenu(polyline, feature);
      group.addLayer(polyline);

      const imagePath = CartoffPoi.resolveImagePath(props);
      const inactif = isSituationInactif(props);
      [latlngs[0], latlngs[latlngs.length - 1]].forEach((ll) => {
        const iconMarker = L.marker(ll, {
          icon: getSituationIcon(imagePath, inactif),
          pane: 'situationPane'
        });
        iconMarker._cartoffSituationFeature = feature;
        iconMarker.bindPopup(buildSituationPopupContent(props));
        bindSituationFeatureContextMenu(iconMarker, feature);
        group.addLayer(iconMarker);
      });
    } else if (geom.type === 'Polygon' && geom.coordinates && geom.coordinates[0] && geom.coordinates[0].length >= 3) {
      const latlngs = polygonRingToLatLngs(geom.coordinates[0]);
      const polyStyle = getSituationPolygonStyle(props);
      const polygon = L.polygon(latlngs, {
        ...polyStyle,
        pane: 'situationPane'
      });
      polygon._cartoffSituationFeature = feature;
      polygon.bindPopup(buildSituationPopupContent(props));
      bindSituationFeatureContextMenu(polygon, feature);
      group.addLayer(polygon);

      const imagePath = CartoffPoi.resolveImagePath(props);
      const centroid = polygon.getBounds().getCenter();
      const iconMarker = L.marker(centroid, {
        icon: getSituationIcon(imagePath, isSituationInactif(props)),
        pane: 'situationPane'
      });
      iconMarker._cartoffSituationFeature = feature;
      iconMarker.bindPopup(buildSituationPopupContent(props));
      bindSituationFeatureContextMenu(iconMarker, feature);
      group.addLayer(iconMarker);
    } else if (geom.type === 'MultiPolygon' && geom.coordinates && geom.coordinates.length) {
      const rings = geom.coordinates.map((poly) => polygonRingToLatLngs(poly[0]));
      const polyStyle = getSituationPolygonStyle(props);
      const polygon = L.polygon(rings, {
        ...polyStyle,
        pane: 'situationPane'
      });
      polygon._cartoffSituationFeature = feature;
      polygon.bindPopup(buildSituationPopupContent(props));
      bindSituationFeatureContextMenu(polygon, feature);
      group.addLayer(polygon);

      const imagePath = CartoffPoi.resolveImagePath(props);
      const centroid = polygon.getBounds().getCenter();
      const iconMarker = L.marker(centroid, {
        icon: getSituationIcon(imagePath, isSituationInactif(props)),
        pane: 'situationPane'
      });
      iconMarker._cartoffSituationFeature = feature;
      iconMarker.bindPopup(buildSituationPopupContent(props));
      bindSituationFeatureContextMenu(iconMarker, feature);
      group.addLayer(iconMarker);
    }
  });

  group._cartoffFeatures = situationFeatures;
  return group;
}

async function loadSituationFeatures() {
  const res = await fetch(encodeURI('geojson/situation_constats.geojson'));
  if (!res.ok) throw new Error('Erreur chargement situation_constats.geojson');
  const geojson = await res.json();
  const fileFeatures = geojson.features || [];
  const fileCount = fileFeatures.length;
  const meta = readSituationMeta();

  let storedFeatures = null;
  try {
    const stored = localStorage.getItem(SITUATION_STORAGE_KEY);
    if (stored) {
      const data = JSON.parse(stored);
      if (data && Array.isArray(data.features)) storedFeatures = data.features;
    }
  } catch (err) {
    console.warn('Constats localStorage invalides :', err);
    clearSituationStorage();
  }

  if (fileCount === 0) {
    const fileWasEmptied = meta && meta.fileFeatureCount > 0;
    const legacyImportedData = storedFeatures && storedFeatures.length > 0
      && !storedFeatures.every(isLocallyCreatedSituationFeature);
    if (fileWasEmptied || legacyImportedData) {
      clearSituationStorage();
      writeSituationMeta(0);
      return [];
    }
    writeSituationMeta(0);
    return storedFeatures || [];
  }

  writeSituationMeta(fileCount);
  if (storedFeatures !== null) return storedFeatures;
  return fileFeatures;
}

function persistSituationFeatures() {
  localStorage.setItem(SITUATION_STORAGE_KEY, JSON.stringify({
    type: 'FeatureCollection',
    features: situationFeatures
  }));
}

function initSituationFromLocalStorage() {
  try {
    const stored = localStorage.getItem(SITUATION_STORAGE_KEY);
    if (!stored) return;
    const data = JSON.parse(stored);
    if (data && Array.isArray(data.features)) {
      situationFeatures = data.features;
      updateSituationInactifsFilterUI();
    }
  } catch (err) {
    console.warn('Constats localStorage invalides :', err);
    clearSituationStorage();
  }
}

function isSituationLayerVisible() {
  const layer = layers[SITUATION_LAYER_NAME];
  return !!(layer && map.hasLayer(layer));
}

function rebuildSituationLayer() {
  const checkbox = document.getElementById(checkboxIdForLayer(SITUATION_LAYER_NAME));
  const wasVisible = isSituationLayerVisible();

  if (!wasVisible && !(checkbox && checkbox.checked)) {
    updateSituationInactifsFilterUI();
    layerSelectRefreshers.forEach((fn) => fn());
    return;
  }

  const oldLayer = layers[SITUATION_LAYER_NAME];

  if (oldLayer) {
    if (map.hasLayer(oldLayer)) map.removeLayer(oldLayer);
    if (typeof oldLayer.clearLayers === 'function') oldLayer.clearLayers();
  }

  const displayFeatures = getSituationFeaturesForDisplay();
  const newLayer = buildSituationLayerFromFeatures(displayFeatures);
  layers[SITUATION_LAYER_NAME] = newLayer;
  situationLegendEntries = collectSituationLegendEntries(displayFeatures);
  updateSituationInactifsFilterUI();

  if (wasVisible || (checkbox && checkbox.checked)) newLayer.addTo(map);
  updateLegend();
  layerSelectRefreshers.forEach((fn) => fn());
}

const situationPanelEl = document.getElementById('situationPanel');
const situationPanelTitle = document.getElementById('situationPanelTitle');
const situationPanelType = document.getElementById('situationPanelType');
const situationPanelLibelle = document.getElementById('situationPanelLibelle');
const situationHintEl = document.getElementById('situationHint');
const mapContextMenuEl = document.getElementById('mapContextMenu');
buildSituationTypeSelect(situationPanelType, 'point');

function resetSituationHint() {
  if (situationHintEl) {
    situationHintEl.textContent = 'Clic droit sur la carte pour ajouter ou modifier un constat. Cochez le calque ci-dessous pour l\'affichage.';
  }
}

function getSituationLayerFromDomEvent(domEvent) {
  const situationLayer = layers[SITUATION_LAYER_NAME];
  if (!situationLayer || !map.hasLayer(situationLayer)) return null;
  let el = domEvent.target;
  const container = map.getContainer();
  while (el && el !== container) {
    const layer = map._targets && map._targets[L.Util.stamp(el)];
    if (layer && layer._cartoffSituationFeature) return layer;
    el = el.parentNode;
  }
  return null;
}

function updateDrawUI() {
  const finishBtn = document.getElementById('situationLineDrawFinish');
  if (!finishBtn || !drawState) {
    if (finishBtn) finishBtn.disabled = true;
    return;
  }
  const minVerts = drawState.mode === 'polygon' ? 3 : 2;
  finishBtn.disabled = drawState.vertices.length < minVerts;
}

function onDrawClick(e) {
  if (!drawState) return;
  drawState.vertices.push(e.latlng);
  drawState.previewLayer.setLatLngs(
    drawState.mode === 'polygon' ? [drawState.vertices] : drawState.vertices
  );
  updateDrawUI();
}

function onDrawDblClick(e) {
  if (!drawState || drawState.mode !== 'line' || drawState.vertices.length < 2) return;
  L.DomEvent.stop(e);
  finishDraw(e.originalEvent.clientX, e.originalEvent.clientY);
}

function cancelDrawMode() {
  if (!drawState) return;
  map.removeLayer(drawState.previewLayer);
  drawState = null;
  map.getContainer().classList.remove('situation-line-drawing');
  if (situationLineDrawBanner) situationLineDrawBanner.hidden = true;
  map.off('click', onDrawClick);
  map.off('dblclick', onDrawDblClick);
  map.doubleClickZoom.enable();
  resetSituationHint();
}

function finishDraw(clientX, clientY) {
  if (!drawState) return;
  const minVerts = drawState.mode === 'polygon' ? 3 : 2;
  if (drawState.vertices.length < minVerts) return;

  let coordinates;
  let geometry;
  let defaultType;
  let geometryKind;
  if (drawState.mode === 'polygon') {
    const ring = drawState.vertices.map((ll) => [ll.lng, ll.lat]);
    ring.push(ring[0].slice());
    coordinates = [ring];
    geometry = 'Polygon';
    defaultType = 'zone_inondee';
    geometryKind = 'polygon';
  } else {
    coordinates = drawState.vertices.map((ll) => [ll.lng, ll.lat]);
    geometry = 'LineString';
    defaultType = 'route_barree';
    geometryKind = 'line';
  }

  const draftLayer = drawState.previewLayer;
  const vertices = drawState.vertices.slice();
  const drawMode = drawState.mode;
  const presetSousType = drawState.presetSousType;
  if (drawMode === 'polygon') {
    draftLayer.setStyle({ dashArray: null, opacity: 0.65, fillOpacity: 0.25, color: '#3949ab', fillColor: '#3949ab' });
  } else {
    draftLayer.setStyle({ dashArray: null, opacity: 0.65, color: '#3949ab' });
  }

  drawState = null;
  map.getContainer().classList.remove('situation-line-drawing');
  if (situationLineDrawBanner) situationLineDrawBanner.hidden = true;
  map.off('click', onDrawClick);
  map.off('dblclick', onDrawDblClick);
  map.doubleClickZoom.enable();

  const latlng = drawMode === 'polygon'
    ? L.polygon(vertices).getBounds().getCenter()
    : L.latLng(coordinates[0][1], coordinates[0][0]);
  situationPanelState = {
    mode: 'add',
    geometry,
    coordinates,
    latlng,
    draftLayer
  };
  buildSituationTypeSelect(situationPanelType, geometryKind);
  showSituationPanel({
    mode: 'add',
    geometry: geometryKind,
    sousType: presetSousType || defaultType,
    libelle: ''
  });
  positionSituationPanel(clientX, clientY);
}

function startDrawMode(mode, initialLatLng, presetSousType) {
  cancelDrawMode();
  closeSituationPanel();
  closeMapContextMenu();

  const vertices = initialLatLng ? [initialLatLng] : [];
  const isPolygon = mode === 'polygon';
  const previewLayer = (isPolygon ? L.polygon([vertices], {
    color: '#3949ab',
    weight: 2,
    dashArray: '8 6',
    opacity: 0.85,
    fillColor: '#3949ab',
    fillOpacity: 0.15,
    pane: 'situationPane'
  }) : L.polyline(vertices, {
    color: '#3949ab',
    weight: 4,
    dashArray: '8 6',
    opacity: 0.85,
    pane: 'situationPane'
  })).addTo(map);

  drawState = { mode, vertices, previewLayer, presetSousType: presetSousType || null };
  map.getContainer().classList.add('situation-line-drawing');
  if (situationLineDrawBanner) situationLineDrawBanner.hidden = false;
  const bannerText = document.getElementById('situationDrawBannerText');
  if (bannerText) {
    bannerText.textContent = isPolygon
      ? 'Mode zone — cliquez pour le contour (min. 3 points), Terminer ferme le polygone'
      : 'Mode tronçon — cliquez pour ajouter des points, double-clic ou Terminer pour valider';
  }
  updateDrawUI();
  map.doubleClickZoom.disable();
  map.on('click', onDrawClick);
  if (!isPolygon) map.on('dblclick', onDrawDblClick);

  if (situationHintEl) {
    situationHintEl.textContent = isPolygon
      ? 'Mode zone — cliquez pour le contour, Terminer pour fermer le polygone (min. 3 points).'
      : 'Mode tronçon — cliquez pour ajouter des points, double-clic ou Terminer pour valider.';
  }
}

function startLineDrawMode(initialLatLng, presetSousType) {
  startDrawMode('line', initialLatLng, presetSousType);
}

function startPolygonDrawMode(initialLatLng, presetSousType) {
  startDrawMode('polygon', initialLatLng, presetSousType);
}

function clampPopupPosition(el, clientX, clientY, margin) {
  const m = margin || 8;
  const rect = el.getBoundingClientRect();
  const w = rect.width || el.offsetWidth || 200;
  const h = rect.height || el.offsetHeight || 120;
  let x = clientX;
  let y = clientY;
  if (x + w + m > window.innerWidth) x = window.innerWidth - w - m;
  if (y + h + m > window.innerHeight) y = window.innerHeight - h - m;
  if (x < m) x = m;
  if (y < m) y = m;
  return { x, y };
}

function setupFloatingPanelDrag(panelEl, handleEl) {
  if (!panelEl || !handleEl || handleEl.dataset.cartoffDragWired) return;
  handleEl.dataset.cartoffDragWired = '1';
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let origLeft = 0;
  let origTop = 0;

  function clampPanelPos() {
    const m = 8;
    let x = panelEl.offsetLeft;
    let y = panelEl.offsetTop;
    x = Math.min(Math.max(m, x), window.innerWidth - panelEl.offsetWidth - m);
    y = Math.min(Math.max(m, y), window.innerHeight - panelEl.offsetHeight - m);
    panelEl.style.left = x + 'px';
    panelEl.style.top = y + 'px';
  }

  function onDown(e) {
    if (e.type === 'mousedown' && e.button !== 0) return;
    dragging = true;
    const pt = e.touches ? e.touches[0] : e;
    startX = pt.clientX;
    startY = pt.clientY;
    origLeft = panelEl.offsetLeft;
    origTop = panelEl.offsetTop;
    handleEl.classList.add('is-dragging');
    e.preventDefault();
  }

  function onMove(e) {
    if (!dragging) return;
    const pt = e.touches ? e.touches[0] : e;
    panelEl.style.left = (origLeft + pt.clientX - startX) + 'px';
    panelEl.style.top = (origTop + pt.clientY - startY) + 'px';
    clampPanelPos();
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    handleEl.classList.remove('is-dragging');
  }

  handleEl.addEventListener('mousedown', onDown);
  handleEl.addEventListener('touchstart', onDown, { passive: false });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchmove', onMove, { passive: true });
  document.addEventListener('mouseup', onUp);
  document.addEventListener('touchend', onUp);
}

window.setupFloatingPanelDrag = setupFloatingPanelDrag;

function positionSituationPanel(clientX, clientY) {
  situationPanelEl.style.left = clientX + 'px';
  situationPanelEl.style.top = clientY + 'px';
  situationPanelEl.hidden = false;
  const pos = clampPopupPosition(situationPanelEl, clientX, clientY, 10);
  situationPanelEl.style.left = pos.x + 'px';
  situationPanelEl.style.top = pos.y + 'px';
}

function dismissMapContextMenuDom() {
  mapContextMenuEl.hidden = true;
  mapContextMenuEl.innerHTML = '';
}

function closeMapContextMenu() {
  dismissMapContextMenuDom();
  mapContextMenuState = null;
}

const SUBMENU_ITEM_PREFIX = '- ';

function dismissContextMenuAfterAction() {
  queueMicrotask(() => {
    dismissMapContextMenuDom();
    mapContextMenuState = null;
  });
}

function runMapContextMenuAction(handler) {
  try {
    if (typeof handler === 'function') handler();
  } finally {
    dismissContextMenuAfterAction();
  }
}

function addMapContextMenuItem(label, onClick, options, parentEl) {
  const container = parentEl || mapContextMenuEl;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'map-context-menu-item' + (options && options.danger ? ' map-context-menu-item-danger' : '');
  btn.textContent = label;
  btn.addEventListener('mousedown', (e) => {
    e.stopPropagation();
  });
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    runMapContextMenuAction(onClick);
  });
  container.appendChild(btn);
}

function addMapContextMenuCollapsible(menuEl, toggleLabel, contentHost) {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'map-context-menu-item map-context-menu-submenu-toggle';
  toggle.textContent = toggleLabel;
  const submenu = document.createElement('div');
  submenu.className = 'map-context-menu-submenu';
  submenu.hidden = true;
  while (contentHost.firstChild) {
    submenu.appendChild(contentHost.firstChild);
  }
  toggle.addEventListener('mousedown', (e) => {
    e.stopPropagation();
  });
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const opening = submenu.hidden;
    submenu.hidden = !opening;
    toggle.classList.toggle('is-open', opening);
  });
  menuEl.appendChild(toggle);
  menuEl.appendChild(submenu);
}

function hostContextMenuItem(hostEl) {
  return (label, onClick, options) => addMapContextMenuItem(label, onClick, options, hostEl);
}

function appendFlatReleveDfMenuItem(menuEl, target, clientX, clientY) {
  if (typeof CartoffSar === 'undefined' || !CartoffSar.canOfferReleveDf || !CartoffSar.canOfferReleveDf()) return;
  const clickLl = (target && (target.clickLatlng || target.latlng)) || null;
  if (!clickLl) return;
  const snapLat = clickLl.lat;
  const snapLng = clickLl.lng;
  const cx = clientX;
  const cy = clientY;
  addMapContextMenuItem('Relevé DF', () => {
    CartoffSar.openReleveDfDirect({ lat: snapLat, lng: snapLng }, cx, cy, null);
  });
}

function appendSecoursContextMenu(menuEl, target, clientX, clientY) {
  const sarAvailable = typeof CartoffSar !== 'undefined';
  const opAvailable = typeof CartoffSarOperation !== 'undefined';
  if (!sarAvailable && !opAvailable) return;

  const isOpFeature = target.feature && isOperationFeature(target.feature);
  const isSar = target.feature && isSarFeature(target.feature);
  const isEdit = isOpFeature || isSar;

  if (isEdit) {
    const section = document.createElement('div');
    section.className = 'map-context-menu-section';
    section.textContent = 'OPÉRATION DE SECOURS';
    menuEl.appendChild(section);
    if (isOpFeature && opAvailable) {
      CartoffSarOperation.buildMapContextMenu(menuEl, addMapContextMenuItem, target, clientX, clientY, {
        skipSection: true
      });
    } else if (sarAvailable) {
      CartoffSar.buildMapContextMenu(menuEl, addMapContextMenuItem, target, clientX, clientY, {
        skipSection: true
      });
    }
    return;
  }

  const sarHost = document.createElement('div');
  const opHost = document.createElement('div');
  let sarBuilt = false;
  let opBuilt = false;

  if (sarAvailable) {
    sarBuilt = CartoffSar.buildMapContextMenu(menuEl, hostContextMenuItem(sarHost), target, clientX, clientY, {
      skipSection: true,
      hostEl: sarHost,
      skipReleveDf: true
    });
  }
  if (opAvailable) {
    opBuilt = CartoffSarOperation.buildMapContextMenu(menuEl, hostContextMenuItem(opHost), target, clientX, clientY, {
      skipSection: true,
      hostEl: opHost
    });
  }
  if (!sarBuilt && !opBuilt) return;

  const section = document.createElement('div');
  section.className = 'map-context-menu-section';
  section.textContent = 'OPÉRATION DE SECOURS';
  menuEl.appendChild(section);

  appendFlatReleveDfMenuItem(menuEl, target, clientX, clientY);

  if (sarBuilt && opBuilt) {
    addMapContextMenuCollapsible(menuEl, 'Mission SAR', sarHost);
    addMapContextMenuCollapsible(menuEl, 'Opération de recherche', opHost);
  } else if (sarBuilt) {
    while (sarHost.firstChild) menuEl.appendChild(sarHost.firstChild);
  } else {
    while (opHost.firstChild) menuEl.appendChild(opHost.firstChild);
  }
}

function addMapContextMenuSubmenu(menuEl, toggleLabel, items) {
  if (!items || !items.length) return;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'map-context-menu-item map-context-menu-submenu-toggle';
  toggle.textContent = toggleLabel;
  const submenu = document.createElement('div');
  submenu.className = 'map-context-menu-submenu';
  submenu.hidden = true;
  items.forEach((item) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'map-context-menu-item map-context-menu-submenu-item' +
      (item.danger ? ' map-context-menu-item-danger' : '');
    btn.textContent = SUBMENU_ITEM_PREFIX + item.label;
    btn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      runMapContextMenuAction(item.onClick);
    });
    submenu.appendChild(btn);
  });
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = submenu.hidden;
    submenu.hidden = !opening;
    toggle.classList.toggle('is-open', opening);
  });
  menuEl.appendChild(toggle);
  menuEl.appendChild(submenu);
}

window.addMapContextMenuSubmenu = addMapContextMenuSubmenu;

function isSarFeature(feature) {
  const props = feature && feature.properties;
  return !!(props && props['sar:mission_id']);
}

function isOperationFeature(feature) {
  return typeof CartoffSarOperation !== 'undefined' &&
    CartoffSarOperation.isOperationFeature(feature);
}

function openMapContextMenu(clientX, clientY, target) {
  closeMapContextMenu();
  const clickLl = target && (target.clickLatlng || target.latlng);
  if (clickLl) {
    lastRightClickLatLng = L.latLng(clickLl.lat, clickLl.lng);
  }
  mapContextMenuState = { clientX, clientY, target };

  const isSar = target.feature && isSarFeature(target.feature);
  const isOperation = target.feature && isOperationFeature(target.feature);

  if (!isSar && !isOperation) {
    const section = document.createElement('div');
    section.className = 'map-context-menu-section';
    section.textContent = 'Constat / événement';
    mapContextMenuEl.appendChild(section);

    if (target.type === 'marker' || target.type === 'line' || target.type === 'polygon') {
      const props = target.feature.properties || {};
      const inactif = isSituationInactif(props);
      const isLine = target.type === 'line';
      const isPolygon = target.type === 'polygon';
      const editLabel = isLine ? 'Modifier ce tronçon' : (isPolygon ? 'Modifier cette zone' : 'Modifier ce constat');
      addMapContextMenuItem(editLabel, () => {
        openSituationPanelEdit(target.feature, target.latlng, clientX, clientY);
      });
      if (inactif) {
        addMapContextMenuItem('Réactiver', () => {
          setSituationFeatureStatut(target.feature, 'actif');
        });
      } else {
        addMapContextMenuItem('Marquer comme inactif', () => {
          setSituationFeatureStatut(target.feature, 'inactif');
        });
      }
      addMapContextMenuItem('Supprimer', () => {
        deleteSituationFeature(target.feature);
      }, { danger: true });
    } else {
      const pointTypes = CartoffPoi.getTypesForGeometry('point')
        .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
      const lineTypes = CartoffPoi.getTypesForGeometry('line')
        .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
      const polygonTypes = CartoffPoi.getTypesForGeometry('polygon')
        .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
      addMapContextMenuSubmenu(mapContextMenuEl, 'Point', pointTypes.map((t) => ({
        label: t.label,
        onClick: () => openSituationPanelAdd(target.latlng, clientX, clientY, t.id)
      })));
      addMapContextMenuSubmenu(mapContextMenuEl, 'Tronçon', lineTypes.map((t) => ({
        label: t.label,
        onClick: () => startLineDrawMode(target.latlng, t.id)
      })));
      addMapContextMenuSubmenu(mapContextMenuEl, 'Surface', polygonTypes.map((t) => ({
        label: t.label,
        onClick: () => startPolygonDrawMode(target.latlng, t.id)
      })));
    }
  }

  appendSecoursContextMenu(mapContextMenuEl, target, clientX, clientY);

  mapContextMenuEl.style.left = clientX + 'px';
  mapContextMenuEl.style.top = clientY + 'px';
  mapContextMenuEl.hidden = false;
  const pos = clampPopupPosition(mapContextMenuEl, clientX, clientY, 4);
  mapContextMenuEl.style.left = pos.x + 'px';
  mapContextMenuEl.style.top = pos.y + 'px';
}

function closeSituationPanel() {
  if (situationPanelState && situationPanelState.draftMarker) {
    map.removeLayer(situationPanelState.draftMarker);
  }
  if (situationPanelState && situationPanelState.draftLayer) {
    map.removeLayer(situationPanelState.draftLayer);
  }
  situationPanelState = null;
  situationPanelEl.hidden = true;
  resetSituationHint();
}

function showSituationPanel({ mode, geometry, sousType, libelle }) {
  const isLine = geometry === 'line' || geometry === 'LineString';
  const isPolygon = geometry === 'polygon' || geometry === 'Polygon' || geometry === 'MultiPolygon';
  if (mode === 'edit') {
    situationPanelTitle.textContent = isLine ? 'Modifier le tronçon' : (isPolygon ? 'Modifier la zone' : 'Modifier le constat');
  } else {
    situationPanelTitle.textContent = isLine ? 'Nouveau tronçon' : (isPolygon ? 'Nouvelle zone' : 'Nouveau constat');
  }
  const defaultType = isLine ? 'route_barree' : (isPolygon ? 'zone_inondee' : 'incident_generique');
  situationPanelType.value = sousType || defaultType;
  situationPanelLibelle.value = libelle || '';
  document.getElementById('situationPanelDelete').hidden = mode !== 'edit';
  situationPanelEl.hidden = false;
}

function openSituationPanelAdd(latlng, clientX, clientY, sousType) {
  cancelDrawMode();
  closeSituationPanel();
  buildSituationTypeSelect(situationPanelType, 'point');
  const draftMarker = L.marker(latlng, {
    icon: getSituationIcon(CartoffPoi.DEFAULT_IMAGE),
    pane: 'situationPane',
    interactive: false
  }).addTo(map);
  situationPanelState = { mode: 'add', geometry: 'Point', latlng, draftMarker };
  showSituationPanel({
    mode: 'add',
    geometry: 'point',
    sousType: sousType || 'incident_generique',
    libelle: ''
  });
  positionSituationPanel(clientX, clientY);
}

function openSituationPanelEdit(feature, latlng, clientX, clientY) {
  cancelDrawMode();
  closeSituationPanel();
  const props = feature.properties || {};
  const geom = feature.geometry || {};
  const isLine = geom.type === 'LineString';
  const isPolygon = geom.type === 'Polygon' || geom.type === 'MultiPolygon';
  const geometryKind = isLine ? 'line' : (isPolygon ? 'polygon' : 'point');
  buildSituationTypeSelect(situationPanelType, geometryKind);
  situationPanelState = {
    mode: 'edit',
    featureId: props.id,
    geometry: geom.type || 'Point',
    coordinates: geom.coordinates,
    latlng
  };
  showSituationPanel({
    mode: 'edit',
    geometry: geometryKind,
    sousType: props.sous_type,
    libelle: props.libelle || ''
  });
  positionSituationPanel(clientX, clientY);
}

function deleteSituationFeature(feature) {
  const id = feature.properties && feature.properties.id;
  if (!id) return;
  situationFeatures = situationFeatures.filter(
    (f) => !f.properties || f.properties.id !== id
  );
  persistSituationFeatures();
  closeSituationPanel();
  rebuildSituationLayer();
}

function setSituationFeatureStatut(feature, statut) {
  const id = feature.properties && feature.properties.id;
  if (!id) return;
  const existing = findSituationFeature(id);
  if (!existing || !existing.properties) return;
  existing.properties.statut = statut;
  persistSituationFeatures();
  closeSituationPanel();
  rebuildSituationLayer();
}

function saveSituationPanel() {
  if (!situationPanelState) return;
  const typeId = situationPanelType.value;
  const type = CartoffPoi.getType(typeId);
  const libelle = situationPanelLibelle.value.trim();
  const isLine = situationPanelState.geometry === 'LineString';
  const isPolygon = situationPanelState.geometry === 'Polygon' || situationPanelState.geometry === 'MultiPolygon';
  let lat;
  let lon;
  if (isLine && situationPanelState.coordinates && situationPanelState.coordinates.length) {
    lon = situationPanelState.coordinates[0][0];
    lat = situationPanelState.coordinates[0][1];
  } else if (isPolygon && situationPanelState.latlng) {
    lat = situationPanelState.latlng.lat;
    lon = situationPanelState.latlng.lng;
  } else if (situationPanelState.latlng) {
    lat = situationPanelState.latlng.lat;
    lon = situationPanelState.latlng.lng;
  } else {
    return;
  }
  const commune = CartoffCoords.findCommune(lat, lon, communeIndex);
  const dfci = CartoffCoords.latLngToDfci(lat, lon);

  let props;
  if (situationPanelState.mode === 'edit') {
    const existing = findSituationFeature(situationPanelState.featureId);
    const prev = (existing && existing.properties) || {};
    props = {
      ...prev,
      sous_type: typeId,
      panneau: panneauBasenameFromType(typeId),
      libelle: libelle || (type ? type.label : ''),
      statut: prev.statut || 'actif',
      gravite: prev.gravite || 'majeur'
    };
  } else {
    props = {
      id: newSituationId(),
      sous_type: typeId,
      panneau: panneauBasenameFromType(typeId),
      libelle: libelle || (type ? type.label : ''),
      statut: 'actif',
      gravite: 'majeur',
      created_at: new Date().toISOString(),
      created_by: 'terrain'
    };
  }
  if (commune) props.commune = commune;
  if (dfci && dfci.base) props.dfci = dfci.base;

  let geometry;
  if (isLine) {
    geometry = { type: 'LineString', coordinates: situationPanelState.coordinates.slice() };
  } else if (isPolygon) {
    const geomType = situationPanelState.geometry === 'MultiPolygon' ? 'MultiPolygon' : 'Polygon';
    geometry = { type: geomType, coordinates: situationPanelState.coordinates.slice() };
  } else if (situationPanelState.mode === 'edit') {
    const existing = findSituationFeature(situationPanelState.featureId);
    geometry = (existing && existing.geometry) || { type: 'Point', coordinates: [lon, lat] };
  } else {
    geometry = { type: 'Point', coordinates: [lon, lat] };
  }

  const feature = {
    type: 'Feature',
    geometry,
    properties: props
  };

  if (situationPanelState.mode === 'edit') {
    const idx = situationFeatures.findIndex((f) => f.properties && f.properties.id === situationPanelState.featureId);
    if (idx >= 0) situationFeatures[idx] = feature;
  } else {
    situationFeatures.push(feature);
  }

  persistSituationFeatures();
  closeSituationPanel();
  rebuildSituationLayer();
}

function deleteSituationPanel() {
  if (!situationPanelState || situationPanelState.mode !== 'edit') return;
  situationFeatures = situationFeatures.filter(
    (f) => !f.properties || f.properties.id !== situationPanelState.featureId
  );
  persistSituationFeatures();
  closeSituationPanel();
  rebuildSituationLayer();
}

function exportSituationGeoJSON() {
  const json = JSON.stringify({ type: 'FeatureCollection', features: situationFeatures }, null, 2);
  const blob = new Blob([json], { type: 'application/geo+json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const dh = (window.CartoffSar && CartoffSar.formatExportDateHeure)
    ? CartoffSar.formatExportDateHeure()
    : '';
  a.download = 'situation_constats' + (dh ? '_' + dh : '') + '.geojson';
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById('situationShowInactifs').addEventListener('change', (e) => {
  situationShowInactifs = e.target.checked;
  rebuildSituationLayer();
});
document.getElementById('situationExportBtn').addEventListener('click', async () => {
  if (!situationDataLoaded) {
    try {
      situationFeatures = await loadSituationFeatures();
      situationDataLoaded = true;
    } catch (err) {
      console.error(err);
    }
  }
  exportSituationGeoJSON();
});
document.getElementById('situationPanelSave').addEventListener('click', saveSituationPanel);
document.getElementById('situationPanelCancel').addEventListener('click', closeSituationPanel);
document.getElementById('situationPanelDelete').addEventListener('click', deleteSituationPanel);
setupFloatingPanelDrag(situationPanelEl, situationPanelTitle);
setupFloatingPanelDrag(document.getElementById('operationPanel'), document.getElementById('operationPanelTitle'));
setupFloatingPanelDrag(document.getElementById('sarPanel'), document.getElementById('sarPanelTitle'));
document.getElementById('situationLineDrawFinish').addEventListener('click', () => {
  if (!drawState) return;
  const minVerts = drawState.mode === 'polygon' ? 3 : 2;
  if (drawState.vertices.length < minVerts) return;
  const rect = situationLineDrawBanner.getBoundingClientRect();
  finishDraw(rect.left + rect.width / 2, rect.bottom + 8);
});
document.getElementById('situationLineDrawCancel').addEventListener('click', cancelDrawMode);

map.getContainer().addEventListener('contextmenu', (e) => {
  if (window.zoneSelectActive) {
    e.preventDefault();
    return;
  }
  if (drawState) return;
  if (typeof CartoffSarOperation !== 'undefined' && CartoffSarOperation.isDrawOrPanelActive()) return;
  if (typeof CartoffSar !== 'undefined' && CartoffSar.isDrawOrPanelActive()) return;
  if (e.target.closest('.sidebar') || e.target.closest('.situation-panel') || e.target.closest('.map-context-menu') || e.target.closest('.situation-line-draw-banner')) return;
  e.preventDefault();
  if (typeof CartoffSar !== 'undefined') {
    const sarLayerHit = CartoffSar.getFeatureFromDomEvent(e);
    if (sarLayerHit) {
      const feature = sarLayerHit._cartoffSarFeature;
      const geom = feature.geometry || {};
      const isLine = geom.type === 'LineString';
      const isPolygon = geom.type === 'Polygon';
      const clickLatlng = map.mouseEventToLatLng(e);
      let latlng = sarLayerHit.getLatLng ? sarLayerHit.getLatLng() : null;
      if (!latlng) latlng = situationGeomAnchorLatLng(geom);
      openMapContextMenu(e.clientX, e.clientY, {
        type: isLine ? 'line' : (isPolygon ? 'polygon' : 'marker'),
        feature,
        latlng,
        clickLatlng
      });
      return;
    }
  }
  if (typeof CartoffSarOperation !== 'undefined') {
    const operationLayerHit = CartoffSarOperation.getFeatureFromDomEvent(e);
    if (operationLayerHit) {
      const feature = operationLayerHit._cartoffOperationFeature;
      const geom = feature.geometry || {};
      const isLine = geom.type === 'LineString';
      const isPolygon = geom.type === 'Polygon';
      const clickLatlng = map.mouseEventToLatLng(e);
      let latlng = operationLayerHit.getLatLng ? operationLayerHit.getLatLng() : null;
      if (!latlng) latlng = situationGeomAnchorLatLng(geom);
      openMapContextMenu(e.clientX, e.clientY, {
        type: isLine ? 'line' : (isPolygon ? 'polygon' : 'marker'),
        feature,
        latlng,
        clickLatlng
      });
      return;
    }
  }
  const situationLayer = getSituationLayerFromDomEvent(e);
  if (situationLayer) {
    const feature = situationLayer._cartoffSituationFeature;
    const geom = feature.geometry || {};
    const isLine = geom.type === 'LineString';
    const isPolygon = geom.type === 'Polygon' || geom.type === 'MultiPolygon';
    const clickLatlng = map.mouseEventToLatLng(e);
    let latlng = situationLayer.getLatLng ? situationLayer.getLatLng() : null;
    if (!latlng) latlng = situationGeomAnchorLatLng(geom);
    openMapContextMenu(e.clientX, e.clientY, {
      type: isLine ? 'line' : (isPolygon ? 'polygon' : 'marker'),
      feature,
      latlng,
      clickLatlng
    });
    return;
  }
  const latlng = map.mouseEventToLatLng(e);
  openMapContextMenu(e.clientX, e.clientY, { type: 'map', latlng, clickLatlng: latlng });
});

document.addEventListener('click', (e) => {
  if (!mapContextMenuEl.hidden && !mapContextMenuEl.contains(e.target)) {
    closeMapContextMenu();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!mapContextMenuEl.hidden) closeMapContextMenu();
  else if (typeof CartoffSarOperation !== 'undefined' && CartoffSarOperation.isDrawOrPanelActive()) CartoffSarOperation.cancelInteractions();
  else if (typeof CartoffSar !== 'undefined' && CartoffSar.isDrawOrPanelActive()) CartoffSar.cancelInteractions();
  else if (drawState) cancelDrawMode();
  else if (situationPanelState) closeSituationPanel();
});

async function ensureSituationLayerReady() {
  try {
    if (!situationDataLoaded) {
      situationFeatures = await loadSituationFeatures();
      situationDataLoaded = true;
      updateSituationInactifsFilterUI();
    }
    if (!layers[SITUATION_LAYER_NAME]) {
      const displayFeatures = getSituationFeaturesForDisplay();
      layers[SITUATION_LAYER_NAME] = buildSituationLayerFromFeatures(displayFeatures);
      situationLegendEntries = collectSituationLegendEntries(displayFeatures);
      setupSituationSearch();
    } else {
      rebuildSituationLayer();
    }
    return layers[SITUATION_LAYER_NAME];
  } catch (err) {
    console.error(err);
    showSituationLoadError(
      'Impossible de charger les constats (geojson/situation_constats.geojson). ' +
      'Servez l\'application via http://localhost:8000, pas en fichier local.'
    );
    return null;
  }
}

function addSituationLazyCheckbox(div) {
  const name = SITUATION_LAYER_NAME;
  const id = checkboxIdForLayer(name);
  const label = document.createElement('label');
  label.htmlFor = id;
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = id;
  checkbox.checked = false;
  checkbox.addEventListener('change', async (e) => {
    if (e.target.checked) {
      checkbox.disabled = true;
      const layer = await ensureSituationLayerReady();
      checkbox.disabled = false;
      if (!layer) {
        checkbox.checked = false;
        return;
      }
      if (!map.hasLayer(layer)) layer.addTo(map);
      updateLegend();
    } else if (layers[name]) {
      map.removeLayer(layers[name]);
      updateLegend();
    }
  });
  label.appendChild(checkbox);
  label.appendChild(document.createTextNode(' ' + name));
  div.appendChild(label);
}

async function loadGeoJSON(name,file,style){
  try{
    const res = await fetch(encodeURI(file));
    if(!res.ok) throw new Error("Erreur chargement "+file);
    const geojson = await res.json();
    const useIcon = name in icons;
    const isDfci = DFCI_LAYER_NAMES.has(name);
    const isDfci2km = name === DFCI_2KM_LAYER_NAME;
    const useCanvas = isDfci || name === COMMUNE_LAYER_NAME ||
      name === ZONES_INDUSTRIELLES_LAYER || name === SITES_INDUSTRIELS_LAYER ||
      name === ZONES_HABITATION_LAYER;
    const geoJsonOptions = {
      style: style,
      interactive: !isDfci,
      smoothFactor: isDfci2km ? 2.5 : (useCanvas ? 1.5 : 1.0),
      renderer: useCanvas ? polygonCanvasRenderer : undefined,
      pointToLayer:(feature,latlng)=> useIcon ? L.marker(latlng,{icon:icons[name]}) : L.circleMarker(latlng,style),
      onEachFeature:(feature,l)=>{
        if(isDfci) return;
        if(feature.properties){
          let popup="";
          const hiddenKeys = new Set(["osm_id", "osm_type"]);
          for(const key in feature.properties){
            if(hiddenKeys.has(key)) continue;
            popup+=`<b>${key}:</b> ${feature.properties[key]}<br>`;
          }
          l.bindPopup(popup);
        }
      }
    };
    if (isDfci2km) geoJsonOptions.minZoom = 11;
    const layer = L.geoJSON(geojson, geoJsonOptions);
    layerStyles[name] = style;
    layer._cartoffFeatures = geojson.features;
    return layer;
  } catch(err){ console.error(err); alert(err); return null; }
}

function checkboxIdForLayer(name) {
  return 'chk_' + name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function addCheckbox(div, name, layer, options){
  const opts = options || {};
  const id = checkboxIdForLayer(name);
  const label=document.createElement("label");
  label.htmlFor=id;
  const checkbox=document.createElement("input");
  checkbox.type="checkbox"; checkbox.id=id;
  checkbox.checked = !!opts.checkedDefault;
  checkbox.addEventListener("change", e=>{
    if(e.target.checked){ 
      layer.addTo(map); 
      if(opts.fitOnEnable !== false && layer.getBounds) {
        map.fitBounds(layer.getBounds(), {padding: [20,20]});
      }
    } else { 
      map.removeLayer(layer); 
    }
    updateLegend();
  });
  label.appendChild(checkbox);
  label.appendChild(document.createTextNode(" "+name));
  div.appendChild(label);
  if (checkbox.checked) {
    layer.addTo(map);
  }
}

function addLazyCheckbox(div, item, options) {
  const opts = options || {};
  const name = item.name;
  const id = checkboxIdForLayer(name);
  const label = document.createElement('label');
  label.htmlFor = id;
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = id;
  checkbox.checked = !!opts.checkedDefault;
  if (name === DFCI_2KM_LAYER_NAME) {
    label.title = '5012 mailles — peut ralentir fortement la carte, surtout au zoom 15';
  }
  checkbox.addEventListener('change', async e => {
    if (e.target.checked) {
      if (!layers[name]) {
        checkbox.disabled = true;
        const layer = await loadGeoJSON(name, item.file, item.style);
        checkbox.disabled = false;
        if (!layer) {
          checkbox.checked = false;
          return;
        }
        layers[name] = layer;
        registerDepartementLayerSearch(name);
      }
      layers[name].addTo(map);
      if (opts.fitOnEnable !== false && layers[name].getBounds) {
        map.fitBounds(layers[name].getBounds(), { padding: [20, 20] });
      }
      if (DFCI_LAYER_NAMES.has(name)) {
        onDfciLayerChange();
      }
    } else if (layers[name]) {
      map.removeLayer(layers[name]);
    }
    if (DFCI_LAYER_NAMES.has(name)) {
      onDfciLayerChange();
    }
    updateLegend();
  });
  label.appendChild(checkbox);
  label.appendChild(document.createTextNode(' ' + name));
  if (name === DFCI_2KM_LAYER_NAME) {
    const heavyNote = document.createElement('span');
    heavyNote.style.color = '#c62828';
    heavyNote.style.fontSize = '12px';
    heavyNote.textContent = ' ⚠ lourd';
    label.appendChild(heavyNote);
  }
  div.appendChild(label);
}

function updateLegend(){
  let active = [];
  for(const name in layers){
    const chk = document.getElementById(checkboxIdForLayer(name));
    if(chk && chk.checked){ active.push(name); }
  }
  if(active.length===0){ legendDiv.innerHTML="<b>Légende :</b><br>– aucun calque actif –"; }
  else{
    let html = "<b>Légende :</b><br>";
    active.forEach(name=>{
      if(name in squareLegendLayers){
        html += `<span class="squareBox ${squareLegendLayers[name]}"></span> ${name}<br>`;
      } else if(name in icons && icons[name].options.iconUrl){
        html += `<img src="${icons[name].options.iconUrl}" class="icon"> ${name}<br>`;
      } else if(name === SITUATION_LAYER_NAME){
        if (situationLegendEntries.length) {
          situationLegendEntries.forEach((entry) => {
            html += `<img src="${encodeURI(entry.imagePath)}" class="icon" alt=""> ${entry.label}<br>`;
          });
        } else {
          html += `${name} — aucun panneau<br>`;
        }
      } else if (typeof CartoffSar !== 'undefined' && name === CartoffSar.LAYER_NAME) {
        html += CartoffSar.getLegendHtml();
      } else if (typeof CartoffSarOperation !== 'undefined' && name === CartoffSarOperation.LAYER_NAME) {
        html += CartoffSarOperation.getLegendHtml();
      } else {
        const style = layerStyles[name] || {};
        let color = style.color || "#000";
        let weight = style.weight || 2;
        html += `<span class="lineBox" style="border-top:${weight}px solid ${color}"></span> ${name}<br>`;
      }
    });
    legendDiv.innerHTML = html;
  }
}

function buildCommuneSearchEntries(index) {
  return index
    .map(entry => ({
      label: entry.nom,
      sublabel: entry.code_insee || '',
      bounds: entry.bounds,
      geometry: entry.geometry,
      layer: entry.layer,
      searchKey: CartoffCoords.normalizeSearchText(
        entry.nom + ' ' + (entry.code_insee || '')
      )
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
}

function clearSearchHighlight() {
  if (searchHighlightTimer) {
    clearTimeout(searchHighlightTimer);
    searchHighlightTimer = null;
  }
  if (searchHighlightOverlay) {
    map.removeLayer(searchHighlightOverlay);
    searchHighlightOverlay = null;
  }
}

function showSearchHighlight(entry, highlightStyle) {
  clearSearchHighlight();
  if (!entry || !entry.geometry) return;
  const geom = entry.geometry;
  if (geom.type === 'Point') {
    searchHighlightOverlay = L.circleMarker(
      [geom.coordinates[1], geom.coordinates[0]],
      { radius: 12, color: highlightStyle.color, weight: highlightStyle.weight,
        fillColor: highlightStyle.fillColor, fillOpacity: highlightStyle.fillOpacity || 0.6,
        interactive: false }
    ).addTo(map);
  } else {
    searchHighlightOverlay = L.geoJSON(geom, {
      style: highlightStyle,
      interactive: false
    }).addTo(map);
  }
  if (searchHighlightOverlay.bringToFront) searchHighlightOverlay.bringToFront();
  searchHighlightTimer = setTimeout(clearSearchHighlight, SEARCH_HIGHLIGHT_MS);
}

function zoomToSearchResult(entry, highlightStyle) {
  if (!entry || !entry.bounds) return;
  const bounds = entry.bounds;
  const isPoint = entry.geometry && entry.geometry.type === 'Point';
  const isTiny = bounds.getNorthEast && bounds.getSouthWest &&
    bounds.getNorthEast().equals(bounds.getSouthWest());
  if (isPoint || isTiny) {
    map.setView(bounds.getCenter(), Math.max(map.getZoom(), 15), { animate: true });
  } else {
    map.fitBounds(bounds, {
      ...getMapFitPadding(),
      maxZoom: PMTILES_DATA_MAX_ZOOM,
      animate: true
    });
  }
  showSearchHighlight(entry, highlightStyle);
}

function normalizeDfciSearchCode(str) {
  return (str || '').replace(/\s+/g, '').toUpperCase();
}

function preferredDfciResolution(codeLength) {
  if (codeLength >= 6) return 2;
  if (codeLength >= 4) return 20;
  if (codeLength >= 2) return 100;
  return null;
}

function findDfciSearchMatch(rawCode) {
  const code = normalizeDfciSearchCode(rawCode);
  if (!code) return null;
  const matches = dfciSearchIndex.get(code);
  if (!matches || !matches.length) return null;
  if (matches.length === 1) return matches[0];
  const preferred = preferredDfciResolution(code.length);
  const exact = matches.find(m => m.resolution === preferred);
  if (exact) return exact;
  return matches.slice().sort((a, b) => a.resolution - b.resolution)[0];
}

function isAnyDfciLayerChecked() {
  for (const layerName of DFCI_LAYER_NAMES) {
    const chk = document.getElementById(checkboxIdForLayer(layerName));
    if (chk && chk.checked) return true;
  }
  return false;
}

function updateDfciSearchVisibility() {
  const block = document.getElementById('dfciSearch');
  if (!block) return;
  block.hidden = !isAnyDfciLayerChecked();
}

async function onDfciLayerChange() {
  updateDfciSearchVisibility();
  if (isAnyDfciLayerChecked()) {
    await ensureDfciSearchIndex();
  }
}

async function ensureDfciSearchIndex() {
  if (dfciSearchReady) return;
  if (!dfciSearchLoadPromise) {
    dfciSearchLoadPromise = loadDfciSearchIndex();
  }
  await dfciSearchLoadPromise;
}

function showDfciSearchMessage(text) {
  const msg = document.getElementById('dfciSearchMsg');
  if (!msg) return;
  clearTimeout(dfciSearchMsgTimer);
  if (!text) {
    msg.hidden = true;
    msg.textContent = '';
    return;
  }
  msg.hidden = false;
  msg.textContent = text;
  dfciSearchMsgTimer = setTimeout(() => showDfciSearchMessage(''), 3500);
}

async function ensureDfciLayerVisible(layerName) {
  const chk = document.getElementById(checkboxIdForLayer(layerName));
  if (!chk) return;
  if (chk.checked && layers[layerName]) return;
  if (!layers[layerName]) {
    const item = geojsonFiles.urgence.find(i => i.name === layerName);
    if (!item) return;
    chk.disabled = true;
    const layer = await loadGeoJSON(item.name, item.file, item.style);
    chk.disabled = false;
    if (!layer) return;
    layers[layerName] = layer;
  }
  if (!chk.checked) chk.checked = true;
  if (!map.hasLayer(layers[layerName])) layers[layerName].addTo(map);
  updateLegend();
  if (DFCI_LAYER_NAMES.has(layerName)) onDfciLayerChange();
}

async function zoomToDfciSearchResult(entry) {
  if (!entry) return;
  await ensureDfciLayerVisible(entry.layerName);
  zoomToSearchResult(entry, DFCI_HIGHLIGHT_STYLE);
}

async function runDfciSearch() {
  if (!dfciSearchReady) {
    if (isAnyDfciLayerChecked()) {
      showDfciSearchMessage('Index DFCI en cours de chargement…');
      await ensureDfciSearchIndex();
    } else {
      showDfciSearchMessage('Activez un calque DFCI pour rechercher');
      return;
    }
  }
  const input = document.getElementById('dfciSearchInput');
  const raw = input ? input.value : '';
  const match = findDfciSearchMatch(raw);
  if (!match) {
    showDfciSearchMessage('Code DFCI introuvable');
    return;
  }
  showDfciSearchMessage('');
  zoomToDfciSearchResult(match);
}

function setupDfciSearch() {
  const input = document.getElementById('dfciSearchInput');
  const btn = document.getElementById('dfciSearchBtn');
  if (!input || !btn || input.dataset.bound) return;
  input.dataset.bound = '1';
  input.disabled = false;
  btn.disabled = false;
  btn.addEventListener('click', runDfciSearch);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runDfciSearch();
    }
  });
  input.addEventListener('input', () => showDfciSearchMessage(''));
}

async function ingestDfciSearchFile(spec, index) {
  try {
    const resp = await fetch(spec.file);
    if (!resp.ok) {
      console.warn('DFCI search:', spec.file, resp.status);
      return;
    }
    const geojson = await resp.json();
    for (const feature of geojson.features || []) {
      const props = feature.properties || {};
      const code = normalizeDfciSearchCode(props.dfci);
      if (!code || !feature.geometry) continue;
      const bounds = CartoffCoords.boundsFromGeometry(feature.geometry);
      if (!bounds || !bounds.isValid()) continue;
      const entry = {
        label: props.label || ('DFCI ' + code),
        code,
        resolution: spec.resolution,
        geometry: feature.geometry,
        bounds,
        layerName: spec.layerName
      };
      if (!index.has(code)) index.set(code, []);
      index.get(code).push(entry);
    }
  } catch (err) {
    console.warn('DFCI search index:', spec.file, err);
  }
}

async function loadDfciSearchIndex() {
  const index = new Map();
  for (const spec of DFCI_SEARCH_SPECS) {
    await ingestDfciSearchFile(spec, index);
  }
  dfciSearchIndex = index;
  dfciSearchReady = index.size > 0;
  setupDfciSearch();
  if (!dfciSearchReady) {
    showDfciSearchMessage('Impossible de charger l\'index DFCI');
  }
}

function entryInViewport(entry) {
  if (!entry || !entry.bounds) return false;
  const viewport = map.getBounds();
  if (entry.geometry && entry.geometry.type === 'Point') {
    return viewport.contains(entry.bounds.getCenter());
  }
  return CartoffCoords.boundsIntersectViewport(entry.bounds, viewport);
}

function formatSelectOptionLabel(entry) {
  return entry.sublabel ? `${entry.label} (${entry.sublabel})` : entry.label;
}

const layerSelectRefreshers = [];
let layerSelectRefreshTimer = null;
const LAYER_SELECT_DEBOUNCE_MS = 400;

function scheduleLayerSelectRefresh() {
  clearTimeout(layerSelectRefreshTimer);
  layerSelectRefreshTimer = setTimeout(() => {
    layerSelectRefreshers.forEach(fn => fn());
  }, LAYER_SELECT_DEBOUNCE_MS);
}

map.on('moveend', scheduleLayerSelectRefresh);

function setupLayerSelect({ selectId, entries, getEntries, placeholder, emptyMessage, highlightStyle, viewportFilter = true }) {
  const select = document.getElementById(selectId);
  let visibleEntries = [];

  function resolveEntries() {
    return getEntries ? getEntries() : (entries || []);
  }

  function populateOptions() {
    const allEntries = resolveEntries();
    visibleEntries = (viewportFilter ? allEntries.filter(entryInViewport) : allEntries.slice())
      .sort((a, b) => a.label.localeCompare(b.label, 'fr'));

    select.innerHTML = '';
    if (!allEntries.length) {
      const emptyOpt = document.createElement('option');
      emptyOpt.value = '';
      emptyOpt.disabled = true;
      emptyOpt.selected = true;
      emptyOpt.textContent = emptyMessage || 'Aucun élément';
      select.appendChild(emptyOpt);
      select.disabled = true;
      return;
    }
    if (!visibleEntries.length) {
      const emptyOpt = document.createElement('option');
      emptyOpt.value = '';
      emptyOpt.disabled = true;
      emptyOpt.selected = true;
      emptyOpt.textContent = 'Aucun élément dans la zone affichée';
      select.appendChild(emptyOpt);
      select.disabled = true;
      return;
    }

    select.disabled = false;
    const placeholderOpt = document.createElement('option');
    placeholderOpt.value = '';
    placeholderOpt.disabled = true;
    placeholderOpt.selected = true;
    placeholderOpt.textContent = placeholder;
    select.appendChild(placeholderOpt);

    visibleEntries.forEach((entry, index) => {
      const opt = document.createElement('option');
      opt.value = String(index);
      opt.textContent = formatSelectOptionLabel(entry);
      select.appendChild(opt);
    });
  }

  select.addEventListener('change', () => {
    const index = select.value;
    if (!index) return;
    const entry = visibleEntries[Number(index)];
    if (entry) zoomToSearchResult(entry, highlightStyle);
    select.selectedIndex = 0;
  });

  if (viewportFilter || getEntries) {
    layerSelectRefreshers.push(populateOptions);
  }
  select.disabled = false;
  populateOptions();
}

function setupCommuneSearch() {
  if (window._communeSearchReady) {
    scheduleLayerSelectRefresh();
    return;
  }
  window._communeSearchReady = true;
  setupLayerSelect({
    selectId: 'communeSearchSelect',
    getEntries: () => communeSearchEntries,
    placeholder: '— Choisir une commune —',
    highlightStyle: COMMUNE_HIGHLIGHT_STYLE
  });
}

async function loadCommuneIndexOnly() {
  const token = communeLoadToken;
  const item = geojsonFiles.departement.find(i => i.name === COMMUNE_LAYER_NAME);
  if (!item) return;
  try {
    const res = await fetch(encodeURI(item.file));
    if (token !== communeLoadToken) return;
    if (!res.ok) throw new Error('communes');
    const geojson = await res.json();
    if (token !== communeLoadToken) return;
    communeIndex = CartoffCoords.buildCommuneIndexFromFeatures(geojson.features || []);
    communeSearchEntries = buildCommuneSearchEntries(communeIndex);
    setupCommuneSearch();
    layerSearchSetupDone.add(COMMUNE_LAYER_NAME);
    if (lastPointer) refreshCoordsFromMap();
  } catch (err) {
    console.warn('Index communes:', err);
  }
}

function registerDepartementLayerSearch(name) {
  const layer = layers[name];
  if (!layer) return;
  if (!window._zoneSearchSources) window._zoneSearchSources = {};
  if (name === ZONES_INDUSTRIELLES_LAYER || name === SITES_INDUSTRIELS_LAYER || name === ZONES_HABITATION_LAYER) {
    const profiles = {
      [ZONES_INDUSTRIELLES_LAYER]: {
        selectId: 'zonesIndustriellesSearchSelect',
        index: { labelFields: ['nom', 'operateur', 'adresse'], searchFields: ['nom', 'operateur', 'adresse', 'telephone'], sublabelFields: ['operateur', 'adresse'], fallbackLabel: 'Zone industrielle' },
        placeholder: '— Choisir une zone industrielle —',
        highlightStyle: ZONES_INDUSTRIELLES_HIGHLIGHT
      },
      [SITES_INDUSTRIELS_LAYER]: {
        selectId: 'sitesIndustrielsSearchSelect',
        index: { labelFields: ['nom', 'operateur', 'adresse'], searchFields: ['nom', 'operateur', 'adresse', 'telephone'], sublabelFields: ['operateur', 'adresse'], fallbackLabel: 'Site industriel' },
        placeholder: '— Choisir un site industriel —',
        highlightStyle: SITES_INDUSTRIELS_HIGHLIGHT
      },
      [ZONES_HABITATION_LAYER]: {
        selectId: 'zonesHabitationSearchSelect',
        index: { labelFields: ['nom', 'commune'], searchFields: ['nom', 'commune', 'code_postal'], sublabelFields: ['commune', 'code_postal'], fallbackLabel: 'Zone résidentielle', requireSearchable: true },
        placeholder: '— Choisir une zone d\'habitation —',
        highlightStyle: ZONES_HABITATION_HIGHLIGHT
      }
    };
    const profile = profiles[name];
    window._zoneSearchSources[name] = CartoffCoords.buildFeatureSearchIndex(layer, profile.index);
    if (layerSearchSetupDone.has(name)) {
      scheduleLayerSelectRefresh();
      return;
    }
    layerSearchSetupDone.add(name);
    setupLayerSelect({
      selectId: profile.selectId,
      getEntries: () => window._zoneSearchSources[name] || [],
      placeholder: profile.placeholder,
      highlightStyle: profile.highlightStyle
    });
  }
}

function buildSituationSearchEntries() {
  const source = getSituationFeaturesForDisplay();
  if (!source.length) return [];
  return source
    .filter((f) => f && f.geometry)
    .map((feature) => {
      const props = feature.properties || {};
      const type = CartoffPoi.getType(props.sous_type);
      const typeLabel = (type && type.label) || props.sous_type || '';
      const libelle = props.libelle || typeLabel || 'Constat';
      const inactif = isSituationInactif(props);
      const geom = feature.geometry;
      let bounds = null;
      if (geom.type === 'Point') {
        const ll = L.latLng(geom.coordinates[1], geom.coordinates[0]);
        bounds = L.latLngBounds(ll, ll);
      } else if (geom.type === 'LineString' && geom.coordinates.length >= 2) {
        const latlngs = geom.coordinates.map((c) => L.latLng(c[1], c[0]));
        bounds = L.latLngBounds(latlngs);
      } else if (geom.type === 'Polygon' && geom.coordinates && geom.coordinates[0]) {
        const latlngs = polygonRingToLatLngs(geom.coordinates[0]);
        if (latlngs.length) bounds = L.latLngBounds(latlngs);
      } else if (geom.type === 'MultiPolygon' && geom.coordinates && geom.coordinates[0]) {
        const latlngs = polygonRingToLatLngs(geom.coordinates[0][0]);
        if (latlngs.length) bounds = L.latLngBounds(latlngs);
      }
      const isLine = geom.type === 'LineString';
      const isPolygon = geom.type === 'Polygon' || geom.type === 'MultiPolygon';
      const searchKey = CartoffCoords.normalizeSearchText(
        [libelle, typeLabel, isLine ? 'tronçon' : '', isPolygon ? 'zone' : '', props.description, props.commune, props.dfci, props.statut]
          .filter(Boolean)
          .join(' ')
      );
      return {
        label: libelle + (inactif ? ' (inactif)' : ''),
        sublabel: [typeLabel, isLine ? 'Tronçon' : '', isPolygon ? 'Zone' : '', inactif ? 'Inactif' : ''].filter(Boolean).join(' · '),
        bounds,
        geometry: geom,
        layer: null,
        searchKey
      };
    })
    .filter((entry) => entry.bounds)
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
}

function setupSituationSearch() {
  const situationLayer = layers[SITUATION_LAYER_NAME];
  if (!situationLayer) return;
  setupLayerSelect({
    selectId: 'situationConstatsSearchSelect',
    getEntries: () => buildSituationSearchEntries(),
    placeholder: '— Choisir un constat —',
    emptyMessage: '— Aucun constat —',
    highlightStyle: SITUATION_HIGHLIGHT,
    viewportFilter: false
  });
}

function setupOperationSearch() {
  if (typeof CartoffSarOperation === 'undefined') return;
  setupLayerSelect({
    selectId: 'operationRechercheSearchSelect',
    getEntries: () => CartoffSarOperation.buildSearchEntries(),
    placeholder: '— Choisir un élément —',
    emptyMessage: '— Aucun élément —',
    highlightStyle: SITUATION_HIGHLIGHT,
    viewportFilter: false
  });
}

function showSituationLoadError(message) {
  const div = document.getElementById('situationLayers');
  const hint = document.getElementById('situationHint');
  if (hint) hint.hidden = true;
  if (!div) return;
  const err = document.createElement('p');
  err.className = 'situation-error';
  err.textContent = message;
  div.appendChild(err);
}

let zoneCatalogToken = 0;

function catalogLayerNames() {
  const names = [];
  Object.values(geojsonFiles).forEach((group) => {
    group.forEach((item) => names.push(item.name));
  });
  return names;
}

function layerCaptionNode(name) {
  const box = document.getElementById(checkboxIdForLayer(name));
  if (!box || !box.parentElement) return null;
  return Array.from(box.parentElement.childNodes).find((node) => node.nodeType === Node.TEXT_NODE) || null;
}

function releaseCatalogLayers() {
  catalogLayerNames().forEach((name) => {
    if (layers[name]) {
      if (map.hasLayer(layers[name])) map.removeLayer(layers[name]);
      delete layers[name];
    }
  });
  communeIndex = [];
  communeSearchEntries = [];
  communeIndexLoadScheduled = false;
  communeLoadToken += 1;
  dfciSearchIndex = new Map();
  dfciSearchReady = false;
  dfciSearchLoadPromise = null;
}

async function reloadCheckedCatalogLayers() {
  const items = Object.values(geojsonFiles).flat();
  for (const item of items) {
    const box = document.getElementById(checkboxIdForLayer(item.name));
    if (!box || !box.checked) continue;
    box.disabled = true;
    const layer = await loadGeoJSON(item.name, item.file, item.style);
    box.disabled = false;
    if (!layer) {
      box.checked = false;
      continue;
    }
    layers[item.name] = layer;
    layer.addTo(map);
    registerDepartementLayerSearch(item.name);
    if (DFCI_LAYER_NAMES.has(item.name)) onDfciLayerChange();
  }
}

window.cartoffApplyZoneLayers = async function cartoffApplyZoneLayers(zoneName) {
  const token = ++zoneCatalogToken;
  let manifest = null;
  if (zoneName && zoneName !== "loire") {
    try {
      const resp = await fetch("/api/layers/" + encodeURIComponent(zoneName));
      if (resp.ok) manifest = await resp.json();
    } catch (err) {
      console.warn(err);
    }
  }
  if (token !== zoneCatalogToken) return;
  const byName = new Map();
  if (manifest && manifest.layers) {
    Object.values(manifest.layers).forEach((list) => {
      list.forEach((entry) => byName.set(entry.name, entry));
    });
  }
  releaseCatalogLayers();
  Object.values(geojsonFiles).forEach((group) => {
    group.forEach((item) => {
      if (!item.loireFile) item.loireFile = item.file;
      const entry = byName.get(item.name);
      item.file = entry && entry.file ? entry.file : item.loireFile;
      const caption = layerCaptionNode(item.name);
      if (caption) caption.nodeValue = " " + ((entry && entry.label) || item.name);
    });
  });
  DFCI_SEARCH_SPECS.forEach((spec) => {
    const item = Object.values(geojsonFiles).flat().find((entry) => entry.name === spec.layerName);
    if (item) spec.file = item.file;
  });
  const title = document.getElementById("osmZoneTitle");
  if (title) {
    title.textContent = manifest
      ? "Calques OSM — " + (manifest.title || zoneName)
      : "Département de la Loire (OSM)";
  }
  const dfciLabel = document.getElementById(checkboxIdForLayer(DFCI_2KM_LAYER_NAME));
  if (dfciLabel && dfciLabel.parentElement) {
    const entry = byName.get(DFCI_2KM_LAYER_NAME);
    dfciLabel.parentElement.title = entry && entry.count
      ? entry.count + " mailles — peut ralentir la carte"
      : "Peut ralentir fortement la carte, surtout au zoom 15";
  }
  await reloadCheckedCatalogLayers();
  if (token !== zoneCatalogToken) return;
  updateLegend();
  if (!layers[COMMUNE_LAYER_NAME]) scheduleCommuneIndexLoad();
};

async function setupLayers(){
  initSituationFromLocalStorage();

  const departementContainer = document.getElementById('departementLayers');
  for (const item of geojsonFiles.departement) {
    addLazyCheckbox(departementContainer, item, {
      fitOnEnable: item.name !== COMMUNE_LAYER_NAME
    });
  }
  const lazyLayerGroups = [
    ['aviation', 'aviationLayers'],
    ['urgence', 'urgenceLayers'],
    ['sante', 'santeLayers'],
    ['services', 'servicesLayers'],
    ['toponymie', 'toponymieLayers'],
    ['contexte', 'contexteLayers']
  ];
  for (const [category, containerId] of lazyLayerGroups) {
    const container = document.getElementById(containerId);
    for (const item of geojsonFiles[category]) {
      addLazyCheckbox(container, item);
    }
  }
  addSituationLazyCheckbox(document.getElementById('situationLayers'));

  if (typeof CartoffSar !== 'undefined') {
    window.closeMapContextMenu = closeMapContextMenu;
    window.getMapContextMenuClickTarget = function () {
      return mapContextMenuState && mapContextMenuState.target || null;
    };
    window.getLastRightClickLatLng = function () {
      return lastRightClickLatLng;
    };
    window.openMapContextMenuForSar = function (clientX, clientY, target) {
      openMapContextMenu(clientX, clientY, target);
    };
    CartoffSar.init({
      map: map,
      layers: layers,
      updateLegend: updateLegend,
      findCommune: (lat, lon) => CartoffCoords.findCommune(lat, lon, communeIndex),
      latLngToDfci: (lat, lon) => CartoffCoords.latLngToDfci(lat, lon),
      latLngToUtm: (lat, lon) => CartoffCoords.latLngToUtm(lat, lon),
      getElevation: (lat, lon) => CartoffCoords.getElevation(lat, lon),
      sidebarEl: document.getElementById('sarSidebar'),
      panelEl: document.getElementById('sarPanel'),
      panelTitleEl: document.getElementById('sarPanelTitle'),
      panelLabelEl: document.getElementById('sarPanelLabel'),
      panelNotesEl: document.getElementById('sarPanelNotes'),
      panelSaveBtn: document.getElementById('sarPanelSave'),
      panelCancelBtn: document.getElementById('sarPanelCancel'),
      panelDeleteBtn: document.getElementById('sarPanelDelete'),
      panelDfFieldsEl: document.getElementById('sarPanelDfFields'),
      panelTimestampEl: document.getElementById('sarPanelTimestamp'),
      panelTeamFieldsEl: document.getElementById('sarPanelTeamFields'),
      panelTeamEl: document.getElementById('sarPanelTeam'),
      panelBearingFieldsEl: document.getElementById('sarPanelBearingFields'),
      panelBearingTargetEl: document.getElementById('sarPanelBearingTarget'),
      panelAzimuthEl: document.getElementById('sarPanelAzimuth'),
      panelAzimuthFrameEl: document.getElementById('sarPanelAzimuthFrame'),
      panelDeclinationEl: document.getElementById('sarPanelDeclination'),
      panelAzimuthHintEl: document.getElementById('sarPanelAzimuthHint'),
      panelRangeEl: document.getElementById('sarPanelRange'),
      drawBannerEl: document.getElementById('sarLineDrawBanner'),
      drawBannerTextEl: document.getElementById('sarDrawBannerText'),
      drawFinishBtn: document.getElementById('sarLineDrawFinish'),
      drawCancelBtn: document.getElementById('sarLineDrawCancel')
    });
    if (typeof CartoffSarOperation !== 'undefined') {
      CartoffSarOperation.init({
        map: map,
        layers: layers,
        updateLegend: updateLegend,
        findCommune: (lat, lon) => CartoffCoords.findCommune(lat, lon, communeIndex),
        latLngToDfci: (lat, lon) => CartoffCoords.latLngToDfci(lat, lon),
        openMapContextMenu: openMapContextMenu,
        setupSearch: setupOperationSearch,
        sectionEl: document.getElementById('operationRechercheBlock'),
        panelEl: document.getElementById('operationPanel'),
        panelTitleEl: document.getElementById('operationPanelTitle'),
        panelTypeEl: document.getElementById('operationPanelType'),
        panelLibelleEl: document.getElementById('operationPanelLibelle'),
        panelSaveBtn: document.getElementById('operationPanelSave'),
        panelCancelBtn: document.getElementById('operationPanelCancel'),
        panelDeleteBtn: document.getElementById('operationPanelDelete'),
        drawBannerEl: document.getElementById('operationLineDrawBanner'),
        drawFinishBtn: document.getElementById('operationLineDrawFinish'),
        drawCancelBtn: document.getElementById('operationLineDrawCancel'),
        layersContainerEl: document.getElementById('operationLayers'),
        hintEl: document.getElementById('operationHint')
      });
    }
  }

  if (typeof CartoffFileImport !== 'undefined') {
    CartoffFileImport.init({
      map: map,
      listContainer: document.getElementById('importLayersList'),
      fileInput: document.getElementById('importFileInput'),
      pickBtn: document.getElementById('importFileBtn'),
      fitBoundsCheckbox: document.getElementById('importFitBounds'),
      errorEl: document.getElementById('importError'),
      layers: layers,
      layerStyles: layerStyles,
      updateLegend: updateLegend,
      polygonCanvasRenderer: polygonCanvasRenderer
    });
  }
}

setupLayers();

(async function loadAppVersion() {
  const el = document.getElementById('appVersion');
  if (!el || location.protocol === 'file:') return;
  try {
    const res = await fetch('version.json');
    if (!res.ok) return;
    const v = await res.json();
    el.textContent = 'v' + (v.version || '?') + ' · ' + (v.commit || '—');
    el.hidden = false;
  } catch { /* hors ligne ou fichier absent */ }
})();
