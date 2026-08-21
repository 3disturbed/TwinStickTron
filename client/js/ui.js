// DOM overlays: menu, lobby, draft, score, toasts, banners.
// The canvas is the game; this file is everything around it.

import { PILOTS, PHASE, MAX_PLAYERS } from "/shared/constants.js";
import { MODS, modById } from "/shared/mods.js";
import { shopItemById } from "/shared/shop.js";

const $ = (id) => document.getElementById(id);
const screens = ["screen-menu", "screen-lobby", "screen-draft", "screen-score", "screen-settings", "screen-lb", "screen-shop"];

export const ui = { onAction: null }; // main.js wires this

export function showScreen(name) {
  for (const s of screens) $(s).classList.toggle("hidden", s !== name);
}
export function hideScreens() { for (const s of screens) $(s).classList.add("hidden"); }

// ---------- menu ----------
export function initMenu(joinCode, defaults) {
  $("name").value = defaults.name ?? "";
  const pilotsEl = $("pilots");
  pilotsEl.innerHTML = "";
  for (const p of PILOTS) {
    const el = document.createElement("div");
    el.className = "pilot" + (p.id === defaults.pilot ? " sel" : "");
    el.style.setProperty("--c", p.color);
    el.innerHTML = `<div class="nm" style="color:${p.color}">${p.symbol} ${p.name}</div><div class="ab">${p.lean}<br>▸ ${p.weapon.label}<br>✦ ${p.ability}</div>`;
    el.onclick = () => {
      pilotsEl.querySelectorAll(".pilot").forEach(x => x.classList.remove("sel"));
      el.classList.add("sel");
      ui.onAction?.({ t: "ui_pilot", pilot: p.id });
    };
    pilotsEl.appendChild(el);
  }
  if (joinCode) {
    $("btn-join").classList.remove("hidden");
    $("btn-solo").classList.add("hidden");
    $("btn-create").classList.add("hidden");
    $("menu-msg").textContent = `Joining room ${joinCode}…press JOIN`;
    $("btn-join").textContent = `JOIN RUN · ${joinCode}`;
  }
  $("btn-solo").onclick = () => ui.onAction?.({ t: "ui_solo" });
  $("btn-create").onclick = () => ui.onAction?.({ t: "ui_create" });
  $("btn-join").onclick = () => ui.onAction?.({ t: "ui_join", code: joinCode });
  showScreen("screen-menu");
}

export function menuMessage(msg) { $("menu-msg").textContent = msg; }
export function getName() { return $("name").value.trim().toUpperCase() || "PILOT"; }

// ---------- lobby ----------
export function showLobby(code, roster, myId) {
  $("lobby-code").textContent = code;
  updateRoster(roster, myId);
  showScreen("screen-lobby");
}
export function updateRoster(roster, myId) {
  const el = $("roster");
  el.innerHTML = "";
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const r = roster[i];
    const slot = document.createElement("div");
    slot.className = "slot" + (r ? " filled" : "");
    if (r) {
      const pilot = PILOTS[r.pilot] ?? PILOTS[0];
      slot.innerHTML = `<span style="color:${pilot.color}">${r.name}${r.id === myId ? " (YOU)" : ""}</span><span class="dim">${pilot.symbol} ${pilot.name}</span>`;
    } else {
      slot.textContent = "— open slot — send the link —";
    }
    el.appendChild(slot);
  }
}

// ---------- invite ----------
export async function invite(joinUrl, code) {
  const text = `Fight with me in UltraDark — wave shooter, right in the browser. Room ${code}:`;
  if (navigator.share) {
    try { await navigator.share({ title: "UltraDark", text, url: joinUrl }); return; } catch { /* fallthrough */ }
  }
  try {
    await navigator.clipboard.writeText(joinUrl);
    toast("Link copied — send it to a friend!");
  } catch {
    toast(joinUrl);
  }
}

