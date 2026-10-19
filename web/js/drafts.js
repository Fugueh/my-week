// 草稿：三个「写一句、回车记下」的输入框（日记、这周的事、周目标）里还没记下的字。
// 每敲一个字就存进本机，关掉 App、刷新页面再打开还在；回车记下之后清掉。
// 只在这台设备上，不同步——还没记下的东西不算日记内容。
const Drafts = (() => {
  const KEY = "myweek-drafts";
  const all = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  const write = d => { try { if (Object.keys(d).length) localStorage.setItem(KEY, JSON.stringify(d)); else localStorage.removeItem(KEY); } catch (e) {} };

  // extra 是跟着草稿一起记的东西，比如「这周的事」选的是周几
  function set(name, text, extra) {
    const d = all();
    if (text && text.trim()) d[name] = { text, at: Date.now(), ...(extra || {}) }; else delete d[name];
    write(d);
  }
  const get = name => all()[name] || null;
  const clear = name => set(name, "");

  return { get, set, clear };
})();
