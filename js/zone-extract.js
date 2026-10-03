/**
 * Sélection d'une zone (4 clics) et extraction PMTiles.
 * Adapté de F4EED/pmtiles, js/zone-extract.js.
 *
 * Les clics sont pris en phase de capture pour passer au travers des calques
 * GeoJSON. Le mode est ignoré pendant un dessin de constat (classe
 * situation-line-drawing) et le menu contextuel est bloqué via
 * window.zoneSelectActive.
 */
(() => {
  const MAX_POINTS = 4;
  const btn = document.getElementById("zone-btn");
  const cancelBtn = document.getElementById("zone-cancel");
  const hintEl = document.getElementById("zone-hint");
  const statusEl = document.getElementById("extract-status");
  const dialog = document.getElementById("extract-dialog");
  const form = document.getElementById("extract-form");
  const nameInput = document.getElementById("extract-name");
  const bboxEl = document.getElementById("extract-bbox");
  const dialogCancel = document.getElementById("extract-dialog-cancel");
  const map = window.map;
  if (!map || !btn || !form || !dialog) return;

  map.createPane("zonePane");
  map.getPane("zonePane").style.zIndex = 650;

  const drawn = L.layerGroup().addTo(map);
  let points = [];
  let selecting = false;
  let pollTimer = null;
  let lastAddAt = 0;

  function setHint(text) {
    if (hintEl) hintEl.textContent = text || "";
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setStatus(html, kind) {
    if (!statusEl) return;
    statusEl.className = kind ? "extract-status is-" + kind : "extract-status";
    statusEl.innerHTML = html || "";
  }

  function clearDrawing() {
    drawn.clearLayers();
    points = [];
  }

  function stopSelecting() {
    selecting = false;
    window.zoneSelectActive = false;
    map.getContainer().classList.remove("is-selecting");
    map.doubleClickZoom.enable();
    btn.setAttribute("aria-pressed", "false");
    btn.textContent = "Sélectionner une zone";
    cancelBtn.hidden = true;
  }

  function drawingBlocked() {
    if (map.getContainer().classList.contains("situation-line-drawing")) return true;
    if (window.CartoffSar && window.CartoffSar.isDrawOrPanelActive && window.CartoffSar.isDrawOrPanelActive()) return true;
    if (window.CartoffSarOperation && window.CartoffSarOperation.isDrawOrPanelActive && window.CartoffSarOperation.isDrawOrPanelActive()) return true;
    return false;
  }

  function startSelecting() {
    if (drawingBlocked()) {
      setStatus("Terminez ou annulez le dessin en cours avant de sélectionner une zone.", "error");
      return;
    }
    if (dialog.open) dialog.close();
    clearDrawing();
    selecting = true;
    window.zoneSelectActive = true;
    map.closePopup();
    map.doubleClickZoom.disable();
    map.getContainer().classList.add("is-selecting");
    btn.setAttribute("aria-pressed", "true");
    btn.textContent = "Sélection en cours…";
    cancelBtn.hidden = false;
    setStatus("");
    setHint("Ouverture du fond France (routes et villes)…");
    if (window.cartoffZoneOverview) {
      window.cartoffZoneOverview.enter().then((mode) => {
        if (!selecting) return;
        const label = mode === "chevelu"
          ? "Fond France : réseau routier et villes principales. "
          : "Fond France : départements et villes principales. ";
        setHint(label + "Cliquez " + MAX_POINTS + " points (" + points.length + "/" + MAX_POINTS + ").");
      });
    }
  }

  function cancelSelecting() {
    stopSelecting();
    clearDrawing();
    setHint("");
    if (window.cartoffZoneOverview) window.cartoffZoneOverview.leave({ restore: true });
  }

  function orderedRing(latlngs) {
    const lat0 = latlngs.reduce((s, p) => s + p.lat, 0) / latlngs.length;
    const lon0 = latlngs.reduce((s, p) => s + p.lng, 0) / latlngs.length;
    return latlngs.slice().sort(
      (a, b) => Math.atan2(a.lat - lat0, a.lng - lon0) - Math.atan2(b.lat - lat0, b.lng - lon0)
    );
  }

  function render() {
    drawn.clearLayers();
    points.forEach((ll, i) => {
      const icon = L.divIcon({
        className: "zone-marker",
        html: "<span>" + (i + 1) + "</span>",
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });
      L.marker(ll, { icon: icon, keyboard: false, interactive: false }).addTo(drawn);
    });
    if (points.length < 2) return;
    const ring = orderedRing(points);
    L.polygon(ring, {
      pane: "zonePane",
      color: "#1d4ed8",
      weight: 2,
      fillColor: "#3b82f6",
      fillOpacity: 0.18,
      interactive: false
    }).addTo(drawn);
    if (points.length === MAX_POINTS) {
      L.rectangle(L.latLngBounds(points), {
        pane: "zonePane",
        color: "#1e3a5f",
        weight: 1,
        dashArray: "5 4",
        fill: false,
        interactive: false
      }).addTo(drawn);
    }
  }

  function fmt(n) {
    return n.toFixed(4);
  }

  function openDialog() {
    const b = L.latLngBounds(points);
    bboxEl.textContent =
      fmt(b.getWest()) + ", " + fmt(b.getSouth()) + " → " + fmt(b.getEast()) + ", " + fmt(b.getNorth()) +
      "  (" + fmt(b.getEast() - b.getWest()) + "° × " + fmt(b.getNorth() - b.getSouth()) + "°)";
    if (!nameInput.value) nameInput.value = "zone";
    dialog.showModal();
    nameInput.focus();
    nameInput.select();
  }

  function addPoint(latlng) {
    if (!selecting || !latlng) return;
    if (points.length >= MAX_POINTS) return;
    const now = Date.now();
    if (now - lastAddAt < 80) return;
    lastAddAt = now;
    points.push(latlng);
    render();
    if (points.length < MAX_POINTS) {
      setHint("Cliquez " + MAX_POINTS + " points sur la carte (" + points.length + "/" + MAX_POINTS + ").");
      return;
    }
    setHint("Zone définie. Donnez un nom au fichier PMTiles.");
    stopSelecting();
    openDialog();
  }

  window.addZonePoint = addPoint;

  map.getContainer().addEventListener("click", (ev) => {
    if (!window.zoneSelectActive) return;
    if (ev.target.closest && ev.target.closest(".leaflet-control")) return;
    L.DomEvent.stopPropagation(ev);
    L.DomEvent.preventDefault(ev);
    addPoint(map.mouseEventToLatLng(ev));
  }, true);

  map.on("popupopen", () => {
    if (window.zoneSelectActive) map.closePopup();
  });

  btn.addEventListener("click", () => {
    if (selecting) {
      cancelSelecting();
      return;
    }
    startSelecting();
  });
  cancelBtn.addEventListener("click", cancelSelecting);
  dialogCancel.addEventListener("click", () => {
    dialog.close();
    setHint("Sélection annulée. Relancez pour recommencer.");
    if (window.cartoffZoneOverview) window.cartoffZoneOverview.leave({ restore: true });
  });
  dialog.addEventListener("cancel", () => {
    setHint("Sélection annulée. Relancez pour recommencer.");
    if (window.cartoffZoneOverview) window.cartoffZoneOverview.leave({ restore: true });
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && selecting) {
      cancelSelecting();
      ev.stopPropagation();
    }
  }, true);

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    const payload = {
      name: name,
      points: points.map((p) => [p.lat, p.lng]),
      minzoom: Number(form.minzoom.value),
      maxzoom: Number(form.maxzoom.value),
      overwrite: form.overwrite.checked
    };
    dialog.close();
    setStatus("Lancement de l’extraction…", "busy");
    try {
      const resp = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await resp.json();
      if (!resp.ok) {
        setStatus(data.error || "Extraction impossible.", "error");
        if (window.cartoffZoneOverview) window.cartoffZoneOverview.leave({ restore: true });
        return;
      }
      pollJob(data.id);
    } catch (err) {
      setStatus("Erreur réseau : " + err.message, "error");
      if (window.cartoffZoneOverview) window.cartoffZoneOverview.leave({ restore: true });
    }
  });

  function pollJob(jobId) {
    if (pollTimer) clearInterval(pollTimer);
    const tick = async () => {
      try {
        const resp = await fetch("/api/jobs/" + jobId);
        const job = await resp.json();
        if (!resp.ok) {
          setStatus(job.error || "Suivi introuvable.", "error");
          clearInterval(pollTimer);
          if (window.cartoffZoneOverview) window.cartoffZoneOverview.leave({ restore: true });
          return;
        }
        if (job.status === "queued" || job.status === "running") {
          const tail = (job.log || "").trim().split("\n").slice(-2).join(" · ");
          setStatus(
            "Extraction de <strong>" + escapeHtml(job.name) + ".pmtiles</strong> en cours…" +
              (tail ? '<span class="log">' + escapeHtml(tail) + "</span>" : ""),
            "busy"
          );
          return;
        }
        clearInterval(pollTimer);
        if (job.status === "done") {
          const mb = job.size ? (job.size / 1048576).toFixed(1) : "?";
          setStatus(
            "Fond chargé : <strong>" + escapeHtml(job.name) + ".pmtiles</strong> (" + mb + " Mo). " +
              '<a href="' + escapeHtml(job.download) + '" download="' + escapeHtml(job.name) + '.pmtiles">Télécharger</a>',
            "ok"
          );
          clearDrawing();
          if (window.cartoffZoneOverview) window.cartoffZoneOverview.leave({ restore: false });
          if (window.loadLocalPmtiles) {
            window.loadLocalPmtiles(job.name).catch((err) => {
              setStatus("Fichier prêt, mais fond non chargé : " + err.message, "error");
            });
          }
          return;
        }
        setStatus(job.error || "Extraction échouée.", "error");
        if (window.cartoffZoneOverview) window.cartoffZoneOverview.leave({ restore: true });
      } catch (err) {
        setStatus("Erreur de suivi : " + err.message, "error");
        clearInterval(pollTimer);
        if (window.cartoffZoneOverview) window.cartoffZoneOverview.leave({ restore: true });
      }
    };
    tick();
    pollTimer = setInterval(tick, 2000);
  }
})();
