// 日记里的图片。每张图存两份：大图（长边最多 1600，JPEG）和缩略图（长边 320），键是图片 ID 和 ID + "t"。
// 本机存在 IndexedDB（库 myweek-img）。开了同步就也传到服务器（/api/images/<键>，开了端到端加密的账号传的是密文）：
//   - 新加的图进「待上传」队列，同步时上传；别的设备看到周文件里的引用 ![](img:ID)，要显示时才从服务器下载（先缩略图），存在本机
//   - 用户删图 = 本机立刻删、队列里记一笔「待删除」，同步时让服务器真删（像社交媒体一样，删了就没了，不留副本）
//   - 别的设备上的缓存：周文件里已经没有引用的图，同步后从本机清掉（Img.prune）
// 队列存在 localStorage（myweek-imgq），断网时攒着，联网后补做。
const Img = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open("myweek-img", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("i");
    r.onsuccess = () => res(r.result); r.onerror = () => { dbp = null; rej(r.error); };
  }));
  const run = async (mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction("i", mode), q = fn(t.objectStore("i"));
      t.oncomplete = () => res(q && q.result); t.onerror = t.onabort = () => rej(t.error);
    });
  };

  // 解码：先用 createImageBitmap（带方向），不行就退到不带选项，再不行用 <img>（旧 WebView 或个别格式）
  async function decode(file) {
    if (window.createImageBitmap) {
      for (const opt of [{ imageOrientation: "from-image" }, undefined]) {
        try { return await createImageBitmap(file, opt); } catch (e) {}
      }
    }
    const u = URL.createObjectURL(file);
    try {
      const im = new Image(); im.src = u; await im.decode();
      return { width: im.naturalWidth, height: im.naturalHeight, el: im };
    } catch (e) { throw Object.assign(new Error(tr("{0} 解不开（{1}）。支持 JPG、PNG、WebP、GIF；iPhone 的 HEIC 请先转成 JPG", file.name || tr("这张图片"), file.type || tr("未知格式"))), { ours: true }); }
    finally { setTimeout(() => URL.revokeObjectURL(u), 5000); }
  }
  function render(bmp, max, quality) {
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp.el || bmp, 0, 0, c.width, c.height);
    return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error(tr("图片压缩失败"))), "image/jpeg", quality));
  }

  const urls = new Map();   // "id" / "idt" -> Promise<objectURL | null>
  const forget = key => urls.delete(key);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // 压缩并存下，返回新图片的 ID。只解码一次、大图小图都从它出；
  // 手机上大图偶尔会解码失败（内存紧），所以整个过程最多重试 3 次
  async function add(file) {
    const id = "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    let last;
    for (let i = 0; i < 3; i++) {
      let bmp;
      try {
        bmp = await decode(file);
        const big = await render(bmp, 1600, 0.82), small = await render(bmp, 320, 0.7);
        await run("readwrite", s => { s.put(big, id); s.put(small, id + "t"); });
        forget(id); forget(id + "t");
        addToQueue(id);   // 开了同步就传到服务器
        return id;
      } catch (e) { last = e; await sleep(400 * (i + 1)); }
      finally { if (bmp && bmp.close) bmp.close(); }
    }
    throw last.ours ? last : new Error(tr("图片解不开（{0}）：{1}", file.type || tr("未知格式"), last.message));
  }

  /* ---- 队列：待上传 / 待删除（localStorage） ---- */
  const QK = "myweek-imgq";
  const loadQ = () => { try { const q = JSON.parse(localStorage.getItem(QK)); return { up: q.up || [], del: q.del || [] }; } catch (e) { return { up: [], del: [] }; } };
  const saveQ = q => { try { localStorage.setItem(QK, JSON.stringify(q)); } catch (e) {} };
  const poke = () => { try { if (Sync.enabled()) Sync.soon(1500); } catch (e) {} };   // 有改动：马上排一轮同步
  const syncOn = () => { try { return Sync.enabled(); } catch (e) { return false; } };

  // 图片的地址（object URL）。本机没有就去服务器取（先缩略图，点开大图时再取大图）；取不到是 null
  async function load(key) {
    const b = await run("readonly", s => s.get(key)).catch(() => null);
    if (b) return URL.createObjectURL(b);
    if (!syncOn()) return null;
    const got = await Sync.fetchImage(key);     // 服务器上没有是 null，网络问题会抛错
    if (!got) return null;
    await run("readwrite", s => { s.put(got, key); }).catch(() => {});
    return URL.createObjectURL(got);
  }
  function url(id, thumb) {
    const key = thumb ? id + "t" : id;
    if (!urls.has(key)) urls.set(key, load(key).catch(() => { urls.delete(key); return null; }).then(u => { if (!u) urls.delete(key); return u; }));
    return urls.get(key);
  }
  const addToQueue = id => { const q = loadQ(); q.del = q.del.filter(x => x !== id); if (!q.up.includes(id)) q.up.push(id); saveQ(q); poke(); };

  // 删掉一张图：本机立刻删；服务器上的也要删（断网就先记着）
  async function remove(id) {
    for (const k of [id, id + "t"]) { forget(k); }
    await run("readwrite", s => { s.delete(id); s.delete(id + "t"); }).catch(() => {});
    const q = loadQ(); q.up = q.up.filter(x => x !== id); if (!q.del.includes(id)) q.del.push(id); saveQ(q); poke();
  }

  // 同步里调：先做待删除，再做待上传。api = { put(key, blob) → HTTP 状态, del(key) → 是否成功 }
  // 返回提示文字的数组；网络错误直接抛出（留在队列里下轮再试）
  async function sync(api) {
    const notes = [], q = loadQ();
    for (const id of [...q.del]) {
      if (!(await api.del(id)) || !(await api.del(id + "t"))) throw new Error(tr("服务器没能删掉图片"));
      q.del = q.del.filter(x => x !== id); saveQ(q);
    }
    for (const id of [...q.up]) {
      const [big, small] = await Promise.all([run("readonly", s => s.get(id)), run("readonly", s => s.get(id + "t"))]).catch(() => [null, null]);
      if (!big || !small) { q.up = q.up.filter(x => x !== id); saveQ(q); continue; }   // 本机已经没有这张了
      let full = false;
      for (const [k, b] of [[id + "t", small], [id, big]]) {
        const st = await api.put(k, b);
        if (st === 413 || st === 415) { notes.push(tr("有一张图片服务器不收（太大或格式不对），没有上传")); break; }
        if (st === 507) { full = true; notes.push(tr("图片总量超过了服务器上这个账号的上限，新图片先留在这台设备上")); break; }
        if (st !== 200) throw new Error(tr("上传图片失败 {0}", st));
      }
      if (full) break;
      q.up = q.up.filter(x => x !== id); saveQ(q);
    }
    return notes;
  }

  // 清本机缓存：周文件里已经没有引用的图（别的设备上删掉的）从本机删掉。
  // 不动：还在待上传的图，和一天以内新加的图（可能还没记进条目里）。服务器上的不受影响。
  async function prune(refs) {
    const keys = await run("readonly", s => s.getAllKeys()).catch(() => []), up = new Set(loadQ().up), now = Date.now();
    const gone = keys.filter(k => {
      const id = refs.has(k) || (k.endsWith("t") && refs.has(k.slice(0, -1))) ? null : k;
      if (!id || up.has(id) || (id.endsWith("t") && up.has(id.slice(0, -1)))) return false;
      const born = parseInt(id.slice(1, 9), 36);
      return !(born > 0 && now - born < 864e5);
    });
    if (gone.length) { await run("readwrite", s => { gone.forEach(k => s.delete(k)); }).catch(() => {}); gone.forEach(forget); }
    return gone.length;
  }
  return { add, url, remove, sync, prune };
})();
