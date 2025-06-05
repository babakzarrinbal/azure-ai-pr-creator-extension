import { cleanAsk } from "../modules/gemini.js";
import { act as createPR } from "./pr.js";
import { getFilesOfRepo, getFileContent } from "../modules/azure.js";

export async function act({ geminiKey, azurePat, geminiModel, geminiCallThreshold},prompt, referencePage) {
  
  const ACTIONS_LIST = `
  - "getFilesOfRepo" : get list of files within a repository.
  <arg> should be valid url for a repository as one string. <valid format : https://dev.azure.com/<organization>/<project>/_git/<repo>?version=GB<branch>
  
  - "getFilesContents" : get the contents of files
  <arg> is one string containing file urls separated by new line valid file format: https://dev.azure.com/<organization>/<project>/_git/<repo>?path=<path>&version=GB<branch>
  
  - "createPR" : create a pull request to the default branch.
  <arg> must be a single string, formatted as below:
  
  <FULL FILE URL>
  <EXACT CHANGE DESCRIPTION>
  
  Separate file blocks with two newlines seperation. URL first, then description.`;
  
  const ACTIONS = {
    getFilesOfRepo: (x)=>{ files = getFilesOfRepo({ azurePat },x); return files.join("\n"); },
    getFilesContents: x=> x.split("\n").map(u=>'# '+u+'\n'+getFileContent({ azurePat },u)).join("\n\n"),
    createPR: x=>createPR({ geminiKey, azurePat, geminiModel }, x,referencePage),
  };
  
  const SYSTEM_INSTRUCTION = `
  You are a developer designed to help locate the codes location in repository and finally create a pr for change.
  You must respond with action name and the argument as one string only.
  
  ### OBJECTIVES:
  - Analyze prompt and provided information.
  - Identify actions from ###AVAILABLE_ACTIONS###.
  - Avoid repeated actions.
  - Limit large file content.
  - Use valid full URLs.
  
  ### RULES:
  - Only respond with action name and args in exact format:
    action name
    -----
    <args>
  - No markdown or explanation.
  
  ###AVAILABLE_ACTIONS###
  ${ACTIONS_LIST}`;

  const actionsResults = {};
  let actionResult = null;

  while (true) {
    const prevResults = Object.entries(actionsResults)
      .map(([a, r]) => a+":\n" + r)
      .join("\n\n");

    const stepPrompt = `${prompt}\n\n###PREVIOUS_ACTIONS_RESULTS###\n${prevResults}`;
    const geminiCall = 0;
    if (geminiCall++ > geminiCallThreshold) {
      return {
        status: "error",
        message: "Gemini call threshold reached, stopping further actions."
      }
    }
    const stepAction = (await cleanAsk({ geminiModel, geminiKey },stepPrompt, SYSTEM_INSTRUCTION)).trim();

    try {
      const stepActionName = stepAction.split("\n-----\n")[0].trim();
      const stepArg = stepAction.substring(stepAction.indexOf("-----") + 5).trim();
      const actionName = stepActionName.trim();
      const actionArg = stepArg.trim();
      const actionStepTitle = `action:${actionName}\narg:${actionArg}\nresult:`;

      try {
        const result = await ACTIONS[actionName](actionArg);
        if (actionName === "create_pr") {
          actionResult = result;
          break;
        }
        actionsResults[actionStepTitle] =
          result || " no result for this action found. Do not repeat.";
      } catch (err) {
        actionsResults[actionStepTitle] = `action ${actionName} failed.`;
      }
    } catch (e) {
      console.error(`Failed to parse action: ${stepAction}`);
    }
  }

  return actionResult;
}
