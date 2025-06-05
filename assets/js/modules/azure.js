export async function getFilesOfRepo({azurePat}, repoUrl) {
  let { organization, project, repository, branch } = parseAzureUrl(repoUrl);
  branch =
    branch ||
    (await getDefaultBranch(
      { azurePat },
      { organization, project, repository },
    ));

  const baseUrl = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repository}/items`;
  const query =
    `?recursionLevel=Full&includeContentMetadata=true&latestProcessedChange=true` +
    `&versionDescriptor.version=${branch}&versionDescriptor.versionType=branch&api-version=7.1-preview.1`;

  const response = await fetch(baseUrl + query, {
    method: "GET",
    headers: {
      Authorization: `Basic ${btoa(":" + azurePat)}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    console.warn("⚠️ Failed to fetch repository files:", baseUrl + query);
    return [];
  }
  const data = await response.json();
  return data.value
    .filter((item) => item.gitObjectType === "blob")
    .map(
      (item) =>
        `https://dev.azure.com/${organization}/${project}/_git/${repository}?path=${item.path}&version=GB${branch}&_a=contents`,
    );
}

export async function getFileContent({ azurePat }, fileUrl = null) {
  let { organization, project, repository, branch, filePath } = parseAzureUrl(fileUrl);

  const headers = {
    Authorization: `Basic ${btoa(":" + azurePat)}`,
    "Content-Type": "application/json",
  };

  if (!branch) {
    branch = await getDefaultBranch({ azurePat }, { organization, project, repository });
  }

  // Step 1: Try to fetch file from active branch
  const liveFileUrl = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repository}/items` +
    `?path=${encodeURIComponent(filePath)}&versionDescriptor.version=${branch}&versionDescriptor.versionType=branch&includeContent=true&api-version=7.1-preview.1`;

  const liveFileRes = await fetch(liveFileUrl, { headers });
  if (liveFileRes.ok) return await liveFileRes.text();

  // Step 2: Try to recover file from deleted branch's last commit
  const pushListUrl = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repository}/pushes?searchCriteria.refName=refs/heads/${branch}&$top=1&api-version=7.0`;
  const pushListRes = await fetch(pushListUrl, { headers });
  if (!pushListRes.ok) return null;

  const pushList = await pushListRes.json();
  const lastPush = pushList.value?.[0];
  if (!lastPush) return null;

  const pushId = lastPush.pushId;
  const pushDetailsUrl = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repository}/pushes/${pushId}?includeRefUpdates=true&api-version=7.0`;
  const pushDetailsRes = await fetch(pushDetailsUrl, { headers });
  if (!pushDetailsRes.ok) return null;

  const pushDetails = await pushDetailsRes.json();
  const refUpdate = pushDetails.refUpdates?.find(r => r.name === `refs/heads/${branch}`);
  const commitId = refUpdate?.oldObjectId;

  if (!commitId || refUpdate.newObjectId !== "0000000000000000000000000000000000000000") return null;

  // Step 3: Fetch file from the last commit before deletion
  const deletedFileUrl = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repository}/items` +
    `?path=${encodeURIComponent(filePath)}&versionDescriptor.version=${commitId}&versionDescriptor.versionType=commit&includeContent=true&api-version=7.1-preview.1`;

  const deletedFileRes = await fetch(deletedFileUrl, { headers });
  if (!deletedFileRes.ok) return null;

  return await deletedFileRes.text();
}

