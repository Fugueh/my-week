// 更新后第一次打开时弹出「新功能」。
// 记住「上次看到的是哪一版」（localStorage 的 myweek-seen-version）；比现在的版本旧，就把中间这些版本的说明弹出来，点「知道了」才算看过。
// 全新安装（本机没有任何日记、也没开同步）不弹，只是记下版本号。
// 发新版本时：在 NOTES 最前面加一条（版本号 + 几句人话），并在 i18n-en.js 补上英文；这一版没有值得说的就不加，也就不弹。
const NOTES = [
  { version: "0.4.0", items: [
    tr("优化安卓：在日记页按返回键，将回到周页面，不再直接退出 App。"),
    tr("日记可以插入图片：点输入框旁的图片图标选图（电脑上可以直接粘贴截图），页面里显示缩略图，点开查看大图。"),
    tr("图片同步；开启端到端加密的账号，图片会加密后上传。"),
    tr("新增英文界面，跟随系统语言自动切换。"),
    
  ] },
];
const WhatsNew = (() => {
  const KEY = "myweek-seen-version";
  const num = v => String(v).split(".").map(n => parseInt(n, 10) || 0);
  const cmp = (a, b) => { const x = num(a), y = num(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
  const get = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const set = v => { try { localStorage.setItem(KEY, v); } catch (e) {} };
  // 该弹哪些说明：比「上次看到的」新、不比现在的版本新的，新的在前。hasData = 这台设备上已经有数据（升级上来的，不是新装的）
  function pending(current, hasData, notes = NOTES) {
    const seen = get();
    if (seen == null && !hasData) { set(current); return []; }   // 新装：不打扰
    if (seen != null && cmp(seen, current) >= 0) return [];
    return notes.filter(n => (seen == null || cmp(n.version, seen) > 0) && cmp(n.version, current) <= 0).sort((a, b) => cmp(b.version, a.version));
  }
  return { pending, seen: v => set(v), cmp, NOTES };
})();
