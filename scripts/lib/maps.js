// Documentary-style maps drawn offline from Natural Earth country shapes (public domain).
import fs from "node:fs";
import path from "node:path";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { ROOT, FONTS_DIR } from "./util.js";

GlobalFonts.registerFromPath(path.join(FONTS_DIR, "Anton-Regular.ttf"), "Anton");
GlobalFonts.registerFromPath(path.join(FONTS_DIR, "Mukta-ExtraBold.ttf"), "MuktaXB");

let countries;
const load = () => (countries ||= JSON.parse(fs.readFileSync(path.join(ROOT, "assets/maps/countries-50m.json"), "utf8")).features);

// Degrees of longitude visible at each zoom level.
const SPAN = { world: 360, continent: 70, region: 24, country: 12, city: 4 };

const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * Math.PI) / 360));

function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const polygons = (g) => (g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []);

/** Render a map centred on lat/lon with a pin and label. */
export function renderMap({ lat, lon, zoom = "region", label = "" }, out, { w = 1920, h = 1080 } = {}) {
  if (fs.existsSync(out)) return out;
  const span = SPAN[zoom] || SPAN.region;
  const scale = w / ((span * Math.PI) / 180); // pixels per radian
  const cx = (lon * Math.PI) / 180, cy = merc(lat);
  const X = (lo) => w / 2 + ((lo * Math.PI) / 180 - cx) * scale;
  const Y = (la) => h / 2 - (merc(la) - cy) * scale;

  const c = createCanvas(w, h), ctx = c.getContext("2d");
  const sea = ctx.createRadialGradient(w / 2, h / 2, 50, w / 2, h / 2, w * 0.8);
  sea.addColorStop(0, "#0c1a2c");
  sea.addColorStop(1, "#04080f");
  ctx.fillStyle = sea;
  ctx.fillRect(0, 0, w, h);

  // Faint graticule
  ctx.strokeStyle = "rgba(120,160,200,0.08)";
  ctx.lineWidth = 1;
  const step = span > 100 ? 30 : span > 30 ? 10 : span > 10 ? 5 : 1;
  for (let lo = Math.floor((lon - span) / step) * step; lo <= lon + span; lo += step) { ctx.beginPath(); ctx.moveTo(X(lo), 0); ctx.lineTo(X(lo), h); ctx.stroke(); }
  for (let la = -80; la <= 80; la += step) { const y = Y(la); if (y < -10 || y > h + 10) continue; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

  const home = load().find((f) => polygons(f.geometry).some((p) => inRing(lon, lat, p[0])));
  for (const f of load()) {
    const isHome = f === home;
    ctx.beginPath();
    for (const poly of polygons(f.geometry)) {
      for (const ring of poly) {
        ring.forEach(([lo, la], i) => (i ? ctx.lineTo(X(lo), Y(la)) : ctx.moveTo(X(lo), Y(la))));
        ctx.closePath();
      }
    }
    ctx.fillStyle = isHome ? "#4a3322" : "#2b3d52";
    ctx.fill("evenodd");
    ctx.strokeStyle = isHome ? "#ffb74d" : "#4d6784";
    ctx.lineWidth = isHome ? 3 : 1.4;
    ctx.stroke();
  }

  // Country names for context (only those whose label point is on screen)
  if (span <= 70) {
    ctx.font = `${span <= 12 ? 30 : 24}px Anton`;
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(210,225,240,0.45)";
    const placed = [];
    for (const f of load()) {
      // Only real countries with an ISO code (skips disputed areas and tiny territories).
      if (!/^[A-Z]{3}$/.test(f.properties.iso || "")) continue;
      const ring = polygons(f.geometry).sort((a, b) => b[0].length - a[0].length)[0]?.[0];
      if (!ring || ring.length < 20) continue;
      const lo = ring.reduce((s, p) => s + p[0], 0) / ring.length, la = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      const x = X(lo), y = Y(la);
      if (x < 80 || x > w - 80 || y < 80 || y > h - 80 || Math.hypot(x - w / 2, y - h / 2) < 140) continue;
      if (placed.some(([a, b]) => Math.abs(a - x) < 170 && Math.abs(b - y) < 45)) continue;
      placed.push([x, y]);
      ctx.fillText(f.properties.name.toUpperCase(), x, y);
    }
  }

  // Pin with glow rings
  const px = w / 2, py = h / 2;
  for (const [r, a] of [[90, 0.10], [60, 0.18], [36, 0.3]]) { ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fillStyle = `rgba(229,57,53,${a})`; ctx.fill(); }
  ctx.beginPath(); ctx.arc(px, py, 16, 0, Math.PI * 2); ctx.fillStyle = "#e53935"; ctx.fill();
  ctx.lineWidth = 5; ctx.strokeStyle = "#fff"; ctx.stroke();

  if (label) {
    ctx.font = "52px Anton";
    const tw = ctx.measureText(label.toUpperCase()).width;
    const bx = Math.min(px + 40, w - tw - 70), by = py - 120;
    ctx.fillStyle = "#e53935";
    ctx.beginPath(); ctx.roundRect(bx, by, tw + 44, 76, 10); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(label.toUpperCase(), bx + 22, by + 40);
    ctx.strokeStyle = "#e53935"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(px, py - 18); ctx.lineTo(bx + 30, by + 76); ctx.stroke();
  }
  ctx.font = "22px Anton"; ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.textAlign = "right"; ctx.textBaseline = "alphabetic";
  ctx.fillText("MAP DATA: NATURAL EARTH", w - 30, h - 24);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, c.toBuffer("image/jpeg", 92));
  return out;
}