export async function prCreator({ azurePat }, prs) {
  const prUrls = [];

  for (const pr of prs) {
    let { title, description, branch, commit_message, files = [] } = pr;
    files = files.map(f => ({ ...f, path: parseAzureUrl(f.url).filePath }));
    branch = safeBranchName(branch);
    const { organization, project, repository } = parseAzureUrl(files[0].url);

    const headers = {
      Authorization: `Basic ${btoa(":" + azurePat)}`,
      "Content-Type": "application/json",
    };

    const defaultBranch = await getDefaultBranch({ azurePat }, { organization, project, repository });
    const branchExists = await checkBranchExists({ azurePat }, { organization, project, repository, branch });
    const branchDeleted = await isBranchDeleted({ azurePat }, { organization, project, repository, branch });

    let commitId = null;

    if (branchExists && !branchDeleted) {
      // Use existing branch
      const commitsRes = await fetch(
        `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repository}/commits?searchCriteria.itemVersion.version=${branch}&$top=1&api-version=7.0`,
        { headers }
      );
      commitId = (await commitsRes.json()).value?.[0]?.commitId;
    } else if (branchDeleted) {
      // Get commit ID from last push before deletion
      const pushListRes = await fetch(
        `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repository}/pushes?searchCriteria.refName=refs/heads/${branch}&$top=1&api-version=7.0`,
        { headers }
      );
      const pushList = await pushListRes.json();
      const pushId = pushList.value?.[0]?.pushId;

      if (pushId) {
        const pushDetailsRes = await fetch(
          `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repository}/pushes/${pushId}?includeRefUpdates=true&api-version=7.0`,
          { headers }
        );
        const pushDetails = await pushDetailsRes.json();
        const ref = pushDetails.refUpdates?.find(r => r.name === `refs/heads/${branch}`);
        commitId = ref?.oldObjectId;
      }
    }

    // Fallback: use default branch commit if none found
    if (!commitId) {
      const defaultCommitsRes = await fetch(
        `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repository}/commits?searchCriteria.itemVersion.version=${defaultBranch}&$top=1&api-version=7.0`,
        { headers }
      );
      commitId = (await defaultCommitsRes.json()).value?.[0]?.commitId;
    }

    const refUpdates = [
      { name: `refs/heads/${branch}`, oldObjectId: commitId }
    ];

    const pushPayload = {
      refUpdates,
      commits: [
        {
          comment: commit_message,
          changes: files.map((f) => ({
            changeType: f.pr_type,
            item: { path: f.path },
            newContent: {
              content: f.content,
              contentType: "base64encoded",
              encoding: "utf-8",
            },
          })),
        },
      ],
    };

    const pushRes = await fetch(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repository}/pushes?api-version=7.0`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(pushPayload),
      }
    );
    if (!pushRes.ok) {
      console.error("⚠️ Failed to create push:", await pushRes.text());
      continue;
    }
    await waitForBranchIndexing({ azurePat }, { organization, project, repository, branch });

    // Check if PR already exists
    const prSearchRes = await fetch(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repository}/pullrequests?searchCriteria.sourceRefName=refs/heads/${branch}&searchCriteria.status=active&api-version=7.0`,
      { headers }
    );
    const prData = await prSearchRes.json();

    let prId;
    if (prData.count > 0) {
      prId = prData.value[0].pullRequestId;
    } else {
      const createPrRes = await fetch(
        `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repository}/pullrequests?api-version=7.0`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            sourceRefName: `refs/heads/${branch}`,
            targetRefName: `refs/heads/${defaultBranch}`,
            title,
            description: `This PR was created dynamically for ${description}.`,
          }),
        }
      );
      const responseJson = await createPrRes.json();
      prId = responseJson.pullRequestId;
    }

    prUrls.push(`https://dev.azure.com/${organization}/${project}/_git/${repository}/pullrequest/${prId}?_a=files`);
  }

  return prUrls.filter(Boolean);
}

export async function getDefaultBranch(
  { azurePat },
  { organization, project, repository },
) {
  const url = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repository}?api-version=7.1-preview.1`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Basic ${btoa(":" + azurePat)}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) throw new Error("Failed to get default branch");

  const data = await res.json();
  return data.defaultBranch.replace("refs/heads/", "");
}

export function parseAzureUrl(url) {

  const parsed = new URL(url);
  const path = parsed.pathname.replace(/^\/|\/$/g, "");
  const query = Object.fromEntries(parsed.searchParams.entries());

  const organization = path.split("/")[0].split("@").pop();
  let project = null;
  let repository = null;
  let branch = null;
  let filePath = null;

  const classicMatch = path.match(/^([^/]+)\/([^/]+)\/_git\/([^/]+)/);
  if (classicMatch) {
    [, , project, repository] = classicMatch;
    branch = query.version || null;
    if (branch?.startsWith("GB")) branch = branch.slice(2);
    filePath = query.path || null;
  } else if (path.includes("_apis/git/repositories")) {
    const parts = path.split("/");
    if (parts.length >= 6) {
      project = getProjectName(organization, parts[1]);
      repository = getRepoName(organization, parts[1], parts[5]);
      branch = query["versionDescriptor[version]"] || null;
      filePath = query.path || null;
    }
  }

  return { organization, project, repository, branch, filePath };
}

export async function checkBranchExists(
  { azurePat },
  { organization, project, repository, branch },
) {
  const url = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repository}/pushes?searchCriteria.refName=refs/heads/${branch}&$top=1&api-version=7.0`;
  const headers = {
    Authorization: `Basic ${btoa(":" + azurePat)}`,
    "Content-Type": "application/json",
  };

  const res = await fetch(url, { headers });
  if (!res.ok) return false;

  const data = await res.json();
  return Array.isArray(data.value) && data.value.length > 0;
}

