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

  micButton.addEventListener("click", function () {
    // Use the correct global reference for browsers
    const SpeechRec =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRec) {
      statusEl.innerText =
        "⚠️ Speech Recognition not supported in this browser. Try using Chrome or Edge.";
      return;
    }

    // Clear previous recognition state
    if (this.recognizer) {
      try {
        this.recognizer.abort();
      } catch (e) {
        console.error("Error stopping previous recognition:", e);
      }
      this.recognizer = null;
    }

    // Toggle listening state
    this.listening = !this.listening;

    if (!this.listening) {
      statusEl.innerText = "Speech recognition stopped";
      micButton.innerHTML = '<i class="fas fa-microphone"></i>';
      return;
    }

    // Create new recognizer
    try {
      const recognizer = new SpeechRec();
      this.recognizer = recognizer;

      // Configure the recognizer
      recognizer.lang = "en-US"; // Force English to improve reliability
      recognizer.continuous = false;
      recognizer.interimResults = false;
      recognizer.maxAlternatives = 1;

      // Set up event handlers
      recognizer.onstart = () => {
        statusEl.innerText = "🎙️ Listening...";
        micButton.innerHTML = '<i class="fas fa-stop"></i>';
        console.log("Speech recognition started successfully");
      };

      recognizer.onerror = (evt) => {
        console.error("Speech recognition error:", evt);

        // Handle network error specifically
        if (evt.error === "network") {
          statusEl.innerHTML =
            "❌ Network error: Check your internet connection";
          console.log("Network error details:", evt);
        } else if (
          evt.error === "not-allowed" ||
          evt.error === "permission-denied"
        ) {
          statusEl.innerText =
            "❌ Microphone permission denied. Please allow microphone access.";
        } else if (evt.error === "no-speech") {
          statusEl.innerText = "⚠️ No speech detected. Try speaking again.";
        } else {
          statusEl.innerText = `❌ Error: ${evt.error}`;
        }

        micButton.innerHTML = '<i class="fas fa-microphone"></i>';
        this.listening = false;
        this.recognizer = null;
      };

      recognizer.onend = () => {
        micButton.innerHTML = '<i class="fas fa-microphone"></i>';
        if (this.listening) {
          statusEl.innerText = "Speech recognition ended";
          this.listening = false;
        }
        this.recognizer = null;
      };

      recognizer.onresult = (evt) => {
        try {
          const transcript = evt.results[0][0].transcript.trim().toLowerCase();
          statusEl.innerText = `🗣️ Recognized: "${transcript}"`;
          cmdInput.value = transcript;

          // Only run the command if we got a valid transcript
          if (transcript) {
            runCmd(transcript);
          }
        } catch (e) {
          console.error("Error processing speech result:", e);
          statusEl.innerText = "❌ Error processing speech";
        }
      };

      // Start recognition with error handling
      try {
        console.log("Attempting to start speech recognition...");
        recognizer.start();
      } catch (e) {
        console.error("Failed to start speech recognition:", e);
        statusEl.innerText = `❌ Failed to start speech recognition: ${e.message}`;
        this.listening = false;
        this.recognizer = null;
      }
    } catch (e) {
      console.error("Error initializing speech recognition:", e);
      statusEl.innerText = `❌ Error initializing speech recognition: ${e.message}`;
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
