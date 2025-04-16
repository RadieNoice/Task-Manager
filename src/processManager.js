// processManager.js - Handles process listing, filtering, and management

// Constants and variables
const ITEMS_PER_PAGE = 15; // Pagination - define this first to avoid reference errors
let sortField = "cpu";
let sortDirection = "desc";
let processData = {}; // Store last fetched process data
let processHistory = {}; // Track historical data for each process
let currentPage = 0;
let filteredProcesses = [];
let lastRefreshTime = 0;
let refreshIntervalId = null;
let valueChangeThreshold = 0.5; // Threshold to trigger animation for value changes

// DOM element references
const refreshBtn = document.getElementById("refreshBtn");
const lowerBtn = document.getElementById("lowerBtn");
const statusEl = document.getElementById("status");
const terminateBtn =
  document.getElementById("terminateBtn") || createTerminateButton();

// References to table bodies
const pidTableBody = document.querySelector("#pidTable tbody");
const nameTableBody = document.querySelector("#nameTable tbody");
const cpuTableBody = document.querySelector("#cpuTable tbody");
const memoryTableBody = document.querySelector("#memoryTable tbody");
const statusTableBody = document.querySelector("#statusTable tbody");

// Used to synchronize scroll across tables
const tablesContainer = document.getElementById("procTables");

// Create a terminate button if it doesn't exist
function createTerminateButton() {
  const btn = document.createElement("button");
  btn.id = "terminateBtn";
  btn.textContent = "Terminate Process";
  btn.className = "danger-btn";
  document.querySelector(".controls").appendChild(btn);
  return btn;
}

// Create search input if it doesn't exist
function createSearchInput() {
  const searchContainer = document.createElement("div");
  searchContainer.className = "search-container";

  const searchInput = document.createElement("input");
  searchInput.id = "searchInput";
  searchInput.placeholder = "Search processes...";

  const clearBtn = document.createElement("button");
  clearBtn.id = "clearSearch";
  clearBtn.textContent = "✕";
  clearBtn.title = "Clear search";

  searchContainer.appendChild(searchInput);
  searchContainer.appendChild(clearBtn);

  document
    .querySelector(".process-manager")
    .insertBefore(searchContainer, document.querySelector(".table-wrapper"));

  // Add event listeners
  searchInput.addEventListener("input", (e) => filterProcesses(e.target.value));
  clearBtn.addEventListener("click", () => {
    searchInput.value = "";
    renderTable(processData);
  });

  return searchInput;
}

// Status indicator
function setStatus(msg) {
  statusEl.innerHTML = msg;

  // Add visual status indication
  statusEl.className = "";
  if (msg.includes("fa-check-circle")) statusEl.classList.add("success");
  if (msg.includes("fa-exclamation-triangle"))
    statusEl.classList.add("warning");
  if (msg.includes("fa-times-circle")) statusEl.classList.add("error");
}

// Process refresh functionality
async function refreshProcesses() {
  console.log("🔄 [renderer] Calling getProcesses()");
  setStatus('<i class="fas fa-sync fa-spin"></i> Loading processes...');
  refreshBtn.disabled = true;
  document.body.classList.add("loading");

  try {
    const grouped = await window.api.getProcesses();
    console.log("🔄 [renderer] Received grouped:", grouped);

    // Store the data for filtering
    const previousData = processData || {};
    processData = grouped;

    if (!grouped || Object.keys(grouped).length === 0) {
      showEmptyProcessMessage();
      setStatus(
        '<i class="fas fa-exclamation-triangle"></i> No processes returned'
      );
      return;
    }

    // Check if tables have rows
    const tablesHaveRows = pidTableBody.querySelectorAll("tr").length > 0;

    if (tablesHaveRows) {
      // Update existing rows without redrawing the entire tables
      const needsFullRedraw = updateProcessValues(previousData, grouped);
      if (needsFullRedraw) {
        renderTable(grouped);
      }
    } else {
      // First time or after filtering, apply any existing filter and render full tables
      const searchInput = document.getElementById("searchInput");
      if (searchInput && searchInput.value.trim()) {
        filterProcesses(searchInput.value);
      } else {
        renderTable(grouped);
      }
    }

    // Update system dashboard with the process data
    if (window.systemDashboard) {
      window.systemDashboard.updateSystemMetrics(grouped);
    }

    // Update process history
    updateProcessHistory(grouped);

    const timestamp = new Date().toLocaleTimeString();
    setStatus(
      `<i class="fas fa-check-circle"></i> Processes refreshed at ${timestamp}`
    );
  } catch (err) {
    console.error("❌ [renderer] refreshProcesses error:", err);
    setStatus('<i class="fas fa-times-circle"></i> Error refreshing processes');
    showEmptyProcessMessage(err.message || "Failed to load processes");
  } finally {
    refreshBtn.disabled = false;
    document.body.classList.remove("loading");
  }
}

