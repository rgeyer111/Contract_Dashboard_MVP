import { expect, test } from "@playwright/test";

test("production excludes the demo entry and ignores a forged demo query", async ({ page }) => {
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

  await page.goto("/?demo=1");
  await expect(page.getByTestId("link-demo-dashboard")).toHaveCount(0);
  await expect(page.getByText("Demo only", { exact: true })).toHaveCount(0);

  await page.goto("/dashboard?demo=1");
  await expect(page.getByTestId("banner-demo-mode")).toHaveCount(0);
  await expect(page.getByTestId("contract-registry-empty")).toContainText("No confirmed contracts yet");
  expect(contractSources).toEqual(["/api/contracts"]);
});