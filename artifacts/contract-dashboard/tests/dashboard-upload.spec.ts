import { expect, test } from "@playwright/test";

const provenance = (value: unknown = null, note: string | null = null) => ({
  value,
  status: value === null ? "not_found" : "found",
  confidence: value === null ? "low" : "high",
  page: value === null ? null : 1,
  clause: null,
  quote: value === null ? null : "Verbatim source evidence.",
  note,
});

const makeContract = ({
  vendor = "Acme",
  contractNumber = "AC-100",
  contractTitle = "Support",
  contractType = "maintenance",
  contractValue = null,
}: {
  vendor?: string;
  contractNumber?: string;
  contractTitle?: string;
  contractType?: string;
  contractValue?: unknown;
} = {}) => ({
  fields: {
    documentType: provenance("master_agreement"),
    documentLanguage: provenance("en"),
    vendorLegalName: provenance(vendor),
    buyerLegalEntity: provenance("Example Buyer AG"),
    contractTitle: provenance(contractTitle),
    contractNumber: provenance(contractNumber),
    contractType: provenance(contractType),
    signatureDate: provenance("2025-12-20"),
    effectiveDate: provenance("2026-01-01"),
    initialTermLength: provenance({ amount: 12, unit: "months" }),
    initialTermEndDate: provenance("2026-12-31"),
    renewalMechanism: provenance("auto_renew"),
    renewalTermLength: provenance({ amount: 12, unit: "months" }),
    noticePeriod: provenance({
      amount: 60,
      unit: "days",
      anchor: "term_end",
      purpose: "non_renewal",
    }),
    noticeDeadline: provenance(null, "Computed by the application; never extracted from model output."),
    noticeDelivery: provenance({ method: "email", address: "legal@example.com", cc: [] }),
    contractValue: provenance(contractValue),
    billingFrequency: provenance("annual"),
  },
  assignment: {
    owner: "John Doe",
    negotiationBufferDays: 30,
    negotiationBufferSource: "global_default",
    status: "Review Open",
  },
  computed: {
    exitDate: "2026-12-31",
    noticeDeadline: "2026-11-01",
    actionDate: "2026-10-02",
    status: "green",
    reason: null,
  },
});

const reviewerEdited = (value: unknown) => ({
  value,
  status: "ambiguous",
  confidence: "low",
  page: null,
  clause: null,
  quote: null,
  note: "Reviewer-supplied value; original extraction evidence was cleared.",
});

test("shows upload success and API error states", async ({ page }) => {
  let responseMode: "success" | "error" = "success";
  await page.route("**/api/contracts", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/contracts/extract", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    if (responseMode === "error") {
      return route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({ error: "This PDF has no readable contract text." }),
      });
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        filename: "acme.pdf",
        extraction: {
          contract: makeContract(),
          source: "text",
          ocrConfidence: null,
          ocrPageCount: null,
          ocrPagesProcessed: null,
        },
      }),
    });
  });

  await page.goto("/dashboard");
  await page.getByRole("button", { name: "New Contract" }).click();
  await expect(page.getByRole("heading", { name: "Upload a PDF to extract its details" })).toBeVisible();

  await page.locator("#contract-pdf-file").setInputFiles({
    name: "acme.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\ncontract text"),
  });
  await expect(page.getByText("acme.pdf")).toBeVisible();
  await page.getByRole("button", { name: "Extract contract" }).click();
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByRole("heading", { name: "Review Contract Details" })).toBeVisible();
  await expect(page.getByText(/acme\.pdf/)).toBeVisible();

  await page.goto("/dashboard");
  responseMode = "error";
  await page.getByRole("button", { name: "New Contract" }).click();
  await page.locator("#contract-pdf-file").setInputFiles({
    name: "blank.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nblank"),
  });
  await page.getByRole("button", { name: "Extract contract" }).click();
  await expect(page.getByText("This PDF has no readable contract text.")).toBeVisible();
});

test("shows OCR scan warnings for every legibility level but not embedded text", async ({ page }) => {
  const contract = makeContract();
  let source: "text" | "ocr" = "ocr";
  let ocrConfidence: "High" | "Medium" | "Low" = "High";

  await page.route("**/api/contracts", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: [] });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/contracts/extract", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        filename: "scan.pdf",
        extraction: {
          contract,
          source,
          ocrConfidence: source === "ocr" ? ocrConfidence : null,
          ocrPageCount: source === "ocr" ? 1 : null,
          ocrPagesProcessed: source === "ocr" ? 1 : null,
        },
      }),
    });
  });

  await page.goto("/dashboard");
  for (const level of ["High", "Medium", "Low"] as const) {
    source = "ocr";
    ocrConfidence = level;
    await page.getByRole("button", { name: "New Contract" }).click();
    await page.locator("#contract-pdf-file").setInputFiles({
      name: `${level.toLowerCase()}-scan.pdf`,
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\nscanned contract"),
    });
    await page.getByRole("button", { name: "Extract contract" }).click();
    await expect(page).toHaveURL(/\/review$/);
    const warning = page
      .locator("div.mt-4.inline-flex")
      .filter({ hasText: "OCR used for this scan" });
    await expect(warning).toContainText("OCR used for this scan");
    await expect(warning).toContainText(`${level} legibility`);
    await page.goto("/dashboard");
  }

  source = "text";
  await page.getByRole("button", { name: "New Contract" }).click();
  await page.locator("#contract-pdf-file").setInputFiles({
    name: "embedded-text.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nembedded contract text"),
  });
  await page.getByRole("button", { name: "Extract contract" }).click();
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByText(/OCR used for this scan/)).toHaveCount(0);
});