// Show empty process message across all tables
function showEmptyProcessMessage(errorMsg = null) {
  const message = errorMsg
    ? `<i class="fas fa-times-circle"></i> Error: ${errorMsg}`
    : `<i class="fas fa-exclamation-triangle"></i> No processes found.`;

  const emptyRow = `<tr><td style="padding:1rem; color:${
    errorMsg ? "#dd3333" : "#666"
  }; text-align:center;">${message}</td></tr>`;

  pidTableBody.innerHTML = emptyRow;
  nameTableBody.innerHTML = emptyRow;
  cpuTableBody.innerHTML = emptyRow;
  memoryTableBody.innerHTML = emptyRow;
  statusTableBody.innerHTML = emptyRow;
}

// Update process values without redrawing the tables
function updateProcessValues(previousData, newData) {
  // Get index map of rows (by index)
  const rowCount = pidTableBody.querySelectorAll("tr").length;
  if (rowCount === 0) return true; // If no rows, force a full redraw

  // Create a map of processes by name for quick lookup using the name table
  const processMap = {};
  const nameRows = nameTableBody.querySelectorAll("tr");

  nameRows.forEach((row, index) => {
    // Extract the process name without the count
    const fullText = row.textContent;
    const processName = fullText.split(" (x")[0].trim();
    processMap[processName] = index;
  });

  // Count how many values changed significantly
  let significantChanges = 0;

  // Track what processes were updated
  const updatedProcesses = new Set();

  // Update each process in the table with new values
  for (const [name, info] of Object.entries(newData)) {
    const rowIndex = processMap[name];
    if (rowIndex !== undefined) {
      updatedProcesses.add(name);

      // Get corresponding rows for this process from each table
      const cpuRow = cpuTableBody.querySelectorAll("tr")[rowIndex];
      const memRow = memoryTableBody.querySelectorAll("tr")[rowIndex];
      const statusRow = statusTableBody.querySelectorAll("tr")[rowIndex];

      // Update CPU value
      const cpuValue = isNaN(info.cpu) ? 0 : Math.min(100, info.cpu);
      if (cpuRow) {
        // Store previous value for comparison
        const oldCpuValue = parseFloat(cpuRow.dataset.value) || 0;

        // Display exact CPU percentage with one decimal place
        cpuRow.textContent = `${cpuValue.toFixed(1)}%`;
        cpuRow.dataset.value = cpuValue;

        // Check for significant change
        if (Math.abs(cpuValue - oldCpuValue) > valueChangeThreshold) {
          significantChanges++;

          // Update color based on new value
          cpuRow.className = "";
          if (cpuValue > 80) {
            cpuRow.classList.add("critical");
          } else if (cpuValue > 50) {
            cpuRow.classList.add("warning");
          }
        }
      }

      // Update Memory value
      const memValue = isNaN(info.memory) ? 0 : info.memory;
      if (memRow) {
        // Store previous value for comparison
        const oldMemValue = parseFloat(memRow.dataset.value) || 0;

        // Display exact memory percentage with one decimal place
        memRow.textContent = `${memValue.toFixed(1)}%`;
        memRow.dataset.value = memValue;

        // Check for significant change
        if (Math.abs(memValue - oldMemValue) > valueChangeThreshold) {
          significantChanges++;

          // Update color based on new value
          memRow.className = "";
          if (memValue > 80) {
            memRow.classList.add("critical");
          } else if (memValue > 50) {
            memRow.classList.add("warning");
          }
        }
      }

      // Update Status value
      if (statusRow) {
        const oldStatus = statusRow.textContent;
        const newStatus =
          cpuValue > 80
            ? "Critical CPU"
            : memValue > 80
            ? "Critical Memory"
            : cpuValue > 50
            ? "High CPU"
            : memValue > 50
            ? "High Memory"
            : "";

        if (oldStatus !== newStatus) {
          statusRow.textContent = newStatus;
          significantChanges++;
        }
      }
    } else {
      // This is a new process that's not in the table yet
      addNewProcessRow(name, info);
      significantChanges++;
    }
  }

  // Handle removed processes - hide them instead of forcing a full redraw
  const existingNames = new Set(Object.keys(processMap));
  const processesToRemove = [...existingNames].filter((name) => !newData[name]);

  // Remove rows for processes that no longer exist
  if (processesToRemove.length > 0) {
    // We need to recreate the table since removing rows would misalign them
    // This approach is more stable than trying to remove rows from multiple tables
    renderTable(newData);
    return false; // We've already redrawn
  }

  console.log(
    `Updated ${significantChanges} values in place, added/removed ${processesToRemove.length} processes`
  );

  // Only force a full redraw in extreme cases (over 50% of processes changed significantly)
  const changePercentage =
    (significantChanges / Math.max(existingNames.size, 1)) * 100;
  return changePercentage > 50;
}

