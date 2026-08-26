# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard-upload.spec.ts >> keeps a confirmed contract available after reload and update
- Location: tests/dashboard-upload.spec.ts:223:1

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\/review$/
Received string:  "http://127.0.0.1:5173/dashboard"
Timeout: 5000ms

Call log:
  - Expect "toHaveURL" with timeout 5000ms
    14 × locator resolved to <html lang="en">…</html>
       - unexpected value "http://127.0.0.1:5173/dashboard"

```

```yaml
- complementary:
  - text: Contract Dash
  - navigation:
    - link "Contracts":
      - /url: /dashboard
    - text: Renewals
    - link "Action Items":
      - /url: /action-items
  - text: Settings
  - link "Log out":
    - /url: /
- main:
  - textbox "Search contracts":
    - /placeholder: Search contracts...
  - button
  - text: JD
  - heading "Welcome back, John" [level=1]
  - paragraph: Here's the status of your contract renewals this week.
  - button "New Contract"
  - region "Upload a PDF to extract its details":
    - text: New contract
    - heading "Upload a PDF to extract its details" [level=2]
    - paragraph: We'll prepare an editable draft with confidence ratings for every field.
    - button "Close contract upload"
    - button "1 PDF selected acme.pdf"
    - text: 1 PDF selected acme.pdf Ingest run 1/1 complete acme.pdf HTTP 404 Not Found
    - paragraph: Your PDF is used to create an editable review draft. Confirmed details are saved securely.
    - button "Extract contract"
  - text: Critical Renewals 0
  - paragraph: Past the legal notice deadline
  - text: Upcoming 1
  - paragraph: Total Active Contracts
  - button "Action Items 0 Open action items":
    - text: Action Items 0
    - paragraph: Open action items
  - heading "Contract Registry" [level=2]
  - text: Document type
  - combobox "Filter by document type":
    - option "All document types (1)" [selected]
    - option "master agreement (1)"
    - option "order form (0)"
    - option "sow (0)"
    - option "amendment (0)"
    - option "renewal letter (0)"
    - option "termination notice (0)"
    - option "quote or proposal (0)"
    - option "unknown (0)"
  - button "View All"
  - text: All documents 1 master agreement 1 order form 0 sow 0 amendment 0 renewal letter 0 termination notice 0 quote or proposal 0 unknown 0
  - table:
    - rowgroup:
      - row "Contract / commercial context Renewal Notice runway Owner Signal":
        - columnheader "Contract / commercial context"
        - columnheader "Renewal"
        - columnheader "Notice runway"
        - columnheader "Owner"
        - columnheader "Signal"
    - rowgroup:
      - row "Northstar Sourcing Support maintenance · Value not stated Needs review 2026-12-31 auto renew 60 days before term end Deadline 2026-11-01 John Doe Contract owner green":
        - cell "Northstar Sourcing Support maintenance · Value not stated Needs review":
          - button "Northstar Sourcing"
          - text: Support maintenance · Value not stated Needs review
        - cell "2026-12-31 auto renew"
        - cell "60 days before term end Deadline 2026-11-01"
        - cell "John Doe Contract owner"
        - cell "green"
- region "Notifications (F8)":
  - list
