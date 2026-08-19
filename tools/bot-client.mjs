// Real-WebSocket soak test (SDD §3.11): spins up rooms full of bots that
// play (randomly but legally) through the actual server, then reports
// snapshot throughput. Usage:
//   node tools/bot-client.mjs [--url http://127.0.0.1:3000] [--rooms 2] [--bots 4] [--seconds 20]

import WebSocket from "ws";
import {
  MSG, encodeJson, decodeJson, decodeSnapshot, encodeInput,
} from "../shared/protocol.js";
import { BTN } from "../shared/protocol.js";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const URL_BASE = arg("url", "http://127.0.0.1:3000");
const ROOMS = Number(arg("rooms", 2));
const BOTS = Number(arg("bots", 4));
const SECONDS = Number(arg("seconds", 20));

const stats = { snapshots: 0, events: 0, disconnects: 0, errors: 0, bots: 0 };

async function room(idx) {
  const res = await fetch(`${URL_BASE}/api/rooms`, { method: "POST" });
  if (!res.ok) throw new Error(`create room failed: ${res.status}`);
  const { code } = await res.json();
  for (let b = 0; b < BOTS; b++) bot(code, b, idx);
  return code;
}

function bot(code, n, roomIdx) {
  const wsUrl = URL_BASE.replace(/^http/, "ws") + `/ws?room=${code}`;
  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";
  let seq = 0, myId = 0, t = 0;
  const timers = [];
  ws.on("open", () => {
    stats.bots++;
    ws.send(encodeJson(MSG.HELLO, { name: `BOT${roomIdx}-${n}`, pilot: n % 4 }));
    timers.push(setInterval(() => {
      t++;
      const ang = t * 0.05 + n;
      ws.send(encodeInput(
        seq = (seq + 1) % 65536,
        Math.cos(ang), Math.sin(ang),
        Math.cos(t * 0.2), Math.sin(t * 0.2),
        BTN.FIRE | (t % 60 === 0 ? BTN.DASH : 0) | (t % 210 === 0 ? BTN.USE : 0),
      ));
    }, 33));
  });
  ws.on("message", (data) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const type = buf[0];
    if (type === MSG.SNAPSHOT) {
      stats.snapshots++;
      decodeSnapshot(new DataView(buf.buffer, buf.byteOffset, buf.length)); // must not throw
    } else if (type === MSG.WELCOME) {
      const w = decodeJson(new Uint8Array(buf.buffer, buf.byteOffset + 1, buf.length - 1));
      myId = w.id;
      if (n === 0) setTimeout(() => ws.send(encodeJson(MSG.ACTION, { t: "start" })), 500);
    } else if (type === MSG.EVENT) {
      stats.events++;
      const ev = decodeJson(new Uint8Array(buf.buffer, buf.byteOffset + 1, buf.length - 1));
      if (ev.t === "draft_offer" && ev.to === undefined) { /* broadcast: not ours */ }
      if (ev.t === "draft_offer" && ev.offer) ws.send(encodeJson(MSG.ACTION, { t: "pick", id: ev.offer[0] }));
      if ((ev.t === "gameover" || ev.t === "victory") && n === 0) {
        setTimeout(() => ws.send(encodeJson(MSG.ACTION, { t: "again" })), 800);
      }
    }
  });
  ws.on("close", () => { stats.disconnects++; timers.forEach(clearInterval); });
  ws.on("error", (e) => { stats.errors++; console.error(`bot error: ${e.message}`); });
  setTimeout(() => { try { ws.close(); } catch { /* done */ } }, SECONDS * 1000);
}

console.log(`soak: ${ROOMS} rooms × ${BOTS} bots for ${SECONDS}s against ${URL_BASE}`);
const codes = [];
for (let i = 0; i < ROOMS; i++) codes.push(await room(i));
console.log(`rooms: ${codes.join(", ")}`);

await new Promise((r) => setTimeout(r, SECONDS * 1000 + 2000));
const health = await fetch(`${URL_BASE}/api/health`).then(r => r.json()).catch(() => null);
console.log(`snapshots received: ${stats.snapshots} (expect ≈ ${ROOMS * BOTS * SECONDS * 15})`);
console.log(`events: ${stats.events}, clean closes: ${stats.disconnects}, errors: ${stats.errors}`);
if (health) console.log(`server health:`, JSON.stringify(health));
const expected = ROOMS * BOTS * SECONDS * 15;
if (stats.snapshots < expected * 0.7) { console.error("✗ snapshot throughput below 70% of expected"); process.exit(1); }
if (stats.errors > 0) { console.error("✗ socket errors occurred"); process.exit(1); }
console.log("soak: OK ✓");
process.exit(0);
