// 英文界面：代码里每一句 tr("…") 和页面里写死的每一句中文，都要在 web/js/i18n-en.js 里有英文；
// 英文里的 {0} {1} 要和中文原文一一对应，EN 里不能留着没人用的条目。
const fs = require("fs"), path = require("path"), vm = require("vm");
const WEB = path.join(__dirname, "../web");
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(WEB, "js/i18n-en.js"), "utf8") + "\n;globalThis.EN = EN;", ctx);
const EN = ctx.EN;

const keys = new Set();
for (const f of fs.readdirSync(path.join(WEB, "js"))) {
  if (!f.endsWith(".js") || f.startsWith("i18n")) continue;
  const s = fs.readFileSync(path.join(WEB, "js", f), "utf8");
  for (const m of s.matchAll(/\btr\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(JSON.parse('"' + m[1] + '"'));
}
const hist = fs.readFileSync(path.join(WEB, "js/history.js"), "utf8");   // 历史版本的原因写在表里，用 tr(REASON[r]) 取
for (const m of hist.matchAll(/\b\w+: "([^"]*[^\x00-\x7f][^"]*)"/g)) keys.add(m[1]);
const html = fs.readFileSync(path.join(WEB, "index.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "").replace(/<script[\s\S]*?<\/script>/g, "");
for (const m of html.matchAll(/>([^<>]+)</g)) { const t = m[1].trim(); if (/[^\x00-\x7f]/.test(t)) keys.add(t); }
for (const m of html.matchAll(/\b(?:placeholder|title|aria-label|alt)="([^"]*)"/g)) if (/[^\x00-\x7f]/.test(m[1])) keys.add(m[1]);

const same = k => !/[一-龥]/.test(k);   // 不含中文的（符号、示例文字）不用翻译
const holes = k => (k.match(/\{\d+\}/g) || []).sort().join();
let bad = 0;
const fail = msg => { console.log("  ✗ " + msg); bad++; };
for (const k of keys) {
  if (same(k)) continue;
  if (!(k in EN)) { fail("缺英文：" + JSON.stringify(k)); continue; }
  if (holes(k) !== holes(EN[k])) fail("{0} 对不上：" + JSON.stringify(k));
}
for (const k of Object.keys(EN)) if (!keys.has(k)) fail("没人用的英文条目：" + JSON.stringify(k));
if (bad) { console.log(bad + " 处问题"); process.exit(1); }
console.log(`ok  英文界面：${keys.size} 句都有对应的英文，占位符一致`);
