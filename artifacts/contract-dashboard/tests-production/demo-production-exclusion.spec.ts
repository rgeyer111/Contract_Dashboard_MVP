import { expect, test } from "@playwright/test";

test("production includes the isolated read-only demo entry", async ({ page }) => {
  const contractSources: string[] = [];
  await page.route("**/api/contracts", (route) => {
    contractSources.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: [] });
  });
  await page.route("**/api/demo/contracts", (route) => {
    contractSources.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: [] });
  });
  await page.route("**/api/registry-views", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/contracts/ingest-runs/current", (route) => route.fulfill({ json: null }));

  await page.goto("/");
  await expect(page.getByTestId("link-demo-dashboard")).toBeVisible();
  await expect(page.getByText("Demo only", { exact: true })).toBeVisible();

  await page.goto("/dashboard?demo=1");
  await expect(page.getByTestId("banner-demo-mode")).toBeVisible();
  await expect(page.getByTestId("contract-registry-empty")).toContainText("No confirmed contracts yet");
  expect(contractSources).toEqual(["/api/demo/contracts"]);
});