// ---------- draft ----------
export function showDraft(offer, bankAmount, canBank, grant) {
  const g = $("class-grant");
  if (grant) {
    g.innerHTML = `✦ CLASS UPGRADE — <b>${grant.name}</b>: ${grant.desc}`;
    g.classList.remove("hidden");
  } else {
    g.classList.add("hidden");
  }
  const cardsEl = $("draft-cards");
  cardsEl.innerHTML = "";
  for (const id of offer) {
    const m = modById(id);
    if (!m) continue;
    const el = document.createElement("div");
    el.className = "card" + (m.rarity >= 2 ? " r2" : "") + (m.cursed ? " cursed" : "");
    el.innerHTML = `<div class="fam">${m.cursed ? "⚠ CURSED · " : ""}${m.family.toUpperCase()}</div><div class="nm">${m.name}</div><div class="ds">${m.desc}</div>`;
    el.onclick = () => {
      cardsEl.querySelectorAll(".card").forEach(x => { x.onclick = null; x.style.opacity = 0.4; });
      el.style.opacity = 1;
      el.classList.add("picked");
      ui.onAction?.({ t: "pick", id });
    };
    cardsEl.appendChild(el);
  }
  updateBank(bankAmount, canBank);
  showScreen("screen-draft");
}
export function updateBank(amount, canBank) {
  $("bank-amount").textContent = amount.toLocaleString("en-US");
  $("btn-bank").disabled = !canBank || amount <= 0;
}
export function updateDraftTimer(frac) {
  const w = `${Math.max(0, frac * 100)}%`;
  $("draft-timer").firstElementChild.style.width = w;
  $("shop-timer").firstElementChild.style.width = w;
}
export function hideDraft() { $("screen-draft").classList.add("hidden"); }

// ---------- couch co-op: extra draft rows, one per local seat ----------
export function clearDraftLocals() { $("draft-locals").innerHTML = ""; }

// Renders a pad-navigable card row for a couch seat. Selection moves with
// the seat's d-pad, A confirms (wired from main.js via draftNav/draftConfirm).
export function addDraftRow(seat, pilotDef) {
  const wrap = document.createElement("div");
  wrap.className = "draft-seat";
  const grantLine = seat.grant
    ? `<div class="grant small">✦ ${seat.grant.name}: ${seat.grant.desc}</div>` : "";
  wrap.innerHTML =
    `<div class="seat-label" style="color:${pilotDef.color}">${pilotDef.symbol} ${seat.name} — 🎮 d-pad + Ⓐ</div>` + grantLine;
  const row = document.createElement("div");
  row.className = "cards";
  seat.cardEls = [];
  seat.sel = 0;
  seat.pickedUi = false;
  for (const id of seat.offer) {
    const m = modById(id);
    if (!m) continue;
    const el = document.createElement("div");
    el.className = "card" + (m.rarity >= 2 ? " r2" : "") + (m.cursed ? " cursed" : "");
    el.innerHTML = `<div class="fam">${m.cursed ? "⚠ CURSED · " : ""}${m.family.toUpperCase()}</div><div class="nm">${m.name}</div><div class="ds">${m.desc}</div>`;
    seat.cardEls.push({ el, id });
    row.appendChild(el);
  }
  wrap.appendChild(row);
  $("draft-locals").appendChild(wrap);
  drawSeatSel(seat);
}

export function drawSeatSel(seat) {
  seat.cardEls?.forEach(({ el }, i) => el.classList.toggle("sel", i === seat.sel && !seat.pickedUi));
}

export function seatDraftMove(seat, dir) {
  if (!seat.cardEls?.length || seat.pickedUi) return;
  seat.sel = (seat.sel + dir + seat.cardEls.length) % seat.cardEls.length;
  drawSeatSel(seat);
}

export function seatDraftConfirm(seat) {
  if (!seat.cardEls?.length || seat.pickedUi) return null;
  const { el, id } = seat.cardEls[seat.sel];
  seat.pickedUi = true;
  seat.cardEls.forEach(({ el: e }) => { e.style.opacity = 0.4; e.classList.remove("sel"); });
  el.style.opacity = 1;
  el.classList.add("picked");
  return id;
}

