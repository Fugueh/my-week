// 草稿的测试：没记下的字存进本机，「关掉再打开」（换一个新的运行环境、同一份存储）还在。运行：node tests/drafts.test.js
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const SRC = fs.readFileSync(path.join(__dirname, "../web/js/drafts.js"), "utf8");

function storage(init) {
  const m = new Map(init);
  return { m, getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}
// 一次「打开 App」：新的运行环境，用同一份本机存储
const open = ls => { const c = vm.createContext({ localStorage: ls }); vm.runInContext(SRC, c); return vm.runInContext("Drafts", c); };
let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok  " + name); };

t("写了没记下 → 关掉再打开，草稿还在", () => {
  const ls = storage();
  open(ls).set("dayIn", "地铁上想到的一句");
  assert.strictEqual(open(ls).get("dayIn").text, "地铁上想到的一句");
});
t("「这周的事」的草稿连同选的周几一起记住", () => {
  const ls = storage();
  open(ls).set("wkIn", "周五交报告", { wd: 4 });
  const d = open(ls).get("wkIn");
  assert.deepStrictEqual([d.text, d.wd], ["周五交报告", 4]);
});
t("记下之后（清掉）→ 再打开没有草稿，本机也不留空记录", () => {
  const ls = storage(), D = open(ls);
  D.set("goalIn", "跑步三次"); D.clear("goalIn");
  assert.strictEqual(open(ls).get("goalIn"), null);
  assert.ok(!ls.m.has("myweek-drafts"));
});
t("删成空白等于没有草稿；三个框互不影响", () => {
  const ls = storage(), D = open(ls);
  D.set("dayIn", "甲"); D.set("wkIn", "乙", { wd: 0 }); D.set("dayIn", "   ");
  assert.strictEqual(D.get("dayIn"), null);
  assert.strictEqual(D.get("wkIn").text, "乙");
});
t("本机存储坏了或用不了 → 不报错，当作没有草稿", () => {
  assert.strictEqual(open(storage([["myweek-drafts", "{坏的"]])).get("dayIn"), null);
  const broken = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); }, removeItem() {} };
  const D = open(broken);
  D.set("dayIn", "x");
  assert.strictEqual(D.get("dayIn"), null);
});
console.log(`\n${n} 项通过`);