export async function isBranchDeleted({ azurePat }, { organization, project, repository, branch }) {
  const pushListUrl = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repository}/pushes?searchCriteria.refName=refs/heads/${branch}&$top=1&api-version=7.0`;
  const headers = {
    Authorization: `Basic ${btoa(":" + azurePat)}`,
    "Content-Type": "application/json",
  };

  const pushRes = await fetch(pushListUrl, { headers });
  if (!pushRes.ok) throw new Error(`Failed to fetch push list: ${pushRes.status}`);
  const pushData = await pushRes.json();

  if (!pushData.value?.length) return true; // No push history found — possibly deleted before any push

  const pushId = pushData.value[0].pushId;
  const pushDetailsUrl = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repository}/pushes/${pushId}?includeRefUpdates=true&api-version=7.0`;
  const detailsRes = await fetch(pushDetailsUrl, { headers });
  if (!detailsRes.ok) throw new Error(`Failed to fetch push details: ${detailsRes.status}`);
  const detailsData = await detailsRes.json();

  const ref = detailsData.refUpdates?.find(ref => ref.name === `refs/heads/${branch}`);
  return ref?.newObjectId === "0000000000000000000000000000000000000000";
}

export async function waitForBranchIndexing(
  { azurePat },
  { organization, project, repository, branch },
  maxAttempts = 10,
  delay = 3000,
) {
  const url = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repository}/refs/heads/${branch}?api-version=7.0`;
  const headers = {
    Authorization: `Basic ${btoa(":" + azurePat)}`,
    "Content-Type": "application/json",
  };

  for (let i = 0; i < maxAttempts; i++) {
    console.log(
      `Polling Azure DevOps for branch '${branch}' (attempt ${i + 1}/${maxAttempts})`,
    );
    const res = await fetch(url, { headers });

    if (res.ok) {
      const data = await res.json();
      if (data.count > 0) {
        console.log(`Branch '${branch}' is now indexed.`);
        return true;
      }
    }

    await new Promise((r) => setTimeout(r, delay));
  }

  throw new Error(
    `Branch '${branch}' not indexed after ${maxAttempts} attempts.`,
  );
}


function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

export async function getBranchAndFilesFromPRUrl({azurePat}, prUrl) {
  console.log("Fetching branch and files from PR URL:", prUrl);
     try {
    const url = new URL(prUrl);
    const pathParts = url.pathname.split("/");
    const pullRequestId = pathParts[pathParts.indexOf("pullrequest") + 1];
    const [organization, project] = pathParts.slice(1, 3);
    const repository = pathParts[pathParts.indexOf("_git") + 1];

    const prMetaUrl = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repository}/pullRequests/${pullRequestId}?api-version=7.1-preview.1`;

    const prMetaRes = await fetch(prMetaUrl, {
      headers: {
        Authorization: `Basic ${btoa(":" + azurePat)}`,
        "Content-Type": "application/json",
      },
    });

    if (!prMetaRes.ok) throw new Error("Failed to fetch PR metadata");
    const prMeta = await prMetaRes.json();
    const branch = prMeta.sourceRefName.replace("refs/heads/", "");
    console.log("Branch from prev PR:", branch);
    const iterationsUrl = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repository}/pullRequests/${pullRequestId}/iterations?api-version=7.1-preview.1`;

    const iterationsRes = await fetch(iterationsUrl, {
      headers: {
        Authorization: `Basic ${btoa(":" + azurePat)}`,
        "Content-Type": "application/json",
      },
    });

    if (!iterationsRes.ok) throw new Error("Failed to fetch PR iterations");

    const iterations = await iterationsRes.json();
    const latestIterationId = Math.max(...iterations.value.map(i => i.id));

    const changesUrl = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repository}/pullRequests/${pullRequestId}/iterations/${latestIterationId}/changes?api-version=7.1-preview.1`;

    const changesRes = await fetch(changesUrl, {
      headers: {
        Authorization: `Basic ${btoa(":" + azurePat)}`,
        "Content-Type": "application/json",
      },
    });
    console.log("Changes URL:", changesUrl);
    if (!changesRes.ok) throw new Error("Failed to fetch changed files");

    const changes = await changesRes.json();
    console.log("Changes in PR:", changes);
    const files = changes.changeEntries
      .filter(change => change.item?.path)
      .map(change => 
        `https://dev.azure.com/${organization}/${project}/_git/${repository}?path=${change.item.path}&version=GB${branch}`);


    return { branch, files };
  } catch (e) {
    console.error("⚠️ getBranchAndChangedFilesFromPR error:", e.message);
    return { branch: "", files: [] };
  }
}

function safeBranchName(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\-_\s]/g, '') // remove special chars
    .replace(/\s+/g, '-')           // replace spaces with dashes
    .replace(/^-+|-+$/g, '');       // trim leading/trailing dashes
}