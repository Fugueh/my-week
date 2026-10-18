// 周对象 <-> Markdown。一周一个文件，例如 2026-W42.md：
//
// ---
// week: 2026-W42
// start: 2026-10-12
// updated: 2026-10-18T05:40:00.000Z
// ---
//
// ## 周目标
// - [ ] 投三份简历
//
// ## 这周的事
// ### 周一
// - 跑完 Am 的那批计算
//
// ## 日记
// ### 10-18 周日
// - 11:57 开始画手帐
//   - 11:59 决定做网页版
// - 10-19 09:00 补记的一条（写下它的日期和时间）
// - 没写时间也可以
//
// ## 复盘
// 自由文本，原样保存。
//
// 规则：缩进两个空格（或一个 Tab）为一层；不认识的 ## 段落原样保留在文件末尾。
const MD = (() => {
  const H_GOALS = "周目标", H_EVENTS = "这周的事", H_DIARY = "日记", H_REVIEW = "复盘";

  const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const md = d => `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  function serialize(w) {
    const out = ["---", `week: ${w.week}`, `start: ${w.start}`];
    if (w.updated) out.push(`updated: ${w.updated}`);
    out.push("---", "", `## ${H_GOALS}`);
    w.goals.forEach(g => out.push(`- [${g.done ? "x" : " "}] ${oneLine(g.text)}`));

    out.push("", `## ${H_EVENTS}`);
    for (let i = 0; i < 7; i++) {
      const ev = w.events.filter(e => e.wd === i);
      if (!ev.length) continue;
      out.push(`### 周${WD[i]}`);
      ev.forEach(e => out.push(`- ${oneLine(e.text)}`));
    }

    out.push("", `## ${H_DIARY}`);
    Object.keys(w.days).sort().forEach(k => {
      const list = w.days[k]; if (!list.length) return;
      const d = fromKey(k);
      out.push(`### ${md(d)} 周${WD[weekday(d)]}`);
      list.forEach(e => {
        const ind = "  ".repeat(e.indent || 0);
        let stamp = "";
        if (e.ts != null) { const t = new Date(e.ts); stamp = (dkey(t) === k ? hm(t) : `${md(t)} ${hm(t)}`) + " "; }
        const lines = String(e.text || "").split("\n");
        out.push(`${ind}- ${stamp}${lines[0]}`);
        lines.slice(1).forEach(l => out.push(`${ind}  ${l}`));      // 多行条目：续行比圆点多缩进两格
      });
    });

    out.push("", `## ${H_REVIEW}`);
    if (w.review.trim()) out.push(w.review.replace(/\s+$/, ""));
    if (w.extra && w.extra.trim()) out.push("", w.extra.replace(/\s+$/, ""));
    return out.join("\n") + "\n";
  }
  const oneLine = s => String(s).replace(/\s*\n\s*/g, " ");

  // 某周里 "MM-DD" 对应的完整日期（跨年周也能对上）
  function resolveMD(startKey, mm, dd) {
    const s = fromKey(startKey);
    for (let i = -7; i < 14; i++) { const d = addDays(s, i); if (d.getMonth() + 1 === mm && d.getDate() === dd) return d; }
    return new Date(s.getFullYear(), mm - 1, dd);
  }

  function parse(text) {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const meta = {}; let i = 0;
    if (lines[0] && lines[0].trim() === "---") {
      for (i = 1; i < lines.length && lines[i].trim() !== "---"; i++) {
        const m = lines[i].match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/); if (m) meta[m[1]] = m[2];
      }
      i++;
    }
    if (!meta.start && meta.week) meta.start = startOfIsoWeek(meta.week);
    if (!meta.start) throw new Error("文件开头缺少 start 或 week");
    const start = meta.start;
    const w = { schema: 1, week: meta.week || isoWeek(fromKey(start)), start, end: dkey(addDays(fromKey(start), 6)),
                updated: meta.updated || null, events: [], goals: [], review: "", days: {}, extra: "" };

    let sec = null, sub = null, reviewBuf = [], extraBuf = [], last = null;
    for (; i < lines.length; i++) {
      const line = lines[i];
      const h2 = line.match(/^##\s+(.+?)\s*$/);
      if (h2 && !line.startsWith("###")) {
        const name = h2[1];
        sec = [H_GOALS, H_EVENTS, H_DIARY, H_REVIEW].includes(name) ? name : "extra";
        if (sec === "extra") extraBuf.push(line);
        sub = null; last = null; continue;
      }
      if (sec === H_REVIEW) { reviewBuf.push(line); continue; }
      if (sec === "extra" || sec === null) { if (sec === "extra" || line.trim()) extraBuf.push(line); continue; }

      const h3 = line.match(/^###\s+(.+?)\s*$/);
      if (h3) {
        last = null;
        if (sec === H_EVENTS) { const m = h3[1].match(/周([一二三四五六日天])/); sub = m ? WD.indexOf(m[1] === "天" ? "日" : m[1]) : null; }
        if (sec === H_DIARY) {
          const m = h3[1].match(/(?:(\d{4})-)?(\d{1,2})-(\d{1,2})/);
          sub = m ? dkey(m[1] ? new Date(+m[1], m[2] - 1, +m[3]) : resolveMD(start, +m[2], +m[3])) : null;
          if (sub && !w.days[sub]) w.days[sub] = [];
        }
        continue;
      }
      if (!line.trim()) continue;

      const b = line.match(/^([ \t]*)[-*+]\s+(.*)$/);
      const indent = b ? Math.floor(b[1].replace(/\t/g, "  ").length / 2) : 0;
      if (sec === H_GOALS) {
        if (!b) continue;
        const m = b[2].match(/^\[([ xX])\]\s*(.*)$/);
        w.goals.push({ id: "g_" + uid(), done: m ? m[1] !== " " : false, text: m ? m[2] : b[2] });
      } else if (sec === H_EVENTS) {
        if (!b) { if (last) last.text += " " + line.trim(); continue; }
        last = { id: "w_" + uid(), wd: sub ?? 0, text: b[2] }; w.events.push(last);
      } else if (sec === H_DIARY) {
        if (!sub) continue;
        if (!b) { if (last) last.text += "\n" + line.trim(); continue; }   // 续行
        let body = b[2], ts = null;
        const full = body.match(/^(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})\s+(.*)$/);
        const short = body.match(/^(\d{1,2}):(\d{2})(?:\s+(.*))?$/);
        if (full) { const d = resolveMD(start, +full[1], +full[2]); d.setHours(+full[3], +full[4]); ts = d.getTime(); body = full[5]; }
        else if (short && +short[1] < 24) { const d = fromKey(sub); d.setHours(+short[1], +short[2]); ts = d.getTime(); body = short[3] || ""; }
        const list = w.days[sub], prevInd = list.length ? list[list.length - 1].indent : -1;
        last = { id: "e_" + uid(), ts, indent: Math.min(indent, prevInd + 1), text: body };
        list.push(last);
      }
    }
    w.review = reviewBuf.join("\n").replace(/^\n+|\s+$/g, "");
    w.extra = extraBuf.join("\n").replace(/^\n+|\s+$/g, "");
    return w;
  }

  function startOfIsoWeek(id) {
    const m = id.match(/^(\d{4})-W(\d{2})$/); if (!m) return null;
    const jan4 = new Date(+m[1], 0, 4);
    return dkey(addDays(monday(jan4), (+m[2] - 1) * 7));
  }

  return { serialize, parse, startOfIsoWeek };
})();