// ---------- the Core Shop (post-boss intermissions) ----------
// P1's storefront. Items grey out when owned or unaffordable; the live
// cores balance re-renders affordability every snapshot via updateShop().
let shopState = { items: [], ownedArr: [], cores: 0 };
let shopRenderKey = ""; // re-render ONLY on real changes — a per-frame rebuild
                        // destroys the node between mousedown and mouseup, so
                        // mouse clicks never register (the "shop dead on PC" bug)

function shopKey(cores, ownedArr) {
  // duplicates included: buying another stack of the same item must re-render
  return cores + "|" + ownedArr.filter(i => i.startsWith("s_")).sort().join(",");
}

export function showShop(itemIds, cores, ownedIds) {
  shopState = { items: itemIds, ownedArr: [...(ownedIds ?? [])], cores };
  shopRenderKey = shopKey(cores, shopState.ownedArr);
  renderShopCards();
  showScreen("screen-shop");
}
export function updateShop(cores, ownedIds) {
  if ($("screen-shop").classList.contains("hidden")) return;
  const ownedArr = ownedIds ? [...ownedIds] : shopState.ownedArr;
  const key = shopKey(cores, ownedArr);
  if (key === shopRenderKey) return; // nothing changed — leave the DOM alone
  shopRenderKey = key;
  shopState.cores = cores;
  shopState.ownedArr = ownedArr;
  renderShopCards();
}
function renderShopCards() {
  $("shop-cores").textContent = `⬡ ${shopState.cores.toLocaleString("en-US")}`;
  const el = $("shop-cards");
  el.innerHTML = "";
  for (const id of shopState.items) {
    const it = shopItemById(id);
    if (!it) continue;
    const stacks = shopState.ownedArr.filter(m => m === id).length;
    const owned = it.once && stacks > 0;
    const poor = shopState.cores < it.price;
    const card = document.createElement("div");
    card.className = "card shopcard" + (owned ? " owned" : poor ? " poor" : "");
    const stackBadge = !it.once && stacks > 0 ? ` <span class="stacks">×${stacks}</span>` : "";
    card.innerHTML =
      `<div class="fam">${it.pilot === null ? "ANY CLASS" : PILOTS[it.pilot].symbol + " " + PILOTS[it.pilot].name}${it.once ? " · SIGNATURE" : ""}</div>` +
      `<div class="nm">${it.name}${stackBadge}</div><div class="ds">${it.desc}</div>` +
      `<div class="price">${owned ? "OWNED" : "⬡ " + it.price}</div>`;
    if (!owned && !poor) {
      card.onclick = () => ui.onAction?.({ t: "buy", id });
    }
    el.appendChild(card);
  }
}
export function hideShopTab() {
  $("btn-tab-shop").classList.add("hidden");
}
export function showShopTab(cores) {
  const b = $("btn-tab-shop");
  b.classList.remove("hidden");
  b.textContent = `⬡ SHOP (${cores})`;
}

