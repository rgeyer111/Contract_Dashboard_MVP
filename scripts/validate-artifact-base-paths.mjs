import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const dashboardRequire = createRequire(
  path.join(workspaceRoot, "artifacts/contract-dashboard/package.json"),
);
const { chromium } = dashboardRequire("@playwright/test");
const lockDir = path.join(
  workspaceRoot,
  ".cache",
  "artifact-base-path-validation.lock",
);

const artifacts = [
  {
    label: "contract dashboard",
    packageName: "@workspace/contract-dashboard",
    artifactDir: "artifacts/contract-dashboard",
    outDir: "dist/public",
    testBase: "/base-path-check/dashboard/",
    registeredBase: "/",
    port: 4173,
    proxyApi: true,
    expectedText: "Stay ahead of contract renewals.",
    deepPaths: [
      {
        path: "dashboard?demo=1",
        expectedText: "Demo only",
      },
    ],
    extraAssets: ["favicon.svg", "logo.svg"],
  },
  {
    label: "contract walkthrough",
    packageName: "@workspace/contract-walkthrough",
    artifactDir: "artifacts/contract-walkthrough",
    outDir: "dist/public",
    testBase: "/base-path-check/contract-walkthrough/",
    registeredBase: "/contract-walkthrough/",
    port: 4174,
    expectedText: "Stay ahead of",
    deepPaths: [],
    extraAssets: [
      "assets/contract-paper.png",
      "assets/signature-detail.png",
    ],
  },
  {
    label: "workflow video",
    packageName: "@workspace/contract-workflow-video",
    artifactDir: "artifacts/contract-workflow-video",
    outDir: "dist/public",
    testBase: "/base-path-check/workflow-video/",
    registeredBase: "/contract-workflow-video/",
    port: 4175,
    expectedText: "Stay ahead of",
    deepPaths: [],
    extraAssets: [
      "assets/contract-paper.png",
      "assets/signature-detail.png",
    ],
  },
  {
    label: "mockup sandbox",
    packageName: "@workspace/mockup-sandbox",
    artifactDir: "artifacts/mockup-sandbox",
    outDir: "dist",
    testBase: "/base-path-check/mockup/",
    registeredBase: "/__mockup",
    registeredOutputBase: "/__mockup/",
    port: 4176,
    expectedText: "Component Preview Server",
    deepPaths: [
      {
        path: "preview/contract-workspace-redesign/Overview",
        expectedText: "Know what can’t wait.",
      },
    ],
    extraAssets: [],
  },
];

