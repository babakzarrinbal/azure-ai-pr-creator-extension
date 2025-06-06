document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get(
    ["geminiKey", "azurePat", "geminiModel", "geminiCallThreshold"],
    ({ geminiKey, azurePat, geminiModel,geminiCallThreshold }) => {
      if (geminiKey) document.getElementById("geminiKey").value = geminiKey;
      document.getElementById("geminiModel").value = geminiModel || "gemini-1.5-flash";
      document.getElementById("geminiCallThreshold").value = geminiCallThreshold || 7;
      if (azurePat) document.getElementById("azurePat").value = azurePat;
    }
  );

  document.getElementById("saveKeys").addEventListener("click", () => {
    const geminiKey = document.getElementById("geminiKey").value;
    const azurePat = document.getElementById("azurePat").value;
    const geminiModel = document.getElementById("geminiModel").value;
    const geminiCallThreshold = document.getElementById("geminiCallThreshold").value
    const status = document.getElementById("status");
    if (!geminiKey || !azurePat ) {
      status.style.color = "red";
      status.textContent = "Please enter all fields.";
      return;
    }
    if (!geminiCallThreshold || isNaN(geminiCallThreshold) || geminiCallThreshold <= 0) {
      status.style.color = "red";
      status.textContent = "Please Enter valid Gemini Multi call Threshold.";
      return;
    }
    chrome.storage.local.set({ geminiKey, azurePat, geminiModel, geminiCallThreshold }, () => {
      status.style.color = "green";
      status.textContent = "Keys saved!";
      setTimeout(() => {
        status.textContent = "";
      }, 2000);
    });
  });
});