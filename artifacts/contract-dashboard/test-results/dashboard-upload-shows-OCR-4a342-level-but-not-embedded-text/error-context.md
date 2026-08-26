# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard-upload.spec.ts >> shows OCR scan warnings for every legibility level but not embedded text
- Location: tests/dashboard-upload.spec.ts:141:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('div.mt-4.inline-flex').filter({ hasText: 'OCR used for this scan' })
Expected substring: "OCR used for this scan"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" with timeout 5000ms
  - waiting for locator('div.mt-4.inline-flex').filter({ hasText: 'OCR used for this scan' })

```

```yaml
- heading "Something went wrong" [level=1]
- paragraph: This part of the app hit an error. The rest of the app is still running.
- text: Cannot read properties of undefined (reading 'trim')
- button "Try again"
- region "Notifications (F8)":
  - list
```

# Test source

```ts
  85  |       return;
  86  |     }
  87  |     await route.continue();
  88  |   });
  89  |   await page.route("**/api/contracts/extract", async (route) => {
  90  |     if (route.request().method() !== "POST") return route.continue();
  91  |     if (responseMode === "error") {
  92  |       return route.fulfill({
  93  |         status: 422,
  94  |         contentType: "application/json",
  95  |         body: JSON.stringify({ error: "This PDF has no readable contract text." }),
  96  |       });
  97  |     }
  98  |     await route.fulfill({
  99  |       status: 200,
  100 |       contentType: "application/json",
  101 |       body: JSON.stringify({
  102 |         filename: "acme.pdf",
  103 |         extraction: {
  104 |           contract: makeContract(),
  105 |           source: "text",
  106 |           ocrConfidence: null,
  107 |           ocrPageCount: null,
  108 |           ocrPagesProcessed: null,
  109 |         },
  110 |       }),
  111 |     });
  112 |   });
  113 | 
  114 |   await page.goto("/dashboard");
  115 |   await page.getByRole("button", { name: "New Contract" }).click();
  116 |   await expect(page.getByRole("heading", { name: "Upload a PDF to extract its details" })).toBeVisible();
  117 | 
  118 |   await page.locator("#contract-pdf-file").setInputFiles({
  119 |     name: "acme.pdf",
  120 |     mimeType: "application/pdf",
  121 |     buffer: Buffer.from("%PDF-1.7\ncontract text"),
  122 |   });
  123 |   await expect(page.getByText("acme.pdf")).toBeVisible();
  124 |   await page.getByRole("button", { name: "Extract contract" }).click();
  125 |   await expect(page).toHaveURL(/\/review$/);
  126 |   await expect(page.getByRole("heading", { name: "Review Contract Details" })).toBeVisible();
  127 |   await expect(page.getByText(/acme\.pdf/)).toBeVisible();
  128 | 
  129 |   await page.goto("/dashboard");
  130 |   responseMode = "error";
  131 |   await page.getByRole("button", { name: "New Contract" }).click();
  132 |   await page.locator("#contract-pdf-file").setInputFiles({
  133 |     name: "blank.pdf",
  134 |     mimeType: "application/pdf",
  135 |     buffer: Buffer.from("%PDF-1.7\nblank"),
  136 |   });
  137 |   await page.getByRole("button", { name: "Extract contract" }).click();
  138 |   await expect(page.getByText("This PDF has no readable contract text.")).toBeVisible();
  139 | });
  140 | 
  141 | test("shows OCR scan warnings for every legibility level but not embedded text", async ({ page }) => {
  142 |   const contract = makeContract();
  143 |   let source: "text" | "ocr" = "ocr";
  144 |   let ocrConfidence: "High" | "Medium" | "Low" = "High";
  145 | 
  146 |   await page.route("**/api/contracts", async (route) => {
  147 |     if (route.request().method() === "GET") {
  148 |       await route.fulfill({ json: [] });
  149 |       return;
  150 |     }
  151 |     await route.continue();
  152 |   });
  153 |   await page.route("**/api/contracts/extract", async (route) => {
  154 |     await route.fulfill({
  155 |       status: 200,
  156 |       contentType: "application/json",
  157 |       body: JSON.stringify({
  158 |         filename: "scan.pdf",
  159 |         extraction: {
  160 |           contract,
  161 |           source,
  162 |           ocrConfidence: source === "ocr" ? ocrConfidence : null,
  163 |           ocrPageCount: source === "ocr" ? 1 : null,
  164 |           ocrPagesProcessed: source === "ocr" ? 1 : null,
  165 |         },
  166 |       }),
  167 |     });
  168 |   });
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
> 185 |     await expect(warning).toContainText("OCR used for this scan");
      |                           ^ Error: expect(locator).toContainText(expected) failed
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
  269 |   expect(createPayload).toEqual({
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
```