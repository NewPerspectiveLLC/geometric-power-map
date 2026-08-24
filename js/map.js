(function () {
  const KEY = "gp-map-vortex";
  const LOCK_KEY = "gp-map-locked";
  const BASE_KEY = "gp-map-basemap";
  const PLACES = {
    ra: {
      name: "Ready Athletics",
      lat: 48.11035,
      lon: -122.80591,
      parcel: [
        [48.11062, -122.80622],
        [48.11062, -122.80558],
        [48.11008, -122.80558],
        [48.11008, -122.80622]
      ]
    },
    cappy: {
      name: "Cappy's Trails",
      lat: 48.131646,
      lon: -122.799205,
      parcel: [
        [48.13203, -122.79882],
        [48.13126, -122.79881],
        [48.13126, -122.79959],
        [48.13203, -122.79960]
      ]
    }
  };

  function destPoint(lon, lat, headingDeg, meters) {
    const R = 6378137;
    const br = headingDeg * Math.PI / 180;
    const lat1 = lat * Math.PI / 180;
    const lon1 = lon * Math.PI / 180;
    const ang = meters / R;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(br));
    const lon2 = lon1 + Math.atan2(
      Math.sin(br) * Math.sin(ang) * Math.cos(lat1),
      Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2)
    );
    return { lat: lat2 * 180 / Math.PI, lon: lon2 * 180 / Math.PI };
  }

  function toCart(lat, lon) {
    const p = lat * Math.PI / 180;
    const l = lon * Math.PI / 180;
    const c = Math.cos(p);
    return [c * Math.cos(l), c * Math.sin(l), Math.sin(p)];
  }

  function fromCart(v) {
    const r = Math.hypot(v[0], v[1], v[2]) || 1;
    let lat = Math.asin(Math.max(-1, Math.min(1, v[2] / r))) * 180 / Math.PI;
    const lon = Math.atan2(v[1], v[0]) * 180 / Math.PI;
    if (lat > 85) lat = 85;
    if (lat < -85) lat = -85;
    return { lat: lat, lon: lon };
  }

  function scale(v, s) { return [v[0] * s, v[1] * s, v[2] * s]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function norm(v) {
    const r = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / r, v[1] / r, v[2] / r];
  }

  function tangentAt(lat, lon, headingDeg) {
    const p = lat * Math.PI / 180;
    const l = lon * Math.PI / 180;
    const east = [-Math.sin(l), Math.cos(l), 0];
    const north = [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)];
    const h = headingDeg * Math.PI / 180;
    return norm(add(scale(north, Math.cos(h)), scale(east, Math.sin(h))));
  }

  function geodesic(lat, lon, headingDeg, maxRad, steps) {
    const p = toCart(lat, lon);
    const t = tangentAt(lat, lon, headingDeg);
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const th = maxRad * (i / steps);
      pts.push(fromCart(add(scale(p, Math.cos(th)), scale(t, Math.sin(th)))));
    }
    return pts;
  }

  function splitDateLine(pts) {
    const parts = [[]];
    for (let i = 0; i < pts.length; i++) {
      const cur = [pts[i].lat, pts[i].lon];
      if (i && Math.abs(pts[i].lon - pts[i - 1].lon) > 180) parts.push([]);
      parts[parts.length - 1].push(cur);
    }
    return parts.filter(function (part) { return part.length > 1; });
  }

  function loadVortex() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "null");
      if (raw && Number.isFinite(raw.lat) && Number.isFinite(raw.lon)) {
        return { lat: raw.lat, lon: raw.lon, place: raw.place || "custom" };
      }
    } catch (e) {}
    return { lat: PLACES.ra.lat, lon: PLACES.ra.lon, place: "ra" };
  }

  function saveVortex(v) {
    localStorage.setItem(KEY, JSON.stringify(v));
  }

  function loadLocked() {
    return localStorage.getItem(LOCK_KEY) === "1";
  }

  function saveLocked(on) {
    localStorage.setItem(LOCK_KEY, on ? "1" : "0");
  }

  function loadBase() {
    return localStorage.getItem(BASE_KEY) === "sat" ? "sat" : "street";
  }

  function saveBase(id) {
    localStorage.setItem(BASE_KEY, id);
  }

  const start = loadVortex();
  let locked = loadLocked();
  let basemap = loadBase();

  const map = L.map("map", {
    zoomControl: true,
    attributionControl: true,
    preferCanvas: false,
    worldCopyJump: true,
    minZoom: 2
  }).setView([start.lat, start.lon], 16);

  const streetLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    noWrap: false,
    attribution: "&copy; OpenStreetMap"
  });
  const satLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      noWrap: false,
      attribution: "Tiles &copy; Esri"
    }
  );

  function applyBase() {
    if (map.hasLayer(streetLayer)) map.removeLayer(streetLayer);
    if (map.hasLayer(satLayer)) map.removeLayer(satLayer);
    if (basemap === "sat") satLayer.addTo(map);
    else streetLayer.addTo(map);
    document.getElementById("map-btn").classList.toggle("active", basemap === "street");
    document.getElementById("sat-btn").classList.toggle("active", basemap === "sat");
  }
  applyBase();

  const overlay = L.layerGroup().addTo(map);
  const pin = L.marker([start.lat, start.lon], {
    draggable: !locked,
    title: "Vortex",
    autoPan: true
  }).addTo(map);

  let vortex = start;

  function setActive(id) {
    document.getElementById("ra-btn").classList.toggle("active", id === "ra");
    document.getElementById("cappy-btn").classList.toggle("active", id === "cappy");
  }

  function nearestPlace(lat, lon) {
    let best = "custom";
    let bestD = 80;
    Object.keys(PLACES).forEach(function (id) {
      const p = PLACES[id];
      const dlat = (p.lat - lat) * 111320;
      const dlon = (p.lon - lon) * 111320 * Math.cos(lat * Math.PI / 180);
      const d = Math.hypot(dlat, dlon);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    });
    return best;
  }

  function lineStyle() {
    const z = map.getZoom();
    // Zoomed out: thick black underpaint + bright gold top for contrast on sat/street
    if (z <= 3) return { under: 10, over: 5, opacity: 1 };
    if (z <= 5) return { under: 8, over: 4, opacity: 1 };
    if (z <= 8) return { under: 6, over: 3, opacity: 0.98 };
    if (z <= 12) return { under: 5, over: 2.5, opacity: 0.95 };
    return { under: 4, over: 2, opacity: 0.92 };
  }

  function flashSave() {
    const btn = document.getElementById("save-btn");
    if (!btn) return;
    const old = btn.textContent;
    btn.textContent = "Saved";
    btn.classList.add("active");
    setTimeout(function () {
      btn.textContent = old;
      btn.classList.remove("active");
    }, 1200);
  }

  function syncLockUI() {
    document.body.classList.toggle("locked", locked);
    pin.dragging[locked ? "disable" : "enable"]();
    const status = document.getElementById("lock-status");
    status.textContent = locked ? "Locked · wedges frozen" : "Unlocked · drag or tap to move";
    status.classList.toggle("locked", locked);
    const lockBtn = document.getElementById("lock-btn");
    lockBtn.textContent = locked ? "Unlock" : "Lock vortex";
    lockBtn.classList.toggle("active", locked);
    ["ra-btn", "cappy-btn", "me-btn"].forEach(function (id) {
      document.getElementById(id).disabled = locked;
    });
  }

  function draw() {
    overlay.clearLayers();
    const lat = vortex.lat;
    const lon = vortex.lon;
    const placeId = vortex.place;
    const place = PLACES[placeId];
    const style = lineStyle();

    if (place && place.parcel) {
      L.polygon(place.parcel, {
        color: "#ffd24a",
        weight: 2,
        fillColor: "#c4a35a",
        fillOpacity: 0.14
      }).addTo(overlay);
    }

    for (let i = 0; i < 12; i++) {
      const mid = destPoint(lon, lat, i * 30 + 15, 90);
      L.marker([mid.lat, mid.lon], {
        interactive: false,
        icon: L.divIcon({
          className: "wedge-label",
          html: String(i + 1),
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        })
      }).addTo(overlay);
    }

    for (let i = 0; i < 12; i++) {
      const pts = geodesic(lat, lon, i * 30, Math.PI, 180);
      splitDateLine(pts).forEach(function (part) {
        L.polyline(part, {
          color: "#000000",
          weight: style.under,
          opacity: 0.85,
          interactive: false,
          lineCap: "round",
          lineJoin: "round"
        }).addTo(overlay);
        L.polyline(part, {
          color: "#ffd24a",
          weight: style.over,
          opacity: style.opacity,
          interactive: false,
          lineCap: "round",
          lineJoin: "round"
        }).addTo(overlay);
      });
    }

    document.getElementById("place-name").textContent = place ? place.name : "Custom vortex";
    document.getElementById("coords").textContent = lat.toFixed(6) + ", " + lon.toFixed(6);
    setActive(placeId);
  }

  function moveTo(lat, lon, place, zoom) {
    if (locked) return;
    vortex = { lat: lat, lon: lon, place: place || nearestPlace(lat, lon) };
    pin.setLatLng([lat, lon]);
    if (zoom) map.setView([lat, lon], zoom);
    saveVortex(vortex);
    draw();
  }

  pin.on("drag", function (e) {
    if (locked) return;
    const ll = e.target.getLatLng();
    vortex = { lat: ll.lat, lon: ll.lng, place: nearestPlace(ll.lat, ll.lng) };
    draw();
  });
  pin.on("dragend", function (e) {
    if (locked) return;
    const ll = e.target.getLatLng();
    moveTo(ll.lat, ll.lng);
  });
  map.on("click", function (e) {
    if (locked) return;
    moveTo(e.latlng.lat, e.latlng.lng);
  });
  map.on("zoomend", draw);

  document.getElementById("ra-btn").addEventListener("click", function () {
    moveTo(PLACES.ra.lat, PLACES.ra.lon, "ra", 17);
  });
  document.getElementById("cappy-btn").addEventListener("click", function () {
    moveTo(PLACES.cappy.lat, PLACES.cappy.lon, "cappy", 17);
  });
  document.getElementById("me-btn").addEventListener("click", function () {
    if (locked || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(function (pos) {
      moveTo(pos.coords.latitude, pos.coords.longitude, "custom", 16);
    });
  });
  document.getElementById("world-btn").addEventListener("click", function () {
    map.setView([vortex.lat, vortex.lon], 2);
  });
  document.getElementById("map-btn").addEventListener("click", function () {
    basemap = "street";
    saveBase(basemap);
    applyBase();
  });
  document.getElementById("sat-btn").addEventListener("click", function () {
    basemap = "sat";
    saveBase(basemap);
    applyBase();
  });
  document.getElementById("lock-btn").addEventListener("click", function () {
    locked = !locked;
    saveLocked(locked);
    if (locked) saveVortex(vortex);
    syncLockUI();
  });
  document.getElementById("save-btn").addEventListener("click", function () {
    saveVortex(vortex);
    saveLocked(locked);
    saveBase(basemap);
    flashSave();
  });

  syncLockUI();
  draw();
})();