// Add a new process row to all tables
function addNewProcessRow(name, proc) {
  // Fix CPU values - cap extremely high values
  const cpuValue = isNaN(proc.cpu) ? 0 : Math.min(100, proc.cpu);
  const cpu = cpuValue.toFixed(1);
  const mem = (isNaN(proc.memory) ? 0 : proc.memory).toFixed(1);

  const status =
    cpuValue > 80
      ? "Critical CPU"
      : proc.memory > 80
      ? "Critical Memory"
      : cpuValue > 50
      ? "High CPU"
      : proc.memory > 50
      ? "High Memory"
      : "";

  // Create rows for each table
  const pidRow = document.createElement("tr");
  const nameRow = document.createElement("tr");
  const cpuRow = document.createElement("tr");
  const memRow = document.createElement("tr");
  const statusRow = document.createElement("tr");

  // Use same pid for all rows to keep them linked
  const pid = proc.pids[0];
  pidRow.dataset.pid =
    nameRow.dataset.pid =
    cpuRow.dataset.pid =
    memRow.dataset.pid =
    statusRow.dataset.pid =
      pid;

  // Format PIDs cell
  if (proc.pids.length > 3) {
    pidRow.innerHTML = `
      <td class="pid-cell">
        <span class="pid-preview">${proc.pids[0]}, ${proc.pids[1]}, ${
      proc.pids[2]
    } </span>
        <span class="pid-more collapsed" data-count="${
          proc.pids.length - 3
        }">+${proc.pids.length - 3} more</span>
        <div class="pid-expanded">
          ${proc.pids.join(", ")}
        </div>
      </td>
    `;
  } else {
    pidRow.innerHTML = `<td>${proc.pids.join(", ")}</td>`;
  }

  // Set content for other columns
  nameRow.innerHTML = `<td>${name} ${
    proc.count > 1 ? `(x${proc.count})` : ""
  }</td>`;

  cpuRow.innerHTML = `<td data-value="${cpu}">${cpu}%</td>`;
  if (cpuValue > 80) cpuRow.classList.add("critical");
  else if (cpuValue > 50) cpuRow.classList.add("warning");

  memRow.innerHTML = `<td data-value="${mem}">${mem}%</td>`;
  if (proc.memory > 80) memRow.classList.add("critical");
  else if (proc.memory > 50) memRow.classList.add("warning");

  statusRow.innerHTML = `<td>${status}</td>`;

  // Add the rows to their respective tables
  pidTableBody.appendChild(pidRow);
  nameTableBody.appendChild(nameRow);
  cpuTableBody.appendChild(cpuRow);
  memoryTableBody.appendChild(memRow);
  statusTableBody.appendChild(statusRow);

  // Add event listeners for expandable PID cells
  const moreElement = pidRow.querySelector(".pid-more");
  if (moreElement) {
    moreElement.addEventListener("click", togglePidExpansion);
  }
}

// Filter processes by search term
function filterProcesses(searchTerm) {
  if (!processData || Object.keys(processData).length === 0) return;

  searchTerm = searchTerm.toLowerCase().trim();

  if (!searchTerm) {
    renderTable(processData);
    return;
  }

  const filtered = {};

  for (const [name, info] of Object.entries(processData)) {
    // Match on process name or PID
    if (
      name.toLowerCase().includes(searchTerm) ||
      info.pids.some((pid) => pid.toString().includes(searchTerm))
    ) {
      filtered[name] = info;
    }
  }

  if (Object.keys(filtered).length === 0) {
    showEmptyProcessMessage(`No processes match your search: "${searchTerm}"`);
    setStatus(`🔍 No processes match your search: "${searchTerm}"`);
  } else {
    renderTable(filtered);

    // Add highlight class to all rows for visual feedback
    setTimeout(() => {
      document
        .querySelectorAll(
          "#pidTable tbody tr, #nameTable tbody tr, #cpuTable tbody tr, #memoryTable tbody tr, #statusTable tbody tr"
        )
        .forEach((row) => {
          row.classList.add("search-highlight");
        });
    }, 10);

    // Update status to show search results
    const count = Object.keys(filtered).length;
    setStatus(
      `🔍 Found ${count} ${
        count === 1 ? "process" : "processes"
      } matching "${searchTerm}"`
    );
  }
}

// Render process table with sorting
function renderTable(grouped) {
  // Clear all table bodies
  pidTableBody.innerHTML = "";
  nameTableBody.innerHTML = "";
  cpuTableBody.innerHTML = "";
  memoryTableBody.innerHTML = "";
  statusTableBody.innerHTML = "";

  // Convert to array for sorting
  filteredProcesses = Object.entries(grouped).map(([name, info]) => ({
    name,
    ...info,
  }));

  // Sort processes
  filteredProcesses.sort((a, b) => {
    let valueA, valueB;

    switch (sortField) {
      case "name":
        valueA = a.name.toLowerCase();
        valueB = b.name.toLowerCase();
        return sortDirection === "asc"
          ? valueA.localeCompare(valueB)
          : valueB.localeCompare(valueA);
      case "cpu":
        return sortDirection === "asc" ? a.cpu - b.cpu : b.cpu - a.cpu;
      case "memory":
        return sortDirection === "asc"
          ? a.memory - b.memory
          : b.memory - a.memory;
      case "pid":
        return sortDirection === "asc"
          ? Number(a.pids[0]) - Number(b.pids[0])
          : Number(b.pids[0]) - Number(a.pids[0]);
      default:
        return 0;
    }
  });

  // Reset to first page when sorting or filtering
  currentPage = 0;
  renderCurrentPage();
  updatePaginationControls();
}

