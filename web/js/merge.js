// 三方合并：把「上次和服务器对齐时的那份（base）」「本设备现在的这份（local）」「服务器现在的这份（server）」
// 合成一份。纯函数，不碰网络和存储，同样的输入永远得到同样的结果。
//
// 按条目合并，不按文本行合并：一周被拆成几个列表（周目标、这周的事、每天的日记），
// 每个列表里的每一条是一个条目，靠条目 ID 认出「同一条」（ID 写在 .md 行尾，见 markdown.js），改了字也认得出来。
//
// 对每个条目（base / local / server 里各有没有）：
//   local 和 server 都有            → 保留，逐个字段三方合并（见下）
//   只有一边有，base 里没有          → 是那一边新加的，保留
//   只有一边有，base 里有            → 另一边删了：这一边也没改过就删掉；这一边改过就留下（改了的比删了的优先）
//   两边都没有                      → 丢掉
// 字段（文字、勾选、周几、时间、缩进）：哪边改了用哪边的；两边改成了不同的样子 → 本设备（后推送的）为准，
//   服务器上那一版记进 overwritten（同步那边会提示，并把服务器那一版存成快照）。
//
// 顺序：本设备调整过顺序就用本设备的，否则用服务器的。
//   只在另一边出现的条目，放在它在那一边的前一个邻居后面。
// 复盘、其他内容：本设备改了就用本设备的，否则用服务器的。
// 没有 base（比如新装的设备第一次同步）：只做并集，不传播删除；同一条两边不一样时以服务器为准（分不出谁改的）。
const Merge = (() => {
  const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  // 合并一个列表。B 可以是 null（没有 base）。fields 是这种条目要比较的字段，labelOf 给提示用
  function mergeList(B, A, S, fields, labelOf, overwritten) {
    const hasB = !!B, Bi = (B || []).map(x => x.id), Ai = A.map(x => x.id), Si = S.map(x => x.id);
    const inB = new Set(Bi), inA = new Set(Ai), inS = new Set(Si);
    const byB = new Map((B || []).map(x => [x.id, x])), byA = new Map(A.map(x => [x.id, x])), byS = new Map(S.map(x => [x.id, x]));
    const differs = (x, y) => fields.some(f => x[f] !== y[f]);

    const keep = id => inA.has(id) && inS.has(id) ? true
      : inA.has(id) ? !inB.has(id) || differs(byA.get(id), byB.get(id))
      : inS.has(id) ? !inB.has(id) || differs(byS.get(id), byB.get(id)) : false;

    // 两边都有的条目：逐个字段合并
    function both(id) {
      const a = byA.get(id), s = byS.get(id), b = byB.get(id), out = { ...s };
      let clash = false;
      for (const f of fields) {
        if (a[f] === s[f]) continue;
        if (!b) out[f] = s[f];                       // 没有 base：分不出谁改的，以服务器为准
        else if (a[f] === b[f]) out[f] = s[f];       // 只有服务器改了
        else if (s[f] === b[f]) out[f] = a[f];       // 只有本地改了
        else { out[f] = a[f]; clash = true; }        // 两边改得不一样：本地（后推送的）为准
      }
      if (clash) overwritten.push(`${labelOf(s)}：${String(s.text).split("\n")[0]}`);
      return out;
    }

    // 选骨架：只有本设备动过顺序时用本设备的
    const common = new Set(Ai.filter(id => inS.has(id)));
    const onlyCommonB = Bi.filter(id => common.has(id));
    const moved = list => hasB && !eq(list.filter(id => inB.has(id) && common.has(id)), onlyCommonB);
    const useA = moved(Ai);
    const K = useA ? Ai : Si, O = useA ? Si : Ai;

    const out = K.filter(keep);
    let at = -1;
    const posIn = new Set(K);
    O.forEach(id => {
      if (posIn.has(id)) { at = out.indexOf(id); return; }
      if (keep(id)) { out.splice(at + 1, 0, id); at++; }
    });

    return out.map(id => inA.has(id) && inS.has(id) ? both(id) : byA.get(id) || byS.get(id));
  }

  // 整段文本：本设备改了就用本设备的，否则用服务器的；没有 base 时以服务器为准（没法分辨谁改了）
  function scalar(b, a, s) {
    if (b == null) return s || a || "";
    return a !== b ? a : s;
  }

  function weeks(base, local, server) {
    const overwritten = [];
    const B = base || null;
    const out = { ...server, goals: [], events: [], days: {}, review: "", extra: "" };

    out.goals = mergeList(B && B.goals, local.goals, server.goals, ["text", "done"], () => "周目标", overwritten);
    // 这周的事合成一个列表：一边把某条挪到别的周几、另一边改了它的字，两样都保留
    out.events = mergeList(B && B.events, local.events, server.events, ["text", "wd"], e => "周" + WD[e.wd], overwritten);

    const dayKeys = new Set([...Object.keys(local.days), ...Object.keys(server.days), ...(B ? Object.keys(B.days) : [])]);
    [...dayKeys].sort().forEach(k => {
      const merged = mergeList(B ? (B.days[k] || []) : null, local.days[k] || [], server.days[k] || [],
        ["text", "ts", "indent"], () => "日记 " + k.slice(5), overwritten);
      if (merged.length || server.days[k] || local.days[k]) out.days[k] = merged;
    });

    out.review = scalar(B && B.review, local.review, server.review);
    out.extra = scalar(B && B.extra, local.extra || "", server.extra || "");
    return { week: out, overwritten };
  }

  return { weeks };
})();
