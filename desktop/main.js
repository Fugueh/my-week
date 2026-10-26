// Windows 桌面版（Electron）。界面就是 web/ 那一份，这里只做网页做不到的事：
//   - 数据文件夹：直接读写磁盘上的 2026-W42.md（默认「文档\MyWeek」，可以换；路径里不放中文），
//     网页里 store.js 的 desktopFolder 通过 preload.js 调用下面的 folder:* 接口
//   - 「在文件管理器中打开」：用资源管理器打开数据文件夹
//   - 外部链接交给系统浏览器，不在窗口里打开
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const fs = require("fs/promises");
const path = require("path");

const WEEK_FILE = /^\d{4}-W\d{2}\.md$/;

if (!app.requestSingleInstanceLock()) app.quit();   // 只开一个窗口，两个窗口同时写同一个文件夹会互相覆盖

let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 860, minWidth: 360, minHeight: 480,
    backgroundColor: "#f3f5f7",
    icon: path.join(__dirname, "..", "web", "icons", "icon-512.png"),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { openOutside(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("file:")) { e.preventDefault(); openOutside(url); } });
  win.loadFile(path.join(__dirname, "..", "web", "index.html"));
}
const openOutside = url => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); };

app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => { Menu.setApplicationMenu(null); createWindow(); });
app.on("window-all-closed", () => app.quit());

/* ---- 数据文件夹 ---- */
// 文件名只能是 2026-W42.md 这种，不能带路径，防止写到文件夹外面去
const file = (dir, name) => {
  if (!WEEK_FILE.test(name)) throw new Error("文件名不对：" + name);
  return path.join(dir, name);
};
const mtime = async p => { try { return Math.floor((await fs.stat(p)).mtimeMs); } catch (e) { return null; } };
const info = dir => ({ path: dir, name: path.basename(dir) });

ipcMain.handle("folder:default", async () => {
  const dir = path.join(app.getPath("documents"), "MyWeek");
  await fs.mkdir(dir, { recursive: true });
  return info(dir);
});
ipcMain.handle("folder:pick", async () => {
  const r = await dialog.showOpenDialog(win, { title: "选择数据文件夹", properties: ["openDirectory", "createDirectory"] });
  return r.canceled || !r.filePaths[0] ? null : info(r.filePaths[0]);
});
ipcMain.handle("folder:exists", async (_, dir) => { try { return (await fs.stat(dir)).isDirectory(); } catch (e) { return false; } });
ipcMain.handle("folder:list", async (_, dir) => {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith(".md")) out.push({ name: e.name, lastModified: await mtime(path.join(dir, e.name)) });
  }
  return out;
});
ipcMain.handle("folder:stat", (_, dir, name) => mtime(file(dir, name)));
ipcMain.handle("folder:read", async (_, dir, name) => {
  const p = file(dir, name);
  try { return { text: await fs.readFile(p, "utf8"), lastModified: await mtime(p) }; } catch (e) { return null; }
});
ipcMain.handle("folder:write", async (_, dir, name, text) => {
  const p = file(dir, name), tmp = p + ".tmp";
  await fs.writeFile(tmp, text, "utf8");
  await fs.rename(tmp, p);          // 先写临时文件再换名：写到一半断电也不会留下半个文件
  return mtime(p);
});
ipcMain.handle("folder:open", async (_, dir) => {
  const err = await shell.openPath(dir);
  if (err) throw new Error(err);
});
