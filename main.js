const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const pidusage = require("pidusage");
const { exec } = require("child_process");
const fs = require("fs");

const FEEDBACK_FILE = path.join(__dirname, "feedback.json");
let feedback = {};
if (fs.existsSync(FEEDBACK_FILE)) {
  try {
    feedback = JSON.parse(fs.readFileSync(FEEDBACK_FILE));
  } catch {}
}
function saveFeedback() {
  fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(feedback, null, 2));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "src", "index.html"));
}
app.whenReady().then(createWindow);

// Cache for process list to improve performance
let processCache = {
  timestamp: 0,
  data: {},
};

// Cache for known temporary processes that frequently show "No matching pid" errors
const knownTemporaryProcesses = new Set([
  "wmic.exe",
  "fastlist-0.3.0-x64.exe",
  "lenovoVantage-(GenericTelemetryAddin).exe",
  "lenovoVantage-(ModernPreloadAddin).exe",
]);

ipcMain.handle("get-processes", async () => {
  try {
    const now = Date.now();

    // Use cached data if it's less than 2 seconds old
    if (
      now - processCache.timestamp < 2000 &&
      Object.keys(processCache.data).length > 0
    ) {
      return processCache.data;
    }

    // dynamic import because ps-list is ESM-only
    const { default: psList } = await import("ps-list");
    const procs = await psList();
    const grouped = {};

    for (const p of procs) {
      const name = p.name || "unknown";
      if (!grouped[name]) {
        grouped[name] = {
          pids: [],
          cpu: 0,
          memory: 0,
          count: 0,
        };
      }

      grouped[name].pids.push(p.pid);
      grouped[name].count++;
    }

    // Get memory usage information for all processes
    try {
      // Create batches of pids to avoid overwhelming the system
      const batchSize = 20;
      const batches = [];

      // Group all PIDs into batches
      const allPids = [];
      for (const [name, info] of Object.entries(grouped)) {
        if (!knownTemporaryProcesses.has(name.toLowerCase())) {
          allPids.push(...info.pids);
        }
      }

      // Create batches of PIDs
      for (let i = 0; i < allPids.length; i += batchSize) {
        batches.push(allPids.slice(i, i + batchSize));
      }

      // Process each batch
      for (const batch of batches) {
        try {
          const stats = await pidusage(batch);

          // Update process information with the stats
          for (const [name, info] of Object.entries(grouped)) {
            for (const pid of info.pids) {
              if (stats[pid]) {
                // Add CPU and memory values to the respective process
                grouped[name].cpu += stats[pid].cpu || 0;
                grouped[name].memory +=
                  (stats[pid].memory / 1024 / 1024 / 1024) * 100 || 0; // Convert to percentage of total RAM
              }
            }

            // Calculate average CPU and memory per process instance
            if (info.count > 0) {
              grouped[name].cpu = grouped[name].cpu / info.count;
              grouped[name].memory = grouped[name].memory / info.count;
            }
          }
        } catch (error) {
          console.error(`Error processing batch: ${error.message}`);
        }
      }
    } catch (error) {
      console.error("Error getting process stats:", error);
    }

    // Update cache
    processCache.data = grouped;
    processCache.timestamp = now;

    return grouped;
  } catch (error) {
    console.error("Error getting processes:", error);
    // If we have cached data, return it even if it's stale
    if (Object.keys(processCache.data).length > 0) {
      return processCache.data;
    }
    return {};
  }
});