```

# Test source

```ts
  179 |       status: 200,
  180 |       contentType: "application/json",
  181 |       body: JSON.stringify({
  182 |         filename: "scan.pdf",
  183 |         extraction: {
  184 |           contract,
  185 |           source,
  186 |           ocrConfidence: source === "ocr" ? ocrConfidence : null,
  187 |           ocrPageCount: source === "ocr" ? 1 : null,
  188 |           ocrPagesProcessed: source === "ocr" ? 1 : null,
  189 |         },
  190 |       }),
  191 |     });
  192 |   });
  193 | 
  194 |   await page.goto("/dashboard");
  195 |   for (const level of ["High", "Medium", "Low"] as const) {
  196 |     source = "ocr";
  197 |     ocrConfidence = level;
  198 |     await page.getByRole("button", { name: "New Contract" }).click();
  199 |     await page.locator("#contract-pdf-file").setInputFiles({
  200 |       name: `${level.toLowerCase()}-scan.pdf`,
  201 |       mimeType: "application/pdf",
  202 |       buffer: Buffer.from("%PDF-1.7\nscanned contract"),
  203 |     });
  204 |     await page.getByRole("button", { name: "Extract contract" }).click();
  205 |     await expect(page).toHaveURL(/\/review$/);
  206 |     await expect(page.getByText(`OCR · ${level} legibility`, { exact: true })).toBeVisible();
  207 |     await page.goto("/dashboard");
  208 |   }
  209 | 
  210 |   source = "text";
  211 |   await page.getByRole("button", { name: "New Contract" }).click();
  212 |   await page.locator("#contract-pdf-file").setInputFiles({
  213 |     name: "embedded-text.pdf",
  214 |     mimeType: "application/pdf",
  215 |     buffer: Buffer.from("%PDF-1.7\nembedded contract text"),
  216 |   });
  217 |   await page.getByRole("button", { name: "Extract contract" }).click();
  218 |   await expect(page).toHaveURL(/\/review$/);
  219 |   await expect(page.getByText("Embedded text extraction", { exact: true })).toBeVisible();
  220 |   await expect(page.getByText(/^OCR · /)).toHaveCount(0);
  221 | });
  222 | 
  223 | test("keeps a confirmed contract available after reload and update", async ({ page }) => {
  224 |   const contract = makeContract();
  225 |   contract.fields.vendorLegalName = reviewerEdited("Northstar Sourcing");
  226 |   const saved = {
  227 |     id: "saved-northstar-contract",
  228 |     filename: "northstar.pdf",
  229 |     contract,
  230 |     createdAt: "2026-01-01T00:00:00.000Z",
  231 |     updatedAt: "2026-01-01T00:00:00.000Z",
  232 |   };
  233 |   let createPayload: Record<string, unknown> | undefined;
  234 |   let updatePayload: Record<string, unknown> | undefined;
  235 | 
  236 |   await page.route("**/api/contracts", async (route) => {
  237 |     if (route.request().method() === "GET") {
  238 |       return route.fulfill({ json: [savedResponse(saved)] });
  239 |     }
  240 |     if (route.request().method() === "POST") {
  241 |       const body = request.postDataJSON() as Record<string, unknown>;
  242 |       createPayload = body;
  243 |       saved.filename = body.filename;
  244 |       saved.contract = body.contract;
  245 |       return route.fulfill({ status: 201, json: savedResponse(saved) });
  246 |     }
  247 |     return route.continue();
  248 |   });
  249 |   await page.route("**/api/contracts/saved-northstar-contract", async (route) => {
  250 |     if (route.request().method() === "GET") {
  251 |       return route.fulfill({ json: savedResponse(saved) });
  252 |     }
  253 |     if (route.request().method() === "PUT") {
  254 |       const body = request.postDataJSON() as Record<string, unknown>;
  255 |       savedContract = {
  256 |         ...savedContract,
  257 |         ...body,
  258 |         updatedAt: "2026-08-25T00:01:00.000Z",
  259 |       };
  260 |       await route.fulfill({
  261 |         status: 200,
  262 |         contentType: "application/json",
  263 |         body: JSON.stringify(currentSavedResponse()),
  264 |       });
  265 |       return;
  266 |     }
  267 | 
  268 |     await route.continue();
  269 |   });
  270 | 
  271 |   await page.goto("/dashboard");
  272 |   await page.getByRole("button", { name: "New Contract" }).click();
  273 |   await page.locator("#contract-pdf-file").setInputFiles({
  274 |     name: "acme.pdf",
  275 |     mimeType: "application/pdf",
  276 |     buffer: Buffer.from("%PDF-1.7\ncontract text"),
  277 |   });
  278 |   await page.getByRole("button", { name: "Extract contract" }).click();
> 279 |   await expect(page).toHaveURL(/\/review$/);
      |                      ^ Error: expect(page).toHaveURL(expected) failed
  280 | 
  281 |   const vendorIssue = page
  282 |     .getByRole("heading", { name: "Vendor legal name", exact: true })
  283 |     .locator("xpath=ancestor::article");
  284 |   const vendorInput = vendorIssue.getByPlaceholder("Enter a value");
  285 |   await expect(vendorInput).toBeVisible();
  286 |   await expect(vendorIssue.getByText("reviewer supplied", { exact: true })).toBeVisible();
  287 | 
  288 |   await vendorInput.fill("Northstar Sourcing GmbH");
  289 |   await vendorIssue.getByRole("button", { name: "Resolve" }).click();
  290 |   await page.getByRole("button", { name: "Confirm review" }).click();
  291 |   await expect(page).toHaveURL(/\/dashboard$/);
  292 |   expect(updatePayload).toEqual({
  293 |     filename: "northstar.pdf",
  294 |     contract: {
  295 |       ...contract,
  296 |       fields: {
  297 |         ...contract.fields,
  298 |         vendorLegalName: {
  299 |           ...reviewerEdited("Northstar Sourcing GmbH"),
  300 |           reviewed: true,
  301 |         },
  302 |       },
  303 |     },
  304 |   });
  305 |   await expect(page.getByText("Northstar Sourcing GmbH", { exact: true })).toBeVisible();
  306 | 
  307 |   await page.reload();
  308 |   await expect(page.getByText("Northstar Sourcing GmbH", { exact: true })).toBeVisible();
  309 | });
  310 | 
  311 | test("confirmed contracts persist through reload and reopen with edits intact", async ({ page }) => {
  312 |   const contractId = "saved-contract-regression";
  313 |   let savedContract: Record<string, unknown> | null = null;
  314 |   const contract = makeContract();
  315 |   contract.fields.vendorLegalName = reviewerEdited("Acme");
  316 | 
  317 |   const currentSavedResponse = () => {
  318 |     if (!savedContract) return null;
  319 |     return savedResponse(savedContract as {
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
```