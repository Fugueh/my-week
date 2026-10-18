// 条目合并的测试。运行：node tests/merge.test.js
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const ctx = vm.createContext({ window: {}, console });
for (const f of ["dates.js", "markdown.js", "merge.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../web/js", f), "utf8"), ctx, { filename: f });
const run = code => vm.runInContext(code, ctx);
const MD = run("MD"), Merge = run("Merge");

const head = "---\nweek: 2026-W42\nstart: 2026-10-12\n---\n\n";
const mk = ({ goals = [], events = {}, diary = [], review = "" } = {}) => MD.parse(
  head + "## 周目标\n" + goals.map(g => `- [ ] ${g}`).join("\n") + "\n\n## 这周的事\n" +
  Object.entries(events).map(([d, l]) => `### 周${d}\n` + l.map(x => `- ${x}`).join("\n")).join("\n") +
  "\n\n## 日记\n### 10-18 周日\n" + diary.map(x => `- ${x}`).join("\n") + "\n\n## 复盘\n" + review + "\n");
const text = w => MD.serialize({ ...w, updated: null });
const merge = (b, a, s) => { const r = Merge.weeks(b, a, s); return { week: r.week, overwritten: Array.from(r.overwritten) }; };
const ev = r => Array.from(r.week.events, e => e.text);
let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok  " + name); };

