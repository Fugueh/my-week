// 三方合并：把「上次和服务器对齐时的那份（base）」「本设备现在的这份（local）」「服务器现在的这份（server）」
// 合成一份。纯函数，不碰网络和存储，同样的输入永远得到同样的结果。
//
// 按条目合并，不按文本行合并：一周被拆成几个列表（周目标、每个周几的事、每天的日记），
// 每个列表里的每一条是一个条目。条目的身份：
//   周目标、这周的事  → 内容本身
//   日记             → 时间戳 + 内容
//
// 对每个条目（base / local / server 里各有没有）：
//   local 和 server 都有            → 保留
//   只有一边有，base 里没有          → 是那一边新加的，保留
//   只有一边有，base 里有            → 另一边删了（或改了字），丢掉
//   两边都没有                      → 丢掉
// 一条被改了字，就等于「删掉旧的、加上新的」。
// 例外（同一条被两边同时改）：本地新加的那一条，如果正好紧挨在一条 base 条目原来的位置，
//   而那条 base 条目在 local 和 server 里都没了，就当作「对同一条的并发修改」，以服务器为准，
//   丢掉本地这一条，并记进 dropped 里让页面提示。
//
// 顺序：以服务器的顺序为骨架。只有本设备调整过顺序（服务器没动）时，用本设备的顺序。
//   只在另一边出现的条目，放在它在那一边的前一个邻居后面。
// 勾选状态：只有一边改了就用那一边，两边都改了以服务器为准。
// 复盘、其他内容：只有一边改了就用那一边，两边都改了以服务器为准。
// 没有 base（比如新装的设备第一次同步）：只做并集，不传播删除。
const Merge = (() => {
  const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  // 同一个身份出现多次时，给它们编上序号，保证每个条目在列表里有唯一的 id
  function ids(items, keyOf) {
    const n = new Map();
    return items.map(it => { const k = keyOf(it), c = (n.get(k) || 0) + 1; n.set(k, c); return k + "\u0000" + c; });
  }

  // 合并一个列表。B 可以是 null（没有 base）。dropped 收集被丢掉的本地条目。
  function mergeList(B, A, S, keyOf, label, dropped, fields) {
    const hasB = !!B, Bi = ids(B || [], keyOf), Ai = ids(A, keyOf), Si = ids(S, keyOf);
    const inB = new Set(Bi), inA = new Set(Ai), inS = new Set(Si);
    const item = new Map();
    Ai.forEach((id, i) => item.set(id, A[i]));
    Si.forEach((id, i) => item.set(id, S[i]));            // 两边都有时用服务器的那份

    // 并发修改：本地新加的一条紧挨着一个「两边都没了」的 base 条目
    const goneBoth = new Set(Bi.filter(id => !inA.has(id) && !inS.has(id)));
    const claimed = new Set(), lostLocal = new Set();
    if (hasB) {
      let prev = null;
      Ai.forEach(id => {
        if (inB.has(id)) { prev = id; return; }
        if (inS.has(id)) return;
        const slot = prev === null ? Bi[0] : Bi[Bi.indexOf(prev) + 1];
        if (slot !== undefined && goneBoth.has(slot) && !claimed.has(slot)) { claimed.add(slot); lostLocal.add(id); }
      });
    }
    Ai.forEach((id, i) => { if (lostLocal.has(id)) dropped.push(`${label}：${String(A[i].text).split("\n")[0]}`); });

    const keep = id => inA.has(id) && inS.has(id) ? true
      : inA.has(id) ? !inB.has(id) && !lostLocal.has(id)
      : inS.has(id) ? !inB.has(id) : false;

    // 选骨架：只有本设备动过顺序时用本设备的
    const common = new Set(Ai.filter(id => inS.has(id)));
    const onlyCommonB = Bi.filter(id => common.has(id));
    const moved = list => hasB && !eq(list.filter(id => inB.has(id) && common.has(id)), onlyCommonB);
    const useA = moved(Ai) && !moved(Si);
    const K = useA ? Ai : Si, O = useA ? Si : Ai;

    const out = K.filter(keep);
    let at = -1;
    const posIn = new Set(K);
    O.forEach(id => {
      if (posIn.has(id)) { at = out.indexOf(id); return; }
      if (keep(id)) { out.splice(at + 1, 0, id); at++; }
    });

    return out.map(id => {
      const x = item.get(id);
      return fields ? fields(x, id, { b: hasB && inB.has(id) ? B[Bi.indexOf(id)] : null, a: inA.has(id) ? A[Ai.indexOf(id)] : null, s: inS.has(id) ? S[Si.indexOf(id)] : null }) : x;
    });
  }

  // 整段文本：只有一边改了就用那一边，两边都改了以服务器为准
  function scalar(b, a, s) {
    if (b == null) return s || a || "";
    return s !== b ? s : a;
  }

  function weeks(base, local, server) {
    const dropped = [];
    const B = base || null;
    const out = { ...server, goals: [], events: [], days: {}, review: "", extra: "" };

    out.goals = mergeList(B && B.goals, local.goals, server.goals, g => g.text, "周目标", dropped, (x, id, v) => {
      if (!v.a || !v.s) return x;
      return { ...x, done: v.b && v.s.done === v.b.done ? v.a.done : v.s.done };
    });

    for (let wd = 0; wd < 7; wd++) {
      const pick = w => (w ? w.events : []).filter(e => e.wd === wd);
      out.events.push(...mergeList(B && pick(B), pick(local), pick(server), e => e.text, "周" + WD[wd], dropped));
    }

    const dayKeys = new Set([...Object.keys(local.days), ...Object.keys(server.days), ...(B ? Object.keys(B.days) : [])]);
    [...dayKeys].sort().forEach(k => {
      const merged = mergeList(B ? (B.days[k] || []) : null, local.days[k] || [], server.days[k] || [],
        e => `${e.ts == null ? "" : e.ts}|${e.text}`, "日记 " + k.slice(5), dropped);
      if (merged.length || server.days[k] || local.days[k]) out.days[k] = merged;
    });

    out.review = scalar(B && B.review, local.review, server.review);
    out.extra = scalar(B && B.extra, local.extra || "", server.extra || "");
    return { week: out, dropped };
  }

  return { weeks };
})();
