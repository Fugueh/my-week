// 检查 App 有没有新版本（只在安卓 App 里用；网页版靠 sw.js 自己更新）。
//
// 去哪查：先问 GitHub Releases，连不上再问 Gitee（国内更稳）。两边的「最新版本」接口格式一样：
//   tag_name: "v0.3.2"，assets: [{ name: "my-week.apk", browser_download_url: "…" }]
// 下载链接用回答了的那一边的 my-week.apk。
//
// 什么时候查（只读一个公开的版本信息，不带任何身份和日记内容）：
//   - 开了同步的用户：自动查，一天最多一次。他们本来就联网，查的是公开的发布页。
//   - 没开同步的用户：从不自动联网，只有点「检查更新」才查。
// 提示只给链接，不自动下载、不自动安装。覆盖安装时安卓会核对签名，签名不一致装不上去。
const Updates = (() => {
  const REPO_GITHUB = "Fugueh/my-week", REPO_GITEE = "fugueh/my-week-apk";
  const SOURCES = [
    { name: "GitHub", url: `https://api.github.com/repos/${REPO_GITHUB}/releases/latest` },
    { name: "Gitee", url: `https://gitee.com/api/v5/repos/${REPO_GITEE}/releases/latest` },
  ];
  const ASSET = "my-week.apk", KEY = "myweek-update", DAY = 24 * 3600e3, TIMEOUT = 8000;
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  const keep = s => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} };

  // "v0.3.10" > "0.3.9"；认不出的当作 0
  function newer(a, b) {
    const p = v => String(v || "").replace(/^v/i, "").split(/[.-]/).slice(0, 3).map(x => parseInt(x, 10) || 0);
    const x = p(a), y = p(b);
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
    return false;
  }

  // 发 GET。App 里走原生网络（不受浏览器跨域限制），否则用 fetch。返回解析好的 JSON
  async function getJson(url) {
    const late = new Promise((_, no) => setTimeout(() => no(new Error("超时")), TIMEOUT));
    const Http = typeof window !== "undefined" && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
    const go = Http
      ? Http.get({ url, headers: { Accept: "application/json" }, connectTimeout: TIMEOUT, readTimeout: TIMEOUT }).then(r => {
          if (r.status !== 200) throw new Error("返回 " + r.status);
          return typeof r.data === "string" ? JSON.parse(r.data) : r.data;
        })
      : fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" }).then(r => { if (!r.ok) throw new Error("返回 " + r.status); return r.json(); });
    return Promise.race([go, late]);
  }

  // 依次问每个来源，拿到第一个有 my-week.apk 的回答
  async function latest(get = getJson) {
    const errs = [];
    for (const s of SOURCES) {
      try {
        const r = await get(s.url), a = (r.assets || []).find(x => x && x.name === ASSET);
        if (!r.tag_name || !a || !a.browser_download_url) throw new Error("发布里没有 " + ASSET);
        return { version: String(r.tag_name).replace(/^v/i, ""), url: a.browser_download_url, source: s.name };
      } catch (e) { errs.push(`${s.name}：${e.message}`); }
    }
    throw new Error("查不到新版本（" + errs.join("；") + "）");
  }

  // auto=true：自动检查，只给开了同步的用户，一天最多一次。返回 { update, version, url, source } 或 null（这次没查）
  async function check({ auto = false, syncOn = false, current = APP_VERSION, get, now = Date.now() } = {}) {
    const st = load();
    if (auto && (!syncOn || (st.at && now - st.at < DAY))) return null;
    const r = await latest(get);
    keep({ ...st, at: now, latest: r.version, url: r.url, source: r.source });
    return { ...r, update: newer(r.version, current) };
  }

  // 已经知道有新版本、而且用户没点过「这一版先不提醒」：返回那一版的信息，用来显示提示条
  function pending(current = APP_VERSION) {
    const st = load();
    return st.latest && newer(st.latest, current) && st.dismissed !== st.latest ? { version: st.latest, url: st.url, source: st.source } : null;
  }
  const dismiss = v => keep({ ...load(), dismissed: v });

  return { check, pending, dismiss, newer, latest, SOURCES };
})();
