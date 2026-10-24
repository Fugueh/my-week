// 是否运行在安卓 App（Capacitor）里：App 里没有「同一个网址的服务器」，同步要填服务器地址
const IS_APP = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
// 日期工具：周一为一周的第一天，周编号用 ISO 8601（2026-W42）
const WD = ["一", "二", "三", "四", "五", "六", "日"];
const pad = n => String(n).padStart(2, "0");
const dkey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
function monday(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
const weekday = d => (d.getDay() + 6) % 7; // 0 = 周一

// 某天所在的 ISO 周，例如 "2026-W42"
function isoWeek(d) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() + 3 - weekday(t));            // 本周的周四决定归属年份
  const y = t.getFullYear(), jan4 = new Date(y, 0, 4);
  const w = 1 + Math.round(((t - jan4) / 864e5 - 3 + weekday(jan4)) / 7);
  return `${y}-W${pad(w)}`;
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// 时间戳颜色：凌晨靛蓝 → 清晨玫瑰 → 上午琥珀 → 正午绿 → 下午蓝 → 傍晚紫 → 深夜回到靛蓝
const STOPS = [[0, 265, .45], [5, 20, .9], [8, 70, 1], [12, 145, 1], [16, 230, 1], [19, 300, .9], [22, 275, .6], [24, 265, .45]];
function hueAt(h) {
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [a, ha, ca] = STOPS[i], [b, hb, cb] = STOPS[i + 1];
    if (h >= a && h <= b) {
      const f = (h - a) / (b - a); let dh = hb - ha;
      if (dh > 180) dh -= 360; if (dh < -180) dh += 360;
      return [(ha + dh * f + 360) % 360, ca + (cb - ca) * f];
    }
  }
  return [265, .45];
}
const tsColor = d => { const [h, c] = hueAt(d.getHours() + d.getMinutes() / 60); return `oklch(var(--tsL) calc(var(--tsC) * ${c.toFixed(3)}) ${h.toFixed(1)})`; };

// 界面上的星期和日期（随界面语言；.md 文件里的写法不变，见 markdown.js）
const WD_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayName = i => LANG === "en" ? WD_EN[i] : "周" + WD[i];       // 周一 / Mon
const dayShort = i => LANG === "en" ? WD_EN[i] : WD[i];              // 一 / Mon
const monthDay = d => LANG === "en" ? `${MON_EN[d.getMonth()]} ${d.getDate()}` : `${d.getMonth() + 1}月${d.getDate()}日`;   // 10月24日 / Oct 24