// Render the current page of processes across all tables
function renderCurrentPage() {
  // Clear all table bodies
  pidTableBody.innerHTML = "";
  nameTableBody.innerHTML = "";
  cpuTableBody.innerHTML = "";
  memoryTableBody.innerHTML = "";
  statusTableBody.innerHTML = "";

  const start = currentPage * ITEMS_PER_PAGE;
  const end = Math.min(start + ITEMS_PER_PAGE, filteredProcesses.length);
  const currentPageProcesses = filteredProcesses.slice(start, end);

  if (currentPageProcesses.length === 0) {
    showEmptyProcessMessage();
    return;
  }

  // Render processes for the current page
  for (const proc of currentPageProcesses) {
    // Fix CPU values - cap extremely high values
    const cpuValue = isNaN(proc.cpu) ? 0 : Math.min(100, proc.cpu);
    const cpu = cpuValue.toFixed(1);
    const mem = (isNaN(proc.memory) ? 0 : proc.memory).toFixed(1);

    const status =
      cpuValue > 80
        ? "Critical CPU"
        : proc.memory > 80
        ? "Critical Memory"
        : cpuValue > 50
        ? "High CPU"
        : proc.memory > 50
        ? "High Memory"
        : "";

    // Create rows for each table
    const pidRow = document.createElement("tr");
    const nameRow = document.createElement("tr");
    const cpuRow = document.createElement("tr");
    const memRow = document.createElement("tr");
    const statusRow = document.createElement("tr");

    // Store first PID for reference - important to keep all rows linked
    const pid = proc.pids[0];
    pidRow.dataset.pid =
      nameRow.dataset.pid =
      cpuRow.dataset.pid =
      memRow.dataset.pid =
      statusRow.dataset.pid =
        pid;

    // Format PIDs cell
    if (proc.pids.length > 3) {
      pidRow.innerHTML = `
        <td class="pid-cell">
          <span class="pid-preview">${proc.pids[0]}, ${proc.pids[1]}, ${
        proc.pids[2]
      } </span>
          <span class="pid-more collapsed" data-count="${
            proc.pids.length - 3
          }">+${proc.pids.length - 3} more</span>
          <div class="pid-expanded">
            ${proc.pids.join(", ")}
          </div>
        </td>
      `;
    } else {
      pidRow.innerHTML = `<td>${proc.pids.join(", ")}</td>`;
    }

    // Set content for other columns
    nameRow.innerHTML = `<td>${proc.name} ${
      proc.count > 1 ? `(x${proc.count})` : ""
    }</td>`;

    cpuRow.innerHTML = `<td data-value="${cpu}">${cpu}%</td>`;
    if (cpuValue > 80) cpuRow.classList.add("critical");
    else if (cpuValue > 50) cpuRow.classList.add("warning");

    memRow.innerHTML = `<td data-value="${mem}">${mem}%</td>`;
    if (proc.memory > 80) memRow.classList.add("critical");
    else if (proc.memory > 50) memRow.classList.add("warning");

    statusRow.innerHTML = `<td>${status}</td>`;

    // Add the rows to their respective tables
    pidTableBody.appendChild(pidRow);
    nameTableBody.appendChild(nameRow);
    cpuTableBody.appendChild(cpuRow);
    memoryTableBody.appendChild(memRow);
    statusTableBody.appendChild(statusRow);
  }

  // Add event listeners for expandable PID cells
  document.querySelectorAll(".pid-more").forEach((element) => {
    element.addEventListener("click", togglePidExpansion);
  });

  // Add row selection handling
  setupRowSelectionHandling();

  // Update the page info text
  const pageInfo = document.getElementById("pageInfo");
  if (pageInfo) {
    const totalPages = Math.ceil(filteredProcesses.length / ITEMS_PER_PAGE);
    pageInfo.textContent = `Page ${currentPage + 1} of ${totalPages || 1}`;
  }

  // Update process info in table footer
  const processInfo = document.getElementById("processInfo");
  if (processInfo) {
    processInfo.textContent = `${filteredProcesses.length} processes`;
  }
}

