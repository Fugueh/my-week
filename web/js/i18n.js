// 界面语言：跟随系统语言，中文系统显示中文，其他显示英文（地址里加 ?lang=zh 或 ?lang=en 可以临时指定）。
// 用法：tr("同步没成功：{0}", msg)。中文原文就是键，英文在 EN 里；EN 里没有的就原样显示中文，不会空白。
// 只翻译界面。周文件（.md）里的标题（## 周目标 等）永远是中文，这是数据格式，换语言不改它。
const LANG = (() => {
  try {
    const q = /[?&]lang=(zh|en)\b/.exec(location.search); if (q) return q[1];
    const l = (navigator.languages && navigator.languages[0]) || navigator.language || "zh";
    return /^zh/i.test(l) ? "zh" : "en";
  } catch (e) { return "zh"; }
})();
const tr = (zh, ...a) => {
  const s = LANG === "en" && Object.prototype.hasOwnProperty.call(EN, zh) ? EN[zh] : zh;
  return a.length ? s.replace(/\{(\d+)\}/g, (m, i) => (i in a ? a[i] : m)) : s;
};
// 页面里写死的文字：按原文整句替换（文字节点、placeholder、title、aria-label、alt）
function trDom(root) {
  if (LANG !== "en") return;
  const sub = s => { const k = s.trim(); return k && Object.prototype.hasOwnProperty.call(EN, k) ? s.replace(k, EN[k]) : s; };
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) if (n.parentNode.tagName !== "SCRIPT") n.nodeValue = sub(n.nodeValue);
  root.querySelectorAll("[placeholder],[title],[aria-label],[alt]").forEach(el => {
    for (const a of ["placeholder", "title", "aria-label", "alt"]) if (el.hasAttribute(a)) el.setAttribute(a, sub(el.getAttribute(a)));
  });
}
const cnt = n => LANG === "en" ? `${n} ${n === 1 ? "entry" : "entries"}` : `${n} 条`;   // 3 条 / 3 entries
const cntShort = n => LANG === "en" ? `${n} ${n === 1 ? "note" : "notes"}` : `${n}条`;   // 周页面小格子里的数量
