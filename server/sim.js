// The authoritative simulation (SDD §3.3). One Sim per room. Everything
// that matters — health, score, multiplier, collisions, drafts — resolves
// here at 30 Hz. Clients only ever render what this file decides.

import {
  ARENA_W, ARENA_H, WALL_PAD, PLAYER, MULT, WAVE, PHASE, PS, EK, ZK,
  PILOTS, REVIVE_COST_PER_WAVE, TICK_DT, clamp,
} from "../shared/constants.js";
import { stepPlayerMovement, startDash } from "../shared/movement.js";
import { spawnPattern, PT } from "../shared/patterns.js";
import { ENEMIES } from "../shared/enemies.js";
import { computeStats, draftOffer, modById } from "../shared/mods.js";
import { BTN, PF, EF } from "../shared/protocol.js";
import { makeWave, bossHp } from "./waves.js";

const PATTERN_IDS = { RING: PT.RING, FAN: PT.FAN, SPOKES: PT.SPOKES, ORB: PT.ORB };

export class Sim {
  constructor() {
    this.phase = PHASE.LOBBY;
    this.tick = 0;
    this.wave = 0;
    this.phaseT = 0;              // seconds left in current phase (intermission)
    this.players = new Map();     // id -> player
    this.enemies = new Map();     // id -> enemy
    this.pBullets = [];
    this.eBullets = [];
    this.zones = [];
    this.events = [];             // drained by Room every tick
    this.script = null;           // current wave spawn timeline
    this.scriptT = 0;
    this.pending = [];            // warp-in spawns
    this.mult = 1;
    this.sinceKill = 999;
    this.unbanked = 0;
    this.banked = 0;
    this.bestMult = 1;
    this.eid = 1;
    this.bid = 1;
    this.offers = new Map();      // playerId -> [modId,modId,modId] during draft
  }

  // ---------- roster ----------
  addPlayer(id, name, pilot) {
    const p = {
      id, name, pilot: clamp(pilot | 0, 0, PILOTS.length - 1),
      x: ARENA_W / 2 + (id - 2) * 60, y: ARENA_H / 2, vx: 0, vy: 0,
      aim: 0, hp: PLAYER.MAX_HP, state: this.phase === PHASE.WAVE ? PS.SPECTATING : PS.ALIVE,
      mods: [], stats: computeStats(PILOTS[pilot], []),
      dashT: 0, dashCd: 0, dashCharges: 1, fireCd: 0, abilCd: 0,
      iframesT: 0, bombs: PLAYER.START_BOMBS, lives: PLAYER.SOLO_LIVES,
      downedT: 0, reviveP: 0, respawnT: 0, beingRevived: false,
      buttonsPrev: 0, input: { seq: 0, mx: 0, my: 0, ax: 0, ay: 0, buttons: 0 },
      kills: 0, picked: true,
    };
    this.players.set(id, p);
    return p;
  }
  removePlayer(id) { this.players.delete(id); }

  activeCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.state !== PS.SPECTATING) n++;
    return n;
  }
  isSolo() { return this.players.size === 1; }

  // ---------- run control ----------
  startRun() {
    this.wave = 0;
    this.mult = 1; this.bestMult = 1; this.sinceKill = 999;
    this.unbanked = 0; this.banked = 0;
    this.enemies.clear(); this.pBullets.length = 0; this.eBullets.length = 0;
    this.zones.length = 0; this.pending.length = 0;
    let i = 0;
    for (const p of this.players.values()) {
      p.state = PS.ALIVE; p.hp = PLAYER.MAX_HP; p.mods = [];
      p.stats = computeStats(PILOTS[p.pilot], []);
      p.bombs = PLAYER.START_BOMBS; p.lives = PLAYER.SOLO_LIVES; p.kills = 0;
      p.x = ARENA_W / 2 + (i++ - this.players.size / 2) * 70; p.y = ARENA_H / 2;
      p.vx = p.vy = 0; p.dashCd = 0; p.abilCd = 0; p.iframesT = 2;
    }
    this.startWave(1);
  }

  startWave(n) {
    this.wave = n;
    this.phase = PHASE.WAVE;
    this.script = makeWave(n, Math.max(1, this.activeCount()));
    this.scriptT = 0;
    this.offers.clear();
    for (const p of this.players.values()) {
      if (p.state === PS.OUT || p.state === PS.SPECTATING || p.state === PS.DOWNED) {
        p.state = PS.ALIVE; p.hp = 2; p.iframesT = 2;
        p.x = ARENA_W / 2; p.y = ARENA_H / 2;
      }
      p.picked = true;
    }
    if (this.script.boss) {
      this.spawnEnemy(this.script.boss, ARENA_W / 2, ARENA_H * 0.25, true);
      this.emit({ t: "boss", kind: this.script.boss, name: ENEMIES[this.script.boss].name });
    }
    this.emit({ t: "wave_start", wave: n });
  }

  beginIntermission() {
    this.phase = PHASE.INTERMISSION;
    this.phaseT = WAVE.INTERMISSION_S;
    this.eBullets.length = 0;
    // post-boss perks (SDD slice): heal 1, +1 bomb
    if (this.wave % WAVE.BOSS_EVERY === 0) {
      for (const p of this.players.values()) {
        if (p.state === PS.ALIVE) p.hp = Math.min(PLAYER.MAX_HP, p.hp + 1);
        p.bombs = Math.min(PLAYER.MAX_BOMBS, p.bombs + 1);
      }
    }
    for (const p of this.players.values()) {
      if (p.state === PS.SPECTATING) continue;
      p.picked = false;
      const offer = draftOffer(Math.random, this.wave);
      this.offers.set(p.id, offer);
      this.emit({ t: "draft_offer", to: p.id, offer, wave: this.wave });
    }
    this.emit({ t: "intermission", wave: this.wave, seconds: this.phaseT });
  }

  // ---------- actions from clients ----------
  action(p, a) {
    if (a.t === "start" && this.phase === PHASE.LOBBY) { this.startRun(); return; }
    if (a.t === "again" && (this.phase === PHASE.GAMEOVER || this.phase === PHASE.VICTORY)) { this.startRun(); return; }
    if (a.t === "bank" && this.phase === PHASE.INTERMISSION && this.unbanked > 0) {
      this.banked += this.unbanked;
      this.emit({ t: "bank", amount: this.unbanked, by: p.id });
      this.unbanked = 0;
      return;
    }
    if (a.t === "pick" && this.phase === PHASE.INTERMISSION && !p.picked) {
      const offer = this.offers.get(p.id) ?? [];
      if (offer.includes(a.id)) {
        p.mods.push(a.id);
        p.stats = computeStats(PILOTS[p.pilot], p.mods);
        p.picked = true;
        this.emit({ t: "picked", who: p.id, mod: a.id });
        let all = true;
        for (const q of this.players.values()) if (q.state !== PS.SPECTATING && !q.picked) all = false;
        if (all) this.phaseT = Math.min(this.phaseT, 3);
      }
    }
  }

  // ---------- main step ----------
  step(dt) {
    this.tick++;
    if (this.phase === PHASE.LOBBY || this.phase === PHASE.GAMEOVER || this.phase === PHASE.VICTORY) {
      this.stepPlayers(dt, false);
      return;
    }
    if (this.phase === PHASE.INTERMISSION) {
      this.stepPlayers(dt, false);
      this.stepZones(dt);
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        for (const p of this.players.values()) {
          if (p.state !== PS.SPECTATING && !p.picked) {
            const offer = this.offers.get(p.id) ?? [];
            if (offer.length) this.action(p, { t: "pick", id: offer[Math.floor(Math.random() * offer.length)] });
          }
        }
        if (this.wave >= WAVE.MAX) this.endRun(true);
        else this.startWave(this.wave + 1);
      }
      return;
    }
    // PHASE.WAVE
    this.stepPlayers(dt, true);
    this.stepSpawner(dt);
    this.stepEnemies(dt);
    this.stepEnemyBullets(dt);
    this.stepPlayerBullets(dt);
    this.stepOrbitals(dt);
    this.stepZones(dt);
    this.stepReviveAndRespawn(dt);
    // multiplier decay
    this.sinceKill += dt;
    if (this.sinceKill > MULT.DECAY_GRACE && this.mult > 1) {
      this.mult = Math.max(1, this.mult - MULT.DECAY_PER_S * dt);
    }
    // wave end
    if (this.scriptDone() && this.enemies.size === 0 && this.pending.length === 0) {
      this.emit({ t: "wave_end", wave: this.wave });
      if (this.wave >= WAVE.MAX) this.endRun(true);
      else this.beginIntermission();
      return;
    }
    // wipe
    let anyAlive = false;
    for (const p of this.players.values()) if (p.state === PS.ALIVE) anyAlive = true;
    if (!anyAlive && this.activeCount() > 0) this.endRun(false);
  }

  endRun(victory) {
    this.phase = victory ? PHASE.VICTORY : PHASE.GAMEOVER;
    const lost = victory ? 0 : this.unbanked;
    if (victory) { this.banked += this.unbanked; this.unbanked = 0; }
    const roster = [...this.players.values()].map(p => ({ id: p.id, name: p.name, kills: p.kills }));
    this.emit({
      t: victory ? "victory" : "gameover",
      score: this.banked, lost, wave: this.wave, bestMult: Math.round(this.bestMult * 10) / 10,
      roster,
    });
  }

  // ---------- players ----------
  stepPlayers(dt, combat) {
    for (const p of this.players.values()) {
      if (p.state !== PS.ALIVE) continue;
      const inp = p.input;
      const btn = inp.buttons, prev = p.buttonsPrev;
      // aim
      if (Math.hypot(inp.ax, inp.ay) > 0.25) p.aim = Math.atan2(inp.ay, inp.ax);
      // dash (edge)
      p.dashCd = Math.max(0, p.dashCd - dt);
      if ((btn & BTN.DASH) && !(prev & BTN.DASH) && p.dashCd <= 0) {
        startDash(p, { mx: inp.mx, my: inp.my });
        p.dashCd = PLAYER.DASH_CD + (p.stats.dashPenalty ?? 0);
        p.iframesT = Math.max(p.iframesT, PLAYER.DASH_IFRAMES);
        if (p.stats.nova > 0 && combat) this.novaBurst(p);
        this.emit({ t: "dash", who: p.id });
      }
      stepPlayerMovement(p, { mx: inp.mx, my: inp.my }, p.stats, dt);
      p.iframesT = Math.max(0, p.iframesT - dt);
      p.fireCd = Math.max(0, p.fireCd - dt);
      p.abilCd = Math.max(0, p.abilCd - dt);
      // fire
      if ((btn & BTN.FIRE) && p.fireCd <= 0) {
        this.fire(p);
        p.fireCd = PLAYER.FIRE_CD / p.stats.fire;
      }
      if (combat) {
        // bomb (edge)
        if ((btn & BTN.BOMB) && !(prev & BTN.BOMB) && p.bombs > 0) this.smartBomb(p);
        // ability (edge)
        if ((btn & BTN.ABILITY) && !(prev & BTN.ABILITY) && p.abilCd <= 0) this.ability(p);
      }
      p.buttonsPrev = btn;
    }
  }

  fire(p) {
    const n = 1 + p.stats.split;
    const speed = PLAYER.BULLET_SPEED * p.stats.bulletSpeed;
    for (let i = 0; i < n; i++) {
      const off = n === 1 ? 0 : (i - (n - 1) / 2) * 0.14;
      const a = p.aim + off;
      this.pBullets.push({
        id: this.bid = (this.bid % 65000) + 1,
        x: p.x + Math.cos(a) * 18, y: p.y + Math.sin(a) * 18,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        dmg: p.stats.dmg, pierce: p.stats.pierce, ricochet: p.stats.ricochet,
        life: PLAYER.BULLET_LIFE, owner: p.id,
      });
    }
  }

  smartBomb(p) {
    p.bombs--;
    this.eBullets.length = 0;
    for (const e of this.enemies.values()) {
      if (e.warpT > 0) continue;
      this.damageEnemy(e, e.def.boss ? 4 : 2, p);
    }
    this.emit({ t: "bomb", who: p.id, x: p.x, y: p.y });
  }

  ability(p) {
    p.abilCd = PLAYER.ABILITY_CD;
    const aim = p.aim;
    if (p.pilot === 0) { // VANTA — Blink Volley
      p.x = clamp(p.x + Math.cos(aim) * 180, WALL_PAD, ARENA_W - WALL_PAD);
      p.y = clamp(p.y + Math.sin(aim) * 180, WALL_PAD, ARENA_H - WALL_PAD);
      p.iframesT = Math.max(p.iframesT, 0.3);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        this.pBullets.push({
          id: this.bid = (this.bid % 65000) + 1,
          x: p.x, y: p.y, vx: Math.cos(a) * 560, vy: Math.sin(a) * 560,
          dmg: p.stats.dmg, pierce: 0, ricochet: 0, life: 0.8, owner: p.id,
        });
      }
    } else if (p.pilot === 1) { // EMBER — Flame Zone
      this.zones.push({ kind: ZK.FLAME, x: p.x + Math.cos(aim) * 120, y: p.y + Math.sin(aim) * 120, r: 90, ttl: 4, owner: p.id });
    } else if (p.pilot === 2) { // HALO — Aegis Field
      this.zones.push({ kind: ZK.AEGIS, x: p.x, y: p.y, r: 220, ttl: 6, owner: p.id });
    } else if (p.pilot === 3) { // ONYX — Gravity Well
      this.zones.push({
        kind: ZK.WELL, x: clamp(p.x + Math.cos(aim) * 250, WALL_PAD, ARENA_W - WALL_PAD),
        y: clamp(p.y + Math.sin(aim) * 250, WALL_PAD, ARENA_H - WALL_PAD), r: 130, ttl: 2.5, owner: p.id,
      });
    }
    this.emit({ t: "ability", who: p.id, pilot: p.pilot });
  }

  novaBurst(p) {
    for (const e of this.enemies.values()) {
      if (e.warpT > 0) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < 140) this.damageEnemy(e, p.stats.nova, p);
    }
    this.emit({ t: "nova", x: p.x, y: p.y });
  }

  applyPlayerHit(p, dmg) {
    if (p.state !== PS.ALIVE || p.iframesT > 0) return;
    let shielded = false;
    for (const z of this.zones) {
      if (z.kind === ZK.AEGIS && Math.hypot(p.x - z.x, p.y - z.y) < z.r) { shielded = true; break; }
    }
    if (!shielded) this.mult = Math.max(1, this.mult * MULT.HIT_FACTOR);
    p.hp -= dmg;
    p.iframesT = PLAYER.HIT_IFRAMES;
    this.emit({ t: "hurt", who: p.id, hp: p.hp });
    if (p.hp <= 0) this.downPlayer(p);
  }

  downPlayer(p) {
    if (this.isSolo() || this.activeCount() === 1) {
      p.lives--;
      if (p.lives >= 0) { // solo: burn a life, respawn shortly
        p.state = PS.DOWNED; p.respawnT = 2; p.downedT = 0;
        this.emit({ t: "downed", who: p.id, solo: true, lives: p.lives });
      } else {
        p.state = PS.OUT;
        this.emit({ t: "downed", who: p.id, solo: true, lives: 0 });
      }
    } else {
      p.state = PS.DOWNED; p.downedT = PLAYER.DOWNED_TIMEOUT; p.reviveP = 0;
      this.emit({ t: "downed", who: p.id, solo: false });
    }
  }

  stepReviveAndRespawn(dt) {
    for (const p of this.players.values()) {
      if (p.state !== PS.DOWNED) continue;
      if (p.respawnT > 0) { // solo respawn
        p.respawnT -= dt;
        if (p.respawnT <= 0) {
          p.state = PS.ALIVE; p.hp = PLAYER.MAX_HP; p.iframesT = 2;
          p.x = ARENA_W / 2; p.y = ARENA_H / 2; p.vx = p.vy = 0;
          this.emit({ t: "revived", who: p.id, solo: true });
        }
        continue;
      }
      // co-op core revive
      let reviver = null;
      for (const q of this.players.values()) {
        if (q.state === PS.ALIVE && Math.hypot(q.x - p.x, q.y - p.y) < PLAYER.REVIVE_RANGE) {
          if (!reviver || q.stats.reviveSpeed > reviver.stats.reviveSpeed) reviver = q;
        }
      }
      p.beingRevived = !!reviver;
      if (reviver) {
        p.reviveP += dt * reviver.stats.reviveSpeed / PLAYER.REVIVE_TIME;
        if (p.reviveP >= 1) {
          const cost = Math.min(this.banked, REVIVE_COST_PER_WAVE * this.wave);
          this.banked -= cost;
          p.state = PS.ALIVE; p.hp = 2; p.iframesT = 2; p.reviveP = 0;
          this.emit({ t: "revived", who: p.id, by: reviver.id, cost });
        }
      } else {
        p.reviveP = Math.max(0, p.reviveP - dt * 0.5);
        p.downedT -= dt;
        if (p.downedT <= 0) { p.state = PS.OUT; this.emit({ t: "out", who: p.id }); }
      }
    }
  }

  // ---------- spawning ----------
  scriptDone() { return this.script && this.scriptT > (this.script.entries.at(-1)?.t ?? 0) && this.script.entries.every(e => e.done); }

  stepSpawner(dt) {
    this.scriptT += dt;
    for (const e of this.script.entries) {
      if (!e.done && e.t <= this.scriptT) {
        e.done = true;
        for (let i = 0; i < e.count; i++) this.spawnAtEdge(e.kind);
      }
    }
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const s = this.pending[i];
      s.t -= dt;
      if (s.t <= 0) { this.pending.splice(i, 1); this.spawnEnemy(s.kind, s.x, s.y, false); }
    }
  }

  spawnAtEdge(kind) {
    let best = null, bestD = -1;
    for (let tries = 0; tries < 8; tries++) {
      const side = Math.floor(Math.random() * 4);
      const x = side === 0 ? WALL_PAD : side === 1 ? ARENA_W - WALL_PAD : WALL_PAD + Math.random() * (ARENA_W - WALL_PAD * 2);
      const y = side < 2 ? WALL_PAD + Math.random() * (ARENA_H - WALL_PAD * 2) : side === 2 ? WALL_PAD : ARENA_H - WALL_PAD;
      let d = Infinity;
      for (const p of this.players.values()) if (p.state === PS.ALIVE) d = Math.min(d, Math.hypot(p.x - x, p.y - y));
      if (d >= WAVE.SPAWN_MIN_DIST) { best = { x, y }; break; }
      if (d > bestD) { bestD = d; best = { x, y }; }
    }
    this.pending.push({ kind, x: best.x, y: best.y, t: WAVE.WARP_IN_S });
    this.zones.push({ kind: ZK.WARP, x: best.x, y: best.y, r: ENEMIES[kind].radius + 10, ttl: WAVE.WARP_IN_S });
  }

  spawnEnemy(kind, x, y, isBoss) {
    const def = ENEMIES[kind];
    const hp = isBoss ? bossHp(kind, Math.max(1, this.activeCount())) : def.hp;
    const e = {
      id: this.eid = (this.eid % 65000) + 1,
      kind, def, x, y, vx: 0, vy: 0,
      hp, maxHp: hp,
      speed: def.speed * (1 + this.wave * 0.03),
      fireT: (def.fireEvery ?? 0) * (0.5 + Math.random() * 0.5),
      wanderT: 0, wanderA: Math.random() * Math.PI * 2,
      sinePhase: Math.random() * Math.PI * 2, t: 0,
      warpT: isBoss ? 0 : 0, enraged: false, spokeAngle: Math.random() * Math.PI * 2,
    };
    this.enemies.set(e.id, e);
  }

  // ---------- enemies ----------
  nearestAlive(x, y) {
    let best = null, bd = Infinity;
    for (const p of this.players.values()) {
      if (p.state !== PS.ALIVE) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  stepEnemies(dt) {
    for (const e of this.enemies.values()) {
      e.t += dt;
      const def = e.def;
      const target = this.nearestAlive(e.x, e.y);
      const ai = def.ai;
      if (ai === "seek" || ai === "boss_brute") {
        if (target) {
          const d = Math.hypot(target.x - e.x, target.y - e.y) || 1;
          const sp = e.speed * (e.enraged ? 1.8 : 1);
          e.vx = ((target.x - e.x) / d) * sp; e.vy = ((target.y - e.y) / d) * sp;
        }
      } else if (ai === "weave") {
        if (target) {
          const d = Math.hypot(target.x - e.x, target.y - e.y) || 1;
          const px = -(target.y - e.y) / d, py = (target.x - e.x) / d;
          const s = Math.sin(e.t * 3 + e.sinePhase) * 90;
          e.vx = ((target.x - e.x) / d) * e.speed + px * s;
          e.vy = ((target.y - e.y) / d) * e.speed + py * s;
        }
      } else if (ai === "wander") {
        e.wanderT -= dt;
        if (e.wanderT <= 0) { e.wanderT = 1 + Math.random() * 1.5; e.wanderA = Math.random() * Math.PI * 2; }
        e.vx = Math.cos(e.wanderA) * e.speed; e.vy = Math.sin(e.wanderA) * e.speed;
      } else if (ai === "mortar") {
        const cx = ARENA_W / 2, cy = ARENA_H / 2;
        e.vx = (cx - e.x) * 0.02; e.vy = (cy - e.y) * 0.02;
      } else if (ai === "boss_hex") {
        const cx = ARENA_W / 2, cy = ARENA_H / 2;
        e.vx = (cx - e.x) * 0.05; e.vy = (cy - e.y) * 0.05;
      }
      e.x = clamp(e.x + e.vx * dt, WALL_PAD, ARENA_W - WALL_PAD);
      e.y = clamp(e.y + e.vy * dt, WALL_PAD, ARENA_H - WALL_PAD);

      // firing
      if (def.fireEvery && target) {
        e.fireT -= dt;
        if (e.fireT <= 0) {
          e.fireT = def.fireEvery * (e.enraged ? 0.55 : 1);
          const aimA = Math.atan2(target.y - e.y, target.x - e.x);
          if (ai === "weave" || (ai === "boss_brute" && e.enraged)) {
            this.emitPattern(PT.FAN, e.x, e.y, aimA);
          } else if (ai === "mortar") {
            this.zones.push({ kind: ZK.MORTAR_TELE, x: target.x, y: target.y, r: def.shellRadius, ttl: def.shellDelay, dmgPlayers: true });
          } else if (ai === "boss_brute") {
            this.emitPattern(PT.RING, e.x, e.y, 0);
          } else if (ai === "boss_hex") {
            e.spokeAngle += e.enraged ? 0.52 : 0.35;
            this.emitPattern(PT.SPOKES, e.x, e.y, e.spokeAngle);
            if (Math.floor(e.t / 6) > Math.floor((e.t - dt) / 6)) {
              this.spawnAtEdge(EK.WEAVER); this.spawnAtEdge(EK.WEAVER);
            }
          }
        }
      }
      if (def.boss && !e.enraged && e.hp <= e.maxHp * 0.5) {
        e.enraged = true;
        this.emit({ t: "enrage", id: e.id });
      }

      // contact damage
      for (const p of this.players.values()) {
        if (p.state !== PS.ALIVE) continue;
        const d = Math.hypot(p.x - e.x, p.y - e.y);
        if (d < def.radius + PLAYER.RADIUS) {
          this.applyPlayerHit(p, 1);
          const push = 60 / (d || 1);
          e.x -= (p.x - e.x) * push * 0.2; e.y -= (p.y - e.y) * push * 0.2;
        }
      }
    }
  }

  emitPattern(pid, x, y, angle) {
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const bullets = spawnPattern(pid, seed, x, y, angle);
    for (const b of bullets) this.eBullets.push(b);
    this.emit({ t: "pattern", pid, seed, x: Math.round(x), y: Math.round(y), angle: Math.round(angle * 1000) / 1000 });
  }

  stepEnemyBullets(dt) {
    for (let i = this.eBullets.length - 1; i >= 0; i--) {
      const b = this.eBullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < 0 || b.x > ARENA_W || b.y < 0 || b.y > ARENA_H) { this.eBullets.splice(i, 1); continue; }
      for (const p of this.players.values()) {
        if (p.state !== PS.ALIVE || p.iframesT > 0) continue;
        if (Math.hypot(p.x - b.x, p.y - b.y) < PLAYER.RADIUS + b.r) {
          this.applyPlayerHit(p, 1);
          this.eBullets.splice(i, 1);
          break;
        }
      }
    }
  }

  stepPlayerBullets(dt) {
    const aoeQueue = [];
    for (let i = this.pBullets.length - 1; i >= 0; i--) {
      const b = this.pBullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0) { this.pBullets.splice(i, 1); continue; }
      if (b.x < 4 || b.x > ARENA_W - 4) {
        if (b.ricochet > 0) { b.ricochet--; b.vx = -b.vx; b.x = clamp(b.x, 4, ARENA_W - 4); }
        else { this.pBullets.splice(i, 1); continue; }
      }
      if (b.y < 4 || b.y > ARENA_H - 4) {
        if (b.ricochet > 0) { b.ricochet--; b.vy = -b.vy; b.y = clamp(b.y, 4, ARENA_H - 4); }
        else { this.pBullets.splice(i, 1); continue; }
      }
      for (const e of this.enemies.values()) {
        if (e.warpT > 0) continue;
        if (Math.hypot(e.x - b.x, e.y - b.y) < e.def.radius + 5) {
          const killer = this.players.get(b.owner);
          const died = this.damageEnemy(e, b.dmg, killer, aoeQueue);
          if (died || b.pierce <= 0) { this.pBullets.splice(i, 1); }
          else b.pierce--;
          break;
        }
      }
    }
    // resolve on-kill blast chains iteratively (no recursion blowups)
    while (aoeQueue.length) {
      const { x, y, dmg, killer } = aoeQueue.pop();
      for (const e of this.enemies.values()) {
        if (e.warpT > 0) continue;
        if (Math.hypot(e.x - x, e.y - y) < 80) this.damageEnemy(e, dmg, killer, aoeQueue);
      }
    }
  }

  damageEnemy(e, dmg, killer, aoeQueue) {
    if (!this.enemies.has(e.id)) return false;
    e.hp -= dmg;
    if (e.hp > 0) return false;
    this.enemies.delete(e.id);
    const def = e.def;
    // score & multiplier
    const bounty = killer?.stats.bounty ?? 1;
    const overdrive = this.mult >= MULT.MAX - 0.05;
    const points = Math.round(def.score * this.mult * bounty * (overdrive ? 2 : 1));
    this.unbanked += points;
    this.mult = Math.min(MULT.MAX, this.mult + MULT.PER_KILL);
    this.bestMult = Math.max(this.bestMult, this.mult);
    this.sinceKill = 0;
    if (killer) killer.kills++;
    this.emit({ t: "kill", kind: e.kind, x: Math.round(e.x), y: Math.round(e.y), points, who: killer?.id ?? 0 });
    // death effects
    if (def.onDeath?.pattern) this.emitPattern(PATTERN_IDS[def.onDeath.pattern], e.x, e.y, 0);
    if (def.onDeath?.split) {
      for (let i = 0; i < def.onDeath.count; i++) {
        const a = (i / def.onDeath.count) * Math.PI * 2;
        this.spawnEnemy(def.onDeath.split, clamp(e.x + Math.cos(a) * 30, WALL_PAD, ARENA_W - WALL_PAD), clamp(e.y + Math.sin(a) * 30, WALL_PAD, ARENA_H - WALL_PAD), false);
      }
    }
    if (killer?.stats.blast > 0 && aoeQueue) aoeQueue.push({ x: e.x, y: e.y, dmg: killer.stats.blast, killer });
    if (def.boss) {
      for (const p of this.players.values()) p.bombs = Math.min(PLAYER.MAX_BOMBS, p.bombs + 1);
      this.emit({ t: "boss_down", kind: e.kind });
    }
    return true;
  }

  stepOrbitals(dt) {
    for (const p of this.players.values()) {
      if (p.state !== PS.ALIVE || p.stats.orbitals <= 0) continue;
      const k = p.stats.orbitals;
      for (let i = 0; i < k; i++) {
        const a = this.tick * TICK_DT * 3 + (i / k) * Math.PI * 2;
        const ox = p.x + Math.cos(a) * 60, oy = p.y + Math.sin(a) * 60;
        for (const e of this.enemies.values()) {
          if (e.warpT > 0) continue;
          if (Math.hypot(e.x - ox, e.y - oy) < e.def.radius + 14) this.damageEnemy(e, 2.5 * dt, p);
        }
      }
    }
  }

  stepZones(dt) {
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.ttl -= dt;
      if (z.kind === ZK.FLAME) {
        const owner = this.players.get(z.owner);
        for (const e of this.enemies.values()) {
          if (e.warpT > 0) continue;
          if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.def.radius) this.damageEnemy(e, 2 * dt, owner);
        }
      } else if (z.kind === ZK.WELL) {
        for (const e of this.enemies.values()) {
          const d = Math.hypot(e.x - z.x, e.y - z.y);
          if (d < z.r * 2 && d > 4) {
            e.x += ((z.x - e.x) / d) * 140 * dt;
            e.y += ((z.y - e.y) / d) * 140 * dt;
          }
        }
      }
      if (z.ttl <= 0) {
        if (z.kind === ZK.MORTAR_TELE) {
          for (const p of this.players.values()) {
            if (p.state === PS.ALIVE && Math.hypot(p.x - z.x, p.y - z.y) < z.r) this.applyPlayerHit(p, 1);
          }
          this.zones.push({ kind: ZK.BLAST, x: z.x, y: z.y, r: z.r, ttl: 0.25 });
        } else if (z.kind === ZK.WELL) {
          const owner = this.players.get(z.owner);
          for (const e of this.enemies.values()) {
            if (Math.hypot(e.x - z.x, e.y - z.y) < z.r) this.damageEnemy(e, 3, owner);
          }
          this.zones.push({ kind: ZK.BLAST, x: z.x, y: z.y, r: z.r, ttl: 0.25 });
        }
        this.zones.splice(i, 1);
      }
    }
  }

  // ---------- output ----------
  emit(ev) { this.events.push(ev); }

  buildSnapshot() {
    const players = [];
    for (const p of this.players.values()) {
      let flags = 0;
      if (p.dashT > 0) flags |= PF.DASHING;
      if (p.iframesT > 0) flags |= PF.IFRAMES;
      if (p.beingRevived) flags |= PF.REVIVING;
      if (this.mult >= MULT.MAX - 0.05) flags |= PF.OVERDRIVE;
      players.push({
        id: p.id, pilot: p.pilot, state: p.state, x: p.x, y: p.y, aim: p.aim,
        hp: Math.max(0, p.hp), dashCd: p.dashCd, abilCd: Math.ceil(p.abilCd),
        bombs: p.bombs, flags,
      });
    }
    const enemies = [];
    for (const e of this.enemies.values()) {
      let flags = 0;
      if (e.enraged) flags |= EF.ENRAGED;
      if (e.warpT > 0) flags |= EF.WARPING;
      enemies.push({
        id: e.id, kind: e.kind, x: e.x, y: e.y,
        hpPct: Math.max(1, Math.ceil((e.hp / e.maxHp) * 100)), flags,
      });
    }
    const bullets = this.pBullets.map(b => ({ id: b.id, x: b.x, y: b.y, owner: b.owner }));
    const zones = this.zones.map(z => ({ kind: z.kind, x: z.x, y: z.y, r: z.r, ttl: z.ttl }));
    return {
      tick: this.tick, phase: this.phase, wave: this.wave,
      phaseT: Math.max(0, Math.round(this.phaseT * 30)), // ticks remaining
      mult: this.mult, unbanked: Math.round(this.unbanked), banked: Math.round(this.banked),
      enemiesLeft: this.enemies.size + this.pending.length,
      players, enemies, bullets, zones,
    };
  }
}