// Setup row selection handling for multi-table structure
function setupRowSelectionHandling() {
  // Get all rows from all tables
  const allPidRows = pidTableBody.querySelectorAll("tr");
  const allNameRows = nameTableBody.querySelectorAll("tr");
  const allCpuRows = cpuTableBody.querySelectorAll("tr");
  const allMemRows = memoryTableBody.querySelectorAll("tr");
  const allStatusRows = statusTableBody.querySelectorAll("tr");

  // Add click handlers for each row in each table
  for (let i = 0; i < allPidRows.length; i++) {
    const rows = [
      allPidRows[i],
      allNameRows[i],
      allCpuRows[i],
      allMemRows[i],
      allStatusRows[i],
    ];

    rows.forEach((row) => {
      row.addEventListener("click", (e) => {
        // Find pid from dataset
        const pid = row.dataset.pid;

        // Clear all selections
        clearAllSelections();

        // Select all rows with this pid
        selectRowsByPid(pid);

        // Enable action buttons based on selection
        lowerBtn.disabled = false;
        terminateBtn.disabled = false;
      });

      row.addEventListener("dblclick", (e) => {
        const pid = Number(row.dataset.pid);
        if (pid) {
          showProcessDetails(pid);
        }
      });

      row.addEventListener("contextmenu", handleContextMenu);
    });
  }
}

// Clear all row selections across all tables
function clearAllSelections() {
  pidTableBody
    .querySelectorAll("tr")
    .forEach((row) => row.classList.remove("selected"));
  nameTableBody
    .querySelectorAll("tr")
    .forEach((row) => row.classList.remove("selected"));
  cpuTableBody
    .querySelectorAll("tr")
    .forEach((row) => row.classList.remove("selected"));
  memoryTableBody
    .querySelectorAll("tr")
    .forEach((row) => row.classList.remove("selected"));
  statusTableBody
    .querySelectorAll("tr")
    .forEach((row) => row.classList.remove("selected"));
}

// Select all rows with the given pid across all tables
function selectRowsByPid(pid) {
  const selector = `tr[data-pid="${pid}"]`;
  pidTableBody.querySelector(selector)?.classList.add("selected");
  nameTableBody.querySelector(selector)?.classList.add("selected");
  cpuTableBody.querySelector(selector)?.classList.add("selected");
  memoryTableBody.querySelector(selector)?.classList.add("selected");
  statusTableBody.querySelector(selector)?.classList.add("selected");
}

// Find selected process name
function getSelectedProcessName() {
  const selectedRow = nameTableBody.querySelector("tr.selected");
  if (selectedRow) {
    return selectedRow.textContent.split(" (x")[0].trim();
  }
  return null;
}

// Synchronized scrolling for all tables
function setupSynchronizedScrolling() {
  if (!tablesContainer) return;

  tablesContainer.addEventListener("scroll", function () {
    // When the container scrolls, this is already synchronized
    // This is handled naturally by the CSS
  });
}

// Handle table header clicks for sorting
function handleTableHeaderClick(e) {
  const headerCell = e.target.closest("th");
  if (!headerCell || !headerCell.dataset.sort) return;

  const field = headerCell.dataset.sort;

  // Toggle direction if clicking the same field
  if (field === sortField) {
    sortDirection = sortDirection === "asc" ? "desc" : "asc";
  } else {
    sortField = field;
    sortDirection = "desc"; // Default to descending for new sort field
  }

  // Update UI to show sort direction
  document.querySelectorAll("th[data-sort]").forEach((th) => {
    th.classList.remove("sort-asc", "sort-desc");
  });
  headerCell.classList.add(`sort-${sortDirection}`);

  // Re-render with new sort
  renderTable(processData);
}

// Handle lowering process priority
async function handleLowerPriority() {
  const sel = pidTableBody.querySelector("tr.selected");
  if (!sel) {
    alert("⚠️ Please select a process row first.");
    return;
  }

  const pid = Number(sel.dataset.pid);
  // Get the process name from the corresponding name cell
  const nameRow = nameTableBody.querySelector(`tr[data-pid="${pid}"]`);
  const processName = nameRow
    ? nameRow.textContent.trim().split(" (x")[0]
    : "Unknown";

  setStatus(`⚙️ Lowering priority for PID ${pid} (${processName})...`);
  try {
    const res = await window.api.lowerPriority(pid);
    if (res.success) {
      setStatus(`✅ Priority lowered for ${processName} (PID: ${pid})`);
    } else {
      alert(`🚨 Error: ${res.error}`);
      setStatus(`❌ Failed to lower priority for PID ${pid}`);
    }
  } catch (e) {
    console.error("❌ lowerPriority error:", e);
    alert(`🚨 Unexpected error: ${e.message}`);
    setStatus(`❌ Error: ${e.message}`);
  }
  await refreshProcesses();
}

