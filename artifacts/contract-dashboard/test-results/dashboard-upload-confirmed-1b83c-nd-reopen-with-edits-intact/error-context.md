# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard-upload.spec.ts >> confirmed contracts persist through reload and reopen with edits intact
- Location: tests/dashboard-upload.spec.ts:301:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Edited Acme')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByText('Edited Acme')

```

```yaml
- heading "Something went wrong" [level=1]
- paragraph: This part of the app hit an error. The rest of the app is still running.
- text: Cannot read properties of undefined (reading 'id')
- button "Try again"
- region "Notifications (F8)":
  - list
```

# Test source

```ts
  296 | 
  297 |   await page.reload();
  298 |   await expect(page.getByText("Northstar Sourcing GmbH", { exact: true })).toBeVisible();
  299 | });
  300 | 
  301 | test("confirmed contracts persist through reload and reopen with edits intact", async ({ page }) => {
  302 |   const contractId = "saved-contract-regression";
  303 |   let savedContract: Record<string, unknown> | null = null;
  304 |   const contract = makeContract();
  305 | 
  306 |   await page.route("**/api/contracts/extract", async (route) => {
  307 |     await route.fulfill({
  308 |       status: 200,
  309 |       contentType: "application/json",
  310 |       body: JSON.stringify({
  311 |         filename: "acme.pdf",
  312 |         extraction: {
  313 |           contract,
  314 |           source: "text",
  315 |           ocrConfidence: null,
  316 |           ocrPageCount: null,
  317 |           ocrPagesProcessed: null,
  318 |         },
  319 |       }),
  320 |     });
  321 |   });
  322 | 
  323 |   await page.route("**/api/contracts", async (route) => {
  324 |     const request = route.request();
  325 | 
  326 |     if (request.method() === "GET") {
  327 |       await route.fulfill({
  328 |         status: 200,
  329 |         contentType: "application/json",
  330 |         body: JSON.stringify(savedContract ? [savedContract] : []),
  331 |       });
  332 |       return;
  333 |     }
  334 | 
  335 |     if (request.method() === "POST") {
  336 |       const body = request.postDataJSON() as Record<string, unknown>;
  337 |       savedContract = {
  338 |         id: contractId,
  339 |         ...body,
  340 |         createdAt: "2026-08-25T00:00:00.000Z",
  341 |         updatedAt: "2026-08-25T00:00:00.000Z",
  342 |       };
  343 |       await route.fulfill({
  344 |         status: 201,
  345 |         contentType: "application/json",
  346 |         body: JSON.stringify(savedContract),
  347 |       });
  348 |       return;
  349 |     }
  350 | 
  351 |     await route.continue();
  352 |   });
  353 |   await page.route(`**/api/contracts/${contractId}`, async (route) => {
  354 |     const request = route.request();
  355 |     if (request.method() === "GET") {
  356 |       await route.fulfill({
  357 |         status: savedContract ? 200 : 404,
  358 |         contentType: "application/json",
  359 |         body: JSON.stringify(savedContract ?? { error: "Contract not found." }),
  360 |       });
  361 |       return;
  362 |     }
  363 | 
  364 |     if (request.method() === "PUT") {
  365 |       const body = request.postDataJSON() as Record<string, unknown>;
  366 |       savedContract = {
  367 |         ...savedContract,
  368 |         ...body,
  369 |         updatedAt: "2026-08-25T00:01:00.000Z",
  370 |       };
  371 |       await route.fulfill({
  372 |         status: 200,
  373 |         contentType: "application/json",
  374 |         body: JSON.stringify(savedContract),
  375 |       });
  376 |       return;
  377 |     }
  378 | 
  379 |     await route.continue();
  380 |   });
  381 | 
  382 |   await page.goto("/dashboard");
  383 |   await page.getByRole("button", { name: "New Contract" }).click();
  384 |   await page.locator("#contract-pdf-file").setInputFiles({
  385 |     name: "acme.pdf",
  386 |     mimeType: "application/pdf",
  387 |     buffer: Buffer.from("%PDF-1.7\ncontract text"),
  388 |   });
  389 |   await page.getByRole("button", { name: "Extract contract" }).click();
  390 |   await expect(page).toHaveURL(/\/review$/);
  391 | 
  392 |   const vendorInput = page.getByPlaceholder("e.g. Acme Corp LLC");
  393 |   await vendorInput.fill("Edited Acme");
  394 |   await page.getByRole("button", { name: "Confirm contract" }).click();
  395 |   await expect(page).toHaveURL(/\/dashboard$/);
> 396 |   await expect(page.getByText("Edited Acme")).toBeVisible();
      |                                               ^ Error: expect(locator).toBeVisible() failed
  397 | 
  398 |   await page.reload();
  399 |   await expect(page.getByText("Edited Acme")).toBeVisible();
  400 |   const unknownValue = page.getByText("Unknown / not stated");
  401 |   await expect(unknownValue).toBeVisible();
  402 |   await expect(unknownValue).toHaveClass(/text-destructive/);
  403 |   await expect(page.getByText("John Doe", { exact: true })).toBeVisible();
  404 | 
  405 |   await page.getByRole("row").filter({ hasText: "Edited Acme" }).click();
  406 |   await expect(page).toHaveURL(new RegExp(`/review\\?id=${contractId}$`));
  407 |   await expect(vendorInput).toHaveValue("Edited Acme");
  408 |   const contractValueField = page
  409 |     .getByText("Contract Value", { exact: true })
  410 |     .locator("xpath=../..");
  411 |   await expect(contractValueField.getByText("not found", { exact: true })).toHaveClass(
  412 |     /text-destructive/,
  413 |   );
  414 |   await expect(page.getByPlaceholder("e.g. John Doe")).toHaveValue("John Doe");
  415 | });
```