function runWorkspaceBuild() {
  console.log("\nRunning clean workspace build");
  const env = { ...process.env };
  delete env.BASE_PATH;
  delete env.PORT;

  const result = spawnSync("pnpm", ["run", "build"], {
    cwd: workspaceRoot,
    env,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`workspace build exited with ${result.status}`);
  }
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireLock() {
  await mkdir(path.dirname(lockDir), { recursive: true });
  const deadline = Date.now() + 180_000;

  while (Date.now() < deadline) {
    try {
      await mkdir(lockDir);
      await writeFile(path.join(lockDir, "pid"), String(process.pid));
      return async () => {
        await rm(lockDir, { recursive: true, force: true });
      };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }

      try {
        const owner = Number(
          await readFile(path.join(lockDir, "pid"), "utf8"),
        );
        if (!Number.isInteger(owner) || !processExists(owner)) {
          await rm(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch (lockError) {
        if (lockError?.code !== "ENOENT") {
          throw lockError;
        }
      }

      console.log("Waiting for another base-path validation to finish...");
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }

  throw new Error("timed out waiting for the base-path validation lock");
}

function runBuild(artifact, basePath) {
  console.log(`\nBuilding ${artifact.label} with BASE_PATH=${basePath}`);
  const result = spawnSync(
    "pnpm",
    ["--filter", artifact.packageName, "run", "build"],
    {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        BASE_PATH: basePath,
        NODE_ENV: "production",
      },
      stdio: "inherit",
    },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${artifact.label} build exited with ${result.status}`);
  }
}

async function getEntrypointReferences(artifact) {
  const indexPath = path.join(
    workspaceRoot,
    artifact.artifactDir,
    artifact.outDir,
    "index.html",
  );
  const html = await readFile(indexPath, "utf8");
  return [...html.matchAll(/(?:src|href)="(\/[^"#?]+(?:\?[^"#]*)?)"/g)].map(
    (match) => match[1],
  );
}

function assertPrefixed(artifact, references, basePath) {
  const bad = references.filter(
    (reference) => !reference.startsWith(basePath),
  );
  if (bad.length > 0) {
    throw new Error(
      `${artifact.label} emitted URLs outside ${basePath}: ${bad.join(", ")}`,
    );
  }
  if (references.length === 0) {
    throw new Error(`${artifact.label} emitted no local entrypoint URLs`);
  }
}

async function waitForServer(url, processHandle, output) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(
        `preview exited before becoming ready\n${output.join("")}`,
      );
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until the preview server opens its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for ${url}\n${output.join("")}`);
}

async function assertRequest(url, expectedKind) {
  const response = await fetch(url, { redirect: "manual" });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (
    expectedKind === "asset" &&
    contentType.toLowerCase().includes("text/html")
  ) {
    throw new Error(`${url} returned HTML instead of an asset`);
  }
}

async function startApiProduction() {
  console.log("\nBuilding and exercising API Server at /api");
  const build = spawnSync(
    "pnpm",
    ["--filter", "@workspace/api-server", "run", "build"],
    {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        NODE_ENV: "production",
      },
      stdio: "inherit",
    },
  );
  if (build.error) {
    throw build.error;
  }
  if (build.status !== 0) {
    throw new Error(`API Server build exited with ${build.status}`);
  }

  const output = [];
  const processHandle = spawn(
    "node",
    [
      "--enable-source-maps",
      "artifacts/api-server/dist/index.mjs",
    ],
    {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: "4177",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  processHandle.stdout.on("data", (chunk) => output.push(chunk.toString()));
  processHandle.stderr.on("data", (chunk) => output.push(chunk.toString()));

  const healthUrl = "http://127.0.0.1:4177/api/healthz";
  try {
    await waitForServer(healthUrl, processHandle, output);
    const response = await fetch(healthUrl);
    const body = await response.json();
    if (!response.ok || body?.status !== "ok") {
      throw new Error(
        `${healthUrl} returned ${response.status}: ${JSON.stringify(body)}`,
      );
    }
  } catch (error) {
    await stopPreview(processHandle);
    throw error;
  }

  console.log("Verified API Server at /api/healthz");
  return processHandle;
}

async function stopPreview(processHandle) {
  if (processHandle.exitCode !== null) {
    return;
  }
  processHandle.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => processHandle.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (processHandle.exitCode === null) {
    processHandle.kill("SIGKILL");
  }
}

async function assertBrowserRoute(page, url, expectedText) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator("#root > *").first().waitFor({ state: "visible" });
  await page.getByText(expectedText, { exact: false }).first().waitFor({
    state: "visible",
  });
}

async function exercisePreview(
  artifact,
  entrypointReferences,
  browser,
  apiOrigin,
) {
  const output = [];
  const processHandle = spawn(
    "pnpm",
    [
      "--filter",
      artifact.packageName,
      "exec",
      "vite",
      "preview",
      "--config",
      "vite.config.ts",
      "--host",
      "127.0.0.1",
      "--port",
      String(artifact.port),
      "--strictPort",
    ],
    {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        BASE_PATH: artifact.testBase,
        PORT: String(artifact.port),
        NODE_ENV: "production",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  processHandle.stdout.on("data", (chunk) => output.push(chunk.toString()));
  processHandle.stderr.on("data", (chunk) => output.push(chunk.toString()));

  const origin = `http://127.0.0.1:${artifact.port}`;
  const rootUrl = `${origin}${artifact.testBase}`;
  const browserFailures = [];
  const page = await browser.newPage();
  if (artifact.proxyApi) {
    await page.route(`${origin}/api/**`, async (route) => {
      const requestUrl = new URL(route.request().url());
      await route.continue({
        url: `${apiOrigin}${requestUrl.pathname}${requestUrl.search}`,
      });
    });
  }
  page.on("requestfailed", (request) => {
    if (request.url().startsWith(origin)) {
      browserFailures.push(
        `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "failed"}`,
      );
    }
  });
  page.on("response", (response) => {
    if (response.url().startsWith(origin) && response.status() >= 400) {
      browserFailures.push(`${response.status()} ${response.url()}`);
    }
  });

  try {
    await waitForServer(rootUrl, processHandle, output);
    await assertRequest(rootUrl, "html");

    await assertBrowserRoute(page, rootUrl, artifact.expectedText);
    for (const deepPath of artifact.deepPaths) {
      const deepUrl = `${rootUrl}${deepPath.path}`;
      await assertRequest(deepUrl, "html");
      await assertBrowserRoute(page, deepUrl, deepPath.expectedText);
    }
    for (const reference of entrypointReferences) {
      await assertRequest(`${origin}${reference}`, "asset");
    }
    for (const asset of artifact.extraAssets) {
      await assertRequest(`${rootUrl}${asset}`, "asset");
    }
    if (browserFailures.length > 0) {
      throw new Error(
        `${artifact.label} browser requests failed:\n${browserFailures.join("\n")}`,
      );
    }
  } finally {
    await page.close();
    await stopPreview(processHandle);
  }
}

const releaseLock = await acquireLock();

try {
  if (process.argv.includes("--clean-build")) {
    runWorkspaceBuild();
  }

  let validationError;
  let browser;
  let apiProcess;

  try {
    apiProcess = await startApiProduction();
    browser = await chromium.launch({ headless: true });
    for (const artifact of artifacts) {
      runBuild(artifact, artifact.testBase);
      const references = await getEntrypointReferences(artifact);
      assertPrefixed(artifact, references, artifact.testBase);
      await exercisePreview(
        artifact,
        references,
        browser,
        "http://127.0.0.1:4177",
      );
      console.log(`Verified ${artifact.label} at ${artifact.testBase}`);
    }
  } catch (error) {
    validationError = error;
  } finally {
    await browser?.close();
    if (apiProcess) {
      await stopPreview(apiProcess);
    }
    console.log("\nRestoring deployable outputs to registered artifact paths");
    for (const artifact of artifacts) {
      try {
        runBuild(artifact, artifact.registeredBase);
        const references = await getEntrypointReferences(artifact);
        assertPrefixed(
          artifact,
          references,
          artifact.registeredOutputBase ?? artifact.registeredBase,
        );
      } catch (error) {
        validationError ??= error;
        console.error(`Failed to restore ${artifact.label}:`, error);
      }
    }
  }

  if (validationError) {
    throw validationError;
  }

  console.log("\nAll artifact base-path checks passed.");
} finally {
  await releaseLock();
}