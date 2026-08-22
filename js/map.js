(function () {
  const KEY = "gp-map-vortex";
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

  const start = loadVortex();
  const map = L.map("map", {
    zoomControl: true,
    attributionControl: true,
    preferCanvas: false,
    worldCopyJump: true,
    minZoom: 2
  }).setView([start.lat, start.lon], 16);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    noWrap: false,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);

  const overlay = L.layerGroup().addTo(map);
  const pin = L.marker([start.lat, start.lon], {
    draggable: true,
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

  function draw() {
    overlay.clearLayers();
    const lat = vortex.lat;
    const lon = vortex.lon;
    const placeId = vortex.place;
    const place = PLACES[placeId];

    if (place && place.parcel) {
      L.polygon(place.parcel, {
        color: "#c4a35a",
        weight: 2,
        fillColor: "#c4a35a",
        fillOpacity: 0.12
      }).addTo(overlay);
    }

    for (let i = 0; i < 12; i++) {
      const a = i * 30;
      const b = (i + 1) * 30;
      const edge1 = geodesic(lat, lon, a, 0.055, 12);
      const edge2 = geodesic(lat, lon, b, 0.055, 12).slice().reverse();
      const local = [[lat, lon]].concat(edge1.map(function (p) { return [p.lat, p.lon]; })).concat(edge2.map(function (p) { return [p.lat, p.lon]; }));
      L.polygon(local, {
        color: "#c4a35a",
        weight: 0,
        fillColor: i % 2 === 0 ? "#c4a35a" : "#8a3a32",
        fillOpacity: 0.16,
        interactive: false
      }).addTo(overlay);
      const mid = destPoint(lon, lat, a + 15, 90);
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
          color: "#f3ead6",
          weight: 1.6,
          opacity: 0.88,
          interactive: false
        }).addTo(overlay);
      });
    }

    document.getElementById("place-name").textContent = place ? place.name : "Custom vortex";
    document.getElementById("coords").textContent = lat.toFixed(6) + ", " + lon.toFixed(6);
    setActive(placeId);
  }

  function moveTo(lat, lon, place, zoom) {
    vortex = { lat: lat, lon: lon, place: place || nearestPlace(lat, lon) };
    pin.setLatLng([lat, lon]);
    if (zoom) map.setView([lat, lon], zoom);
    saveVortex(vortex);
    draw();
  }

  pin.on("drag", function (e) {
    const ll = e.target.getLatLng();
    vortex = { lat: ll.lat, lon: ll.lng, place: nearestPlace(ll.lat, ll.lng) };
    draw();
  });
  pin.on("dragend", function (e) {
    const ll = e.target.getLatLng();
    moveTo(ll.lat, ll.lng);
  });
  map.on("click", function (e) {
    moveTo(e.latlng.lat, e.latlng.lng);
  });

  document.getElementById("ra-btn").addEventListener("click", function () {
    moveTo(PLACES.ra.lat, PLACES.ra.lon, "ra", 17);
  });
  document.getElementById("cappy-btn").addEventListener("click", function () {
    moveTo(PLACES.cappy.lat, PLACES.cappy.lon, "cappy", 17);
  });
  document.getElementById("me-btn").addEventListener("click", function () {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(function (pos) {
      moveTo(pos.coords.latitude, pos.coords.longitude, "custom", 16);
    });
  });
  const worldBtn = document.getElementById("world-btn");
  if (worldBtn) {
    worldBtn.addEventListener("click", function () {
      map.setView([vortex.lat, vortex.lon], 2);
    });
  }

  draw();
})();