test("keeps a confirmed contract available after reload and update", async ({ page }) => {
  const contract = makeContract({
    vendor: "Northstar Sourcing",
    contractNumber: "NS-2026-014",
    contractTitle: "Sourcing Agreement",
    contractType: "software_license",
    contractValue: { amount: 240000, currency: "USD", basis: "annual" },
  });
  const saved = {
    id: "saved-northstar-contract",
    filename: "northstar.pdf",
    contract,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  let createPayload: Record<string, unknown> | undefined;
  let updatePayload: Record<string, unknown> | undefined;

  await page.route("**/api/contracts", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: [saved] });
    }
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      createPayload = body;
      saved.filename = body.filename;
      saved.contract = body.contract;
      return route.fulfill({ status: 201, json: saved });
    }
    return route.continue();
  });
  await page.route("**/api/contracts/saved-northstar-contract", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: saved });
    }
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      updatePayload = body;
      saved.filename = body.filename;
      saved.contract = body.contract;
      saved.updatedAt = "2026-01-02T00:00:00.000Z";
      return route.fulfill({ json: saved });
    }
    return route.continue();
  });

  await page.goto("/review");
  await page.evaluate(({ filename, contract }) => {
    sessionStorage.setItem(
      "contract-dashboard.extraction",
      JSON.stringify({
        filename,
        extraction: {
          contract,
          source: "text",
          ocrConfidence: null,
          ocrPageCount: null,
          ocrPagesProcessed: null,
        },
      }),
    );
  }, saved);
  await page.reload();

  await expect(page.getByRole("button", { name: "Confirm contract" })).toBeEnabled();
  await page.getByRole("button", { name: "Confirm contract" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(createPayload).toEqual({
    filename: "northstar.pdf",
    contract,
  });
  await expect(page.getByText("Northstar Sourcing", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText("Northstar Sourcing", { exact: true })).toBeVisible();
  await page.getByText("Northstar Sourcing", { exact: true }).click();
  await expect(page).toHaveURL(/\/review\?id=saved-northstar-contract$/);
  const vendorInput = page.getByPlaceholder("e.g. Acme Corp LLC");
  await expect(vendorInput).toBeVisible();

  await vendorInput.fill("Northstar Sourcing GmbH");
  await page.getByRole("button", { name: "Confirm contract" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(updatePayload).toEqual({
    filename: "northstar.pdf",
    contract: {
      ...contract,
      fields: {
        ...contract.fields,
        vendorLegalName: reviewerEdited("Northstar Sourcing GmbH"),
      },
    },
  });
  await expect(page.getByText("Northstar Sourcing GmbH", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText("Northstar Sourcing GmbH", { exact: true })).toBeVisible();
});

test("confirmed contracts persist through reload and reopen with edits intact", async ({ page }) => {
  const contractId = "saved-contract-regression";
  let savedContract: Record<string, unknown> | null = null;
  const contract = makeContract();

  await page.route("**/api/contracts/extract", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        filename: "acme.pdf",
        extraction: {
          contract,
          source: "text",
          ocrConfidence: null,
          ocrPageCount: null,
          ocrPagesProcessed: null,
        },
      }),
    });
  });

  await page.route("**/api/contracts", async (route) => {
    const request = route.request();

    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(savedContract ? [savedContract] : []),
      });
      return;
    }

    if (request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      savedContract = {
        id: contractId,
        ...body,
        createdAt: "2026-08-25T00:00:00.000Z",
        updatedAt: "2026-08-25T00:00:00.000Z",
      };
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(savedContract),
      });
      return;
    }

    await route.continue();
  });
  await page.route(`**/api/contracts/${contractId}`, async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({
        status: savedContract ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(savedContract ?? { error: "Contract not found." }),
      });
      return;
    }

    if (request.method() === "PUT") {
      const body = request.postDataJSON() as Record<string, unknown>;
      savedContract = {
        ...savedContract,
        ...body,
        updatedAt: "2026-08-25T00:01:00.000Z",
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(savedContract),
      });
      return;
    }

    await route.continue();
  });

  await page.goto("/dashboard");
  await page.getByRole("button", { name: "New Contract" }).click();
  await page.locator("#contract-pdf-file").setInputFiles({
    name: "acme.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\ncontract text"),
  });
  await page.getByRole("button", { name: "Extract contract" }).click();
  await expect(page).toHaveURL(/\/review$/);

  const vendorInput = page.getByPlaceholder("e.g. Acme Corp LLC");
  await vendorInput.fill("Edited Acme");
  await page.getByRole("button", { name: "Confirm contract" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("Edited Acme")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Edited Acme")).toBeVisible();
  const unknownValue = page.getByText("Unknown / not stated");
  await expect(unknownValue).toBeVisible();
  await expect(unknownValue).toHaveClass(/text-destructive/);
  await expect(page.getByText("John Doe", { exact: true })).toBeVisible();

  await page.getByRole("row").filter({ hasText: "Edited Acme" }).click();
  await expect(page).toHaveURL(new RegExp(`/review\\?id=${contractId}$`));
  await expect(vendorInput).toHaveValue("Edited Acme");
  const contractValueField = page
    .getByText("Contract Value", { exact: true })
    .locator("xpath=../..");
  await expect(contractValueField.getByText("not found", { exact: true })).toHaveClass(
    /text-destructive/,
  );
  await expect(page.getByPlaceholder("e.g. John Doe")).toHaveValue("John Doe");
});