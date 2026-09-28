// Serve dist/ at http://localhost:8080 to preview the website.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/util.js";

const DIST = path.join(ROOT, "dist");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".ttf": "font/ttf", ".xml": "application/xml", ".txt": "text/plain" };

http.createServer((req, res) => {
  let p = path.join(DIST, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(DIST)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
  if (!fs.existsSync(p)) { res.writeHead(404, { "Content-Type": TYPES[".html"] }); fs.createReadStream(path.join(DIST, "404.html")).pipe(res); return; }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
}).listen(8080, () => console.log("Preview: http://localhost:8080"));
