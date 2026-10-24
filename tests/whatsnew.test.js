// 更新后的「新功能」弹窗：什么时候弹、弹哪几版。
const fs = require("fs"), path = require("path"), vm = require("vm");
const SRC = ["i18n.js", "i18n-en.js", "whatsnew.js"].map(f => fs.readFileSync(path.join(__dirname, "../web/js", f), "utf8")).join("\n");
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));

const open = seen => {
  const store = new Map(seen == null ? [] : [["myweek-seen-version", seen]]);
  const c = vm.createContext({ localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) } });
  vm.runInContext(SRC + "\n;globalThis.W = WhatsNew; globalThis.NOTES = NOTES;", c);
  return { W: c.W, NOTES: c.NOTES, store };
};
const T = [
  ["新装（没有数据）：不弹，只记下版本号", () => { const { W, store } = open(null); return W.pending("0.4.0", false).length === 0 && store.get("myweek-seen-version") === "0.4.0"; }],
  ["从没有这个功能的老版本升级上来（有数据、没记录）：弹", () => { const { W } = open(null); const r = W.pending("0.4.0", true); return r.length === 1 && r[0].version === "0.4.0"; }],
  ["上次看到 0.3.2，现在 0.4.0：弹 0.4.0 的说明", () => { const { W } = open("0.3.2"); const r = W.pending("0.4.0", true); return r.length === 1 && r[0].items.length > 0; }],
  ["已经看过这一版：不弹", () => { const { W } = open("0.4.0"); return W.pending("0.4.0", true).length === 0; }],
  ["版本比较按数字：0.10.0 比 0.9.0 新", () => { const { W } = open("0.4.0"); return W.cmp("0.10.0", "0.9.0") > 0 && W.cmp("0.4.0", "0.4.0") === 0 && W.cmp("0.3.9", "0.4.0") < 0; }],
  ["跳过了几版：中间的都弹，新的在前；比现在还新的不弹", () => {
    const { W } = open("0.3.2");
    const notes = [{ version: "0.4.0", items: ["a"] }, { version: "0.5.0", items: ["b"] }, { version: "0.6.0", items: ["c"] }];
    return W.pending("0.5.0", true, notes).map(n => n.version).join() === "0.5.0,0.4.0";
  }],
  ["说明按版本从新到旧排，最新一条不比 package.json 的版本新", () => {
    const { W, NOTES } = open(null);
    return NOTES.every((n, i) => i === 0 || W.cmp(NOTES[i - 1].version, n.version) > 0) && W.cmp(NOTES[0].version, pkg.version) <= 0;
  }],
];
let bad = 0;
for (const [name, fn] of T) { let ok = false; try { ok = fn(); } catch (e) { console.log("    " + e.message); } console.log((ok ? "ok  " : "  ✗ ") + name); if (!ok) bad++; }
console.log(bad ? `${bad} 项失败` : `\n${T.length} 项通过`);
process.exit(bad ? 1 : 0);