// couch seats: a compact pad-navigable shop row appended under their draft
export function addShopRow(seat, pilotDef, itemIds, cores) {
  const wrap = document.createElement("div");
  wrap.className = "draft-seat";
  wrap.innerHTML = `<div class="seat-label" style="color:${pilotDef.color}">${pilotDef.symbol} ${seat.name} — SHOP ⬡${cores} (d-pad + Ⓐ, READY to finish)</div>`;
  const row = document.createElement("div");
  row.className = "cards";
  seat.shopEls = [];
  seat.shopSel = 0;
  seat.shopDoneUi = false;
  for (const id of itemIds) {
    const it = shopItemById(id);
    if (!it) continue;
    const el = document.createElement("div");
    el.className = "card shopcard small";
    el.innerHTML = `<div class="nm">${it.name}</div><div class="ds">${it.desc}</div><div class="price">⬡ ${it.price}</div>`;
    seat.shopEls.push({ el, id });
    row.appendChild(el);
  }
  const done = document.createElement("div");
  done.className = "card shopcard small ready";
  done.innerHTML = `<div class="nm">✔ READY</div><div class="ds">Finish shopping</div>`;
  seat.shopEls.push({ el: done, id: "__done" });
  row.appendChild(done);
  wrap.appendChild(row);
  $("draft-locals").appendChild(wrap);
  drawSeatShopSel(seat);
}
export function drawSeatShopSel(seat) {
  seat.shopEls?.forEach(({ el }, i) => el.classList.toggle("sel", i === seat.shopSel && !seat.shopDoneUi));
}
export function seatShopMove(seat, dir) {
  if (!seat.shopEls?.length || seat.shopDoneUi) return;
  seat.shopSel = (seat.shopSel + dir + seat.shopEls.length) % seat.shopEls.length;
  drawSeatShopSel(seat);
}
export function seatShopConfirm(seat) {
  if (!seat.shopEls?.length || seat.shopDoneUi) return null;
  const { el, id } = seat.shopEls[seat.shopSel];
  if (id === "__done") {
    seat.shopDoneUi = true;
    seat.shopEls.forEach(({ el: e }) => e.classList.remove("sel"));
    el.classList.add("picked");
    return "__done";
  }
  el.classList.add("picked");
  return id;
}

// ---------- challenge links ----------
export function showChallengeBanner(ch) {
  const el = $("challenge-banner");
  el.innerHTML = `⚔ <b>${escapeHtml(ch.n)}</b> challenges you!<br>` +
    `<b>${Number(ch.s).toLocaleString("en-US")}</b> points, wave ${ch.w}. ` +
    `Same waves. One click. Beat it.`;
  el.classList.remove("hidden");
  $("btn-accept").classList.remove("hidden");
  $("btn-solo").classList.add("hidden");
}
export function bindChallenge(onAccept) { $("btn-accept").onclick = onAccept; }

// ---------- score ----------
export function showScore(ev, victory, challenge) {
  $("score-title").textContent = victory ? "🏆 ARENA CLEARED" : "RUN OVER";
  const rows = (ev.roster ?? []).map(r => `<div>${r.name}: ${r.kills} kills</div>`).join("");
  let rankLine = "";
  if (ev.counted && ev.rank) {
    const what = ev.mode === "daily" ? "DAILY DARK RANK" : "WORLD RANK";
    rankLine = `<div style="color:#39f0ff">★ ${what} #${ev.rank}</div>`;
  } else if (ev.mode === "daily" && ev.counted === false) {
    rankLine = `<div class="lost">Daily already attempted today — score not counted</div>`;
  }
  let challengeLine = "";
  if (challenge) {
    const beat = ev.score > challenge.s;
    challengeLine = beat
      ? `<div style="color:#b8ff5e">⚔ CHALLENGE BEATEN — ${escapeHtml(challenge.n)}'s ${Number(challenge.s).toLocaleString("en-US")} falls</div>`
      : `<div class="lost">⚔ ${escapeHtml(challenge.n)}'s ${Number(challenge.s).toLocaleString("en-US")} stands — again?</div>`;
  }
  $("score-body").innerHTML =
    `<div class="big">${ev.score.toLocaleString("en-US")}</div>` + challengeLine + rankLine +
    (ev.lost > 0 ? `<div class="lost">${ev.lost.toLocaleString("en-US")} unbanked — gone</div>` : "") +
    `<div>Wave ${ev.wave} · best ×${ev.bestMult}</div>` + rows;
  showScreen("screen-score");
}

// ---------- settings ----------
export function openSettings(s) {
  $("set-shake").value = Math.round(s.shake * 100);
  $("set-floor").value = Math.round(s.floor * 100);
  $("set-vol").value = Math.round(s.volume * 400); // master 0..0.25 → 0..100
  syncSettingLabels(s);
  showScreen("screen-settings");
}
const THEME_LABELS = { retro: "◆ RETRO", bots: "🤖 BOTS", zombies: "🧟 ZOMBIES" };
const THEME_ORDER = ["retro", "bots", "zombies"];

