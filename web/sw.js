// 离线可用：页面文件整版缓存。安装时把 SHELL 一次下全放进 CACHE，之后只从这一版里取，运行时不再逐个写回，
// 所以不会出现新 app.js 配旧 sync.js。新版本 = 新的 CACHE 名 → 浏览器发现 sw.js 变了 → 装好新的一整版 → 等页面说可以了再切换。
// CACHE 后面的哈希由 tests/sw-version.test.js 按 SHELL 文件内容算；改了 web/ 下的文件就跑 node tests/sw-version.test.js --fix。/api 不缓存。
const CACHE = "myweek-084963f5";
const SHELL = ["index.html", "css/style.css", "js/dates.js", "js/markdown.js", "js/merge.js", "js/crypto.js", "js/history.js", "js/drafts.js", "js/version.js", "js/updates.js", "js/store.js", "js/sync.js", "js/app.js",
               "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];
const ROOT = new URL(self.registration.scope).pathname, URLS = new Set(SHELL.map(p => new URL(p, self.registration.scope).pathname));
// 整包下载，任何一个失败就整版作废（install 失败，旧版本继续用）；cache:"reload" 绕开 HTTP 缓存
// 旧式缓存（myweek-v9 及以前）的页面不会发 "skip"，从那里升级时直接接管一次
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(p => new Request(p, { cache: "reload" }))))
  .then(() => caches.keys()).then(ks => { if (ks.some(k => /^myweek-v\d+$/.test(k))) self.skipWaiting(); })); });
// 第一次安装（页面还没被接管）直接生效；之后的新版本先等着，页面在安全的时候发 "skip" 才切换（见 app.js）
self.addEventListener("message", e => { if (e.data === "skip") self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url), page = url.pathname === ROOT;   // "/" 就是 index.html
  if (e.request.method !== "GET" || url.origin !== location.origin || !(page || URLS.has(url.pathname))) return;   // /api 和 SHELL 以外的照常走网络
  e.respondWith(caches.open(CACHE).then(c => c.match(page ? "index.html" : e.request, { ignoreSearch: true })).then(hit => hit || fetch(e.request)));
});
