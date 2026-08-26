# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard-upload.spec.ts >> confirmed contracts persist through reload and reopen with edits intact
- Location: tests/dashboard-upload.spec.ts:311:1

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\/dashboard$/
Received string:  "http://127.0.0.1:5173/review"
Timeout: 5000ms

Call log:
  - Expect "toHaveURL" with timeout 5000ms
    14 × locator resolved to <html lang="en">…</html>
       - unexpected value "http://127.0.0.1:5173/review"

```

```yaml
- complementary:
  - text: Contract Dash Review workspace
  - navigation:
    - link "Contracts":
      - /url: /dashboard
    - link "Action Items":
      - /url: /action-items
  - text: Settings
  - link "Log out":
    - /url: /
- main:
  - textbox "Search contracts..." [disabled]
  - button "Notifications"
  - text: JD
  - button "Back to registry"
  - text: Contract review
  - heading "Resolve the open decisions" [level=1]
  - paragraph: Confirm only what is uncertain. The full extracted record stays available when you need it.
  - button "Confirm review"
  - text: HTTP 404 Not Found Vendor Edited Acme Support Contract value Not stated Value status is unresolved Current term ends 31.12.2026 01.11.2026 notice deadline Source document acme.pdf Embedded text extraction
  - heading "Needs your decision" [level=2]
  - text: 2 open
  - paragraph: Resolve the flagged points below; confirmed fields stay out of your way.
  - article:
    - text: Identity reviewer supplied
    - heading "Vendor legal name" [level=3]
    - paragraph: Which legal entity is the supplier?
    - text: Resolution
    - textbox "Enter a value": Edited Acme
    - paragraph: This name is used across the registry and owner notifications.
    - button "Resolve"
  - article:
    - text: Commercial terms not found
    - heading "Contract value" [level=3]
    - paragraph: What value should the registry track?
    - text: Resolution
    - spinbutton "Amount"
    - textbox "Currency":
      - /placeholder: USD
      - text: USD
    - combobox:
      - option "total contract value"
      - option "annual" [selected]
      - option "monthly"
      - option "per unit"
      - option "not to exceed"
      - option "variable"
    - paragraph: Leave blank to record “not stated”.
    - paragraph: Leave it as not stated when the document provides no reliable value.
    - button "Resolve"
  - button "Full extraction Secondary view · 18 extracted fields":
    - heading "Full extraction" [level=2]
    - paragraph: Secondary view · 18 extracted fields
  - complementary:
    - text: Review progress 80%
    - paragraph: 2 decisions still needs attention.
    - text: Renewal timeline Start negotiation 02.10.2026 Legal notice 01.11.2026 Exit date 31.12.2026 Assignment Owner John Doe Status Review Open Buffer 30 days
    - combobox:
      - option "At Risk"
      - option "Review Open" [selected]
      - option "In Negotiation"
- region "Notifications (F8)":
  - list
```

# Test source

```ts
  320 |       id: string;
  321 |       filename: string;
  322 |       contract: ReturnType<typeof makeContract>;
  323 |     });
  324 |   };
  325 | 
  326 |   await page.route("**/api/contracts/extract", async (route) => {
  327 |     await route.fulfill({
  328 |       status: 200,
  329 |       contentType: "application/json",
  330 |       body: JSON.stringify({
  331 |         filename: "acme.pdf",
  332 |         extraction: {
  333 |           contract,
  334 |           source: "text",
  335 |           ocrConfidence: null,
  336 |           ocrPageCount: null,
  337 |           ocrPagesProcessed: null,
  338 |         },
  339 |       }),
  340 |     });
  341 |   });
  342 | 
  343 |   await page.route("**/api/contracts", async (route) => {
  344 |     const request = route.request();
  345 |     if (request.method() === "GET") {
  346 |       const current = currentSavedResponse();
  347 |       await route.fulfill({
  348 |         status: current ? 200 : 404,
  349 |         contentType: "application/json",
  350 |         body: JSON.stringify(current ?? { error: "Contract not found." }),
  351 |       });
  352 |       return;
  353 |     }
  354 | 
  355 |     if (request.method() === "PUT") {
  356 |       const body = request.postDataJSON() as Record<string, unknown>;
  357 |       savedContract = {
  358 |         id: contractId,
  359 |         ...body,
  360 |         createdAt: "2026-08-25T00:00:00.000Z",
  361 |         updatedAt: "2026-08-25T00:00:00.000Z",
  362 |       };
  363 |       await route.fulfill({
  364 |         status: 201,
  365 |         contentType: "application/json",
  366 |         body: JSON.stringify(currentSavedResponse()),
  367 |       });
  368 |       return;
  369 |     }
  370 | 
  371 |     await route.continue();
  372 |   });
  373 |   await page.route(`**/api/contracts/${contractId}`, async (route) => {
  374 |     const request = route.request();
  375 |     if (request.method() === "GET") {
  376 |       const current = currentSavedResponse();
  377 |       await route.fulfill({
  378 |         status: current ? 200 : 404,
  379 |         contentType: "application/json",
  380 |         body: JSON.stringify(current ?? { error: "Contract not found." }),
  381 |       });
  382 |       return;
  383 |     }
  384 | 
  385 |     if (request.method() === "PUT") {
  386 |       const body = request.postDataJSON() as Record<string, unknown>;
  387 |       savedContract = {
  388 |         ...savedContract,
  389 |         ...body,
  390 |         updatedAt: "2026-08-25T00:01:00.000Z",
  391 |       };
  392 |       await route.fulfill({
  393 |         status: 200,
  394 |         contentType: "application/json",
  395 |         body: JSON.stringify(currentSavedResponse()),
  396 |       });
  397 |       return;
  398 |     }
  399 | 
  400 |     await route.continue();
  401 |   });
  402 | 
  403 |   await page.goto("/dashboard");
  404 |   await page.getByRole("button", { name: "New Contract" }).click();
  405 |   await page.locator("#contract-pdf-file").setInputFiles({
  406 |     name: "acme.pdf",
  407 |     mimeType: "application/pdf",
  408 |     buffer: Buffer.from("%PDF-1.7\ncontract text"),
  409 |   });
  410 |   await page.getByRole("button", { name: "Extract contract" }).click();
  411 |   await expect(page).toHaveURL(/\/review$/);
  412 | 
  413 |   const vendorIssue = page
  414 |     .getByRole("heading", { name: "Vendor legal name", exact: true })
  415 |     .locator("xpath=ancestor::article");
  416 |   const vendorInput = vendorIssue.getByPlaceholder("Enter a value");
  417 |   await expect(vendorIssue.getByText("reviewer supplied", { exact: true })).toBeVisible();
  418 |   await vendorInput.fill("Edited Acme");
  419 |   await page.getByRole("button", { name: "Confirm review" }).click();