// Handle process termination
async function handleTerminateProcess() {
  const sel = pidTableBody.querySelector("tr.selected");
  if (!sel) {
    alert("⚠️ Please select a process row first.");
    return;
  }

  const pid = Number(sel.dataset.pid);
  // Get the process name from the corresponding name cell
  const nameRow = nameTableBody.querySelector(`tr[data-pid="${pid}"]`);
  const processName = nameRow
    ? nameRow.textContent.trim().split(" (x")[0]
    : "Unknown";

  if (
    confirm(
      `Are you sure you want to terminate "${processName}" (PID: ${pid})?`
    )
  ) {
    setStatus(`⚙️ Terminating process ${pid}...`);
    try {
      const res = await window.api.terminateProcess(pid);
      if (res.success) {
        setStatus(`✅ Process ${pid} terminated successfully`);
      } else {
        // More descriptive error message
        if (res.error && res.error.includes("EPERM")) {
          alert(
            `🔒 Permission denied: You don't have permission to terminate ${processName} (PID: ${pid}).\n\nThis may be a system process or a process running with higher privileges.`
          );
          setStatus(
            `❌ Permission denied terminating ${processName} (PID: ${pid})`
          );
        } else {
          alert(`🚨 Error: ${res.error}`);
          setStatus(`❌ Failed to terminate process ${pid}`);
        }
      }
    } catch (e) {
      console.error("❌ terminateProcess error:", e);
      if (e.message && e.message.includes("EPERM")) {
        alert(
          `🔒 Permission denied: You don't have permission to terminate ${processName} (PID: ${pid}).\n\nThis may be a system process or a process running with higher privileges.`
        );
        setStatus(`❌ Permission denied terminating ${processName}`);
      } else {
        alert(`🚨 Unexpected error: ${e.message || "Unknown error"}`);
        setStatus(`❌ Error: ${e.message || "Unknown error"}`);
      }
    }
    await refreshProcesses();
  }
}

// Handle row selection
function handleRowSelect(e) {
  const tr = e.target.closest("tr");
  if (!tr) return;

  // Double-click handling
  if (e.type === "dblclick") {
    const pid = Number(tr.dataset.pid);
    if (pid) {
      showProcessDetails(pid);
    }
    return;
  }

  // Single click for selection
  tableBody
    .querySelectorAll("tr")
    .forEach((r) => r.classList.remove("selected"));
  tr.classList.add("selected");

  // Enable action buttons based on selection
  lowerBtn.disabled = false;
  terminateBtn.disabled = false;
}

// Show process details
async function showProcessDetails(pid) {
  try {
    setStatus(`⏳ Loading details for process ${pid}...`);
    const details = await window.api.getProcessDetails(pid);

    // Create modal if it doesn't exist already
    let modal = document.querySelector(".modal-overlay");
    if (modal) {
      document.body.removeChild(modal);
    }

    modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>Process Details: ${details.name || "Unknown"} (PID: ${pid})</h3>
          <button class="close-btn">&times;</button>
        </div>
        <div class="modal-body">
          <div class="detail-row">
            <span class="label">User:</span> 
            <span class="value">${details.user || "Unknown"}</span>
          </div>
          <div class="detail-row">
            <span class="label">Memory Usage:</span> 
            <span class="value">${(details.memoryMB || 0).toFixed(2)} MB</span>
          </div>
          <div class="detail-row">
            <span class="label">CPU Usage:</span> 
            <span class="value">${(details.cpu || 0).toFixed(2)}%</span>
          </div>
          <div class="detail-row">
            <span class="label">Started:</span> 
            <span class="value">${details.startTime || "Unknown"}</span>
          </div>
          <div class="detail-row">
            <span class="label">Path:</span> 
            <span class="value">${details.path || "Unknown"}</span>
          </div>
        </div>
        <div class="modal-footer">
          <button class="terminate-btn">Terminate Process</button>
          <button class="close-btn">Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Event listeners for modal
    modal.querySelectorAll(".close-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.body.removeChild(modal);
      });
    });

    modal
      .querySelector(".terminate-btn")
      .addEventListener("click", async () => {
        if (confirm(`Are you sure you want to terminate this process?`)) {
          try {
            const result = await window.api.terminateProcess(pid);
            if (result.success) {
              document.body.removeChild(modal);
              setStatus(`✅ Process ${pid} terminated successfully`);
              await refreshProcesses();
            } else {
              if (result.error && result.error.includes("EPERM")) {
                alert(
                  `🔒 Permission denied: You don't have permission to terminate this process.\n\nThis may be a system process or a process running with higher privileges.`
                );
                setStatus(`❌ Permission denied terminating process ${pid}`);
              } else {
                alert(`Error terminating process: ${result.error}`);
                setStatus(`❌ Failed to terminate process: ${result.error}`);
              }
            }
          } catch (err) {
            if (err.message && err.message.includes("EPERM")) {
              alert(
                `🔒 Permission denied: You don't have permission to terminate this process.\n\nThis may be a system process or a process running with higher privileges.`
              );
              setStatus(`❌ Permission denied terminating process ${pid}`);
            } else {
              alert(`Error terminating process: ${err.message}`);
              setStatus(`❌ Failed to terminate process: ${err.message}`);
            }
          }
        }
      });

    setStatus(`✅ Loaded details for process ${pid}`);
  } catch (err) {
    console.error("Error getting process details:", err);
    setStatus(`❌ Failed to get details for process ${pid}`);
    alert(`Could not load process details: ${err.message}`);
  }
}

