// 图片接口：上传、下载、真删、认证、加密账号只收密文、总量上限。起一个真的服务（server/app.py），用完关掉。
// 找不到可用的 python 就跳过（不算失败）。
const { spawn, spawnSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");

const py = ["python3", "python", "C:/ProgramData/miniforge3/python.exe"].find(p => { try { return spawnSync(p, ["-c", "import sys;sys.exit(0 if sys.version_info>=(3,8) else 1)"]).status === 0; } catch (e) { return false; } });
if (!py) { console.log("skip  图片接口：这台机器上没有 python"); process.exit(0); }

const TOKEN = "t".repeat(24), PORT = 8700 + Math.floor(Math.random() * 90), BASE = `http://127.0.0.1:${PORT}`;
const data = fs.mkdtempSync(path.join(os.tmpdir(), "myweek-img-"));
const srv = spawn(py, [path.join(__dirname, "../server/app.py")], {
  env: { ...process.env, MYWEEK_TOKEN: TOKEN, DATA_DIR: data, WEB_DIR: path.join(__dirname, "../web"), USERS_FILE: path.join(data, "none"), PORT: String(PORT), IMAGE_QUOTA: "1000", PYTHONUTF8: "1" },
  stdio: "ignore",
});
const H = { Authorization: "Bearer " + TOKEN };
const call = (method, p, body, headers = {}) => fetch(BASE + p, { method, body, headers: { ...H, ...headers }, cache: "no-store" });
const jpeg = n => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 7)]);

let fails = 0;
const ok = (c, m) => { if (c) console.log("ok  " + m); else { console.log("  ✗ " + m); fails++; } };

(async () => {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + "/api/health")).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 100)); }
  try {
    let r = await call("PUT", "/api/images/iabc123", jpeg(100));
    ok(r.status === 200, "上传 JPEG 成功");
    r = await call("GET", "/api/images/iabc123");
    const got = Buffer.from(await r.arrayBuffer());
    ok(r.status === 200 && got.equals(jpeg(100)) && r.headers.get("content-type") === "image/jpeg", "下载回来和上传的一模一样");
    ok((await fetch(BASE + "/api/images/iabc123")).status === 401, "没带令牌：401");
    ok((await call("PUT", "/api/images/ibad1", "not an image")).status === 415, "不是 JPEG 也不是密文：415");
    ok((await call("PUT", "/api/images/a.b", jpeg(10))).status === 400, "图片 ID 里有不合法字符：400");
    ok((await call("PUT", "/api/images/ibig1", jpeg(5 << 20))).status === 413, "超过单张上限：413");
    ok((await call("PUT", "/api/images/iabc124", jpeg(950))).status === 507, "超过账号总量上限：507");

    r = await call("DELETE", "/api/images/iabc123");
    ok(r.status === 200 && (await call("GET", "/api/images/iabc123")).status === 404, "删除后再取是 404");
    ok(!fs.existsSync(path.join(data, "images", "iabc123")), "服务器上的文件真的没了");
    ok((await call("DELETE", "/api/images/iabc123")).status === 200, "重复删除没有副作用");
    ok((await fetch(BASE + "/api/images/iabc123", { method: "DELETE" })).status === 401, "没带令牌不能删：401");

    r = await call("PUT", "/api/meta", JSON.stringify({ e2ee: true, keyId: "1a2b3c4d" }), { "Content-Type": "application/json" });
    ok(r.status === 200, "开启加密");
    ok((await call("PUT", "/api/images/iabc125", jpeg(10))).status === 422, "开了加密：明文图片被拒（422）");
    const sealed = Buffer.concat([Buffer.from("MYWEEK-E2EE/1 1a2b3c4d\n"), Buffer.alloc(30, 9)]);
    r = await call("PUT", "/api/images/iabc125", sealed);
    const back = Buffer.from(await (await call("GET", "/api/images/iabc125")).arrayBuffer());
    ok(r.status === 200 && back.equals(sealed), "开了加密：密文收下并原样取回");
  } finally { srv.kill(); fs.rmSync(data, { recursive: true, force: true }); }
  console.log(fails ? `${fails} 项失败` : "\n14 项通过");
  process.exit(fails ? 1 : 0);
})();