// Rest of the file remains unchanged
ipcMain.handle("lower-priority", async (e, pid) => {
  try {
    // On Windows, we can use WMIC to set process priority
    // Priority class 16384 = Below Normal, 64 = Idle
    return new Promise((resolve) => {
      exec(
        `wmic process where ProcessId=${pid} CALL setpriority "below normal"`,
        (error) => {
          if (error) {
            console.error(`Failed to lower priority for PID ${pid}:`, error);
            resolve({ success: false, error: error.message });
          } else {
            feedback[pid] = "lowered";
            saveFeedback();
            resolve({ success: true });
          }
        }
      );
    });
  } catch (err) {
    console.error(`Error lowering priority for PID ${pid}:`, err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("run-command", async (e, cmd) => {
  let response = "";
  if (cmd.startsWith("open ")) {
    const appName = cmd.slice(5).trim();
    exec(`start ${appName}`);
    response = `Opening ${appName}`;
  } else if (/^(kill|close) /.test(cmd)) {
    const appName = cmd.replace(/^(kill|close) /, "").trim();
    const { default: psList } = await import("ps-list");
    const list = await psList();
    const matches = list.filter((p) =>
      p.name.toLowerCase().includes(appName.toLowerCase())
    );
    if (!matches.length) response = `No process matching '${appName}'.`;
    else {
      for (const p of matches) {
        try {
          process.kill(p.pid);
          response += `Killed ${p.name} (PID: ${p.pid})\n`;
        } catch {}
      }
    }
  } else {
    response = "Unknown command. Try 'open', 'kill', or 'close'.";
  }
  return response.trim();
});

// Add a handler to get system-wide CPU and memory usage
ipcMain.handle("get-system-stats", async () => {
  try {
    const os = require("os");

    // Calculate CPU usage by getting a snapshot, waiting, then comparing
    const cpus = os.cpus();
    const startMeasure = getCpuAverage(cpus);

    // Wait for 100ms to get a meaningful measurement
    await new Promise((resolve) => setTimeout(resolve, 100));

    const endMeasure = getCpuAverage(os.cpus());

    // Calculate the difference in idle and total time between the measures
    const idleDifference = endMeasure.idle - startMeasure.idle;
    const totalDifference = endMeasure.total - startMeasure.total;

    // Calculate CPU usage as a percentage (properly bounded between 0-100%)
    const cpuUsage = Math.min(
      100,
      Math.max(0, 100 - Math.floor((100 * idleDifference) / totalDifference))
    );

    // Get memory usage
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memoryUsage = Math.min(
      100,
      Math.max(0, Math.floor((usedMem / totalMem) * 100))
    );

    return {
      cpu: cpuUsage,
      memory: memoryUsage,
    };
  } catch (error) {
    console.error("Error getting system stats:", error);
    return { cpu: 0, memory: 0 };
  }
});

// Helper function to calculate CPU average
function getCpuAverage(cpus) {
  let idle = 0;
  let total = 0;

  for (const cpu of cpus) {
    for (const type in cpu.times) {
      total += cpu.times[type];
    }
    idle += cpu.times.idle;
  }

  return {
    idle,
    total,
  };
}

// Add handler for getting detailed process information
ipcMain.handle("get-process-details", async (e, pid) => {
  try {
    // Get basic info using ps-list
    const { default: psList } = await import("ps-list");
    const allProcesses = await psList();
    const process = allProcesses.find((p) => p.pid === pid);

    if (!process) {
      return { error: "Process not found" };
    }

    // Get more detailed info with pidusage
    try {
      const stats = await pidusage(pid);

      const details = {
        name: process.name,
        pid: process.pid,
        cpu: stats.cpu || 0,
        memoryMB: stats.memory / 1024 / 1024 || 0,
        user: process.username || "Unknown",
        path: process.cmd || "",
        startTime: new Date(Date.now() - stats.elapsed).toLocaleString(),
      };

      return details;
    } catch (pidError) {
      // If pidusage fails, return basic info without detailed CPU/memory stats
      console.log(
        `Could not get detailed stats for ${process.name}: ${pidError.message}`
      );

      return {
        name: process.name,
        pid: process.pid,
        cpu: 0, // Default values when detailed stats aren't available
        memoryMB: 0,
        user: process.username || "Unknown",
        path: process.cmd || "",
        startTime: "Unknown",
      };
    }
  } catch (error) {
    console.error(`Error getting process details for PID ${pid}:`, error);
    return { error: error.message };
  }
});

// Add handler for terminating processes
ipcMain.handle("terminateProcess", async (e, pid) => {
  try {
    process.kill(pid);
    return { success: true };
  } catch (error) {
    console.error(`Error terminating process ${pid}:`, error.message);

    // Return a structured error response with more detailed information
    return {
      success: false,
      error: error.message,
      code: error.code || "UNKNOWN",
    };
  }
});