// Handle column header clicks for sorting
function handleTableHeaderClick(e) {
  const headerCell = e.target.closest("th");
  if (!headerCell || !headerCell.dataset.sort) return;

  const field = headerCell.dataset.sort;

  // Toggle direction if clicking the same field
  if (field === sortField) {
    sortDirection = sortDirection === "asc" ? "desc" : "asc";
  } else {
    sortField = field;
    sortDirection = "desc"; // Default to descending for new sort field
  }

  // Update UI to show sort direction
  document.querySelectorAll("th[data-sort]").forEach((th) => {
    th.classList.remove("sort-asc", "sort-desc");
  });
  headerCell.classList.add(`sort-${sortDirection}`);

  // Re-render with new sort
  renderTable(processData);
}

// Add table headers with sort capability
function setupSortableTableHeaders() {
  const headerRow = document.querySelector("#procTable thead tr");
  if (!headerRow) return;

  // Replace with sortable headers
  headerRow.innerHTML = `
    <th data-sort="pid">PIDs</th>
    <th data-sort="name">Name</th>
    <th data-sort="cpu">CPU %</th>
    <th data-sort="memory">Memory %</th>
    <th>Status</th>
  `;

  // Add sort indicators to current sort field
  const currentSortHeader = headerRow.querySelector(
    `th[data-sort="${sortField}"]`
  );
  if (currentSortHeader) {
    currentSortHeader.classList.add(`sort-${sortDirection}`);
  }

  // Add event listener for header clicks
  headerRow.addEventListener("click", handleTableHeaderClick);
}

// Show process-specific trend data
function showProcessTrends(processName) {
  if (!processHistory[processName]) {
    alert("No history data available for this process yet");
    return;
  }

  const history = processHistory[processName];

  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-content trend-modal">
      <div class="modal-header">
        <h3>Resource Trends: ${processName}</h3>
        <button class="close-btn">&times;</button>
      </div>
      <div class="modal-body">
        <canvas id="processTrendChart" width="600" height="300"></canvas>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Close button handler
  modal.querySelector(".close-btn").addEventListener("click", () => {
    document.body.removeChild(modal);
  });

  // Create trend chart
  const ctx = document.getElementById("processTrendChart").getContext("2d");
  new Chart(ctx, {
    type: "line",
    data: {
      labels: history.timestamps,
      datasets: [
        {
          label: "CPU Usage (%)",
          data: history.cpu,
          borderColor: "rgba(75, 192, 192, 1)",
          backgroundColor: "rgba(75, 192, 192, 0.2)",
          borderWidth: 2,
          tension: 0.2,
        },
        {
          label: "Memory Usage (%)",
          data: history.memory,
          borderColor: "rgba(153, 102, 255, 1)",
          backgroundColor: "rgba(153, 102, 255, 0.2)",
          borderWidth: 2,
          tension: 0.2,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: "Process Resource Usage Over Time",
        },
        tooltip: {
          mode: "index",
          intersect: false,
        },
      },
      scales: {
        y: {
          min: 0,
          max:
            Math.max(
              Math.max(...history.cpu, 10),
              Math.max(...history.memory, 10)
            ) * 1.1, // Add 10% margin
        },
      },
    },
  });
}

// Update the context menu handler to work with multiple tables
function handleContextMenu(e) {
  e.preventDefault();

  const tr = e.target.closest("tr");
  if (!tr) return;

  // Get pid from this row
  const pid = Number(tr.dataset.pid);
  if (!pid) return;

  // Clear all selections and select all rows with this pid
  clearAllSelections();
  selectRowsByPid(pid);

  // Get the process name from the corresponding name cell
  const nameRow = nameTableBody.querySelector(`tr[data-pid="${pid}"]`);
  const processName = nameRow
    ? nameRow.textContent.trim().split(" (x")[0]
    : "Unknown";

  // Remove existing context menus
  document.querySelectorAll(".context-menu").forEach((menu) => {
    document.body.removeChild(menu);
  });

  // Create and show context menu
  const contextMenu = document.createElement("div");
  contextMenu.className = "context-menu";
  contextMenu.innerHTML = `
    <div class="menu-item" data-action="details">View Details</div>
    <div class="menu-item" data-action="trends">Show Resource Trends</div>
    <div class="menu-item" data-action="lower">Lower Priority</div>
    <div class="menu-item" data-action="terminate">Terminate Process</div>
  `;

  contextMenu.style.left = `${e.pageX}px`;
  contextMenu.style.top = `${e.pageY}px`;
  document.body.appendChild(contextMenu);

  // Menu item click handler
  contextMenu.addEventListener("click", async (e) => {
    const action = e.target.dataset.action;

    document.body.removeChild(contextMenu);

    switch (action) {
      case "details":
        showProcessDetails(pid);
        break;
      case "trends":
        showProcessTrends(processName);
        break;
      case "lower":
        await handleLowerPriority();
        break;
      case "terminate":
        if (confirm(`Are you sure you want to terminate "${processName}"?`)) {
          try {
            await window.api.terminateProcess(pid);
            await refreshProcesses();
          } catch (err) {
            alert(`Error terminating process: ${err.message}`);
          }
        }
        break;
    }
  });

  // Close menu when clicking outside of it
  function closeMenu(e) {
    if (!contextMenu.contains(e.target)) {
      document.body.removeChild(contextMenu);
      document.removeEventListener("click", closeMenu);
    }
  }

  setTimeout(() => {
    document.addEventListener("click", closeMenu);
  }, 0);
}

