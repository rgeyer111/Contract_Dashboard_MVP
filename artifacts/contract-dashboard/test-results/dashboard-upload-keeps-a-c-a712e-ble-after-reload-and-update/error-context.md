# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard-upload.spec.ts >> keeps a confirmed contract available after reload and update
- Location: tests/dashboard-upload.spec.ts:202:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 0
+ Received  + 1

@@ -196,6 +196,7 @@
          "value": "Northstar Sourcing",
        },
      },
    },
    "filename": "northstar.pdf",
+   "parentContractId": null,
  }
```

# Page snapshot

```yaml
- generic [ref=f1e2]:
  - generic [ref=f1e4]:
    - heading "Something went wrong" [level=1] [ref=f1e5]
    - paragraph [ref=f1e6]: This part of the app hit an error. The rest of the app is still running.
    - generic [ref=f1e7]: Cannot read properties of undefined (reading 'id')
    - button "Try again" [ref=f1e8]
  - region "Notifications (F8)":
    - list
```

# Test source

```ts
  169 | 
  170 |   await page.goto("/dashboard");
  171 |   for (const level of ["High", "Medium", "Low"] as const) {
  172 |     source = "ocr";
  173 |     ocrConfidence = level;
  174 |     await page.getByRole("button", { name: "New Contract" }).click();
  175 |     await page.locator("#contract-pdf-file").setInputFiles({
  176 |       name: `${level.toLowerCase()}-scan.pdf`,
  177 |       mimeType: "application/pdf",
  178 |       buffer: Buffer.from("%PDF-1.7\nscanned contract"),
  179 |     });
  180 |     await page.getByRole("button", { name: "Extract contract" }).click();
  181 |     await expect(page).toHaveURL(/\/review$/);
  182 |     const warning = page
  183 |       .locator("div.mt-4.inline-flex")
  184 |       .filter({ hasText: "OCR used for this scan" });
  185 |     await expect(warning).toContainText("OCR used for this scan");
  186 |     await expect(warning).toContainText(`${level} legibility`);
  187 |     await page.goto("/dashboard");
  188 |   }
  189 | 
  190 |   source = "text";
  191 |   await page.getByRole("button", { name: "New Contract" }).click();
  192 |   await page.locator("#contract-pdf-file").setInputFiles({
  193 |     name: "embedded-text.pdf",
  194 |     mimeType: "application/pdf",
  195 |     buffer: Buffer.from("%PDF-1.7\nembedded contract text"),
  196 |   });
  197 |   await page.getByRole("button", { name: "Extract contract" }).click();
  198 |   await expect(page).toHaveURL(/\/review$/);
  199 |   await expect(page.getByText(/OCR used for this scan/)).toHaveCount(0);
  200 | });
  201 | 
  202 | test("keeps a confirmed contract available after reload and update", async ({ page }) => {
  203 |   const contract = makeContract({
  204 |     vendor: "Northstar Sourcing",
  205 |     contractNumber: "NS-2026-014",
  206 |     contractTitle: "Sourcing Agreement",
  207 |     contractType: "software_license",
  208 |     contractValue: { amount: 240000, currency: "USD", basis: "annual" },
  209 |   });
  210 |   const saved = {
  211 |     id: "saved-northstar-contract",
  212 |     filename: "northstar.pdf",
  213 |     contract,
  214 |     createdAt: "2026-01-01T00:00:00.000Z",
  215 |     updatedAt: "2026-01-01T00:00:00.000Z",
  216 |   };
  217 |   let createPayload: Record<string, unknown> | undefined;
  218 |   let updatePayload: Record<string, unknown> | undefined;
  219 | 
  220 |   await page.route("**/api/contracts", async (route) => {
  221 |     if (route.request().method() === "GET") {
  222 |       return route.fulfill({ json: [saved] });
  223 |     }
  224 |     if (route.request().method() === "POST") {
  225 |       const body = route.request().postDataJSON();
  226 |       createPayload = body;
  227 |       saved.filename = body.filename;
  228 |       saved.contract = body.contract;
  229 |       return route.fulfill({ status: 201, json: saved });
  230 |     }
  231 |     return route.continue();
  232 |   });
  233 |   await page.route("**/api/contracts/saved-northstar-contract", async (route) => {
  234 |     if (route.request().method() === "GET") {
  235 |       return route.fulfill({ json: saved });
  236 |     }
  237 |     if (route.request().method() === "PUT") {
  238 |       const body = route.request().postDataJSON();
  239 |       updatePayload = body;
  240 |       saved.filename = body.filename;
  241 |       saved.contract = body.contract;
  242 |       saved.updatedAt = "2026-01-02T00:00:00.000Z";
  243 |       return route.fulfill({ json: saved });
  244 |     }
  245 |     return route.continue();
  246 |   });
  247 | 
  248 |   await page.goto("/review");
  249 |   await page.evaluate(({ filename, contract }) => {
  250 |     sessionStorage.setItem(
  251 |       "contract-dashboard.extraction",
  252 |       JSON.stringify({
  253 |         filename,
  254 |         extraction: {
  255 |           contract,
  256 |           source: "text",
  257 |           ocrConfidence: null,
  258 |           ocrPageCount: null,
  259 |           ocrPagesProcessed: null,
  260 |         },
  261 |       }),
  262 |     );
  263 |   }, saved);
  264 |   await page.reload();
  265 | 
  266 |   await expect(page.getByRole("button", { name: "Confirm contract" })).toBeEnabled();
  267 |   await page.getByRole("button", { name: "Confirm contract" }).click();
  268 |   await expect(page).toHaveURL(/\/dashboard$/);
> 269 |   expect(createPayload).toEqual({
      |                         ^ Error: expect(received).toEqual(expected) // deep equality
  270 |     filename: "northstar.pdf",
  271 |     contract,
  272 |   });
  273 |   await expect(page.getByText("Northstar Sourcing", { exact: true })).toBeVisible();
  274 | 
  275 |   await page.reload();
  276 |   await expect(page.getByText("Northstar Sourcing", { exact: true })).toBeVisible();
  277 |   await page.getByText("Northstar Sourcing", { exact: true }).click();
  278 |   await expect(page).toHaveURL(/\/review\?id=saved-northstar-contract$/);
  279 |   const vendorInput = page.getByPlaceholder("e.g. Acme Corp LLC");
  280 |   await expect(vendorInput).toBeVisible();
  281 | 
  282 |   await vendorInput.fill("Northstar Sourcing GmbH");
  283 |   await page.getByRole("button", { name: "Confirm contract" }).click();
  284 |   await expect(page).toHaveURL(/\/dashboard$/);
  285 |   expect(updatePayload).toEqual({
  286 |     filename: "northstar.pdf",
  287 |     contract: {
  288 |       ...contract,
  289 |       fields: {
  290 |         ...contract.fields,
  291 |         vendorLegalName: reviewerEdited("Northstar Sourcing GmbH"),
  292 |       },
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
```