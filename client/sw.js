// UltraDark service worker — app-shell cache. NEVER touches /ws or /api
// (SDD §3.10). Bump VERSION on client deploys.
const VERSION = "ud-v2";
const SHELL = [
  "/", "/styles.css", "/manifest.webmanifest", "/icons/icon.svg",
  "/js/main.js", "/js/net.js", "/js/game.js", "/js/input.js",
  "/js/render.js", "/js/ui.js", "/js/audio.js",
  "/shared/constants.js", "/shared/rng.js", "/shared/movement.js",
  "/shared/patterns.js", "/shared/enemies.js", "/shared/mods.js",
  "/shared/protocol.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/ws")) return;
  if (e.request.method !== "GET") return;
  // join links and navigations: network first, shell fallback
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match("/")));
    return;
  }
  e.respondWith(
    caches.match(url.pathname).then((hit) =>
      hit ||
      fetch(e.request).then((res) => {
        if (res.ok && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(url.pathname, copy));
        }
        return res;
      })
    )
  );
});
