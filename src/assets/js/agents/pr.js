import { cleanAsk } from "../modules/gemini.js";
import { prCreator, getFileContent, getBranchAndFilesFromPRUrl} from "../modules/azure.js";

const AGENT_CALL_SYSTEM_INSTRUCTION = `
You are a PR Creation Agent, assisting in creating pull requests from a branch to the default branch.
At least one file URL must be provided in the input for a PR to be created.


Objective:
Analyze the user’s prompt and generate a JSON response according to the following schema.
If multiple repositories are referenced, generate multiple PRs inside the array.

Rules:
- If multiple repositories are referenced, create one PR object per repository inside the "pull_requests" array.
- If a file is deleted, simply put empty string in "content" field.
- alway give one pr per repository.
- Always return valid json


Schema:

[
  {
    "title": "<PR title>",                // Generate based on the prompt and file changes
    "description": "<PR description>",    // Generate based on the prompt and file changes
    "branch": "<Branch name>",            // Generate based on the prompt and file changes
    "commit_message": "<Commit message>", // Generate based on the prompt and file changes
    "files": [
      {
        "change_description": "<Description of the change>", // Generate based on the prompt and file changes
        "url": "<File URL>",              // Use exactly as provided in the prompt
        "pr_type": "add | edit | delete"  // Generate based on the prompt and file changes
      }
    ]
  }
]
`;
const CODE_SUGGESTION_SYSTEM_INSTRUCTION = `
You are given a file content as prompt. Based on the ###INSTRUCTIONS###:

- Always provide the full, updated file content. with comments on changes with AI_SUGGESTIONS: in the beginning of the comment
- just return raw text. **Do not wrap the output in any code fences**.

###INSTRUCTIONS###
`;

export async function act({ geminiKey, azurePat, geminiModel}, prompt, referencePage) {
  let pullRequestBranch, files=[];
  if (referencePage?.includes("/pullrequest/")) {
    ({ branch:pullRequestBranch, files } = await getBranchAndFilesFromPRUrl({azurePat},referencePage));
  } else {
    files = [referencePage];
  }
  prompt = prompt+ (files.length ?`\n\nReference files:\n${files.join("\n")}`:"");
  let prInfo;

  try {
    let prInfoRaw =  await cleanAsk(
          { geminiKey, geminiModel },
          prompt,
          AGENT_CALL_SYSTEM_INSTRUCTION,
        )
    prInfo = JSON.parse(prInfoRaw);
    
  } catch(err) {
    console.error("Error creating pr", err);
    return {
      message: "Failed to create PR!",
      status: "error",
    };
  }
  console.log("ai prInfo", prInfo);
  for (const pr of prInfo) {
    for (const f of pr.files) {
      const fileContent = await getFileContent({azurePat},f.url);
      console.log("fileContent", fileContent);
      f.pr_type = (fileContent && f.pr_type === "add") ? "edit": f.pr_type;
      f.content = encodeBase64(
        f.pr_type === "delete"
          ? null
          : await cleanAsk(
              { geminiKey, geminiModel },
              fileContent,
              CODE_SUGGESTION_SYSTEM_INSTRUCTION + f.change_description
            ),
      );
    }
  }
  console.log("prInfo", prInfo);
  const prUrls = await prCreator({ azurePat }, prInfo, pullRequestBranch);
  console.log("prUrls", prUrls);
  return {
    pr: prUrls[0],
    message: "PR created successfully",
    status: "success",
  };
}

function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}