// Setup sortable headers for our table columns
function setupSortableTableHeaders() {
  // Add click handlers to all sortable column headers
  document.querySelectorAll("th[data-sort]").forEach((header) => {
    header.addEventListener("click", handleTableHeaderClick);

    // Add sort indicator to the current sort field
    if (header.dataset.sort === sortField) {
      header.classList.add(`sort-${sortDirection}`);
    }
  });
}

// Toggle PID expansion
function togglePidExpansion(e) {
  e.stopPropagation(); // Prevent row selection when clicking on expand/collapse

  const moreElement = e.target;
  const pidCell = moreElement.closest(".pid-cell");
  const pidExpanded = pidCell.querySelector(".pid-expanded");

  if (moreElement.classList.contains("collapsed")) {
    // Expand
    moreElement.classList.remove("collapsed");
    moreElement.classList.add("expanded");
    moreElement.textContent = "Show less";

    // Show expanded PIDs
    pidExpanded.style.display = "block";
    pidCell.querySelector(".pid-preview").style.display = "none";
  } else {
    // Collapse
    moreElement.classList.remove("expanded");
    moreElement.classList.add("collapsed");
    const count = parseInt(moreElement.dataset.count);
    moreElement.textContent = `+${count} more`;

    // Hide expanded PIDs
    pidExpanded.style.display = "none";
    pidCell.querySelector(".pid-preview").style.display = "inline";
  }
}

// Track history of specific processes
function updateProcessHistory(grouped) {
  const timestamp = new Date().toLocaleTimeString();

  // Initialize or update history for each process
  for (const [name, info] of Object.entries(grouped)) {
    if (!processHistory[name]) {
      processHistory[name] = {
        timestamps: [],
        cpu: [],
        memory: [],
      };
    }

    const history = processHistory[name];
    history.timestamps.push(timestamp);
    history.cpu.push(info.cpu);
    history.memory.push(info.memory);

    // Keep only the last 30 points
    if (history.timestamps.length > 30) {
      history.timestamps.shift();
      history.cpu.shift();
      history.memory.shift();
    }
  }

  // Clean up history for processes that no longer exist
  for (const name in processHistory) {
    if (!grouped[name]) {
      delete processHistory[name];
    }
  }
}

// Add pagination event handlers
function handlePrevPage() {
  if (currentPage > 0) {
    currentPage--;
    renderCurrentPage();
    updatePaginationControls();
  }
}

function handleNextPage() {
  const totalPages = Math.ceil(filteredProcesses.length / ITEMS_PER_PAGE);
  if (currentPage < totalPages - 1) {
    currentPage++;
    renderCurrentPage();
    updatePaginationControls();
  }
}

// Update pagination buttons state
function updatePaginationControls() {
  const prevPageBtn = document.getElementById("prevPage");
  const nextPageBtn = document.getElementById("nextPage");
  const totalPages = Math.ceil(filteredProcesses.length / ITEMS_PER_PAGE);

  if (prevPageBtn) {
    prevPageBtn.disabled = currentPage === 0;
  }

  if (nextPageBtn) {
    nextPageBtn.disabled = currentPage >= totalPages - 1 || totalPages === 0;
  }
}

// Initialize the process manager when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  // Create search input if needed
  if (!document.getElementById("searchInput")) {
    createSearchInput();
  }

  // Add sort handlers to column headers
  setupSortableTableHeaders();

  // Set up synchronized scrolling between tables
  setupSynchronizedScrolling();

  // Add event listeners for main controls
  refreshBtn.addEventListener("click", refreshProcesses);
  lowerBtn.addEventListener("click", handleLowerPriority);
  terminateBtn.addEventListener("click", handleTerminateProcess);

  // Pagination event listeners
  const prevPageBtn = document.getElementById("prevPage");
  const nextPageBtn = document.getElementById("nextPage");

  if (prevPageBtn) prevPageBtn.addEventListener("click", handlePrevPage);
  if (nextPageBtn) nextPageBtn.addEventListener("click", handleNextPage);

  // Disable action buttons initially
  lowerBtn.disabled = true;
  terminateBtn.disabled = true;

  // Initial load
  refreshProcesses();

  // Removed the automatic refresh interval - only refresh when button is clicked
});
