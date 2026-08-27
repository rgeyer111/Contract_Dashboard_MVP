import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const demoFixture = JSON.parse(
  readFileSync(new URL("../../api-server/src/demo/tea-23-demo-register.json", import.meta.url), "utf8"),
) as { records: unknown[] };
const demoRecords = demoFixture.records;

test("demo navigation, reloads, and filters stay isolated from real APIs", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) requested.push(new URL(request.url()).pathname);
  });
  await page.route("**/api/demo/contracts", (route) => route.fulfill({ json: demoRecords }));

  await page.goto("/");
  await expect(page.getByTestId("link-demo-dashboard")).toHaveText("Demo only");
  await page.getByTestId("link-demo-dashboard").click();
  await expect(page).toHaveURL(/\/dashboard\?demo=1/);
  await expect(page.getByTestId("banner-demo-mode")).toBeVisible();
  await expect(page.getByTestId("contract-registry")).toContainText("Helvetic Analytics AG");
  await expect(page.getByText("New Contract")).toHaveCount(0);
  await expect(page.getByText("Saved views")).toHaveCount(0);
  await expect(page.getByTestId("contract-type-select-tea23-quarter-end")).toBeDisabled();

  await page.getByLabel("Search contracts").fill("Helvetic");
  await expect(page).toHaveURL(/demo=1/);
  await expect(page).toHaveURL(/search=Helvetic/);
  await page.getByTestId("link-action-items").click();
  await expect(page).toHaveURL(/\/action-items\?.*demo=1/);
  await expect(page.getByRole("button", { name: "Dismiss", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Send now", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("banner-demo-mode")).toBeVisible();
  await page.getByTestId("link-dashboard").click();
  await expect(page).toHaveURL(/\/dashboard\?.*demo=1/);
  expect(requested.every((path) => path === "/api/demo/contracts")).toBe(true);
});

test("demo mode and filters survive browser Back and Forward", async ({ page }) => {
  await page.route("**/api/demo/contracts", (route) => route.fulfill({ json: demoRecords }));

  await page.goto("/dashboard?demo=1");
  await expect(page.getByTestId("banner-demo-mode")).toBeVisible();

  await page.getByLabel("Search contracts").fill("Helvetic");
  await expect(page).toHaveURL(/demo=1/);
  await expect(page).toHaveURL(/search=Helvetic/);

  await page.getByLabel("Filter by document type").selectOption("master_agreement");
  await expect(page).toHaveURL(/documentType=master_agreement/);
  await expect(page.getByTestId("contract-registry")).toContainText("Helvetic Analytics AG");

  await page.goBack();
  await expect(page).toHaveURL(/demo=1/);
  await expect(page).toHaveURL(/search=Helvetic/);
  await expect(page).not.toHaveURL(/documentType=/);
  await expect(page.getByLabel("Search contracts")).toHaveValue("Helvetic");
  await expect(page.getByLabel("Filter by document type")).toHaveValue("");
  await expect(page.getByTestId("banner-demo-mode")).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/demo=1/);
  await expect(page).not.toHaveURL(/[?&]search=/);
  await expect(page.getByLabel("Search contracts")).toHaveValue("");
  await expect(page.getByTestId("banner-demo-mode")).toBeVisible();

  await page.goForward();
  await expect(page.getByLabel("Search contracts")).toHaveValue("Helvetic");
  await expect(page.getByTestId("banner-demo-mode")).toBeVisible();
  await page.goForward();
  await expect(page.getByLabel("Filter by document type")).toHaveValue("master_agreement");
  await expect(page.getByTestId("banner-demo-mode")).toBeVisible();
});

test("normal dashboard renders an empty real registry without requesting demo contracts", async ({ page }) => {
  const contractSources: string[] = [];
  await page.route("**/api/contracts", (route) => {
    contractSources.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: [] });
  });
  await page.route("**/api/demo/contracts", (route) => {
    contractSources.push(new URL(route.request().url()).pathname);
    return route.abort();
  });
  await page.route("**/api/registry-views", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/contracts/ingest-runs/current", (route) => route.fulfill({ json: null }));

  await page.goto("/dashboard");

  await expect(page.getByTestId("contract-registry-empty")).toContainText("No confirmed contracts yet");
  await expect(page.getByTestId("banner-demo-mode")).toHaveCount(0);
  expect(contractSources).toEqual(["/api/contracts"]);
});