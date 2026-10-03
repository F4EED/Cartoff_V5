/**
 * Fond d'orientation affiché pendant la sélection d'une zone.
 *
 * Le fond opérationnel (archive locale, souvent la Loire) ne couvre pas la
 * France. Pour poser les 4 points ailleurs, on le remplace temporairement par
 * le réseau routier Protomaps (le chevelu) et les villes principales.
 * Hors ligne, les contours de départements et les villes restent affichés.
 */
(() => {
  const map = window.map;
  if (!map || !window.protomapsL) return;

  const FRANCE_BOUNDS = window.cartoffFranceBounds || L.latLngBounds([41.2, -5.5], [51.2, 9.8]);
  let token = 0;
  let overviewLayer = null;
  let deptLayer = null;
  let citiesLayer = null;
  let citiesData = null;
  let active = false;

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function refreshCities() {
    if (!citiesLayer || !citiesData || !map.hasLayer(citiesLayer)) return;
    const zoom = map.getZoom();
    citiesLayer.clearLayers();
    citiesLayer.addData({
      type: "FeatureCollection",
      features: citiesData.features.filter((feature) => {
        const props = feature.properties || {};
        if (props.capital) return true;
        if (props.deptRank === 1) return zoom >= 5;
        if (props.deptRank === 2) return zoom >= 8;
        return zoom >= 6;
      })
    });
  }

  function ensureCitiesLayer() {
    if (citiesLayer) return citiesLayer;
    citiesLayer = L.geoJSON(null, {
      interactive: false,
      pointToLayer(feature, latlng) {
        const props = feature.properties || {};
        const cls = "city-label" + (props.capital ? " is-capital" : props.deptRank === 2 ? " is-secondary" : "");
        return L.marker(latlng, {
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: cls,
            html: '<span class="city-dot"></span><span class="city-name">' + escapeHtml(props.name || "") + "</span>",
            iconSize: [0, 0],
            iconAnchor: [4, 5]
          })
        });
      }
    });
    return citiesLayer;
  }

  async function loadJson(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(url);
    return resp.json();
  }

  async function showReferenceLayers(filled) {
    if (!deptLayer) {
      const departments = await loadJson("data/france-departements.geojson");
      deptLayer = L.geoJSON(departments, {
        interactive: false,
        style: filled
          ? { color: "#7a3e14", weight: 1, fillColor: "#f3d7a4", fillOpacity: 0.92 }
          : { color: "#7a3e14", weight: 1.1, fillOpacity: 0, opacity: 0.85 }
      });
    } else {
      deptLayer.setStyle(filled
        ? { color: "#7a3e14", weight: 1, fillColor: "#f3d7a4", fillOpacity: 0.92 }
        : { color: "#7a3e14", weight: 1.1, fillOpacity: 0, opacity: 0.85 });
    }
    if (!map.hasLayer(deptLayer)) deptLayer.addTo(map);
    if (!citiesData) citiesData = await loadJson("data/france-villes.geojson");
    ensureCitiesLayer();
    if (!map.hasLayer(citiesLayer)) citiesLayer.addTo(map);
    refreshCities();
  }

  function removeOverviewLayer() {
    if (overviewLayer) {
      map.removeLayer(overviewLayer);
      overviewLayer = null;
    }
  }

  function hideReferenceLayers() {
    if (deptLayer && map.hasLayer(deptLayer)) map.removeLayer(deptLayer);
    if (citiesLayer && map.hasLayer(citiesLayer)) map.removeLayer(citiesLayer);
  }

  map.on("zoomend", () => {
    if (active) refreshCities();
  });

  async function enter() {
    const my = ++token;
    active = true;
    window.cartoffZonePicking = true;
    const selectEl = document.getElementById("basemap-select");
    if (selectEl) selectEl.disabled = true;
    if (window.suspendLocalBasemap) window.suspendLocalBasemap();
    map.fitBounds(FRANCE_BOUNDS, { padding: [28, 28], maxZoom: 6, animate: true });
    try {
      await showReferenceLayers(false);
      if (my !== token) {
        hideReferenceLayers();
        return "cancelled";
      }
      const url = new URL("pmtiles/overview.pmtiles", window.location.href).href;
      const probe = await fetch(url, { headers: { Range: "bytes=0-16383" } });
      if (probe.status !== 206) throw new Error("aperçu indisponible");
      if (my !== token) {
        hideReferenceLayers();
        return "cancelled";
      }
      removeOverviewLayer();
      overviewLayer = window.protomapsL.leafletLayer({
        url: url,
        flavor: "light",
        lang: "fr",
        levelDiff: 0,
        maxDataZoom: 15,
        maxZoom: 18
      }).addTo(map);
      if (overviewLayer.bringToBack) overviewLayer.bringToBack();
      if (deptLayer && deptLayer.bringToFront) deptLayer.bringToFront();
      return "chevelu";
    } catch (err) {
      if (my !== token) {
        hideReferenceLayers();
        removeOverviewLayer();
        return "cancelled";
      }
      removeOverviewLayer();
      try {
        await showReferenceLayers(true);
      } catch (fallbackErr) {
        console.error(fallbackErr);
      }
      console.error(err);
      return "atlas";
    }
  }

  function leave(options) {
    const restore = !options || options.restore !== false;
    token += 1;
    active = false;
    window.cartoffZonePicking = false;
    removeOverviewLayer();
    hideReferenceLayers();
    const selectEl = document.getElementById("basemap-select");
    if (selectEl && selectEl.options.length && selectEl.options[0].value) selectEl.disabled = false;
    if (restore && window.resumeLocalBasemap) window.resumeLocalBasemap();
    else if (window.discardBasemapSuspend) window.discardBasemapSuspend();
  }

  window.cartoffZoneOverview = { enter: enter, leave: leave };
})();
