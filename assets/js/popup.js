document.addEventListener("DOMContentLoaded", () => {
  const el = id => document.getElementById(id),
        fileActionBtn = el("fileButton"),
        repoScopeCheckbox = el("repoCheckbox"),
        repoCheckboxLabel = el("repoCheckboxLabel"),
        promptBox = el("prompt");

  el("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    const currentUrl = tab?.url || "";
    if (!currentUrl.includes("dev.azure.com")) {
      Object.assign(promptBox, {
        value: "You are not in an Azure DevOps page. Please navigate to a valid Azure DevOps repository or pull request.",
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

    fileActionBtn.textContent = currentUrl.includes("/pullrequest/") ? "Modify PR" : "Create PR";

    const hasPathParam = /\?path=|&path=/.test(currentUrl) ;
    repoScopeCheckbox.disabled = !hasPathParam;
    repoScopeCheckbox.checked = !hasPathParam && !currentUrl.includes("/pullrequest/");

    fileActionBtn.addEventListener("click", () => {
      const scope = repoScopeCheckbox.checked ? "repo" : "file";
      send(scope, currentUrl);
    });
  });

  
  renderHistory();
  setInterval(renderHistory, pollInterval);
});

const pollInterval = 2000;
  let last = "";
  const getHistory = ()=>new Promise(r => chrome.storage.local.get(["history"], ({ history }) => r(history)));
  const renderHistory = async () => {
    const history  = await getHistory();
    if (!history || history === last) return;
    output = document.getElementById("response");
    output.style.display = "block";
    last = history;

    const records = JSON.parse(history);

    const html = records.map(h =>
      `<div class="history-block ${h.status === 'success' ? 'success':''} ${h.status === 'error' ? 'error':''}">${
        h.status === 'success'
          ? `<span class="pompt-summery">${h.shortPrompt}</span><br/><a href="${h.pr}" target="_blank">${h.message}</a>`
          : `<span class="pompt-summery">${h.shortPrompt}</span></br><span>${h.status === 'error' ? h.message : '<span class="spinner"></span>In Progress...'}</span>`
      }</div>`
    ).reverse().join('');

    output.setHTMLUnsafe(html);
  }
  
function send(scope, activeUrl) {
  const prompt = document.getElementById("prompt").value;
  chrome.runtime.sendMessage(
    { action: "createPrWithAI", prompt, activeUrl, changeScope: scope },
  );
  setTimeout(renderHistory, 50);

}

// historySample = [
//   {
//     "status": "success",
//     "prompt": "complete prompt",
//     "shortPrompt": "shorted prompt",
//     "message": "PR #123 created successfully",
//     "activeUrl": "https://dev.azure.com/your-org/your-project/_git/your-repo/pullrequest/123", 
//     "pr": "https://dev.azure.com/your-org/your-project/_git/your-repo/pullrequest/123"
//   },
//   {
//     "status": "error",
//     "prompt": "complete prompt",
//     "shortPrompt": "shorted prompt",
//     "message": "Error: Invalid repository URL",
//     "activeUrl": "https://dev.azure.com/your-org/your-project/_git/your-repo/pullrequest/123", 
//     "pr": ""
//   },
//   {
//     "status": "in-progress",
//     "prompt": "complete prompt",
//     "shortPrompt": "shorted prompt",
//     "message": "",
//     "activeUrl": "https://dev.azure.com/your-org/your-project/_git/your-repo/pullrequest/123", 
//     "pr": ""
//   }
// ];