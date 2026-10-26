// 给网页用的桌面接口（window.MyWeekDesktop），对应 main.js 里的 folder:* 。网页里用法见 web/js/store.js 的 desktopFolder
const { contextBridge, ipcRenderer } = require("electron");
const call = (ch, ...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld("MyWeekDesktop", {
  defaultFolder: () => call("folder:default"),
  pick: () => call("folder:pick"),
  exists: dir => call("folder:exists", dir),
  list: dir => call("folder:list", dir),
  stat: (dir, name) => call("folder:stat", dir, name),
  read: (dir, name) => call("folder:read", dir, name),
  write: (dir, name, text) => call("folder:write", dir, name, text),
  open: dir => call("folder:open", dir),
});
