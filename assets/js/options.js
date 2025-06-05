document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get(
    ["geminiKey", "azurePat", "geminiModel"],
    ({ geminiKey, azurePat, geminiModel }) => {
      if (geminiKey) document.getElementById("geminiKey").value = geminiKey;
      document.getElementById("geminiModel").value = geminiModel || "gemini-1.5-flash";
      if (azurePat) document.getElementById("azurePat").value = azurePat;
    }
  );

  document.getElementById("saveKeys").addEventListener("click", () => {
    const geminiKey = document.getElementById("geminiKey").value;
    const azurePat = document.getElementById("azurePat").value;
    const geminiModel = document.getElementById("geminiModel").value;

    if (!geminiKey || !azurePat || !geminiModel) {
      document.getElementById("status").textContent = "Please enter all fields.";
      return;
    }

    chrome.storage.local.set({ geminiKey, azurePat, geminiModel }, () => {
      document.getElementById("status").textContent = "Keys saved!";
      setTimeout(() => {
        document.getElementById("status").textContent = "";
      }, 1500);
    });
  });
});