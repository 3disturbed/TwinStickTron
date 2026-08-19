// WebSocket client — connects, speaks the shared binary protocol, and
// dispatches to callbacks wired up by main.js. No game logic here.

import {
  MSG, encodeJson, decodeJson, decodeSnapshot, decodePong, encodeInput, encodePing,
} from "/shared/protocol.js";

export const net = {
  ws: null,
  connected: false,
  rttMs: 0,
  onWelcome: null, onSnapshot: null, onEvent: null, onClose: null,
  pingTimer: null,
};

export async function createRoom(mode = "run") {
  const res = await fetch("/api/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "create_failed");
  return res.json(); // {code, mode, joinUrl}
}

export function connect(code, hello) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws?room=${encodeURIComponent(code)}`);
  ws.binaryType = "arraybuffer";
  net.ws = ws;

  ws.onopen = () => {
    net.connected = true;
    ws.send(encodeJson(MSG.HELLO, hello));
    net.pingTimer = setInterval(() => {
      if (ws.readyState === 1) ws.send(encodePing(performance.now()));
    }, 2000);
  };
  ws.onmessage = (msg) => {
    const buf = msg.data;
    if (typeof buf === "string") return;
    const bytes = new Uint8Array(buf);
    const type = bytes[0];
    if (type === MSG.SNAPSHOT) {
      net.onSnapshot?.(decodeSnapshot(new DataView(buf)));
    } else if (type === MSG.EVENT) {
      net.onEvent?.(decodeJson(bytes.subarray(1)));
    } else if (type === MSG.WELCOME) {
      net.onWelcome?.(decodeJson(bytes.subarray(1)));
    } else if (type === MSG.PONG) {
      const p = decodePong(new DataView(buf));
      net.rttMs = Math.round(performance.now() - p.clientT);
    }
  };
  ws.onclose = () => {
    net.connected = false;
    clearInterval(net.pingTimer);
    net.onClose?.();
  };
  ws.onerror = () => { /* onclose follows */ };
}

export function sendInput(seq, st) {
  if (net.ws?.readyState === 1) net.ws.send(encodeInput(seq, st.mx, st.my, st.ax, st.ay, st.buttons));
}

export function sendAction(a) {
  if (net.ws?.readyState === 1) net.ws.send(encodeJson(MSG.ACTION, a));
}
