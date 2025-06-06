import { cleanAsk } from "../modules/gemini.js";
import { act as createPR } from "./pr.js";
import { getFilesOfRepo, getFileContent } from "../modules/azure.js";

const ACTIONS = [
  {
    name: "get_files_contents",
    description: "get the contents of files with given files urls.",
    operator: async (keys,x)=> {
      let result = []
      for (const fileUrl of x.split("\n")) {
        if (!fileUrl.trim() || fileUrl.slice(0,5) !=='https') continue;
        console.log("Fetching content for file:", fileUrl);
        result.push('# ' + fileUrl + '\n' + await getFileContent(keys,fileUrl));
      }
      return result.join("\n\n");
    },
    inputSchema: {
      type: "string",
      description:`is one string containing file urls separated by new line valid file format: https://dev.azure.com/<organization>/<project>/_git/<repo>?path=<path>&version=GB<branch>`
    },
  },
  {
    name: "create_pr",
    description: "create a pull request to the default branch.",
    operator:(keys,x)=>createPR(keys, x,keys.referencePage),
    inputSchema: {
      type: "string",
      description: `must be a single string, formatted as below with valid file urls with this format https://dev.azure.com/<organization>/<project>/_git/<repo>?path=<path>&version=GB<branch> and exact change descriptions.:
<FULL FILE URL> 
<EXACT CHANGE DESCRIPTION>

<ANOTHER FILE URL> 
<ANOTHER CHANGE DESCRIPTION>

Separate file blocks with two newlines separation. URL first, then description.`
    }
  }
];

const system_instruction_generator = (actions)=>`
You are a developer designed to help locate the codes location in repository and finally create a pr for change.
try to get the contents of the files that can help you understand the code and needed changes for the pr.
consider ###PREVIOUS_ACTIONS_RESULTS### section for previous actions results and better understanding of repository. 
finally create a pr with the changes.
You must respond with action name and the argument as one string only.
  
### OBJECTIVES:
  - Analyze prompt and provided information.
  - Identify actions from ###AVAILABLE_ACTIONS###.
  - Avoid repeated actions.
  - Use valid full URLs.
  
### RULES:
  - Only respond with one action name and arg in exact format:
    action name
    -----
    <arg>
  - No markdown or explanation.
  
###AVAILABLE_ACTIONS###
${actions.map(a => "- "+ a.name+": "+a.description+"\n<arg> "+ a.inputSchema.description).join("\n\n")};`

export async function act({ geminiKey, azurePat, geminiModel, geminiCallThreshold},prompt, referencePage) {
  let SYSTEM_INSTRUCTION = system_instruction_generator(ACTIONS);
  const actionsResults = {};
  let finalResult = null;
  const keys = { geminiKey, azurePat, geminiModel};
  const fileOfRepo = await getFilesOfRepo(keys, referencePage)
  prompt = `${prompt}\n\nreference: ${referencePage}\n\n ###list of files of the repository###\n${fileOfRepo.join("\n")}`;
  while (true) {
    const prevResults = Object.entries(actionsResults)
      .map(([a, r]) => a+":\n" + r)
      .join("\n\n");
    let errorCount = 0;
    try {

      const stepPrompt = `${prompt}\n\n###PREVIOUS_ACTIONS_RESULTS###\n${prevResults}`;
      let geminiCall = 0;
      if (geminiCall++ > geminiCallThreshold) 
        SYSTEM_INSTRUCTION = system_instruction_generator(ACTIONS.filter(a=>a.name==='create_pr'));
      const stepAction = (await cleanAsk({ geminiModel, geminiKey },stepPrompt, SYSTEM_INSTRUCTION)).trim();
      const stepActionName = stepAction.split("\n-----\n")[0].trim();
      const stepArg = stepAction.substring(stepAction.indexOf("-----") + 5).trim();
      const actionName = stepActionName.trim();
      const actionArg = stepArg.trim();
      const actionStepTitle = `action:${actionName}\narg:${actionArg}\nresult:`;
      console.log(stepAction);
      let errorCount = 0
      try {
        const result = await ACTIONS.find(a=>a.name === actionName).operator(keys,actionArg);
        console.log(`Action "${actionName}" executed with result:`, result);
        if (actionName === "create_pr") {
          finalResult = result;
          break;
        }
        actionsResults[actionStepTitle] =
          result || " no result for this action found. Do not repeat.";
      } catch (err) {
        console.error(`Action failed with error:`, err);
        actionsResults[actionStepTitle] = `action ${actionName} failed.`;
        if (++errorCount > 3) {
          console.error("Too many errors, stopping further actions.");
          actionsResults[actionStepTitle] = "Action failed too many times, stopping further actions.";
          break;
        }
        break;
      }
    } catch (e) {
      console.error("Error during action processing:", e);
      if (++errorCount > 3) {
        console.error("Too many errors, stopping further actions.");
        break;
      }

      break;
    }
  }

  return finalResult;
}
