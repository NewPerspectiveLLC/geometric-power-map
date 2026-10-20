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




  const HUD_KEY = "gp-map-hud-collapsed";
  const hudShow = document.getElementById("hud-toggle");
  const hudHide = document.getElementById("hud-hide");
  function setHudCollapsed(on) {
    document.body.classList.toggle("hud-collapsed", !!on);
    if (hudShow) {
      hudShow.hidden = !on;
      hudShow.setAttribute("aria-expanded", on ? "false" : "true");
    }
    if (hudHide) hudHide.setAttribute("aria-expanded", on ? "false" : "true");
    localStorage.setItem(HUD_KEY, on ? "1" : "0");
    setTimeout(function () { try { map.invalidateSize(); } catch (e) {} }, 50);
  }
  setHudCollapsed(localStorage.getItem(HUD_KEY) === "1");
  if (hudHide) hudHide.addEventListener("click", function () { setHudCollapsed(true); });
  if (hudShow) hudShow.addEventListener("click", function () { setHudCollapsed(false); });

  syncLockUI();
  draw();

  // ---- WA Power Sites layer (public institutional places only; no private residences) ----
  const POWER_SITES = [{"name": "Washington Governor's Mansion", "cat": "State government", "lat": 47.0367, "lon": -122.9037}, {"name": "Washington State Capitol (Legislative Building)", "cat": "State government", "lat": 47.0359, "lon": -122.9049}, {"name": "Temple of Justice (WA Supreme Court)", "cat": "State government", "lat": 47.0378, "lon": -122.905}, {"name": "Microsoft headquarters (Redmond campus)", "cat": "Corporate HQ", "lat": 47.6423, "lon": -122.1369}, {"name": "Amazon headquarters (Seattle, The Spheres)", "cat": "Corporate HQ", "lat": 47.6156, "lon": -122.3393}, {"name": "Boeing Everett Factory", "cat": "Industry", "lat": 47.923, "lon": -122.2717}, {"name": "Costco headquarters (Issaquah)", "cat": "Corporate HQ", "lat": 47.5503, "lon": -122.056}, {"name": "Starbucks Center (HQ, Seattle)", "cat": "Corporate HQ", "lat": 47.5806, "lon": -122.3359}, {"name": "Gates Foundation campus (Seattle)", "cat": "Philanthropy", "lat": 47.6235, "lon": -122.3466}, {"name": "Port of Seattle (Pier 69 HQ)", "cat": "Port", "lat": 47.6152, "lon": -122.3546}, {"name": "Port of Tacoma (Administration)", "cat": "Port", "lat": 47.2665, "lon": -122.4127}, {"name": "Puyallup Tribe government center", "cat": "Tribal government", "lat": 47.238, "lon": -122.4033}, {"name": "Tulalip Tribes administration", "cat": "Tribal government", "lat": 48.062, "lon": -122.283}, {"name": "Jamestown S'Klallam Tribe center (Blyn)", "cat": "Tribal government", "lat": 48.0222, "lon": -122.9978}, {"name": "Port Gamble S'Klallam Tribe center (Little Boston)", "cat": "Tribal government", "lat": 47.8608, "lon": -122.566}, {"name": "Muckleshoot Indian Tribe administration", "cat": "Tribal government", "lat": 47.262, "lon": -122.147}];
  function bearingDeg(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180, p1 = lat1 * r, p2 = lat2 * r, dl = (lon2 - lon1) * r;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return ((Math.atan2(y, x) / r) % 360 + 360) % 360;
  }
  function wedgeOf(fromLat, fromLon, lat, lon) {
    const b = bearingDeg(fromLat, fromLon, lat, lon);
    return { wedge: Math.floor(b / 30) + 1, bearing: b };
  }
  const powerLayer = L.layerGroup();
  POWER_SITES.forEach(function (s) {
    const m = L.circleMarker([s.lat, s.lon], {
      radius: 7, color: "#000", weight: 2, fillColor: "#e0457b", fillOpacity: 0.9
    });
    m.bindPopup(function () {
      const ra = PLACES.ra;
      const w = wedgeOf(ra.lat, ra.lon, s.lat, s.lon);
      let html = "<strong>" + s.name + "</strong><br>Category: " + s.cat +
        "<br>Wedge " + w.wedge + " from Ready Athletics (" + w.bearing.toFixed(1) + "&deg;)";
      if (vortex && (Math.abs(vortex.lat - ra.lat) > 1e-5 || Math.abs(vortex.lon - ra.lon) > 1e-5)) {
        const v = wedgeOf(vortex.lat, vortex.lon, s.lat, s.lon);
        html += "<br>Wedge " + v.wedge + " from current vortex (" + v.bearing.toFixed(1) + "&deg;)";
      }
      return html;
    });
    m.bindTooltip(s.name);
    m.addTo(powerLayer);
  });
  powerLayer.addTo(map);

  // ---- World Leader Residences layer (official state residences/offices only) ----
  const WORLD_RES = [{"country": "United States", "name": "White House", "role": "President", "lat": 38.8977, "lon": -77.0365, "wedge": 3}, {"country": "United States", "name": "Number One Observatory Circle", "role": "Vice President", "lat": 38.9213, "lon": -77.0671, "wedge": 3}, {"country": "United Kingdom", "name": "10 Downing Street", "role": "Prime Minister", "lat": 51.5034, "lon": -0.1276, "wedge": 2}, {"country": "United Kingdom", "name": "Buckingham Palace", "role": "Monarch (head of state)", "lat": 51.5014, "lon": -0.1419, "wedge": 2}, {"country": "France", "name": "Élysée Palace", "role": "President", "lat": 48.8704, "lon": 2.3167, "wedge": 2}, {"country": "France", "name": "Hôtel Matignon", "role": "Prime Minister", "lat": 48.8546, "lon": 2.3206, "wedge": 2}, {"country": "Russia", "name": "Moscow Kremlin", "role": "President", "lat": 55.752, "lon": 37.6175, "wedge": 1}, {"country": "China", "name": "Zhongnanhai", "role": "President / Premier", "lat": 39.913, "lon": 116.381, "wedge": 11}, {"country": "India", "name": "Rashtrapati Bhavan", "role": "President", "lat": 28.6143, "lon": 77.1994, "wedge": 12}, {"country": "India", "name": "7 Lok Kalyan Marg", "role": "Prime Minister", "lat": 28.596, "lon": 77.201, "wedge": 12}, {"country": "Japan", "name": "Kantei (Prime Minister's Office/Residence)", "role": "Prime Minister", "lat": 35.6731, "lon": 139.743, "wedge": 11}, {"country": "Japan", "name": "Tokyo Imperial Palace", "role": "Emperor", "lat": 35.6852, "lon": 139.7528, "wedge": 11}, {"country": "Germany", "name": "Bundeskanzleramt", "role": "Chancellor", "lat": 52.5202, "lon": 13.3691, "wedge": 1}, {"country": "Germany", "name": "Schloss Bellevue", "role": "President", "lat": 52.5172, "lon": 13.3533, "wedge": 1}, {"country": "Mexico", "name": "Palacio Nacional", "role": "President", "lat": 19.4326, "lon": -99.1311, "wedge": 5}, {"country": "Canada", "name": "Rideau Hall", "role": "Governor General", "lat": 45.4444, "lon": -75.6866, "wedge": 3}, {"country": "Canada", "name": "Rideau Cottage", "role": "Prime Minister", "lat": 45.4433, "lon": -75.6879, "wedge": 3}, {"country": "Canada", "name": "24 Sussex Drive", "role": "Prime Minister (official, vacant)", "lat": 45.4446, "lon": -75.6941, "wedge": 3}, {"country": "Australia", "name": "The Lodge, Canberra", "role": "Prime Minister", "lat": -35.3115, "lon": 149.124, "wedge": 9}, {"country": "Australia", "name": "Government House (Yarralumla)", "role": "Governor-General", "lat": -35.3005, "lon": 149.0855, "wedge": 9}, {"country": "New Zealand", "name": "Premier House", "role": "Prime Minister", "lat": -41.273, "lon": 174.7795, "wedge": 8}, {"country": "Italy", "name": "Palazzo del Quirinale", "role": "President", "lat": 41.8997, "lon": 12.4871, "wedge": 2}, {"country": "Italy", "name": "Palazzo Chigi", "role": "Prime Minister", "lat": 41.9009, "lon": 12.4799, "wedge": 2}, {"country": "Spain", "name": "Palacio de la Moncloa", "role": "Prime Minister", "lat": 40.443, "lon": -3.733, "wedge": 2}, {"country": "Spain", "name": "Palacio de la Zarzuela", "role": "King", "lat": 40.4765, "lon": -3.7765, "wedge": 2}, {"country": "Brazil", "name": "Palácio da Alvorada", "role": "President", "lat": -15.7929, "lon": -47.824, "wedge": 4}, {"country": "Argentina", "name": "Casa Rosada", "role": "President (office)", "lat": -34.6081, "lon": -58.3703, "wedge": 5}, {"country": "Argentina", "name": "Quinta de Olivos", "role": "President", "lat": -34.5106, "lon": -58.4931, "wedge": 5}, {"country": "South Korea", "name": "Hannam-dong Presidential Residence", "role": "President", "lat": 37.5385, "lon": 127.004, "wedge": 11}, {"country": "Israel", "name": "Beit Aghion", "role": "Prime Minister", "lat": 31.7745, "lon": 35.217, "wedge": 1}, {"country": "Turkey", "name": "Presidential Complex (Külliye)", "role": "President", "lat": 39.931, "lon": 32.799, "wedge": 1}, {"country": "South Africa", "name": "Mahlamba Ndlopfu", "role": "President", "lat": -25.74, "lon": 28.211, "wedge": 2}, {"country": "Egypt", "name": "Heliopolis Palace", "role": "President", "lat": 30.091, "lon": 31.326, "wedge": 1}, {"country": "Saudi Arabia", "name": "Al-Yamamah Palace", "role": "King", "lat": 24.69, "lon": 46.66, "wedge": 1}, {"country": "Ireland", "name": "Áras an Uachtaráin", "role": "President", "lat": 53.3597, "lon": -6.3175, "wedge": 2}, {"country": "Netherlands", "name": "Huis ten Bosch", "role": "King", "lat": 52.0928, "lon": 4.3376, "wedge": 2}, {"country": "Belgium", "name": "Royal Palace of Brussels", "role": "King", "lat": 50.8418, "lon": 4.3621, "wedge": 2}, {"country": "Sweden", "name": "Sagerska huset", "role": "Prime Minister", "lat": 59.3292, "lon": 18.0692, "wedge": 1}, {"country": "Norway", "name": "Royal Palace, Oslo", "role": "King", "lat": 59.9169, "lon": 10.7276, "wedge": 1}, {"country": "Denmark", "name": "Amalienborg", "role": "King", "lat": 55.6841, "lon": 12.5933, "wedge": 1}, {"country": "Poland", "name": "Presidential Palace, Warsaw", "role": "President", "lat": 52.2431, "lon": 21.0157, "wedge": 1}, {"country": "Ukraine", "name": "Mariinskyi Palace", "role": "President (ceremonial)", "lat": 50.4482, "lon": 30.5376, "wedge": 1}, {"country": "Portugal", "name": "Palácio de Belém", "role": "President", "lat": 38.6977, "lon": -9.2002, "wedge": 2}, {"country": "Greece", "name": "Maximos Mansion", "role": "Prime Minister", "lat": 37.9746, "lon": 23.7381, "wedge": 1}, {"country": "Austria", "name": "Hofburg", "role": "President (office)", "lat": 48.2066, "lon": 16.3655, "wedge": 1}, {"country": "Switzerland", "name": "Bernerhof / Federal Palace", "role": "Federal Council", "lat": 46.9466, "lon": 7.444, "wedge": 2}, {"country": "Philippines", "name": "Malacañang Palace", "role": "President", "lat": 14.594, "lon": 120.994, "wedge": 10}, {"country": "Indonesia", "name": "Merdeka Palace", "role": "President", "lat": -6.17, "lon": 106.824, "wedge": 10}, {"country": "Thailand", "name": "Government House", "role": "Prime Minister", "lat": 13.76, "lon": 100.515, "wedge": 11}, {"country": "Singapore", "name": "The Istana", "role": "President", "lat": 1.307, "lon": 103.843, "wedge": 11}, {"country": "Pakistan", "name": "Aiwan-e-Sadr", "role": "President", "lat": 33.73, "lon": 73.098, "wedge": 12}, {"country": "Iran", "name": "Pasteur Street Presidential Office", "role": "President", "lat": 35.692, "lon": 51.412, "wedge": 1}, {"country": "Nigeria", "name": "Aso Rock Presidential Villa", "role": "President", "lat": 9.07, "lon": 7.513, "wedge": 2}, {"country": "Kenya", "name": "State House, Nairobi", "role": "President", "lat": -1.278, "lon": 36.803, "wedge": 1}, {"country": "Chile", "name": "Palacio de La Moneda", "role": "President (office)", "lat": -33.4429, "lon": -70.6539, "wedge": 5}, {"country": "Colombia", "name": "Casa de Nariño", "role": "President", "lat": 4.5964, "lon": -74.0776, "wedge": 5}, {"country": "Peru", "name": "Palacio de Gobierno", "role": "President", "lat": -12.0453, "lon": -77.03, "wedge": 5}, {"country": "Cuba", "name": "Palacio de la Revolución", "role": "President", "lat": 23.123, "lon": -82.385, "wedge": 4}, {"country": "Vatican City", "name": "Apostolic Palace", "role": "Pope", "lat": 41.9035, "lon": 12.456, "wedge": 2}, {"country": "Finland", "name": "Kesäranta", "role": "Prime Minister", "lat": 60.188, "lon": 24.903, "wedge": 1}];
  const worldLayer = L.layerGroup();
  WORLD_RES.forEach(function (s) {
    const m = L.circleMarker([s.lat, s.lon], {
      radius: 6, color: "#000", weight: 2, fillColor: "#3a8dde", fillOpacity: 0.9
    });
    m.bindPopup(function () {
      const w = wedgeOf(PLACES.ra.lat, PLACES.ra.lon, s.lat, s.lon);
      return "<strong>" + s.name + "</strong><br>Country: " + s.country + "<br>Role: " + s.role +
        "<br>Wedge " + w.wedge + " from Port Townsend center (" + w.bearing.toFixed(1) + "&deg;)";
    });
    m.bindTooltip(s.country + ": " + s.name);
    m.addTo(worldLayer);
  });
  L.control.layers(null, { "WA Power Sites": powerLayer, "World Leader Residences": worldLayer }, { collapsed: false, position: "topright" }).addTo(map);

})();
