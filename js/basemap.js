/**
 * Chargement des fonds PMTiles locaux (adapté de F4EED/pmtiles, js/basemap.js).
 *
 * Liste les archives via GET /api/files, sonde le support HTTP Range, lit
 * l'en-tête (emprise, zooms) puis affiche la couche protomaps-leaflet.
 * Au démarrage : loire.pmtiles s'il existe, sinon l'archive la plus récente.
 *
 * Dépend de window.map, window.protomapsL, window.pmtiles.
 * Exporte window.loadLocalPmtiles et window.cartoffBasemap.
 */
(() => {
  const map = window.map;
  const selectEl = document.getElementById("basemap-select");
  const VIEW_MAX_ZOOM = 18;
  if (!map || !selectEl || !window.protomapsL) return;

  let currentLayer = null;
  let currentName = "";
  let filling = false;
  let suspendedView = null;

  const FRANCE_BOUNDS = L.latLngBounds([41.2, -5.5], [51.2, 9.8]);
  window.cartoffFranceBounds = FRANCE_BOUNDS;

  function fileUrl(name) {
    return new URL("pmtiles/" + encodeURIComponent(name) + ".pmtiles", window.location.href).href;
  }

  function showRangeError(msg) {
    console.error("PMTiles : " + msg);
    const box = document.getElementById("coords");
    if (box) {
      box.innerHTML = '<span style="color:#c62828;font-weight:bold">' + msg + "</span>";
    }
    const status = document.getElementById("extract-status");
    if (status) {
      status.className = "extract-status is-error";
      status.textContent = msg;
    }
  }

  async function refreshList(selected) {
    filling = true;
    try {
      const resp = await fetch("/api/files");
      const data = await resp.json();
      const files = data.files || [];
      const wanted = selected || currentName;
      selectEl.innerHTML = "";
      if (!files.length) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "Aucun fond disponible";
        selectEl.appendChild(opt);
        selectEl.disabled = true;
        return files;
      }
      selectEl.disabled = false;
      files.forEach((file) => {
        const opt = document.createElement("option");
        opt.value = file.name;
        const mb = (file.size / 1048576).toFixed(1);
        opt.textContent = file.name + ".pmtiles (" + mb + " Mo)";
        selectEl.appendChild(opt);
      });
      if (wanted && files.some((f) => f.name === wanted)) {
        selectEl.value = wanted;
      }
      return files;
    } catch {
      return [];
    } finally {
      filling = false;
    }
  }

  function rememberBasemap(name, header) {
    if (!header) {
      window.cartoffBasemap = { name: name, bounds: null, minZoom: null, maxDataZoom: 15 };
      return;
    }
    const bounds = L.latLngBounds(
      [header.minLat, header.minLon],
      [header.maxLat, header.maxLon]
    );
    window.cartoffBasemap = {
      name: name,
      bounds: bounds,
      minZoom: header.minZoom ?? 0,
      maxDataZoom: header.maxZoom ?? 15
    };
    map.setMinZoom(window.cartoffBasemap.minZoom);
    map.setMaxZoom(VIEW_MAX_ZOOM);
    map.setMaxBounds(bounds.pad(0.08));
  }

  async function loadBasemap(name, options) {
    const fit = !options || options.fit !== false;
    const animate = !options || options.animate !== false;
    if (!name) return;

    if (window.location.protocol === "file:") {
      throw new Error(
        "Ouvrez http://localhost:8000/ (pas le fichier index.html). Lancez start.bat ou python serve.py."
      );
    }

    const url = fileUrl(name);
    const probe = await fetch(url, { headers: { Range: "bytes=0-16383" } });
    const server = probe.headers.get("server") || "(inconnu)";
    const acceptRanges = probe.headers.get("accept-ranges");
    if (probe.status !== 206 || acceptRanges !== "bytes") {
      const hint = server.includes("Cartoff")
        ? "le fichier tuiles est peut-être absent ou corrompu (python scripts/unpack_large_file.py)"
        : "mauvais serveur (« " + server + " »). Fermez python -m http.server et lancez start.bat ou python serve.py";
      throw new Error(
        "HTTP Range requis (réponse " + probe.status + ", Accept-Ranges=" + acceptRanges + "). " + hint
      );
    }

    let header = null;
    if (window.pmtiles && window.pmtiles.PMTiles) {
      const archive = new window.pmtiles.PMTiles(url);
      header = await archive.getHeader();
    }

    if (currentLayer) {
      map.removeLayer(currentLayer);
      currentLayer = null;
    }
    window.discardBasemapSuspend();

    currentLayer = window.protomapsL.leafletLayer({
      url: url,
      flavor: "light",
      lang: "fr",
      levelDiff: 0,
      maxDataZoom: header && header.maxZoom != null ? header.maxZoom : 15,
      maxZoom: VIEW_MAX_ZOOM
    }).addTo(map);
    if (currentLayer.bringToBack) currentLayer.bringToBack();
    currentName = name;
    selectEl.value = name;
    rememberBasemap(name, header);

    if (header && fit) {
      const bounds = window.cartoffBasemap.bounds;
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15, animate: animate });
    }
    if (window.cartoffApplyZoneLayers) window.cartoffApplyZoneLayers(name);
  }

  selectEl.addEventListener("change", async () => {
    if (filling) return;
    if (!selectEl.value || selectEl.value === currentName) return;
    try {
      await loadBasemap(selectEl.value, { fit: true, animate: true });
    } catch (err) {
      showRangeError(err.message);
      selectEl.value = currentName;
    }
  });

  window.loadLocalPmtiles = async function loadLocalPmtiles(name) {
    await refreshList(name);
    selectEl.value = name;
    await loadBasemap(name, { fit: true, animate: true });
  };

  window.refreshPmtilesList = refreshList;

  window.suspendLocalBasemap = function suspendLocalBasemap() {
    if (suspendedView) return;
    suspendedView = {
      center: map.getCenter(),
      zoom: map.getZoom(),
      minZoom: map.getMinZoom(),
      maxZoom: map.getMaxZoom(),
      maxBounds: map.options.maxBounds
    };
    if (currentLayer && map.hasLayer(currentLayer)) map.removeLayer(currentLayer);
    map.setMinZoom(5);
    map.setMaxZoom(VIEW_MAX_ZOOM);
    map.setMaxBounds(FRANCE_BOUNDS.pad(0.12));
  };

  window.resumeLocalBasemap = function resumeLocalBasemap() {
    if (!suspendedView) return;
    const snap = suspendedView;
    suspendedView = null;
    map.setMinZoom(snap.minZoom);
    map.setMaxZoom(snap.maxZoom);
    if (snap.maxBounds) map.setMaxBounds(snap.maxBounds);
    if (currentLayer && !map.hasLayer(currentLayer)) currentLayer.addTo(map);
    map.setView(snap.center, snap.zoom, { animate: false });
  };

  window.discardBasemapSuspend = function discardBasemapSuspend() {
    suspendedView = null;
  };

  function startupName(files) {
    if (files.some((f) => f.name === "loire")) return "loire";
    return files.length ? files[0].name : "";
  }

  refreshList().then((files) => {
    const name = startupName(files);
    if (!name) {
      showRangeError(
        "Aucun fond PMTiles. Lancez start.bat (reconstitue loire.pmtiles) ou extrayez une zone."
      );
      return;
    }
    const keepLoireView = name === "loire";
    loadBasemap(name, { fit: !keepLoireView, animate: false }).catch((err) => {
      showRangeError(err.message || String(err));
    });
  });
})();