t("真实遇到过的冲突：两边内容相同、只有周日两条的顺序不同，没有 base → 零冲突，顺序跟服务器", () => {
  const server = mk({ events: { 日: ["做了网页", "部署服务", "开启加密"] }, diary: ["21:27 发布", "08:00 睡觉"] });
  const local = mk({ events: { 日: ["做了网页", "开启加密", "部署服务"] }, diary: ["21:27 发布", "08:00 睡觉"] });
  const r = merge(null, local, server);
  assert.deepStrictEqual(r.overwritten, []);
  assert.strictEqual(text(r.week), text(server));
  assert.strictEqual(r.week.extra, "");
});
// 本机有真实日记文件（不进仓库）时，再用它验证一遍
const real = path.join(__dirname, "../2026-w42-f12.md");
if (fs.existsSync(real)) t("（本机文件）2026-w42-f12.md 里的真实冲突", () => {
  const [top, bottom] = fs.readFileSync(real, "utf8").split("## 冲突副本");
  const server = MD.parse(top);
  const local = MD.parse(head + bottom.split(String.fromCharCode(10)).slice(3).join(String.fromCharCode(10)).replace(/^##(#{2,})/gm, "$1"));
  const r = merge(null, local, server);
  assert.deepStrictEqual(r.overwritten, []);
  assert.strictEqual(text(r.week), text(server));
});

const S0 = () => mk({ events: { 日: ["甲", "乙", "丙"] } });
t("只有服务器调整了顺序 → 用服务器的顺序", () => {
  const base = S0(), server = mk({ events: { 日: ["乙", "甲", "丙"] } });
  assert.strictEqual(text(merge(base, S0(), server).week), text(server));
});
t("只有本设备调整了顺序 → 用本设备的顺序", () => {
  const base = S0(), local = mk({ events: { 日: ["丙", "甲", "乙"] } });
  assert.strictEqual(text(merge(base, local, S0()).week), text(local));
});
t("两边都调整了顺序 → 以本设备（后推送的）为准", () => {
  const server = mk({ events: { 日: ["乙", "甲", "丙"] } }), local = mk({ events: { 日: ["丙", "甲", "乙"] } });
  assert.strictEqual(text(merge(S0(), local, server).week), text(local));
});
t("两边各加了不同的一条 → 都留下", () => {
  const r = merge(S0(), mk({ events: { 日: ["甲", "乙", "丙", "本地新"] } }), mk({ events: { 日: ["甲", "乙", "丙", "服务器新"] } }));
  const names = ev(r).sort();
  assert.deepStrictEqual(names, ["丙", "乙", "甲", "服务器新", "本地新"].sort());
  assert.deepStrictEqual(r.overwritten, []);
});
t("日记：两边在顶部各插一条 → 都留下，不冲突", () => {
  const b = ["10:00 旧"], a = ["12:00 手机写的", "10:00 旧"], s = ["11:00 电脑写的", "10:00 旧"];
  const r = merge(mk({ diary: b }), mk({ diary: a }), mk({ diary: s }));
  const day = Array.from(Object.values(r.week.days)[0], e => e.text);
  assert.deepStrictEqual(day.slice().sort(), ["旧", "手机写的", "电脑写的"].sort());
  assert.strictEqual(day.length, 3);
});
t("本地删了一条、服务器没动 → 删掉", () => {
  const r = merge(S0(), mk({ events: { 日: ["甲", "丙"] } }), S0());
  assert.deepStrictEqual(ev(r), ["甲", "丙"]);
});
t("服务器删了一条、本地没动 → 删掉", () => {
  const r = merge(S0(), S0(), mk({ events: { 日: ["甲", "乙"] } }));
  assert.deepStrictEqual(ev(r), ["甲", "乙"]);
});
t("本地改了字、服务器没动 → 用本地改后的", () => {
  const r = merge(S0(), mk({ events: { 日: ["甲", "乙改", "丙"] } }), S0());
  assert.deepStrictEqual(ev(r), ["甲", "乙改", "丙"]);
  assert.deepStrictEqual(r.overwritten, []);
});
t("服务器改了字、本地没动 → 用服务器改后的", () => {
  const r = merge(S0(), S0(), mk({ events: { 日: ["甲", "乙改", "丙"] } }));
  assert.deepStrictEqual(ev(r), ["甲", "乙改", "丙"]);
});
// 带 ID 的写法（新版本存下来的文件都是这样）：改了字 ID 不变，合并认得出是同一条
const I0 = () => mk({ events: { 日: ["甲 ^a", "乙 ^b", "丙 ^c"] } });
const ie = l => mk({ events: { 日: l } });
t("同一条两边改成不同的字 → 后推送的（本设备）为准，覆盖服务器上那一条并记录", () => {
  const r = merge(I0(), ie(["甲 ^a", "乙本地 ^b", "丙 ^c"]), ie(["甲 ^a", "乙服务器 ^b", "丙 ^c"]));
  assert.deepStrictEqual(ev(r), ["甲", "乙本地", "丙"]);
  assert.strictEqual(r.overwritten.length, 1);
  assert.ok(r.overwritten[0].includes("乙服务器"));
});
t("没有 ID 的旧文件里同一条两边改成不同的字 → 认不出是同一条，两版都留下（不丢）", () => {
  const r = merge(S0(), mk({ events: { 日: ["甲", "乙本地", "丙"] } }), mk({ events: { 日: ["甲", "乙服务器", "丙"] } }));
  assert.deepStrictEqual(ev(r).slice().sort(), ["甲", "乙本地", "乙服务器", "丙"].sort());
  assert.deepStrictEqual(r.overwritten, []);
});
t("服务器删了一条、本地把它改了字 → 本设备改后的留下（改了的比删了的优先）", () => {
  const r = merge(I0(), ie(["甲 ^a", "乙改 ^b", "丙 ^c"]), ie(["甲 ^a", "丙 ^c"]));
  assert.deepStrictEqual(ev(r), ["甲", "乙改", "丙"]);
  assert.strictEqual(r.overwritten.length, 0);
});
t("本地删了一条、服务器把它改了字 → 服务器改后的留下", () => {
  const r = merge(I0(), ie(["甲 ^a", "丙 ^c"]), ie(["甲 ^a", "乙改 ^b", "丙 ^c"]));
  assert.deepStrictEqual(ev(r), ["甲", "乙改", "丙"]);
});
t("一边改了字、另一边把同一条挪了位置 → 字和位置都保留", () => {
  const r = merge(I0(), ie(["乙 ^b", "甲 ^a", "丙 ^c"]), ie(["甲 ^a", "乙改 ^b", "丙 ^c"]));
  assert.deepStrictEqual(ev(r), ["乙改", "甲", "丙"]);
  assert.deepStrictEqual(r.overwritten, []);
});
t("一边把一条挪到别的周几、另一边改了它的字 → 两样都保留", () => {
  const base = mk({ events: { 一: ["开会 ^m"] } });
  const r = merge(base, mk({ events: { 三: ["开会 ^m"] } }), mk({ events: { 一: ["开会改到下午 ^m"] } }));
  assert.deepStrictEqual(Array.from(r.week.events, e => [e.wd, e.text]), [[2, "开会改到下午"]]);   // wd 从周一 = 0 数起
});
t("勾选和改字分别在两边 → 都保留；两边把字改得不一样 → 本地为准并记录", () => {
  const g = (d, s) => MD.parse(head + `## 周目标\n- [${d}] ${s} ^g\n\n## 这周的事\n\n## 日记\n\n## 复盘\n`);
  let r = merge(g(" ", "跑步"), g("x", "跑步"), g(" ", "跑步 5 公里"));
  assert.deepStrictEqual([r.week.goals[0].done, r.week.goals[0].text], [true, "跑步 5 公里"]);
  r = merge(g(" ", "跑步"), g(" ", "跑步 3 公里"), g(" ", "跑步 5 公里"));
  assert.strictEqual(r.week.goals[0].text, "跑步 3 公里");
  assert.ok(r.overwritten[0].includes("跑步 5 公里"));
});
t("日记：一边改了时间、另一边改了字 → 都保留", () => {
  const r = merge(mk({ diary: ["10:00 开会 ^d"] }), mk({ diary: ["10:30 开会 ^d"] }), mk({ diary: ["10:00 开会，迟到了 ^d"] }));
  const e = Object.values(r.week.days)[0][0];
  assert.deepStrictEqual([new Date(e.ts).getHours(), new Date(e.ts).getMinutes(), e.text], [10, 30, "开会，迟到了"]);
});
t("本地改了一条的同时又新加了一条 → 改的那条本地为准，新加的也留下", () => {
  const r = merge(I0(), ie(["甲 ^a", "乙改 ^b", "丙 ^c", "新加 ^n"]), ie(["甲 ^a", "乙服务器 ^b", "丙 ^c"]));
  assert.deepStrictEqual(ev(r), ["甲", "乙改", "丙", "新加"]);
  assert.strictEqual(r.overwritten.length, 1);
});
t("勾选：只有本地改了 → 用本地；只有服务器改了 → 用服务器", () => {
  const g = d => MD.parse(head + `## 周目标\n- [${d}] 目标\n\n## 这周的事\n\n## 日记\n\n## 复盘\n`);
  assert.strictEqual(merge(g(" "), g("x"), g(" ")).week.goals[0].done, true);
  assert.strictEqual(merge(g(" "), g("x"), g("x")).week.goals[0].done, true);
  assert.strictEqual(merge(g("x"), g(" "), g("x")).week.goals[0].done, false);
});
t("复盘：本设备改了就用本设备的；只有服务器改了就用服务器的；两边都改了以本设备为准", () => {
  assert.strictEqual(merge(mk({ review: "旧" }), mk({ review: "本地" }), mk({ review: "旧" })).week.review, "本地");
  assert.strictEqual(merge(mk({ review: "旧" }), mk({ review: "旧" }), mk({ review: "服务器" })).week.review, "服务器");
  assert.strictEqual(merge(mk({ review: "旧" }), mk({ review: "本地" }), mk({ review: "服务器" })).week.review, "本地");
});
t("没有 base：只做并集，不传播删除", () => {
  const r = merge(null, mk({ events: { 日: ["甲", "丙"] } }), mk({ events: { 日: ["甲", "乙"] } }));
  assert.deepStrictEqual(ev(r).sort(), ["丙", "乙", "甲"].sort());
});
t("幂等：合并的结果再和自己合并，不变", () => {
  const r = merge(S0(), mk({ events: { 日: ["丙", "甲", "乙", "本地新"] } }), mk({ events: { 日: ["乙", "甲", "丙", "服务器新"] } })).week;
  assert.strictEqual(text(merge(r, r, r).week), text(r));
  assert.strictEqual(text(merge(null, r, r).week), text(r));
});

/* ---- 条目 ID 的读写 ---- */
const FILE = head + "## 周目标\n- [ ] 投简历\n- [x] 跑步 ^abc\n\n## 这周的事\n### 周日\n- 甲\n- 甲\n- 乙 ^abc\n\n" +
  "## 日记\n### 10-18 周日\n- 11:57 开始画手帐\n  第二行 ^d1\n  - 11:59 决定 x^y 做网页版\n\n## 复盘\n好\n";
t("ID：行尾的 ^id 读成条目 ID，不算进文字；多行日记的 ID 在最后一行；文字中间的 ^ 不受影响", () => {
  const w = MD.parse(FILE), d = w.days["2026-10-18"];
  assert.deepStrictEqual([w.goals[1].id, w.goals[1].text], ["abc", "跑步"]);
  assert.deepStrictEqual([d[0].id, d[0].text], ["d1", "开始画手帐\n第二行"]);
  assert.strictEqual(d[1].text, "决定 x^y 做网页版");
  assert.ok(MD.serialize(w).includes("  第二行 ^d1\n"), "多行条目的 ID 写回最后一行");
});
t("ID：没有 ID 的条目按内容算出固定的 ID，每次读都一样；同一周里重复的 ID 换成新的", () => {
  const a = MD.parse(FILE), b = MD.parse(FILE);
  assert.deepStrictEqual(JSON.stringify(a), JSON.stringify(b));
  const ids = [...a.goals, ...a.events, ...a.days["2026-10-18"]].map(x => x.id);
  assert.strictEqual(new Set(ids).size, ids.length, "一周里 ID 不重复：" + ids);
  assert.strictEqual(a.goals[1].id, "abc", "先出现的保留原 ID");
  assert.notStrictEqual(a.events[0].id, a.events[1].id, "两条一样的「甲」也要分得开");
});
t("ID：写出去再读回来不变（幂等）", () => {
  const s1 = MD.serialize(MD.parse(FILE));
  assert.strictEqual(MD.serialize(MD.parse(s1)), s1);
});
t("ID：新建条目的 ID 是 6 位小写字母数字，符合 Obsidian 块 ID 的写法", () => {
  for (let i = 0; i < 50; i++) assert.match(MD.newId(), /^[a-z0-9]{6}$/);
});
console.log(`\n${n} 项通过`);
