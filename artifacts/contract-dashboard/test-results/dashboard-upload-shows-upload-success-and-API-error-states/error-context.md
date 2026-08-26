# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard-upload.spec.ts >> shows upload success and API error states
- Location: tests/dashboard-upload.spec.ts:76:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: 'Review Contract Details' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('heading', { name: 'Review Contract Details' })

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
  26  |   fields: {
  27  |     documentType: provenance("master_agreement"),
  28  |     documentLanguage: provenance("en"),
  29  |     vendorLegalName: provenance(vendor),
  30  |     buyerLegalEntity: provenance("Example Buyer AG"),
  31  |     contractTitle: provenance(contractTitle),
  32  |     contractNumber: provenance(contractNumber),
  33  |     contractType: provenance(contractType),
  34  |     signatureDate: provenance("2025-12-20"),
  35  |     effectiveDate: provenance("2026-01-01"),
  36  |     initialTermLength: provenance({ amount: 12, unit: "months" }),
  37  |     initialTermEndDate: provenance("2026-12-31"),
  38  |     renewalMechanism: provenance("auto_renew"),
  39  |     renewalTermLength: provenance({ amount: 12, unit: "months" }),
  40  |     noticePeriod: provenance({
  41  |       amount: 60,
  42  |       unit: "days",
  43  |       anchor: "term_end",
  44  |       purpose: "non_renewal",
  45  |     }),
  46  |     noticeDeadline: provenance(null, "Computed by the application; never extracted from model output."),
  47  |     noticeDelivery: provenance({ method: "email", address: "legal@example.com", cc: [] }),
  48  |     contractValue: provenance(contractValue),
  49  |     billingFrequency: provenance("annual"),
  50  |   },
  51  |   assignment: {
  52  |     owner: "John Doe",
  53  |     negotiationBufferDays: 30,
  54  |     negotiationBufferSource: "global_default",
  55  |     status: "Review Open",
  56  |   },
  57  |   computed: {
  58  |     exitDate: "2026-12-31",
  59  |     noticeDeadline: "2026-11-01",
  60  |     actionDate: "2026-10-02",
  61  |     status: "green",
  62  |     reason: null,
  63  |   },
  64  | });
  65  | 
  66  | const reviewerEdited = (value: unknown) => ({
  67  |   value,
  68  |   status: "ambiguous",
  69  |   confidence: "low",
  70  |   page: null,
  71  |   clause: null,
  72  |   quote: null,
  73  |   note: "Reviewer-supplied value; original extraction evidence was cleared.",
  74  | });
  75  | 
  76  | test("shows upload success and API error states", async ({ page }) => {
  77  |   let responseMode: "success" | "error" = "success";
  78  |   await page.route("**/api/contracts", async (route) => {
  79  |     if (route.request().method() === "GET") {
  80  |       await route.fulfill({
  81  |         status: 200,
  82  |         contentType: "application/json",
  83  |         body: JSON.stringify([]),
  84  |       });
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
> 126 |   await expect(page.getByRole("heading", { name: "Review Contract Details" })).toBeVisible();
      |                                                                                ^ Error: expect(locator).toBeVisible() failed
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
```