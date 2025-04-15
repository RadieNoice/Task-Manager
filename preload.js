const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("api", {
  getProcesses: () => ipcRenderer.invoke("get-processes"),
  lowerPriority: (pid) => ipcRenderer.invoke("lower-priority", pid),
  runCommand: (cmd) => ipcRenderer.invoke("run-command", cmd),
  getSystemStats: () => ipcRenderer.invoke("get-system-stats"),
  getProcessDetails: (pid) => ipcRenderer.invoke("get-process-details", pid),
  terminateProcess: (pid) => ipcRenderer.invoke("terminate-process", pid),
});