export function syncSettingLabels(s) {
  $("v-shake").textContent = `${Math.round(s.shake * 100)}%`;
  $("v-floor").textContent = `${Math.round(s.floor * 100)}%`;
  $("v-vol").textContent = `${Math.round(s.volume * 400)}%`;
  $("set-flash").textContent = s.flash ? "ON" : "OFF (photosensitive)";
  $("set-thworld").textContent = THEME_LABELS[s.themeWorld] ?? THEME_LABELS.retro;
  $("set-thplayers").textContent = THEME_LABELS[s.themePlayers] ?? THEME_LABELS.retro;
  $("set-thenemies").textContent = THEME_LABELS[s.themeEnemies] ?? THEME_LABELS.retro;
}
export function bindSettings(s, onChange) {
  $("set-shake").oninput = (e) => { s.shake = e.target.value / 100; syncSettingLabels(s); onChange(); };
  $("set-floor").oninput = (e) => { s.floor = e.target.value / 100; syncSettingLabels(s); onChange(); };
  $("set-vol").oninput = (e) => { s.volume = e.target.value / 400; syncSettingLabels(s); onChange(); };
  $("set-flash").onclick = () => { s.flash = !s.flash; syncSettingLabels(s); onChange(); };
  const cycle = (key) => {
    const cur = THEME_ORDER.indexOf(s[key]);
    s[key] = THEME_ORDER[(cur + 1) % THEME_ORDER.length];
    syncSettingLabels(s); onChange();
  };
  $("set-thworld").onclick = () => cycle("themeWorld");
  $("set-thplayers").onclick = () => cycle("themePlayers");
  $("set-thenemies").onclick = () => cycle("themeEnemies");
}

// ---------- leaderboards ----------
export function openLeaderboard(fetchTab) {
  const tabs = document.querySelectorAll(".lb-tab");
  tabs.forEach(b => {
    b.onclick = () => {
      tabs.forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      fetchTab(b.dataset.mode, b.dataset.period);
    };
  });
  tabs[0].classList.add("active");
  tabs.forEach((x, i) => { if (i) x.classList.remove("active"); });
  fetchTab("run", "all");
  showScreen("screen-lb");
}
export function renderLeaderboard(rows) {
  const el = $("lb-body");
  if (!rows.length) { el.innerHTML = `<p class="dim">No scores yet — set the first one.</p>`; return; }
  el.innerHTML = rows.map((r, i) =>
    `<div class="lb-row"><span class="rank">${i + 1}</span>` +
    `<span class="score">${r.score.toLocaleString("en-US")}</span>` +
    `<span class="who">${r.names.map(escapeHtml).join(" + ")}</span>` +
    `<span class="wave">w${r.wave}${r.squad > 1 ? ` · ${r.squad}p` : ""}</span></div>`
  ).join("");
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- toast & banner ----------
let toastT = null;
export function toast(msg, ms = 2600) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  el.style.opacity = 1;
  clearTimeout(toastT);
  toastT = setTimeout(() => { el.style.opacity = 0; setTimeout(() => el.classList.add("hidden"), 400); }, ms);
}

let bannerT = null;
export function banner(text, warn = false, ms = 1800) {
  const el = $("banner");
  el.textContent = text;
  el.className = "banner" + (warn ? " warn" : "");
  clearTimeout(bannerT);
  bannerT = setTimeout(() => el.classList.add("hidden"), ms);
}

export function bindButtons() {
  $("btn-invite").onclick = () => ui.onAction?.({ t: "ui_invite" });
  $("btn-invite2").onclick = () => ui.onAction?.({ t: "ui_invite" });
  $("btn-start").onclick = () => ui.onAction?.({ t: "start" });
  $("btn-again").onclick = () => ui.onAction?.({ t: "again" });
  $("btn-bank").onclick = () => ui.onAction?.({ t: "bank" });
}
