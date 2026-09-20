const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("appWindow", {
  close: () => ipcRenderer.invoke("app:close"),
  minimize: () => ipcRenderer.invoke("app:minimize"),
  reload: () => ipcRenderer.invoke("app:reload")
});
