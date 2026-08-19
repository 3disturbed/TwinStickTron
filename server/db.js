// Leaderboards & daily seeds (SDD §3.8) on node:sqlite (built into Node
// 22+, zero native deps). Scores are written server-side at run end from
// server-authoritative state — there is no client submit endpoint, so a
// modified client cannot forge a score.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export function openDb(dbPath) {
  if (dbPath !== ":memory:") mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS scores (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      mode    TEXT    NOT NULL,          -- 'run' | 'daily'
      date    TEXT    NOT NULL,          -- UTC yyyy-mm-dd
      squad   INTEGER NOT NULL,
      score   INTEGER NOT NULL,
      wave    INTEGER NOT NULL,
      names   TEXT    NOT NULL,          -- JSON array of callsigns
      lead    TEXT    NOT NULL,          -- names[0], for the daily one-attempt rule
      created INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scores_mode_score ON scores(mode, score DESC);
    CREATE INDEX IF NOT EXISTS idx_scores_daily ON scores(mode, date, lead);
    CREATE TABLE IF NOT EXISTS daily (
      date TEXT PRIMARY KEY,
      seed INTEGER NOT NULL
    );
  `);

  const qDaily = db.prepare("SELECT seed FROM daily WHERE date = ?");
  const iDaily = db.prepare("INSERT INTO daily(date, seed) VALUES (?, ?)");
  const qDupe = db.prepare("SELECT 1 FROM scores WHERE mode = 'daily' AND date = ? AND lead = ? LIMIT 1");
  const iScore = db.prepare(
    "INSERT INTO scores(mode, date, squad, score, wave, names, lead, created) VALUES (?,?,?,?,?,?,?,?)"
  );
  const qRankRun = db.prepare("SELECT COUNT(*) AS n FROM scores WHERE mode = 'run' AND score > ?");
  const qRankDaily = db.prepare("SELECT COUNT(*) AS n FROM scores WHERE mode = 'daily' AND date = ? AND score > ?");
  const qTopRun = db.prepare(
    "SELECT score, wave, squad, names, created FROM scores WHERE mode = 'run' AND created >= ? ORDER BY score DESC LIMIT ?"
  );
  const qTopDaily = db.prepare(
    "SELECT score, wave, squad, names, created FROM scores WHERE mode = 'daily' AND date = ? ORDER BY score DESC LIMIT ?"
  );

  return {
    getDailySeed(date) {
      const row = qDaily.get(date);
      if (row) return Number(row.seed);
      const seed = (Math.random() * 0xffffffff) >>> 0;
      iDaily.run(date, seed);
      return seed;
    },

    // Returns {accepted, rank|null}. Daily Dark: first submitted attempt per
    // lead callsign per day counts (SDD §2.12 — honest without accounts).
    submit({ mode, date, squad, score, wave, names }) {
      if (score <= 0) return { accepted: false, rank: null };
      const lead = (names[0] ?? "PILOT").toUpperCase();
      if (mode === "daily" && qDupe.get(date, lead)) return { accepted: false, rank: null };
      iScore.run(mode, date, squad, score, wave, JSON.stringify(names), lead, Date.now());
      const n = mode === "daily" ? qRankDaily.get(date, score).n : qRankRun.get(score).n;
      return { accepted: true, rank: Number(n) + 1 };
    },

    top(mode, { date = null, sinceMs = 0, limit = 20 } = {}) {
      const rows = mode === "daily" ? qTopDaily.all(date, limit) : qTopRun.all(sinceMs, limit);
      return rows.map(r => ({
        score: Number(r.score), wave: Number(r.wave), squad: Number(r.squad),
        names: JSON.parse(r.names), created: Number(r.created),
      }));
    },
  };
}

export function todayUTC() { return new Date().toISOString().slice(0, 10); }
