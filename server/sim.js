// The authoritative simulation (SDD §3.3). One Sim per room. Everything
// that matters — health, score, multiplier, collisions, drafts — resolves
// here at 30 Hz. Clients only ever render what this file decides.

import {
  ARENA_W, ARENA_H, WALL_PAD, PLAYER, MULT, WAVE, PHASE, PS, EK, ZK,
  PILOTS, REVIVE_COST_PER_WAVE, TICK_DT, ORBITAL, PICKUP, clamp,
} from "../shared/constants.js";
import { CK, rollConsumable } from "../shared/consumables.js";
import { stepPlayerMovement, startDash } from "../shared/movement.js";
import { spawnPattern, PT } from "../shared/patterns.js";
import { ENEMIES } from "../shared/enemies.js";
import { computeStats, draftOffer, modById, classModsFor } from "../shared/mods.js";
import { mulberry32 } from "../shared/rng.js";
import { BTN, PF, EF } from "../shared/protocol.js";
import { makeWave, bossHp } from "./waves.js";

const PATTERN_IDS = { RING: PT.RING, FAN: PT.FAN, SPOKES: PT.SPOKES, ORB: PT.ORB };
const E_BULLET_CAP = 1200;

export class Sim {
  constructor() {
    this.phase = PHASE.LOBBY;
    this.tick = 0;
    this.wave = 0;
    this.phaseT = 0;
    this.players = new Map();
    this.enemies = new Map();
    this.pBullets = [];
    this.eBullets = [];
    this.zones = [];
    this.events = [];
    this.script = null;
    this.scriptT = 0;
    this.pending = [];
    this.mult = 1;
    this.sinceKill = 999;
    this.unbanked = 0;
    this.banked = 0;
    this.bestMult = 1;
    this.eid = 1;
    this.bid = 1;
    this.offers = new Map();
    this.dailySeed = null;   // set for Daily Dark / challenge rooms — waves become deterministic
    this.runSeed = (Math.random() * 0xffffffff) >>> 0;
    this._wardens = [];
    this.pickups = new Map();
    this.pkid = 1;
    this.stasisT = 0;
    this.rngDrop = Math.random; // injectable for tests
  }

  hpMax(p) { return Math.max(1, PLAYER.MAX_HP + (p.stats.maxHp | 0)); }