> 420 |   await expect(page).toHaveURL(/\/dashboard$/);
      |                      ^ Error: expect(page).toHaveURL(expected) failed
  421 |   await expect(page.getByText("Edited Acme")).toBeVisible();
  422 | 
  423 |   await page.reload();
  424 |   await expect(page.getByText("Edited Acme")).toBeVisible();
  425 |   const unknownValue = page
  426 |     .getByRole("row")
  427 |     .filter({ hasText: "Edited Acme" })
  428 |     .locator("div.text-destructive")
  429 |     .filter({ hasText: "Value not stated" })
  430 |     .first();
  431 |   await expect(unknownValue).toBeVisible();
  432 |   await expect(unknownValue).toHaveClass(/text-destructive/);
  433 |   await expect(page.getByText("John Doe", { exact: true })).toBeVisible();
  434 | 
  435 |   await page
  436 |     .getByRole("row")
  437 |     .filter({ hasText: "Edited Acme" })
  438 |     .getByRole("button", { name: "Edited Acme", exact: true })
  439 |     .click();
  440 |   await expect(page).toHaveURL(new RegExp(`/review\\?id=${contractId}$`));
  441 |   await expect(vendorInput).toHaveValue("Edited Acme");
  442 |   const contractValueField = page
  443 |     .getByRole("heading", { name: "Contract value", exact: true })
  444 |     .locator("xpath=ancestor::article");
  445 |   await expect(contractValueField.getByText("not found", { exact: true })).toHaveClass(
  446 |     /text-destructive/,
  447 |   );
  448 |   await expect(page.getByText("John Doe", { exact: true })).toBeVisible();
  449 | });
  450 | 
  451 | test("keeps standalone contract rows reachable on narrow screens", async ({ page }) => {
  452 |   const rootId = "saved-family-parent";
  453 |   const amendmentId = "saved-family-amendment";
  454 |   const parentContract = makeContract({
  455 |     vendor: "Legacy Parent Vendor",
  456 |     contractNumber: "PARENT-001",
  457 |     contractTitle: "Original Support Agreement",
  458 |     contractValue: { amount: 120000, currency: "USD", basis: "annual" },
  459 |   });
  460 |   const amendmentBase = makeContract({
  461 |     vendor: "Northstar Sourcing GmbH",
  462 |     contractNumber: "PARENT-001",
  463 |     contractTitle: "Northstar & Sourcing Agreement — C&A + 100%",
  464 |     contractType: "software_license",
  465 |     contractValue: { amount: 240000, currency: "USD", basis: "annual" },
  466 |   });
  467 |   const amendmentContract = {
  468 |     ...amendmentBase,
  469 |     fields: {
  470 |       ...amendmentBase.fields,
  471 |       vendorLegalName: reviewerEdited("Northstar Sourcing GmbH"),
  472 |       initialTermEndDate: provenance("2027-12-31"),
  473 |       renewalMechanism: provenance("manual_renewal"),
  474 |       noticePeriod: provenance({
  475 |         amount: 90,
  476 |         unit: "days",
  477 |         anchor: "term_end",
  478 |         purpose: "non_renewal",
  479 |       }),
  480 |     },
  481 |     assignment: {
  482 |       ...amendmentBase.assignment,
  483 |       owner: "Avery Stone",
  484 |     },
  485 |     computed: {
  486 |       ...amendmentBase.computed,
  487 |       noticeDeadline: "2027-10-02",
  488 |       actionDate: "2027-09-02",
  489 |     },
  490 |   };
  491 |   const savedContracts = [
  492 |     {
  493 |       id: rootId,
  494 |       filename: "parent-agreement.pdf",
  495 |       documentType: "master_agreement",
  496 |       contract: parentContract,
  497 |     },
  498 |     {
  499 |       id: amendmentId,
  500 |       filename: "commercial-amendment.pdf",
  501 |       documentType: "amendment",
  502 |       contract: amendmentContract,
  503 |     },
  504 |   ];
  505 |   const specialSearch = "C&A + 100%";
  506 |   let listRequests = 0;
  507 | 
  508 |   await page.route("**/api/contracts", async (route) => {
  509 |     if (route.request().method() === "GET") {
  510 |       listRequests += 1;
  511 |       await route.fulfill({ json: savedContracts });
  512 |       return;
  513 |     }
  514 |     await route.continue();
  515 |   });
  516 | 
  517 |   await page.setViewportSize({ width: 375, height: 800 });
  518 |   await page.goto("/dashboard");
  519 | 
  520 |   const headers = page.locator("table thead th");
```