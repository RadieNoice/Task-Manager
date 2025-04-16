const { contextBridge, ipcRenderer } = require("electron");

// Expose APIs to the renderer process using contextBridge
contextBridge.exposeInMainWorld("api", {
  // Process management functions
  getProcesses: () => ipcRenderer.invoke("get-processes"),
  lowerPriority: (pid) => ipcRenderer.invoke("lower-priority", pid),
  runCommand: (cmd) => ipcRenderer.invoke("run-command", cmd),
  getSystemStats: () => ipcRenderer.invoke("get-system-stats"),
  getProcessDetails: (pid) => ipcRenderer.invoke("get-process-details", pid),
  terminateProcess: (pid) => ipcRenderer.invoke("terminate-process", pid),

  // New native speech recognition functions
  startSpeechRecognition: () => ipcRenderer.invoke("start-speech-recognition"),
  speakText: (text) => ipcRenderer.invoke("speak-text", text),

  // Microphone and speech recognition helpers
  checkMicrophonePermission: () => {
    return new Promise((resolve) => {
      if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions
          .query({ name: "microphone" })
          .then((permissionStatus) => {
            resolve({
              state: permissionStatus.state,
              supported: true,
            });

            // Listen for changes to permission state
            permissionStatus.onchange = () => {
              ipcRenderer.send(
                "microphone-permission-changed",
                permissionStatus.state
              );
            };
          })
          .catch((error) => {
            console.error("Error checking microphone permission:", error);
            resolve({
              state: "unknown",
              supported: false,
              error: error.message,
            });
          });
      } else {
        // Permissions API not supported
        resolve({ state: "unknown", supported: false });
      }
    });
  },

  requestMicrophoneAccess: () => {
    return new Promise((resolve, reject) => {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices
          .getUserMedia({ audio: true, video: false })
          .then((stream) => {
            // Successfully got microphone access
            // Stop all audio tracks immediately - we just needed permission
            stream.getTracks().forEach((track) => track.stop());
            resolve({ success: true });
          })
          .catch((error) => {
            console.error("Error accessing microphone:", error);
            reject({
              success: false,
              error: error.message,
              name: error.name, // Usually "NotAllowedError" for permission denied
            });
          });
      } else {
        reject({
          success: false,
          error: "MediaDevices API not supported in this environment",
        });
      }
    });
  },

  // System info helper
  getSystemInfo: () => {
    return {
      platform: process.platform,
      browser: navigator.userAgent,
      speechRecognitionSupported:
        "SpeechRecognition" in window || "webkitSpeechRecognition" in window,
    };
  },
});
