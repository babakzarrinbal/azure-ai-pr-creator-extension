import * as pr from './agents/pr.js';
import * as coder from './agents/coder.js';

var setHistory = (history)=>new Promise(r =>chrome.storage.local.set({ history: JSON.stringify(history) },r ));

chrome.runtime.onMessage.addListener((req) => {
  if (req.action !== "createPrWithAI") return;
  chrome.storage.local.get(["geminiKey", "azurePat", "geminiModel", "history", "geminiCallThreshold"], async (store) => {
    let { geminiKey, azurePat, geminiModel ,geminiCallThreshold} = store;
    if (!geminiKey) return alert("No Gemini API key found.");
    if (!geminiModel) return alert("No Gemini model selected.");
    if (!azurePat) return alert("No Azure PAT found.");
    let history = store.history ? JSON.parse(store.history) : [];
    const requestTime = new Date().toISOString();

    history.push({
      requestTime,
      status: "in-progress",
      prompt: req.prompt,
      activeUrl: req.activeUrl,
      shortPrompt: req.prompt.length > 50 ? req.prompt.slice(0, 47) + " ..." : req.prompt,
      message: "",
      pr: ""
    });

    if (history.length > 15) history.shift();
    await setHistory(history);

    try {
      console.log("Processing request:", req);
      const responder = req.changeScope === "file" ? pr : coder;
      const response = await responder.act({ geminiKey, azurePat, geminiModel ,geminiCallThreshold}, req.prompt, req.activeUrl);

      const record = history.find(h => h.requestTime === requestTime);
      Object.assign(record, {
        status: response.status,
        pr: response.pr,
        message: response.message
      });
      await setHistory(history);
    } catch (err) {
      const errorRecord = history.find(h => h.requestTime === requestTime);
      Object.assign(errorRecord, {
        status: "error",
        message: err.message || "Action failed due to an error",
      });
      await setHistory(history);
      console.error("Gemini error:", err);
    }
  });

  return true;
});
