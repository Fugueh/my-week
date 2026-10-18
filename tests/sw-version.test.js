// 检查 web/sw.js 的 CACHE 名是否跟得上 SHELL 文件的内容：改了页面文件却没换 CACHE 名，用户就永远拿不到新版本。
// 用法：node tests/sw-version.test.js         检查，不一致就失败
//       node tests/sw-version.test.js --fix   把 sw.js 里的 CACHE 名改成当前内容的哈希
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const WEB = path.join(__dirname, "..", "web"), SW = path.join(WEB, "sw.js");
const sw = fs.readFileSync(SW, "utf8");
const shell = JSON.parse(sw.match(/const SHELL = (\[[^\]]*\])/)[1]);
const h = crypto.createHash("sha256");
for (const p of shell) {
  let buf = fs.readFileSync(path.join(WEB, p));
  if (!/\.(png|jpg|webp|ico)$/.test(p)) buf = Buffer.from(buf.toString("utf8").replace(/\r\n/g, "\n"));   // Windows 换行不算改动
  h.update(p + "\0" + buf.length + "\0"); h.update(buf);
}
const want = "myweek-" + h.digest("hex").slice(0, 8), got = (sw.match(/const CACHE = "([^"]+)"/) || [])[1];
if (got === want) { console.log(`sw-version: ok（${want}）`); process.exit(0); }
if (process.argv.includes("--fix")) {
  fs.writeFileSync(SW, sw.replace(/const CACHE = "[^"]+"/, `const CACHE = "${want}"`));
  console.log(`sw-version: ${got} → ${want}`); process.exit(0);
}
console.error(`sw-version: web/ 下的页面文件改过了，sw.js 的 CACHE 还是 ${got}，应为 ${want}。\n  运行 node tests/sw-version.test.js --fix`);
process.exit(1);