  // ---------- roster ----------
  addPlayer(id, name, pilot) {
    const p = {
      id, name, pilot: clamp(pilot | 0, 0, PILOTS.length - 1),
      x: ARENA_W / 2 + (id - 2) * 60, y: ARENA_H / 2, vx: 0, vy: 0,
      aim: 0, hp: PLAYER.MAX_HP, state: this.phase === PHASE.WAVE ? PS.SPECTATING : PS.ALIVE,
      mods: [], stats: computeStats(PILOTS[pilot], []),
      dashT: 0, dashCd: 0, dashStock: 1, fireCd: 0, abilCd: 0,
      iframesT: 0, bombs: PLAYER.START_BOMBS, lives: PLAYER.SOLO_LIVES,
      downedT: 0, reviveP: 0, respawnT: 0, beingRevived: false,
      dashDmgT: 0, rageT: 0, staticT: 2.2, lastCause: "",
      cons: [], frenzyT: 0,
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
    this.runSeed = this.dailySeed ?? ((Math.random() * 0xffffffff) >>> 0);
    this.wave = 0;
    this.mult = 1; this.bestMult = 1; this.sinceKill = 999;
    this.unbanked = 0; this.banked = 0;
    this.enemies.clear(); this.pBullets.length = 0; this.eBullets.length = 0;
    this.zones.length = 0; this.pending.length = 0;
    this.pickups.clear(); this.stasisT = 0;
    let i = 0;
    for (const p of this.players.values()) {
      p.state = PS.ALIVE; p.mods = [];
      p.stats = computeStats(PILOTS[p.pilot], []);
      p.hp = this.hpMax(p);
      p.bombs = PLAYER.START_BOMBS; p.lives = PLAYER.SOLO_LIVES; p.kills = 0;
      p.x = ARENA_W / 2 + (i++ - this.players.size / 2) * 70; p.y = ARENA_H / 2;
      p.vx = p.vy = 0; p.dashCd = 0; p.dashStock = p.stats.dashCharges; p.abilCd = 0; p.iframesT = 2;
      p.dashDmgT = 0; p.rageT = 0; p.cons = []; p.frenzyT = 0;
    }
    this.startWave(1);
  }

  waveRng(n) {
    // every run is seeded so any finished run can be re-issued as a
    // challenge with identical wave recipes; Daily Dark pins the seed
    return mulberry32(((this.runSeed >>> 0) ^ Math.imul(n, 2654435761)) >>> 0);
  }

  startWave(n) {
    this.wave = n;
    this.phase = PHASE.WAVE;
    this.script = makeWave(n, Math.max(1, this.activeCount()), this.waveRng(n));
    this.scriptT = 0;
    this.offers.clear();
    for (const p of this.players.values()) {
      if (p.state === PS.OUT || p.state === PS.SPECTATING || p.state === PS.DOWNED) {
        p.state = PS.ALIVE; p.hp = Math.min(2, this.hpMax(p)); p.iframesT = 2;
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
    if (this.wave % WAVE.BOSS_EVERY === 0) {
      for (const p of this.players.values()) {
        if (p.state === PS.ALIVE) p.hp = Math.min(this.hpMax(p), p.hp + 1);
        p.bombs = Math.min(PLAYER.MAX_BOMBS, p.bombs + 1);
      }
    }
    for (const p of this.players.values()) {
      if (p.state === PS.SPECTATING) continue;
      // free random pilot-signature upgrade, on top of the draft (stacks)
      const pool = classModsFor(p.pilot);
      if (pool.length) {
        const grant = pool[Math.floor(Math.random() * pool.length)];
        p.mods.push(grant.id);
        p.stats = computeStats(PILOTS[p.pilot], p.mods);
        p.hp = Math.max(1, Math.min(this.hpMax(p), p.hp));
        this.emit({ t: "class_grant", to: p.id, mod: grant.id, name: grant.name, desc: grant.desc });
      }
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
      const bonus = Math.round(this.unbanked * 0.05 * (p.stats.interest || 0));
      this.banked += this.unbanked + bonus;
      this.emit({ t: "bank", amount: this.unbanked, bonus, by: p.id });
      this.unbanked = 0;
      return;
    }
    if (a.t === "pick" && this.phase === PHASE.INTERMISSION && !p.picked) {
      const offer = this.offers.get(p.id) ?? [];
      if (offer.includes(a.id)) {
        p.mods.push(a.id);
        p.stats = computeStats(PILOTS[p.pilot], p.mods);
        const mod = modById(a.id);
        if (mod?.heal) p.hp += mod.heal;
        p.hp = Math.max(1, Math.min(this.hpMax(p), p.hp));
        p.dashStock = Math.min(p.stats.dashCharges, p.dashStock + (p.stats.dashCharges > 1 ? 1 : 0));
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
      this.stepPickups(dt); // leftovers stay collectable between waves
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
    this.stasisT = Math.max(0, this.stasisT - dt);
    this.stepPlayers(dt, true);
    this.stepSpawner(dt);
    this.stepEnemies(dt);
    this.stepEnemyBullets(dt);
    this.stepPlayerBullets(dt);
    this.stepOrbitals(dt);
    this.stepZones(dt);
    this.stepPickups(dt);
    this.stepReviveAndRespawn(dt);
    this.sinceKill += dt;
    if (this.sinceKill > MULT.DECAY_GRACE && this.mult > 1) {
      this.mult = Math.max(1, this.mult - MULT.DECAY_PER_S * dt);
    }
    if (this.scriptDone() && this.enemies.size === 0 && this.pending.length === 0) {
      this.emit({ t: "wave_end", wave: this.wave });
      if (this.wave >= WAVE.MAX) this.endRun(true);
      else this.beginIntermission();
      return;
    }
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
      roster, daily: this.dailySeed != null, seed: this.runSeed >>> 0,
    });
  }

  // ---------- players ----------
  dashCooldown(p) {
    return Math.max(0.6, PLAYER.DASH_CD + (p.stats.dashPenalty ?? 0) - (p.stats.dashBonus ?? 0));
  }

  stepPlayers(dt, combat) {
    for (const p of this.players.values()) {
      if (p.state !== PS.ALIVE) continue;
      const inp = p.input;
      const btn = inp.buttons, prev = p.buttonsPrev;
      if (Math.hypot(inp.ax, inp.ay) > 0.25) p.aim = Math.atan2(inp.ay, inp.ax);
      // dash charges: cooldown refills the stock (SDD §2.2 + Twin Dash mod)
      if (p.dashStock < p.stats.dashCharges) {
        p.dashCd -= dt;
        if (p.dashCd <= 0) {
          p.dashStock++;
          p.dashCd = p.dashStock < p.stats.dashCharges ? this.dashCooldown(p) : 0;
        }
      }
      if ((btn & BTN.DASH) && !(prev & BTN.DASH) && p.dashStock > 0 && p.dashT <= 0) {
        startDash(p, { mx: inp.mx, my: inp.my });
        if (p.dashStock === p.stats.dashCharges) p.dashCd = this.dashCooldown(p);
        p.dashStock--;
        p.iframesT = Math.max(p.iframesT, PLAYER.DASH_IFRAMES);
        p.dashDmgT = 1;
        if (p.stats.nova > 0 && combat) this.novaBurst(p);
        if (p.stats.napalm > 0 && combat) { // EMBER's Napalm Trail class mod
          this.zones.push({ kind: ZK.FLAME, x: p.x, y: p.y, r: 45, ttl: 2 * p.stats.napalm, owner: p.id });
        }
        this.emit({ t: "dash", who: p.id });
      }
      stepPlayerMovement(p, { mx: inp.mx, my: inp.my }, p.stats, dt);
      p.iframesT = Math.max(0, p.iframesT - dt);
      p.fireCd = Math.max(0, p.fireCd - dt);
      p.abilCd = Math.max(0, p.abilCd - dt);
      p.dashDmgT = Math.max(0, p.dashDmgT - dt);
      p.rageT = Math.max(0, p.rageT - dt);
      p.frenzyT = Math.max(0, p.frenzyT - dt);
      if ((btn & BTN.FIRE) && p.fireCd <= 0) {
        this.fire(p);
        const rate = p.stats.fire * (p.rageT > 0 ? 1 + 0.5 * p.stats.rage : 1) * (p.frenzyT > 0 ? 2 : 1);
        p.fireCd = PLAYER.FIRE_CD / rate;
      }
      // use consumable (edge) — works in intermission too, hence outside combat
      if ((btn & BTN.USE) && !(prev & BTN.USE) && p.cons.length > 0) {
        const kind = p.cons.shift();
        this.applyConsumable(p, kind);
        this.emit({ t: "consumed", who: p.id, kind });
      }
      if (combat) {
        if ((btn & BTN.BOMB) && !(prev & BTN.BOMB) && p.bombs > 0) this.smartBomb(p);
        if ((btn & BTN.ABILITY) && !(prev & BTN.ABILITY) && p.abilCd <= 0) this.ability(p);
        // Static Coil: periodic zap on the nearest enemy
        if (p.stats.static > 0) {
          p.staticT -= dt;
          if (p.staticT <= 0) {
            p.staticT = 2.2;
            let tgt = null, td = 180;
            for (const e of this.enemies.values()) {
              const d = Math.hypot(e.x - p.x, e.y - p.y);
              if (d < td) { td = d; tgt = e; }
            }
            if (tgt) {
              this.zones.push({ kind: ZK.BLAST, x: tgt.x, y: tgt.y, r: 26, ttl: 0.2 });
              this.damageEnemy(tgt, 2 * p.stats.static, p);
            }
          }
        }
      }
      p.buttonsPrev = btn;
    }
  }

  fire(p) {
    const n = 1 + p.stats.split;
    const speed = PLAYER.BULLET_SPEED * p.stats.bulletSpeed;
    const dmg = p.stats.dmg * (p.dashDmgT > 0 && p.stats.dashDmg > 0 ? 1 + 0.3 * p.stats.dashDmg : 1);
    for (let i = 0; i < n; i++) {
      const off = n === 1 ? 0 : (i - (n - 1) / 2) * 0.14;
      const a = p.aim + off;
      this.pBullets.push({
        id: this.bid = (this.bid % 65000) + 1,
        x: p.x + Math.cos(a) * 18, y: p.y + Math.sin(a) * 18,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        dmg, pierce: p.stats.pierce, ricochet: p.stats.ricochet,
        life: PLAYER.BULLET_LIFE * p.stats.bulletLife, owner: p.id,
      });
    }
  }

  smartBomb(p) {
    p.bombs--;
    this.eBullets.length = 0;
    for (const e of this.enemies.values()) {
      this.damageEnemy(e, (e.def.boss ? 4 : 2) + (p.stats.bombPower | 0), p);
    }
    this.emit({ t: "bomb", who: p.id, x: p.x, y: p.y });
  }

  ability(p) {
    const s = p.stats;
    p.abilCd = Math.max(5, PLAYER.ABILITY_CD - s.abilityCdr);
    const aim = p.aim;
    if (p.pilot === 0) { // VANTA — Blink Volley
      if (s.blinkNova > 0) { // Echo Blink: detonate the departure point
        this.zones.push({ kind: ZK.BLAST, x: p.x, y: p.y, r: 100, ttl: 0.25 });
        for (const e of this.enemies.values()) {
          if (Math.hypot(e.x - p.x, e.y - p.y) < 100) this.damageEnemy(e, 2 * s.blinkNova, p);
        }
      }
      p.x = clamp(p.x + Math.cos(aim) * 180 * s.blinkDist, WALL_PAD, ARENA_W - WALL_PAD);
      p.y = clamp(p.y + Math.sin(aim) * 180 * s.blinkDist, WALL_PAD, ARENA_H - WALL_PAD);
      p.iframesT = Math.max(p.iframesT, 0.3);
      const shots = 12 + s.blinkShots;
      for (let i = 0; i < shots; i++) {
        const a = (i / shots) * Math.PI * 2;
        this.pBullets.push({
          id: this.bid = (this.bid % 65000) + 1,
          x: p.x, y: p.y, vx: Math.cos(a) * 560, vy: Math.sin(a) * 560,
          dmg: s.dmg, pierce: 0, ricochet: 0, life: 0.8, owner: p.id,
        });
      }
    } else if (p.pilot === 1) { // EMBER — Flame Zone
      this.zones.push({
        kind: ZK.FLAME, x: p.x + Math.cos(aim) * 120, y: p.y + Math.sin(aim) * 120,
        r: 90 * s.flameR, ttl: 4 * s.flameDur, owner: p.id,
      });
    } else if (p.pilot === 2) { // HALO — Aegis Field
      const r = 220 * s.aegisR;
      this.zones.push({ kind: ZK.AEGIS, x: p.x, y: p.y, r, ttl: 6 * s.aegisDur, owner: p.id });
      if (s.aegisHeal > 0) { // Mending Aegis
        for (const q of this.players.values()) {
          if (q.state === PS.ALIVE && Math.hypot(q.x - p.x, q.y - p.y) < r) {
            q.hp = Math.min(this.hpMax(q), q.hp + s.aegisHeal);
          }
        }
      }
    } else if (p.pilot === 3) { // ONYX — Gravity Well
      this.zones.push({
        kind: ZK.WELL, x: clamp(p.x + Math.cos(aim) * 250, WALL_PAD, ARENA_W - WALL_PAD),
        y: clamp(p.y + Math.sin(aim) * 250, WALL_PAD, ARENA_H - WALL_PAD),
        r: 130 * s.wellR, ttl: 2.5 * s.wellDur, owner: p.id,
      });
    }
    this.emit({ t: "ability", who: p.id, pilot: p.pilot });
  }

  // ---------- consumables ----------
  applyConsumable(p, kind) {
    if (kind === CK.REPAIR) p.hp = Math.min(this.hpMax(p), p.hp + 1);
    else if (kind === CK.SHIELD) p.iframesT = Math.max(p.iframesT, 3);
    else if (kind === CK.FRENZY) p.frenzyT = 6;
    else if (kind === CK.STASIS) this.stasisT = Math.max(this.stasisT, 5);
    else if (kind === CK.BOMB) p.bombs = Math.min(PLAYER.MAX_BOMBS, p.bombs + 1);
  }

  spawnPickup(kind, x, y) {
    if (this.pickups.size >= PICKUP.MAX_LIVE) {
      const oldest = this.pickups.keys().next().value;
      this.pickups.delete(oldest);
    }
    const id = this.pkid = (this.pkid % 65000) + 1;
    this.pickups.set(id, {
      id, kind,
      x: clamp(x, WALL_PAD, ARENA_W - WALL_PAD),
      y: clamp(y, WALL_PAD, ARENA_H - WALL_PAD),
      ttl: PICKUP.TTL,
    });
  }

  stepPickups(dt) {
    for (const [id, k] of this.pickups) {
      k.ttl -= dt;
      if (k.ttl <= 0) { this.pickups.delete(id); continue; }
      for (const p of this.players.values()) {
        if (p.state !== PS.ALIVE) continue;
        if (p.cons.length >= PICKUP.MAX_CARRY) continue; // full — leave it for a teammate
        if (Math.hypot(p.x - k.x, p.y - k.y) < PLAYER.RADIUS + PICKUP.RADIUS) {
          p.cons.push(k.kind);
          this.pickups.delete(id);
          this.emit({ t: "pickup_got", who: p.id, kind: k.kind });
          break;
        }
      }
    }
  }

  novaBurst(p) {
    for (const e of this.enemies.values()) {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < 140) this.damageEnemy(e, p.stats.nova, p);
    }
    this.emit({ t: "nova", x: p.x, y: p.y });
  }

  applyPlayerHit(p, dmg, cause = "CONTACT") {
    if (p.state !== PS.ALIVE || p.iframesT > 0) return;
    let shielded = false;
    for (const z of this.zones) {
      if (z.kind === ZK.AEGIS && Math.hypot(p.x - z.x, p.y - z.y) < z.r) { shielded = true; break; }
    }
    if (!shielded) this.mult = Math.max(1, this.mult * p.stats.hitFactor);
    p.hp -= dmg;
    p.iframesT = PLAYER.HIT_IFRAMES * p.stats.iframeBonus;
    if (p.stats.rage > 0) p.rageT = 3;
    p.lastCause = cause;
    this.emit({ t: "hurt", who: p.id, hp: p.hp });
    if (p.hp <= 0) this.downPlayer(p);
  }

  downPlayer(p) {
    if (this.isSolo() || this.activeCount() === 1) {
      p.lives--;
      if (p.lives >= 0) {
        p.state = PS.DOWNED; p.respawnT = 2; p.downedT = 0;
        this.emit({ t: "downed", who: p.id, solo: true, lives: p.lives, cause: p.lastCause });
      } else {
        p.state = PS.OUT;
        this.emit({ t: "downed", who: p.id, solo: true, lives: 0, cause: p.lastCause });
      }
    } else {
      p.state = PS.DOWNED; p.downedT = PLAYER.DOWNED_TIMEOUT; p.reviveP = 0;
      this.emit({ t: "downed", who: p.id, solo: false, cause: p.lastCause });
    }
  }

  stepReviveAndRespawn(dt) {
    for (const p of this.players.values()) {
      if (p.state !== PS.DOWNED) continue;
      if (p.respawnT > 0) {
        p.respawnT -= dt;
        if (p.respawnT <= 0) {
          p.state = PS.ALIVE; p.hp = this.hpMax(p); p.iframesT = 2;
          p.x = ARENA_W / 2; p.y = ARENA_H / 2; p.vx = p.vy = 0;
          this.emit({ t: "revived", who: p.id, solo: true });
        }
        continue;
      }
      let reviver = null;
      for (const q of this.players.values()) {
        if (q.state === PS.ALIVE &&
            Math.hypot(q.x - p.x, q.y - p.y) < PLAYER.REVIVE_RANGE * q.stats.reviveRange) {
          if (!reviver || q.stats.reviveSpeed > reviver.stats.reviveSpeed) reviver = q;
        }
      }
      p.beingRevived = !!reviver;
      if (reviver) {
        p.reviveP += dt * reviver.stats.reviveSpeed / PLAYER.REVIVE_TIME;
        if (p.reviveP >= 1) {
          const cost = Math.round(Math.min(this.banked,
            REVIVE_COST_PER_WAVE * this.wave) * reviver.stats.reviveDiscount);
          this.banked -= cost;
          p.state = PS.ALIVE; p.hp = Math.min(2, this.hpMax(p)); p.iframesT = 2; p.reviveP = 0;
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
    this.pendingAt(kind, best.x, best.y);
  }

  pendingAt(kind, x, y) {
    x = clamp(x, WALL_PAD, ARENA_W - WALL_PAD);
    y = clamp(y, WALL_PAD, ARENA_H - WALL_PAD);
    this.pending.push({ kind, x, y, t: WAVE.WARP_IN_S });
    this.zones.push({ kind: ZK.WARP, x, y, r: ENEMIES[kind].radius + 10, ttl: WAVE.WARP_IN_S });
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
      enraged: false, spokeAngle: Math.random() * Math.PI * 2,
      contactCd: 0,
      // sniper
      aiming: false, aimT: 0, lockX: 0, lockY: 0,
      // ghost
      phased: def.ai === "ghost", phaseT: (def.phaseTime ?? 0) * (0.5 + Math.random()), windowT: 0,
      // forge / foundry
      spawnT: def.spawnEvery ?? 0, doorOpen: false, doorT: def.doorClosed ?? 0,
      // shepherd / ultra
      darkT: def.darkEvery ?? 0, fireMode: 0,
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

  seekVel(e, target, mul = 1) {
    const d = Math.hypot(target.x - e.x, target.y - e.y) || 1;
    const sp = e.speed * mul * (e.enraged ? 1.8 : 1);
    e.vx = ((target.x - e.x) / d) * sp; e.vy = ((target.y - e.y) / d) * sp;
  }

  stepEnemies(dt) {
    this._wardens.length = 0;
    for (const e of this.enemies.values()) if (e.def.ai === "warden") this._wardens.push(e);

    const slow = this.stasisT > 0 ? 0.45 : 1; // Stasis Charge consumable
    for (const e of this.enemies.values()) {
      e.t += dt;
      e.contactCd = Math.max(0, e.contactCd - dt);
      const def = e.def;
      const target = this.nearestAlive(e.x, e.y);
      const ai = def.ai;

      if (ai === "seek" || ai === "boss_brute" || ai === "leech") {
        if (target) this.seekVel(e, target);
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
      } else if (ai === "sniper") {
        // hold a standoff band; freeze while aiming
        if (e.aiming) { e.vx = e.vy = 0; }
        else if (target) {
          const d = Math.hypot(target.x - e.x, target.y - e.y);
          if (d < 480) this.seekVel(e, target, -1);
          else if (d > 780) this.seekVel(e, target, 0.6);
          else { e.vx *= 0.9; e.vy *= 0.9; }
        }
      } else if (ai === "warden") {
        // shepherd the nearest non-warden enemy; drift centre-ward alone
        let ward = null, wd = Infinity;
        for (const o of this.enemies.values()) {
          if (o === e || o.def.ai === "warden" || o.def.boss) continue;
          const d = Math.hypot(o.x - e.x, o.y - e.y);
          if (d < wd) { wd = d; ward = o; }
        }
        const goal = ward ?? { x: ARENA_W / 2, y: ARENA_H / 2 };
        this.seekVel(e, goal, 0.9);
      } else if (ai === "forge") {
        e.vx = e.vy = 0;
        e.spawnT -= dt;
        if (e.spawnT <= 0) {
          e.spawnT = def.spawnEvery;
          const kinds = this.wave >= 8 ? [EK.MITE, EK.DRONE, EK.WEAVER] : [EK.MITE, EK.DRONE];
          for (let i = 0; i < 2; i++) {
            const a = Math.random() * Math.PI * 2;
            this.pendingAt(kinds[Math.floor(Math.random() * kinds.length)],
              e.x + Math.cos(a) * 70, e.y + Math.sin(a) * 70);
          }
        }
      } else if (ai === "ghost") {
        if (e.phased) {
          e.phaseT -= dt;
          if (target) this.seekVel(e, target, 1.2);
          if (e.phaseT <= 0) {
            e.phased = false; e.windowT = def.windowTime;
            if (target) {
              const a = Math.atan2(target.y - e.y, target.x - e.x);
              this.emitPattern(PT.FAN, e.x, e.y, a, def.name);
            }
          }
        } else {
          e.windowT -= dt;
          e.vx *= 0.9; e.vy *= 0.9;
          if (e.windowT <= 0) { e.phased = true; e.phaseT = def.phaseTime; }
        }
      } else if (ai === "magnet") {
        if (target) this.seekVel(e, target, 0.8);
        for (const p of this.players.values()) {
          if (p.state !== PS.ALIVE) continue;
          const d = Math.hypot(p.x - e.x, p.y - e.y);
          if (d < def.pullR && d > 40) {
            p.x += ((e.x - p.x) / d) * def.pull * dt;
            p.y += ((e.y - p.y) / d) * def.pull * dt;
          }
        }
      } else if (ai === "boss_hex") {
        const cx = ARENA_W / 2, cy = ARENA_H / 2;
        e.vx = (cx - e.x) * 0.05; e.vy = (cy - e.y) * 0.05;
      } else if (ai === "boss_foundry") {
        const cx = ARENA_W / 2, cy = ARENA_H * 0.3;
        e.vx = (cx - e.x) * 0.02; e.vy = (cy - e.y) * 0.02;
        e.doorT -= dt;
        if (!e.doorOpen && e.doorT <= 0) {
          e.doorOpen = true; e.doorT = def.doorOpen;
          this.emit({ t: "doors", id: e.id, open: true });
          for (let i = 0; i < def.spawnCount; i++) {
            const a = (i / def.spawnCount) * Math.PI * 2;
            const kinds = [EK.MITE, EK.DRONE, EK.WEAVER];
            this.pendingAt(kinds[i % kinds.length], e.x + Math.cos(a) * 110, e.y + Math.sin(a) * 110);
          }
        } else if (e.doorOpen && e.doorT <= 0) {
          e.doorOpen = false; e.doorT = def.doorClosed * (e.enraged ? 0.55 : 1);
          this.emit({ t: "doors", id: e.id, open: false });
        }
      } else if (ai === "boss_shepherd") {
        if (target) this.seekVel(e, target, 0.7);
        e.darkT -= dt;
        if (e.darkT <= 0) {
          e.darkT = def.darkEvery * (e.enraged ? 0.6 : 1);
          const victims = [...this.players.values()].filter(p => p.state === PS.ALIVE);
          if (victims.length) {
            const v = victims[Math.floor(Math.random() * victims.length)];
            this.zones.push({
              kind: ZK.DARK,
              x: clamp(v.x + (Math.random() - 0.5) * 240, WALL_PAD, ARENA_W - WALL_PAD),
              y: clamp(v.y + (Math.random() - 0.5) * 240, WALL_PAD, ARENA_H - WALL_PAD),
              r: 240, ttl: 6, grace: 1.5, tickT: 0,
            });
          }
        }
      } else if (ai === "boss_ultra") {
        if (target) this.seekVel(e, target, 0.6);
        if (Math.floor(e.t / 7) > Math.floor((e.t - dt) / 7)) this.spawnAtEdge(EK.GHOST);
      }

      e.x = clamp(e.x + e.vx * slow * dt, WALL_PAD, ARENA_W - WALL_PAD);
      e.y = clamp(e.y + e.vy * slow * dt, WALL_PAD, ARENA_H - WALL_PAD);

      // sniper aim/fire cycle (outside movement so freezing works)
      if (ai === "sniper" && target) {
        if (!e.aiming) {
          e.fireT -= dt * slow;
          if (e.fireT <= 0) {
            e.aiming = true; e.aimT = def.aimTime;
            e.lockX = target.x; e.lockY = target.y;
            this.emit({ t: "laser_warn", id: e.id, sx: Math.round(e.x), sy: Math.round(e.y), tx: Math.round(e.lockX), ty: Math.round(e.lockY), s: def.aimTime });
          }
        } else {
          e.aimT -= dt;
          if (e.aimT <= 0) {
            e.aiming = false; e.fireT = def.fireEvery;
            this.fireLaser(e);
          }
        }
      }

      // generic pattern firing
      if (def.fireEvery && target && ai !== "sniper" && ai !== "ghost") {
        e.fireT -= dt * slow;
        if (e.fireT <= 0) {
          e.fireT = def.fireEvery * (e.enraged ? 0.55 : 1);
          const aimA = Math.atan2(target.y - e.y, target.x - e.x);
          if (ai === "weave" || (ai === "boss_brute" && e.enraged) || ai === "boss_shepherd") {
            this.emitPattern(PT.FAN, e.x, e.y, aimA, def.name);
          } else if (ai === "mortar") {
            this.zones.push({ kind: ZK.MORTAR_TELE, x: target.x, y: target.y, r: def.shellRadius, ttl: def.shellDelay });
          } else if (ai === "boss_brute") {
            this.emitPattern(PT.RING, e.x, e.y, 0, def.name);
          } else if (ai === "boss_hex") {
            e.spokeAngle += e.enraged ? 0.52 : 0.35;
            this.emitPattern(PT.SPOKES, e.x, e.y, e.spokeAngle, def.name);
            if (Math.floor(e.t / 6) > Math.floor((e.t - dt) / 6)) {
              this.spawnAtEdge(EK.WEAVER); this.spawnAtEdge(EK.WEAVER);
            }
          } else if (ai === "boss_ultra") {
            const mode = e.fireMode++ % 3;
            if (mode === 0) { e.spokeAngle += 0.4; this.emitPattern(PT.SPOKES, e.x, e.y, e.spokeAngle, def.name); }
            else if (mode === 1) this.emitPattern(PT.FAN, e.x, e.y, aimA, def.name);
            else this.emitPattern(PT.RING, e.x, e.y, 0, def.name);
          }
        }
      }
      if (def.boss && !e.enraged && e.hp <= e.maxHp * 0.5) {
        e.enraged = true;
        this.emit({ t: "enrage", id: e.id, kind: e.kind });
      }

      // contact
      for (const p of this.players.values()) {
        if (p.state !== PS.ALIVE) continue;
        const d = Math.hypot(p.x - e.x, p.y - e.y);
        if (d < def.radius + PLAYER.RADIUS) {
          if (ai === "leech") {
            if (e.contactCd <= 0) {
              e.contactCd = 1;
              this.mult = Math.max(1, this.mult - def.drain);
              this.emit({ t: "leech", who: p.id });
            }
          } else if (!(ai === "ghost" && e.phased)) {
            this.applyPlayerHit(p, 1, def.name.toUpperCase());
          }
          if (p.stats.thorns > 0) this.damageEnemy(e, p.stats.thorns * 2, p);
          const push = 60 / (d || 1);
          e.x -= (p.x - e.x) * push * 0.2; e.y -= (p.y - e.y) * push * 0.2;
        }
      }
    }
  }

  fireLaser(e) {
    // instant beam from the sniper through its locked point, arena-length
    const dx = e.lockX - e.x, dy = e.lockY - e.y;
    const l = Math.hypot(dx, dy) || 1;
    const ex = e.x + (dx / l) * 2600, ey = e.y + (dy / l) * 2600;
    for (const p of this.players.values()) {
      if (p.state !== PS.ALIVE) continue;
      if (distToSegment(p.x, p.y, e.x, e.y, ex, ey) < PLAYER.RADIUS + 6) {
        this.applyPlayerHit(p, 1, "SNIPER");
      }
    }
    this.emit({ t: "laser_fire", id: e.id, sx: Math.round(e.x), sy: Math.round(e.y), tx: Math.round(ex), ty: Math.round(ey) });
  }

  isShielded(e) {
    if (e.def.ai === "warden" || e.def.boss) return false;
    for (const w of this._wardens) {
      if (Math.hypot(e.x - w.x, e.y - w.y) < w.def.shieldR) return true;
    }
    return false;
  }

  emitPattern(pid, x, y, angle, srcName = "") {
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const bullets = spawnPattern(pid, seed, x, y, angle);
    for (const b of bullets) { b.cause = srcName; this.eBullets.push(b); }
    while (this.eBullets.length > E_BULLET_CAP) this.eBullets.shift();
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
          this.applyPlayerHit(p, 1, b.cause ? b.cause.toUpperCase() : "BULLET");
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
        if (e.phased) continue; // bullets pass straight through a phased Ghost
        if (Math.hypot(e.x - b.x, e.y - b.y) < e.def.radius + 5) {
          if ((e.def.ai === "boss_foundry" && !e.doorOpen) || this.isShielded(e)) {
            this.pBullets.splice(i, 1); // absorbed — teaches the order-of-kill puzzle
            break;
          }
          const killer = this.players.get(b.owner);
          const died = this.damageEnemy(e, b.dmg, killer, aoeQueue);
          if (died || b.pierce <= 0) { this.pBullets.splice(i, 1); }
          else b.pierce--;
          break;
        }
      }
    }
    while (aoeQueue.length) {
      const { x, y, dmg, killer } = aoeQueue.pop();
      for (const e of this.enemies.values()) {
        if (Math.hypot(e.x - x, e.y - y) < 80) this.damageEnemy(e, dmg, killer, aoeQueue);
      }
    }
  }

  damageEnemy(e, dmg, killer, aoeQueue) {
    if (!this.enemies.has(e.id)) return false;
    if (e.phased) return false;
    if (e.def.ai === "boss_foundry" && !e.doorOpen) return false;
    if (this.isShielded(e)) return false;
    e.hp -= dmg;
    if (e.hp > 0) return false;
    this.enemies.delete(e.id);
    const def = e.def;
    const bounty = killer?.stats.bounty ?? 1;
    const overdrive = this.mult >= MULT.MAX - 0.05;
    const points = Math.round(def.score * this.mult * bounty * (overdrive ? 2 : 1));
    this.unbanked += points;
    this.mult = Math.min(MULT.MAX, this.mult + MULT.PER_KILL);
    this.bestMult = Math.max(this.bestMult, this.mult);
    this.sinceKill = 0;
    if (killer) {
      killer.kills++;
      if (killer.stats.bloodrush > 0) killer.dashCd = Math.max(0, killer.dashCd - 0.15 * killer.stats.bloodrush);
      if (killer.stats.streakBomb > 0 && killer.kills % 25 === 0) {
        killer.bombs = Math.min(PLAYER.MAX_BOMBS, killer.bombs + killer.stats.streakBomb);
        this.emit({ t: "streak", who: killer.id });
      }
    }
    this.emit({ t: "kill", kind: e.kind, x: Math.round(e.x), y: Math.round(e.y), points, who: killer?.id ?? 0 });
    if (def.dropChance && this.rngDrop() < def.dropChance) {
      this.spawnPickup(rollConsumable(this.rngDrop), e.x, e.y);
    }
    if (def.onDeath?.pattern) this.emitPattern(PATTERN_IDS[def.onDeath.pattern], e.x, e.y, 0, def.name);
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
        // client renders blades from the same tick-based formula (ORBITAL const)
        const a = this.tick * TICK_DT * ORBITAL.ROT + (i / k) * Math.PI * 2;
        const ox = p.x + Math.cos(a) * ORBITAL.R, oy = p.y + Math.sin(a) * ORBITAL.R;
        for (const e of this.enemies.values()) {
          if (Math.hypot(e.x - ox, e.y - oy) < e.def.radius + ORBITAL.BLADE) {
            this.damageEnemy(e, ORBITAL.DPS * dt, p);
          }
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
        const dps = 2 * (owner?.stats.flameDps ?? 1);
        for (const e of this.enemies.values()) {
          if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.def.radius) this.damageEnemy(e, dps * dt, owner);
        }
      } else if (z.kind === ZK.WELL) {
        for (const e of this.enemies.values()) {
          const d = Math.hypot(e.x - z.x, e.y - z.y);
          if (d < z.r * 2 && d > 4) {
            e.x += ((z.x - e.x) / d) * 140 * dt;
            e.y += ((z.y - e.y) / d) * 140 * dt;
          }
        }
      } else if (z.kind === ZK.DARK) {
        // the Shepherd's herding dark: linger inside and it bites
        z.grace -= dt;
        if (z.grace <= 0) {
          z.tickT -= dt;
          if (z.tickT <= 0) {
            z.tickT = 1.25;
            for (const p of this.players.values()) {
              if (p.state === PS.ALIVE && Math.hypot(p.x - z.x, p.y - z.y) < z.r) {
                this.applyPlayerHit(p, 1, "THE DARK");
              }
            }
          }
        }
      }
      if (z.ttl <= 0) {
        if (z.kind === ZK.MORTAR_TELE) {
          for (const p of this.players.values()) {
            if (p.state === PS.ALIVE && Math.hypot(p.x - z.x, p.y - z.y) < z.r) this.applyPlayerHit(p, 1, "MORTAR");
          }
          this.zones.push({ kind: ZK.BLAST, x: z.x, y: z.y, r: z.r, ttl: 0.25 });
        } else if (z.kind === ZK.WELL) {
          const owner = this.players.get(z.owner);
          const dmg = 3 + (owner?.stats.wellDmg ?? 0);
          for (const e of this.enemies.values()) {
            if (Math.hypot(e.x - z.x, e.y - z.y) < z.r) this.damageEnemy(e, dmg, owner);
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
        hp: Math.max(0, p.hp), dashCd: p.dashStock > 0 ? 0 : p.dashCd, abilCd: Math.ceil(p.abilCd),
        bombs: p.bombs, flags,
        orbitals: Math.min(255, p.stats.orbitals | 0),
        cons: p.cons,
      });
    }
    const enemies = [];
    for (const e of this.enemies.values()) {
      let flags = 0;
      if (e.enraged) flags |= EF.ENRAGED;
      if (e.phased) flags |= EF.PHASED;
      if (e.doorOpen) flags |= EF.OPEN;
      enemies.push({
        id: e.id, kind: e.kind, x: e.x, y: e.y,
        hpPct: Math.max(1, Math.ceil((e.hp / e.maxHp) * 100)), flags,
      });
    }
    const bullets = this.pBullets.map(b => ({ id: b.id, x: b.x, y: b.y, owner: b.owner }));
    const zones = this.zones.map(z => ({ kind: z.kind, x: z.x, y: z.y, r: z.r, ttl: z.ttl }));
    const pickups = [...this.pickups.values()];
    return {
      tick: this.tick, phase: this.phase, wave: this.wave,
      phaseT: Math.max(0, Math.round(this.phaseT * 30)),
      mult: this.mult, unbanked: Math.round(this.unbanked), banked: Math.round(this.banked),
      enemiesLeft: this.enemies.size + this.pending.length,
      stasis: this.stasisT,
      players, enemies, bullets, zones, pickups,
    };
  }
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / len2, 0, 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
