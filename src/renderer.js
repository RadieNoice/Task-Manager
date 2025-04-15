// Initialize the assistant module
import { initAssistant } from "./assistant.js";

document.addEventListener("DOMContentLoaded", () => {
  // Initialize the virtual assistant with the correct selectors
  initAssistant({
    input: "#cmdInput",
    runBtn: "#runBtn",
    listenBtn: "#listenBtn",
    status: "#status",
  });

  console.log("Assistant initialized successfully");
});
