import express from "express";
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import morgan from "morgan";
import cors from "cors";
import { LRUCache } from "lru-cache";

const app = express();
app.use(morgan("tiny"));

const allowedOrigins = ['http://localhost:5173', 'https://zmbm.dev'];
const corsOptions = {
  origin: function (origin, callback) {
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

/**
 * Configuration:
 * Put your mbtiles under something like:
 *   /data/mbtiles/<cycle>/<layer>/<hour>.mbtiles
 *
 * Example request:
 *   /tiles/2026010300/temp2m/000/6/18/24.png
 */
const MBTILES_ROOT = process.env.MBTILES_ROOT || path.resolve("./mbtiles");

// Cache open DB handles so we don't reopen SQLite on every request.
const dbCache = new LRUCache({
  max: 32, // number of open mbtiles files
  dispose: (db) => {
    try { db.close(); } catch {}
  },
});

// Optional: cache tile blobs for hot tiles
const tileCache = new LRUCache({
  max: 5000, // number of tiles in memory
  ttl: 30_000, // 30s TTL
});

function getDb(mbtilesPath) {
  let db = dbCache.get(mbtilesPath);
  if (db) return db;

  // Open read-only if possible
  db = new Database(mbtilesPath, { readonly: true, fileMustExist: true });

  // Some MBTiles use `tiles` table; that's standard.
  // Helpful pragmas for read performance:
  db.pragma("journal_mode = OFF");
  db.pragma("synchronous = OFF");
  db.pragma("temp_store = MEMORY");

  dbCache.set(mbtilesPath, db);
  return db;
}

function xyzToTmsY(z, y) {
  // MBTiles spec stores TMS y (flipped)
  const n = 1 << z;
  return (n - 1) - y;
}

function guessContentType(tileData, formatHint) {
  // If you always store PNG, you can hardcode image/png.
  // But let's be a bit robust.
  if (formatHint === "jpg" || formatHint === "jpeg") return "image/jpeg";
  if (formatHint === "webp") return "image/webp";
  return "image/png";
}

app.get("/tiles/:cycle/:layer/:hour/:z/:x/:y.:ext", (req, res) => {
  try {
    const { cycle, layer, hour, z, x, y, ext } = req.params;
    const zi = Number(z), xi = Number(x), yi = Number(y);
    if (!Number.isInteger(zi) || !Number.isInteger(xi) || !Number.isInteger(yi)) {
      return res.status(400).send("z/x/y must be integers");
    }
    if (zi < 0 || zi > 22) return res.status(400).send("z out of range");

    const mbtilesPath = path.join(MBTILES_ROOT, cycle, layer, `${hour}.mbtiles`);
    if (!fs.existsSync(mbtilesPath)) return res.status(404).send("mbtiles not found");

    const tmsY = xyzToTmsY(zi, yi);
    const cacheKey = `${mbtilesPath}:${zi}:${xi}:${tmsY}`;

    const cached = tileCache.get(cacheKey);
    if (cached) {
      res.setHeader("Content-Type", guessContentType(cached, ext));
      res.setHeader("Cache-Control", "public, max-age=3600"); // 1 hour
      return res.status(200).send(cached);
    }

    const db = getDb(mbtilesPath);

    const stmt = db.prepare(`
      SELECT tile_data
      FROM tiles
      WHERE zoom_level = ?
        AND tile_column = ?
        AND tile_row = ?
      LIMIT 1
    `);

    const row = stmt.get(zi, xi, tmsY);
    if (!row) return res.status(204).end(); // no tile; 204 avoids console errors in some clients

    const tileData = row.tile_data; // Buffer
    tileCache.set(cacheKey, tileData);

    res.setHeader("Content-Type", guessContentType(tileData, ext));
    res.setHeader("Cache-Control", "public, max-age=3600"); // tweak later
    return res.status(200).send(tileData);
  } catch (err) {
    console.error(err);
    return res.status(500).send("server error");
  }
});

// Basic health check
app.get("/health", (_req, res) => res.status(200).send("ok"));

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`MBTiles server on http://localhost:${port}`);
  console.log(`MBTILES_ROOT=${MBTILES_ROOT}`);
});
