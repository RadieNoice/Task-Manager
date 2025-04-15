// systemDashboard.js - Handles system metrics and dashboard visualization

// Constants and variables
const MAX_POINTS = 60;
let cpuChart, memChart;
const metrics = { labels: [], cpu: [], mem: [] };

// Initialize the dashboard charts
function initDashboard() {
  initCharts();
  setupMetricCards();

  // Start periodic system stats updates
  updateSystemStats();
  setInterval(updateSystemStats, 2000);
}

// Initialize the CPU and memory charts
function initCharts() {
  const cpuCtx = document.getElementById("cpuChart").getContext("2d");
  cpuChart = new Chart(cpuCtx, {
    type: "line",
    data: {
      labels: metrics.labels,
      datasets: [
        {
          label: "CPU %",
          data: metrics.cpu,
          borderColor: "rgba(75, 192, 192, 1)",
          backgroundColor: "rgba(75, 192, 192, 0.2)",
          borderWidth: 2,
          tension: 0.2,
        },
      ],
    },
    options: {
      animation: false,
      scales: { y: { min: 0, max: 100 } },
      plugins: {
        legend: {
          display: true,
          position: "top",
        },
      },
    },
  });

  const memCtx = document.getElementById("memChart").getContext("2d");
  memChart = new Chart(memCtx, {
    type: "line",
    data: {
      labels: metrics.labels,
      datasets: [
        {
          label: "Memory %",
          data: metrics.mem,
          borderColor: "rgba(153, 102, 255, 1)",
          backgroundColor: "rgba(153, 102, 255, 0.2)",
          borderWidth: 2,
          tension: 0.2,
        },
      ],
    },
    options: {
      animation: false,
      scales: { y: { min: 0, max: 100 } },
      plugins: {
        legend: {
          display: true,
          position: "top",
        },
      },
    },
  });
}

// Set up the metric cards
function setupMetricCards() {
  // Ensure metric cards display correctly initially
  const cpuValue = document.getElementById("cpuValue");
  const memValue = document.getElementById("memValue");
  const processCountEl = document.getElementById("processCount");

  if (cpuValue) cpuValue.textContent = "--";
  if (memValue) memValue.textContent = "--";
  if (processCountEl) processCountEl.textContent = "--";
}

// Fetch system stats from main process and update UI
async function updateSystemStats() {
  try {
    // Get system-wide CPU and memory usage from main process
    const stats = await window.api.getSystemStats();
    const now = new Date().toLocaleTimeString();

    // Ensure we have valid numbers within reasonable bounds (0-100)
    const cpuUsage =
      typeof stats.cpu === "number" &&
      !isNaN(stats.cpu) &&
      stats.cpu >= 0 &&
      stats.cpu <= 100
        ? stats.cpu
        : 0;

    const memUsage =
      typeof stats.memory === "number" &&
      !isNaN(stats.memory) &&
      stats.memory >= 0 &&
      stats.memory <= 100
        ? stats.memory
        : 0;

    // Update chart data
    metrics.labels.push(now);
    metrics.cpu.push(cpuUsage);
    metrics.mem.push(memUsage);

    // Limit the number of data points to MAX_POINTS
    if (metrics.cpu.length > MAX_POINTS) {
      metrics.labels.shift();
      metrics.cpu.shift();
      metrics.mem.shift();
    }

    // Update charts
    if (cpuChart && memChart) {
      cpuChart.update("none");
      memChart.update("none");
    }

    // Update metric cards directly
    updateMetricCardValues(cpuUsage, memUsage);

    // Log values for debugging (can remove in production)
    console.log(`CPU: ${cpuUsage}%, Memory: ${memUsage}%`);
  } catch (error) {
    console.error("Error updating system stats:", error);
  }
}

// Update metric cards directly with system values
function updateMetricCardValues(cpuUsage, memUsage) {
  const cpuValue = document.getElementById("cpuValue");
  const memValue = document.getElementById("memValue");

  if (cpuValue) {
    cpuValue.textContent = `${parseFloat(cpuUsage).toFixed(1)}%`;
    cpuValue.className = "metric-value";
    if (cpuUsage > 80) cpuValue.classList.add("critical");
    else if (cpuUsage > 50) cpuValue.classList.add("warning");
  }

  if (memValue) {
    memValue.textContent = `${parseFloat(memUsage).toFixed(1)}%`;
    memValue.className = "metric-value";
    if (memUsage > 80) memValue.classList.add("critical");
    else if (memUsage > 50) memValue.classList.add("warning");
  }
}

// Update system metrics with process data (for process count)
function updateSystemMetrics(processData) {
  if (!processData) return;

  // Update the process count
  const processCount = Object.keys(processData).length;
  const processCountEl = document.getElementById("processCount");
  if (processCountEl) processCountEl.textContent = processCount;
}

// Update the metric cards with current values - DEPRECATED
// Kept for backward compatibility but no longer used directly
function updateMetricCards(processData) {
  if (!processData) return;

  // Update only the process count
  const processCount = Object.keys(processData).length;
  const processCountEl = document.getElementById("processCount");
  if (processCountEl) processCountEl.textContent = processCount;
}

// Initialize the dashboard when the DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  initDashboard();
});

// Export functions for use in other modules
window.systemDashboard = {
  updateSystemMetrics,
  updateMetricCards,
};
