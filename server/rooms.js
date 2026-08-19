// Room registry: unambiguous 6-char codes, capacity gate, cleanup.

import { ROOM_CODE_ALPHABET, ROOM_CODE_LEN } from "../shared/constants.js";
import { Room } from "./room.js";

export class Rooms {
  constructor(cap) {
    this.cap = cap;
    this.map = new Map();
  }

  create() {
    if (this.map.size >= this.cap) return null; // "server full, retry" (SDD §3.5)
    let code;
    do { code = genCode(); } while (this.map.has(code));
    const room = new Room(code, (c) => this.map.delete(c));
    this.map.set(code, room);
    return room;
  }

  get(code) { return this.map.get(String(code ?? "").toUpperCase()) ?? null; }

  stats() {
    return { rooms: this.map.size, detail: [...this.map.values()].map(r => r.stats()) };
  }
}

function genCode() {
  let s = "";
  for (let i = 0; i < ROOM_CODE_LEN; i++) {
    s += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return s;
}
