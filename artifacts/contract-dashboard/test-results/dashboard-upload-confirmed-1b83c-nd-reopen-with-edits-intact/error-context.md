# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard-upload.spec.ts >> confirmed contracts persist through reload and reopen with edits intact
- Location: tests/dashboard-upload.spec.ts:301:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.fill: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByPlaceholder('e.g. Acme Corp LLC')

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e4]:
    - heading "Something went wrong" [level=1] [ref=e5]
    - paragraph [ref=e6]: This part of the app hit an error. The rest of the app is still running.
    - generic [ref=e7]: Cannot read properties of undefined (reading 'trim')
    - button "Try again" [ref=e8]
  - region "Notifications (F8)":
    - list
```

# Test source

```ts
  293 |     },
  294 |   });
  295 |   await expect(page.getByText("Northstar Sourcing GmbH", { exact: true })).toBeVisible();
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
> 393 |   await vendorInput.fill("Edited Acme");
      |                     ^ Error: locator.fill: Test timeout of 30000ms exceeded.
  394 |   await page.getByRole("button", { name: "Confirm contract" }).click();
  395 |   await expect(page).toHaveURL(/\/dashboard$/);
  396 |   await expect(page.getByText("Edited Acme")).toBeVisible();
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
  416 | 
  417 | test("keeps the family registry schema and effective values reachable on narrow screens", async ({ page }) => {
  418 |   const rootId = "saved-family-parent";
  419 |   const amendmentId = "saved-family-amendment";
  420 |   const parentContract = makeContract({
  421 |     vendor: "Legacy Parent Vendor",
  422 |     contractNumber: "PARENT-001",
  423 |     contractTitle: "Original Support Agreement",
  424 |     contractValue: { amount: 120000, currency: "USD", basis: "annual" },
  425 |   });
  426 |   const effectiveBase = makeContract({
  427 |     vendor: "Northstar Sourcing GmbH",
  428 |     contractNumber: "PARENT-001",
  429 |     contractTitle: "Sourcing Agreement",
  430 |     contractType: "software_license",
  431 |     contractValue: { amount: 240000, currency: "USD", basis: "annual" },
  432 |   });
  433 |   const effectiveContract = {
  434 |     ...effectiveBase,
  435 |     fields: {
  436 |       ...effectiveBase.fields,
  437 |       initialTermEndDate: provenance("2027-12-31"),
  438 |       renewalMechanism: provenance("manual_renewal"),
  439 |       noticePeriod: provenance({
  440 |         amount: 90,
  441 |         unit: "days",
  442 |         anchor: "term_end",
  443 |         purpose: "non_renewal",
  444 |       }),
  445 |     },
  446 |     assignment: {
  447 |       ...effectiveBase.assignment,
  448 |       owner: "Avery Stone",
  449 |     },
  450 |     computed: {
  451 |       ...effectiveBase.computed,
  452 |       noticeDeadline: "2027-10-02",
  453 |       actionDate: "2027-09-02",
  454 |     },
  455 |   };
  456 |   const familyField = (value: unknown, sourceDocumentId: string, sourceFilename: string) => ({
  457 |     value,
  458 |     sourceDocumentId,
  459 |     sourceFilename,
  460 |   });
  461 |   const family = {
  462 |     id: rootId,
  463 |     documentCount: 2,
  464 |     effectiveContract,
  465 |     documents: [
  466 |       {
  467 |         id: rootId,
  468 |         filename: "parent-agreement.pdf",
  469 |         documentType: "master_agreement",
  470 |         effectiveDate: "2026-01-01",
  471 |         isParent: true,
  472 |         isCurrent: false,
  473 |         fieldValues: {
  474 |           vendorLegalName: familyField("Legacy Parent Vendor", rootId, "parent-agreement.pdf"),
  475 |           contractValue: familyField({ amount: 120000, currency: "USD", basis: "annual" }, rootId, "parent-agreement.pdf"),
  476 |           noticePeriod: familyField({ amount: 60, unit: "days", anchor: "term_end", purpose: "non_renewal" }, rootId, "parent-agreement.pdf"),
  477 |           renewalMechanism: familyField("auto_renew", rootId, "parent-agreement.pdf"),
  478 |           initialTermEndDate: familyField("2026-12-31", rootId, "parent-agreement.pdf"),
  479 |         },
  480 |       },
  481 |       {
  482 |         id: amendmentId,
  483 |         filename: "commercial-amendment.pdf",
  484 |         documentType: "amendment",
  485 |         effectiveDate: "2027-01-01",
  486 |         isParent: false,
  487 |         isCurrent: true,
  488 |         fieldValues: {
  489 |           vendorLegalName: familyField("Northstar Sourcing GmbH", amendmentId, "commercial-amendment.pdf"),
  490 |           contractValue: familyField({ amount: 240000, currency: "USD", basis: "annual" }, amendmentId, "commercial-amendment.pdf"),
  491 |           noticePeriod: familyField({ amount: 90, unit: "days", anchor: "term_end", purpose: "non_renewal" }, amendmentId, "commercial-amendment.pdf"),
  492 |           renewalMechanism: familyField("manual_renewal", amendmentId, "commercial-amendment.pdf"),
  493 |           initialTermEndDate: familyField("2027-12-31", amendmentId, "commercial-amendment.pdf"),
```