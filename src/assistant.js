export function initAssistant({ input, runBtn, listenBtn, status }) {
  const statusEl = document.querySelector(status);
  const cmdInput = document.querySelector(input);
  const runButton = document.querySelector(runBtn);
  const micButton = document.querySelector(listenBtn);

  // Add basic validation for required elements
  if (!statusEl || !cmdInput || !runButton || !micButton) {
    console.error("Missing required elements");
    return;
  }

  // List of common applications for suggestions
  const commonApps = [
    "notepad",
    "calc",
    "cmd",
    "explorer",
    "chrome",
    "firefox",
    "edge",
    "msedge",
    "word",
    "excel",
    "powershell",
    "code",
    "outlook",
    "terminal",
  ];

  // Create and add suggestion list
  function setupSuggestions() {
    const datalist = document.createElement("datalist");
    datalist.id = "app-suggestions";

    commonApps.forEach((app) => {
      const option = document.createElement("option");
      option.value = app;
      datalist.appendChild(option);
    });

    document.body.appendChild(datalist);
    cmdInput.setAttribute("list", "app-suggestions");
  }
  setupSuggestions();

  // Add placeholder text to input
  cmdInput.placeholder = "Try: open notepad, kill chrome, etc.";

  async function runCmd(cmd) {
    if (!cmd) return;

    statusEl.innerText = "🤖 Processing…";
    try {
      // Add loading state to buttons
      runButton.disabled = true;
      micButton.disabled = true;

      // Parse command for better user experience
      let enhancedCmd = cmd;

      // Handle various command formats
      if (/^(launch|start|run|execute)\s+/.test(cmd)) {
        enhancedCmd =
          "open " + cmd.replace(/^(launch|start|run|execute)\s+/, "");
      } else if (/^(terminate|end|exit|quit|stop)\s+/.test(cmd)) {
        enhancedCmd =
          "kill " + cmd.replace(/^(terminate|end|exit|quit|stop)\s+/, "");
      }

      // Check if cmd contains a command keyword, if not assume it's an app to open
      if (!/(open|kill|close)\s+/.test(enhancedCmd)) {
        enhancedCmd = "open " + enhancedCmd;
      }

      console.log(`Running command: ${enhancedCmd}`);
      const res = await window.api.runCommand(enhancedCmd);

      // Show success message with appropriate icon
      if (enhancedCmd.startsWith("open")) {
        statusEl.innerText = `✅ ${res}`;
      } else if (
        enhancedCmd.startsWith("kill") ||
        enhancedCmd.startsWith("close")
      ) {
        if (res.includes("No process matching")) {
          statusEl.innerText = `⚠️ ${res}`;
        } else {
          statusEl.innerText = `🛑 ${res}`;
        }
      } else {
        statusEl.innerText = `ℹ️ ${res}`;
      }

      // Clear input after successful command
      cmdInput.value = "";
    } catch (err) {
      console.error("Command execution error:", err);
      statusEl.innerText = `❌ Error: ${err.message || "Unknown error"}`;
    } finally {
      runButton.disabled = false;
      micButton.disabled = false;
    }
  }

  // Add keyboard support for Enter key
  cmdInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") runCmd(cmdInput.value.trim().toLowerCase());
  });

  runButton.addEventListener("click", () => {
    const cmd = cmdInput.value.trim().toLowerCase();
    runCmd(cmd);
  });

  micButton.addEventListener("click", async function () {
    // Check for Speech Recognition API support
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      statusEl.innerText =
        "⚠️ Speech Recognition not supported in your browser. Please try Chrome or Edge.";
      return;
    }

    // Skip internet connection check - assume we're online
    // since requiring electron in the renderer won't work with contextIsolation
    let isOnline = true;

    // Toggle listening state
    this.listening = !this.listening;

    if (!this.listening) {
      // If we're stopping an active recognition session
      if (this.recognizer) {
        try {
          this.recognizer.stop();
        } catch (e) {
          console.error("Error stopping recognition:", e);
        }
      }
      statusEl.innerText = "Speech recognition stopped";
      micButton.innerHTML = '<i class="fas fa-microphone"></i>';
      return;
    }

    // Start speech recognition
    statusEl.innerText = "🎙️ Listening...";
    micButton.innerHTML = '<i class="fas fa-stop"></i>';

    try {
      const recognizer = new SpeechRecognition();
      this.recognizer = recognizer;

      recognizer.lang = "en-US";
      recognizer.continuous = false;
      recognizer.interimResults = false;
      recognizer.maxAlternatives = 1;

      recognizer.onresult = (event) => {
        try {
          const transcript = event.results[0][0].transcript
            .trim()
            .toLowerCase();
          console.log("Speech recognized:", transcript);
          statusEl.innerText = `🗣️ Recognized: "${transcript}"`;
          cmdInput.value = transcript;
          runCmd(transcript);
        } catch (err) {
          console.error("Error processing speech result:", err);
          statusEl.innerText = "❌ Error processing speech. Please try again.";
        }
      };

      recognizer.onerror = (event) => {
        console.error("Speech recognition error:", event.error);

        // Handle specific error types
        if (event.error === "not-allowed") {
          statusEl.innerText =
            "❌ Microphone access denied. Please allow microphone access in settings.";
        } else if (event.error === "network") {
          statusEl.innerText =
            "❌ Network error. Please try again or check internet connection.";
        } else if (event.error === "no-speech") {
          statusEl.innerText =
            "⚠️ No speech detected. Please try again and speak clearly.";
        } else {
          statusEl.innerText = `❌ Error: ${event.error}. Please try again.`;
        }

        micButton.innerHTML = '<i class="fas fa-microphone"></i>';
        this.listening = false;
      };

      recognizer.onend = () => {
        console.log("Speech recognition ended");
        micButton.innerHTML = '<i class="fas fa-microphone"></i>';

        // Only update status if we're still in the listening state
        if (this.listening && statusEl.innerText === "🎙️ Listening...") {
          statusEl.innerText = "Speech recognition ended";
        }

        this.listening = false;
      };

      // Add automatic timeout to avoid getting stuck in listening mode
      setTimeout(() => {
        if (this.listening && recognizer) {
          try {
            recognizer.stop();
          } catch (e) {
            console.warn("Error stopping recognition on timeout:", e);
          }
        }
      }, 10000); // 10 second timeout

      // Start recognition
      recognizer.start();
      console.log("Speech recognition started");
    } catch (error) {
      console.error("Failed to initialize speech recognition:", error);
      statusEl.innerText =
        "❌ Speech recognition failed to start. Please try again.";
      micButton.innerHTML = '<i class="fas fa-microphone"></i>';
      this.listening = false;
    }
  });

  // Helper function to show command examples in status on load
  function showHelp() {
    statusEl.innerHTML = `
            <b>Command Assistant</b><br>
            Examples:<br>
            - open notepad<br>
            - kill chrome<br>
            - close spotify
        `;
  }

  // Show help on initial load
  showHelp();
}
