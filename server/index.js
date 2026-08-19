// UltraDark server: Express for static client + lobby REST, ws for gameplay.
// Runs behind the DarksGames nginx proxy (TLS terminated upstream);
// binds 127.0.0.1:$PORT per stack convention.

import express from "express";
import { WebSocketServer } from "ws";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { Rooms } from "./rooms.js";
import { openDb, todayUTC } from "./db.js";
import { MSG, decodeJson, encodeJson } from "../shared/protocol.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// minimal .env loader (no dependency): KEY=VALUE lines only
const envPath = path.join(ROOT, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
const PORT = Number(process.env.PORT || 3000);
const ROOM_CAP = Number(process.env.ROOM_CAP || 64);

const db = openDb(process.env.DB_PATH || path.join(ROOT, "server", "db", "ultradark.db"));
const rooms = new Rooms(ROOM_CAP);
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2kb" }));

// Rate limit room creation per IP (SDD §3.9): 10/min
const createHits = new Map();
setInterval(() => createHits.clear(), 60_000).unref();

app.post("/api/rooms", (req, res) => {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;
  const hits = (createHits.get(ip) ?? 0) + 1;
  createHits.set(ip, hits);
  if (hits > 10) return res.status(429).json({ error: "slow_down" });
  const mode = req.body?.mode === "daily" ? "daily" : "run";
  const dailySeed = mode === "daily" ? db.getDailySeed(todayUTC()) : null;
  const room = rooms.create({ db, mode, dailySeed });
  if (!room) return res.status(503).json({ error: "server_full" });
  res.json({ code: room.code, mode, joinUrl: `https://ultradark.darksgames.app/j/${room.code}` });
});

app.get("/api/daily", (_req, res) => {
  const date = todayUTC();
  db.getDailySeed(date); // ensure today's seed exists
  res.json({ date, top: db.top("daily", { date, limit: 20 }) });
});

app.get("/api/leaderboard", (req, res) => {
  const mode = req.query.mode === "daily" ? "daily" : "run";
  if (mode === "daily") {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date ?? "") ? req.query.date : todayUTC();
    return res.json({ mode, date, top: db.top("daily", { date, limit: 20 }) });
  }
  const sinceMs = req.query.period === "week" ? Date.now() - 7 * 86400_000 : 0;
  res.json({ mode, period: req.query.period === "week" ? "week" : "all", top: db.top("run", { sinceMs, limit: 20 }) });
});

app.get("/api/rooms/:code", (req, res) => {
  const room = rooms.get(req.params.code);
  if (!room) return res.status(404).json({ error: "not_found" });
  res.json({ code: room.code, players: room.size, phase: room.sim.phase, wave: room.sim.wave });
});

app.get("/api/health", (_req, res) => res.json({ ok: true, ...rooms.stats() }));

// join links serve the app; the client reads the code from the URL
app.get("/j/:code", (_req, res) => res.sendFile(path.join(ROOT, "client", "index.html")));

app.use("/shared", express.static(path.join(ROOT, "shared")));
app.use(express.static(path.join(ROOT, "client")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  ws.binaryType = "nodebuffer";
  const url = new URL(req.url, "http://x");
  const code = url.searchParams.get("room");
  const room = rooms.get(code);
  if (!room) {
    ws.send(encodeJson(MSG.EVENT, { t: "error", error: "no_such_room" }));
    ws.close();
    return;
  }
  let joined = false;
  ws.on("message", (data) => {
    try {
      if (!joined) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (buf[0] !== MSG.HELLO) { ws.close(); return; }
        const hello = decodeJson(new Uint8Array(buf.buffer, buf.byteOffset + 1, buf.length - 1));
        joined = true;
        room.join(ws, hello);
      } else {
        room.onMessage(ws, Buffer.isBuffer(data) ? data : Buffer.from(data));
      }
    } catch (err) {
      console.error("ws message error:", err.message);
      try { ws.close(); } catch { /* gone */ }
    }
  });
  ws.on("close", () => { if (joined) room.leave(ws); });
  ws.on("error", () => { /* close handler runs after */ });
});

// heartbeat: drop dead sockets so seats free up
const hb = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws._dead) { ws.terminate(); continue; }
    ws._dead = true;
    ws.ping(() => { });
  }
}, 30_000);
hb.unref();
wss.on("connection", (ws) => ws.on("pong", () => { ws._dead = false; }));

server.listen(PORT, "127.0.0.1", () => {
  console.log(`UltraDark listening on 127.0.0.1:${PORT} (room cap ${ROOM_CAP})`);
});
