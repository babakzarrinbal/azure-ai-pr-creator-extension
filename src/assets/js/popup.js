
const pollInterval = 2000;
var lastHistory = "";

const getStore = ()=> new Promise(r => chrome.storage.local.get(["geminiKey", "azurePat", "geminiModel", "history", "geminiCallThreshold"], r));

// const { azurePat, geminiKey, geminiModel, geminiCallThreshold } = await getStore();
const renderHistory = async () => {
  const {history}  = await getStore();
  if (!history || history === lastHistory) return;
  output = document.getElementById("response");
  output.style.display = "block";
  lastHistory = history;
   output.setHTMLUnsafe(JSON.parse(history).map(h =>
    `<div class="history-block ${h.status === 'success' ? 'success':''} ${h.status === 'error' ? 'error':''}">${
      h.status === 'success'
        ? `<span class="prompt-summery">${h.shortPrompt}</span><br/><a href="${h.pr}" target="_blank">${h.message}</a>`
        : `<span class="prompt-summery">${h.shortPrompt}</span></br><span>${h.status === 'error' ? h.message : '<span class="spinner"></span>In Progress...'}</span>`
    }</div>`
  ).reverse().join(''));
}

async function main() {
  const el = id => document.getElementById(id),
        fileActionBtn = el("fileButton"),
        repoScopeCheckbox = el("repoCheckbox"),
        repoCheckboxLabel = el("repoCheckboxLabel"),
        settings = el("settings"),
        promptBox = el("prompt");

  const { azurePat, geminiKey, geminiModel, geminiCallThreshold } = await getStore();
  settings.addEventListener("click", () => chrome.runtime.openOptionsPage());

  if (!azurePat || !geminiKey || !geminiModel || !geminiCallThreshold) {
    Object.assign(promptBox, {
      value: "Awww, how nice! you want to use me ?\n\nI'm not ready yet! Go to settings before .",
      disabled: true,
      style: { color: "red" }
    });
    settings.src = "../icons/gear-alert.svg";
    fileActionBtn.disabled = true;
    fileActionBtn.textContent = "No API Keys";
    fileActionBtn.style.backgroundColor = "#ccc";
    repoCheckboxLabel.style.color = "#ccc";
    repoScopeCheckbox.disabled = true;

  }

  const activeUrl = await (new Promise(r=> chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => r(tab?.url || ""))));
  if (!activeUrl.includes("dev.azure.com")) {
    Object.assign(promptBox, {
      value: "Dude! I'm a azure devops extension remember!\n\nYou should be in Azure DevOps repo or pull-request page.",
      disabled: true,
      style: { color: "red" }
    });

    
    fileActionBtn.disabled = true;
    fileActionBtn.textContent = "Invalid Page";
    fileActionBtn.style.backgroundColor = "#ccc";
    repoCheckboxLabel.style.color = "#ccc";
    repoScopeCheckbox.disabled = true;
    return;
  }

  fileActionBtn.textContent = activeUrl.includes("/pullrequest/") ? "Modify PR" : "Create PR";

  const hasPathParam = /\?path=|&path=/.test(activeUrl) ;
  if( !hasPathParam && !activeUrl.includes("/pullrequest/") ) {
    repoScopeCheckbox.disabled = true;
    repoScopeCheckbox.checked = true;
  }

  fileActionBtn.addEventListener("click", () => {
    const scope = repoScopeCheckbox.checked ? "repo" : "file";
    const prompt = document.getElementById("prompt").value;
    if (!prompt) {
      alert("Don't come to me without a prompt!");
      return;
    }
    chrome.runtime.sendMessage({ action: "createPrWithAI", prompt, activeUrl, changeScope: scope });
    setTimeout(renderHistory, 50);

  });

  renderHistory();
  setInterval(renderHistory, pollInterval);
}

document.addEventListener("DOMContentLoaded", main)
