import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/contracts/ingest-runs/current", async (route) => {
    await route.fulfill({ json: null });
  });
  await page.route("**/api/registry-views", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: [] });
      return;
    }
    await route.continue();
  });
});

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
    ownerEmail: "john.doe@example.com",
    negotiationBufferDays: 30,
    negotiationBufferSource: "global_default",
    status: "Review Open",
  },
  computed: {
    exitDate: "2026-12-31",
    noticeDeadline: "2026-11-01",
    actionDate: "2026-10-02",
    daysRemaining: 37,
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

const savedResponse = <T extends { id: string; filename: string; contract: ReturnType<typeof makeContract> }>(saved: T) => ({
  ...saved,
  documentType: "master_agreement",
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
  await expect(page.getByTestId("contract-registry-empty")).toContainText("Upload a PDF to get started");
  await page.getByRole("button", { name: "New Contract" }).click();
  await expect(page.getByRole("heading", { name: "Upload a PDF to extract its details" })).toBeVisible();

  await page.locator("#contract-pdf-file").setInputFiles({
    name: "acme.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\ncontract text"),
  });
  await expect(page.getByTitle("acme.pdf", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Extract contract" }).click();
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByRole("heading", { name: "Resolve the open decisions" })).toBeVisible();
  await expect(page.getByText(/acme\.pdf/)).toBeVisible();
  await expect(page.getByText("Embedded text extraction", { exact: true })).toBeVisible();
  const negotiationBuffer = page.getByLabel("Negotiation buffer (days)");
  await expect(negotiationBuffer).toHaveValue("30");
  await expect(page.getByText("Inherited global default", { exact: true })).toBeVisible();
  await negotiationBuffer.fill("45");
  await expect(negotiationBuffer).toHaveValue("45");
  await expect(page.getByText("Contract override", { exact: true })).toBeVisible();

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

test("retries only a failed PDF and preserves the review queue", async ({ page }) => {
  const requestCounts = new Map<string, number>();
  await page.route("**/api/contracts", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: [] });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/contracts/extract", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataBuffer()?.toString("latin1") ?? "";
    const filename = body.match(/filename="([^"]+)"/)?.[1] ?? "";
    const count = (requestCounts.get(filename) ?? 0) + 1;
    requestCounts.set(filename, count);

    if (filename === "duplicate.pdf") {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "This contract has already been uploaded. Duplicate skipped." }),
      });
      return;
    }
    if (filename === "retry.pdf" && count === 1) {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({ error: "The extraction service is temporarily unavailable." }),
      });
      return;
    }

    const contract = makeContract({
      vendor: filename === "retry.pdf" ? "Retry Vendor" : "Ready Vendor",
      contractNumber: filename === "retry.pdf" ? "RETRY-200" : "READY-100",
    });
    Object.assign(contract, {
      source: {
        id: filename,
        hash: filename === "retry.pdf" ? "retry-hash" : "ready-hash",
        filename,
        size: 100,
        type: "application/pdf",
      },
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        filename,
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

  await page.goto("/dashboard");
  await page.getByRole("button", { name: "New Contract" }).click();
  await page.locator("#contract-pdf-file").setInputFiles([
    {
      name: "ready.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\nready contract"),
    },
    {
      name: "duplicate.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\nduplicate contract"),
    },
    {
      name: "retry.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\nretry contract"),
    },
  ]);

  await page.getByRole("button", { name: "Extract contract" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("3/3 complete", { exact: true })).toBeVisible();
  await expect(page.getByText("Ready for review", { exact: true })).toBeVisible();
  await expect(page.getByText("Duplicate skipped", { exact: true })).toBeVisible();
  await expect(page.getByText(/The extraction service is temporarily unavailable\./)).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry retry.pdf" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Extract contract" })).toBeDisabled();

  await page.getByRole("button", { name: "Retry retry.pdf" }).click();
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByText(/ready\.pdf/)).toBeVisible();

  expect(Object.fromEntries(requestCounts)).toEqual({
    "ready.pdf": 1,
    "duplicate.pdf": 1,
    "retry.pdf": 2,
  });
  await expect.poll(() => page.evaluate(() => {
    const queue = JSON.parse(sessionStorage.getItem("contract-dashboard.extraction-queue") ?? "[]");
    return queue.map((entry: { filename: string }) => entry.filename);
  })).toEqual(["retry.pdf"]);
});

test("shows invalid file feedback and queues a valid PDF without extracting", async ({ page }) => {
  let extractionRequests = 0;
  await page.route("**/api/contracts", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: [] });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/contracts/extract", async (route) => {
    extractionRequests += 1;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Extraction should not be called in this test." }),
    });
  });

  await page.goto("/dashboard");
  await page.getByRole("button", { name: "New Contract" }).click();
  const fileInput = page.locator("#contract-pdf-file");

  await fileInput.setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not a PDF"),
  });
  await expect(page.getByText("Only PDF files up to 10 MB can be added.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Extract contract" })).toBeDisabled();

  await page.getByRole("button", { name: "Close contract upload" }).click();
  await expect(page.getByRole("heading", { name: "Upload a PDF to extract its details" })).toHaveCount(0);

  await page.getByRole("button", { name: "New Contract" }).click();
  await expect(page.getByText("Only PDF files up to 10 MB can be added.")).toHaveCount(0);
  await fileInput.setInputFiles({
    name: "valid.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nvalid contract"),
  });
  await expect(page.getByTitle("valid.pdf", { exact: true })).toBeVisible();
  await expect(page.getByText("Only PDF files up to 10 MB can be added.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Extract contract" })).toBeEnabled();
  expect(extractionRequests).toBe(0);
});

test("removes one queued PDF without removing the other", async ({ page }) => {
  await page.route("**/api/contracts", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: [] });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/contracts/extract", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        filename: "remaining.pdf",
        extraction: {
          contract: makeContract({ vendor: "Remaining Vendor" }),
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
  await page.locator("#contract-pdf-file").setInputFiles([
    {
      name: "mistaken.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\nmistaken contract"),
    },
    {
      name: "remaining.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\nremaining contract"),
    },
  ]);

  await expect(page.getByText("2 PDFs selected", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove mistaken.pdf" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove remaining.pdf" })).toBeVisible();

  await page.getByRole("button", { name: "Remove mistaken.pdf" }).click();
  await expect(page.getByText("1 PDF selected", { exact: true })).toBeVisible();
  await expect(page.getByText("mistaken.pdf", { exact: true })).toHaveCount(0);
  await expect(page.getByTitle("remaining.pdf", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Extract contract" })).toBeEnabled();

  await page.getByRole("button", { name: "Extract contract" }).click();
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByText(/remaining\.pdf/)).toBeVisible();
});

test("disables extraction after every queued PDF is removed", async ({ page }) => {
  await page.route("**/api/contracts", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: [] });
      return;
    }
    await route.continue();
  });

  await page.goto("/dashboard");
  await page.getByRole("button", { name: "New Contract" }).click();
  await page.locator("#contract-pdf-file").setInputFiles({
    name: "only-file.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nonly contract"),
  });
  await page.getByRole("button", { name: "Remove only-file.pdf" }).click();

  await expect(page.getByRole("button", { name: "Extract contract" })).toBeDisabled();
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
    await expect(page.getByText(`OCR · ${level} legibility`, { exact: true })).toBeVisible();
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
  await expect(page.getByText("Embedded text extraction", { exact: true })).toBeVisible();
  await expect(page.getByText(/^OCR · /)).toHaveCount(0);
});

test("keeps a confirmed contract available after reload and update", async ({ page }) => {
  const contract = makeContract();
  contract.fields.vendorLegalName = reviewerEdited("Northstar Sourcing");
  const saved = {
    id: "saved-northstar-contract",
    filename: "northstar.pdf",
    contract,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  let updatePayload: Record<string, unknown> | undefined;

  await page.route("**/api/contracts", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: [savedResponse(saved)] });
    }
    return route.continue();
  });
  await page.route("**/api/contracts/saved-northstar-contract", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: savedResponse(saved) });
    }
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as {
        filename: string;
        contract: ReturnType<typeof makeContract>;
      };
      updatePayload = body;
      saved.filename = body.filename;
      saved.contract = body.contract;
      saved.updatedAt = "2026-08-25T00:01:00.000Z";
      return route.fulfill({ status: 200, json: savedResponse(saved) });
    }

    await route.continue();
  });

  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Northstar Sourcing", exact: true }).click();
  await expect(page).toHaveURL(/\/review\?id=saved-northstar-contract$/);

  const vendorIssue = page
    .getByRole("heading", { name: "Vendor legal name", exact: true })
    .locator("xpath=ancestor::article");
  const vendorInput = vendorIssue.getByPlaceholder("Enter a value");
  await expect(vendorInput).toBeVisible();
  await expect(vendorIssue.getByText("reviewer supplied", { exact: true })).toBeVisible();

  await vendorInput.fill("Northstar Sourcing GmbH");
  await vendorIssue.getByRole("button", { name: "Resolve" }).click();
  await page.getByRole("button", { name: "Confirm review" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(updatePayload).toEqual({
    filename: "northstar.pdf",
    contract: {
      ...contract,
      fields: {
        ...contract.fields,
        vendorLegalName: {
          ...reviewerEdited("Northstar Sourcing GmbH"),
          reviewed: true,
        },
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
  contract.fields.vendorLegalName = reviewerEdited("Acme");

  const currentSavedResponse = () => {
    if (!savedContract) return null;
    return savedResponse(savedContract as {
      id: string;
      filename: string;
      contract: ReturnType<typeof makeContract>;
    });
  };

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
      const current = currentSavedResponse();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(current ? [current] : []),
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
        body: JSON.stringify(currentSavedResponse()),
      });
      return;
    }

    await route.continue();
  });
  await page.route(`**/api/contracts/${contractId}`, async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      const current = currentSavedResponse();
      await route.fulfill({
        status: current ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(current ?? { error: "Contract not found." }),
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
        body: JSON.stringify(currentSavedResponse()),
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

  const vendorIssue = page
    .getByRole("heading", { name: "Vendor legal name", exact: true })
    .locator("xpath=ancestor::article");
  const vendorInput = vendorIssue.getByPlaceholder("Enter a value");
  await expect(vendorIssue.getByText("reviewer supplied", { exact: true })).toBeVisible();
  await vendorInput.fill("Edited Acme");
  await page.getByRole("button", { name: "Confirm review" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("Edited Acme")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Edited Acme")).toBeVisible();
  const unknownValue = page
    .getByRole("row")
    .filter({ hasText: "Edited Acme" })
    .locator("div.text-destructive")
    .filter({ hasText: "Value not stated" })
    .first();
  await expect(unknownValue).toBeVisible();
  await expect(unknownValue).toHaveClass(/text-destructive/);
  await expect(page.getByText("John Doe", { exact: true })).toBeVisible();

  await page
    .getByRole("row")
    .filter({ hasText: "Edited Acme" })
    .getByRole("button", { name: "Edited Acme", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/review\\?id=${contractId}$`));
  await expect(vendorInput).toHaveValue("Edited Acme");
  const contractValueField = page
    .getByRole("heading", { name: "Contract value", exact: true })
    .locator("xpath=ancestor::article");
  await expect(contractValueField.getByText("not found", { exact: true })).toHaveClass(
    /text-destructive/,
  );
  await expect(page.getByText("John Doe", { exact: true })).toBeVisible();
});

test("sorts the register by urgency and persists auditable contract-type corrections", async ({ page }) => {
  const urgentContract = makeContract({ vendor: "Urgent Vendor", contractTitle: "Urgent renewal" });
  urgentContract.computed.daysRemaining = 5;
  urgentContract.computed.actionDate = "2026-08-31";
  urgentContract.computed.noticeDeadline = "2026-09-30";

  const laterContract = makeContract({ vendor: "Later Vendor", contractTitle: "Later renewal" });
  laterContract.computed.daysRemaining = 40;
  laterContract.computed.actionDate = "2026-10-05";
  laterContract.computed.noticeDeadline = "2026-11-04";

  const blockedContract = makeContract({ vendor: "Blocked Vendor", contractTitle: "Blocked renewal" }) as any;
  blockedContract.computed = {
    exitDate: null,
    noticeDeadline: null,
    actionDate: null,
    daysRemaining: null,
    status: "blocked",
    reason: "blocked — missing a trusted timing anchor",
  };

  const savedContracts = [
    { id: "blocked-register-contract", filename: "blocked.pdf", contract: blockedContract, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "later-register-contract", filename: "later.pdf", contract: laterContract, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "urgent-register-contract", filename: "urgent.pdf", contract: urgentContract, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  ];
  let updatePayload: any;

  await page.route("**/api/contracts", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: savedContracts.map((saved) => savedResponse(saved)) });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/contracts/urgent-register-contract", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.continue();
      return;
    }
    updatePayload = route.request().postDataJSON();
    urgentContract.fields.contractType = {
      ...updatePayload.contract.fields.contractType,
      status: "ambiguous",
      confidence: "low",
      page: null,
      clause: null,
      quote: null,
      note: "Reviewer-supplied value; original extraction evidence was cleared.",
      reviewed: true,
      originalValue: "maintenance",
    } as any;
    await route.fulfill({ json: savedResponse(savedContracts[2]) });
  });

  await page.goto("/dashboard");

  const rows = page.locator('[data-testid^="contract-registry-row-"]');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Urgent Vendor");
  await expect(rows.nth(1)).toContainText("Later Vendor");
  await expect(rows.nth(2)).toContainText("Blocked Vendor");

  await page.getByTestId("contract-type-select-urgent-register-contract").selectOption("saas_subscription");
  await expect.poll(() => updatePayload?.contract?.fields?.contractType?.value).toBe("saas_subscription");
  await expect(page.getByText("Edited · extracted maintenance", { exact: true })).toBeVisible();
});

test("keeps independent contract rows reachable on narrow screens", async ({ page }) => {
  const masterId = "saved-standalone-master";
  const amendmentId = "saved-standalone-amendment";
  const masterContract = makeContract({
    vendor: "Legacy Master Vendor",
    contractNumber: "MASTER-001",
    contractTitle: "Original Support Agreement",
    contractValue: { amount: 120000, currency: "USD", basis: "annual" },
  });
  const amendmentBase = makeContract({
    vendor: "Northstar Sourcing GmbH",
    contractNumber: "PARENT-001",
    contractTitle: "Northstar & Sourcing Agreement — C&A + 100%",
    contractType: "software_license",
    contractValue: { amount: 240000, currency: "USD", basis: "annual" },
  });
  const amendmentContract = {
    ...amendmentBase,
    fields: {
      ...amendmentBase.fields,
      vendorLegalName: reviewerEdited("Northstar Sourcing GmbH"),
      initialTermEndDate: provenance("2027-12-31"),
      renewalMechanism: provenance("manual_renewal"),
      noticePeriod: provenance({
        amount: 90,
        unit: "days",
        anchor: "term_end",
        purpose: "non_renewal",
      }),
    },
    assignment: {
      ...amendmentBase.assignment,
      owner: "Avery Stone",
    },
    computed: {
      ...amendmentBase.computed,
      noticeDeadline: "2027-10-02",
      actionDate: "2027-09-02",
    },
  };
  const savedContracts = [
    {
      id: masterId,
      filename: "master-agreement.pdf",
      documentType: "master_agreement",
      contract: masterContract,
    },
    {
      id: amendmentId,
      filename: "commercial-amendment.pdf",
      documentType: "amendment",
      contract: amendmentContract,
    },
  ];
  const specialSearch = "C&A + 100%";
  let listRequests = 0;

  await page.route("**/api/contracts", async (route) => {
    if (route.request().method() === "GET") {
      listRequests += 1;
      await route.fulfill({ json: savedContracts });
      return;
    }
    await route.continue();
  });

  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/dashboard");

  const headers = page.locator("table thead tr").last().locator("th");
  await expect(headers).toHaveCount(13);
  await expect(headers).toHaveText([
    "Vendor",
    "Contract type",
    "End date",
    "Renewal mechanism",
    "Notice period",
    "Value",
    "Action date",
    "Notice deadline",
    "Days remaining",
    "Status",
    "Status reason",
    "Owner",
    "Negotiation buffer",
  ]);
  for (const removedHeader of ["Notice / action", "Actions"]) {
    await expect(headers.filter({ hasText: new RegExp(`^${removedHeader}$`) })).toHaveCount(0);
  }

  const agreementRow = page.getByRole("row").filter({ hasText: "Legacy Master Vendor" });
  const amendmentRow = page.getByRole("row").filter({ hasText: "Northstar Sourcing GmbH" });
  await expect(agreementRow).toHaveCount(1);
  await expect(amendmentRow).toHaveCount(1);
  await expect(agreementRow).toContainText("USD 120,000 · annual");
  await expect(amendmentRow).toContainText("Sourcing Agreement");
  await expect(amendmentRow).toContainText("USD 240,000 · annual");
  await expect(amendmentRow).toContainText("31.12.2027");
  await expect(amendmentRow).toContainText("manual renewal");
  await expect(amendmentRow).toContainText("37 days until action");
  await expect(amendmentRow).toContainText("02.09.2027");
  await expect(amendmentRow).toContainText("02.10.2027");
  await expect(amendmentRow).toContainText("Avery Stone");

  const documentTypeFilter = page.getByRole("combobox", { name: "Filter by document type" });
  await expect(documentTypeFilter).toBeVisible();
  await expect(documentTypeFilter.locator("option")).toHaveText([
    "All document types (2)",
    "master agreement (1)",
    "order form (0)",
    "amendment (1)",
    "renewal letter (0)",
    "termination notice (0)",
    "quote or proposal (0)",
    "unknown (0)",
  ]);
  await documentTypeFilter.selectOption("amendment");
  await expect(page).toHaveURL(/\/dashboard\?documentType=amendment$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(documentTypeFilter).toHaveValue("");
  await expect(page.getByTestId("active-contract-count")).toHaveText("2");
  await page.goForward();
  await expect(page).toHaveURL(/\/dashboard\?documentType=amendment$/);
  await expect(documentTypeFilter).toHaveValue("amendment");
  const copyViewLinkButton = page.getByRole("button", { name: "Copy filtered view link" });

  const sharedSearchTerm = "Northstar & Sourcing";
  await expect(copyViewLinkButton).toBeVisible();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await copyViewLinkButton.click();
  await expect(page.getByRole("button", { name: "Copy filtered view link" })).toContainText("Link copied");
  await expect(page.getByTestId("active-contract-count")).toHaveText("1");
  await expect(page.getByRole("row").filter({ hasText: "Northstar Sourcing GmbH" })).toHaveCount(1);
  await expect(page.getByRole("row").filter({ hasText: "Legacy Master Vendor" })).toHaveCount(0);
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard\?documentType=amendment$/);
  await expect(documentTypeFilter).toHaveValue("amendment");
  await expect(page.getByRole("button", { name: "Copy filtered view link" })).toBeVisible();
  await expect(page.getByTestId("active-contract-count")).toHaveText("1");
  await expect(page.getByRole("row").filter({ hasText: "Northstar Sourcing GmbH" })).toHaveCount(1);
  await expect(page.getByRole("row").filter({ hasText: "Legacy Master Vendor" })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear document type filter" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("button", { name: "Copy filtered view link" })).toHaveCount(0);
  await expect(page.getByTestId("active-contract-count")).toHaveText("2");
  await expect(page.getByRole("row").filter({ hasText: "Legacy Master Vendor" })).toHaveCount(1);

  await page.getByLabel("Search contracts").fill(specialSearch);
  expect(new URL(page.url()).searchParams.get("search")).toBe(specialSearch);
  await expect(page.getByRole("button", { name: "Copy filtered view link" })).toBeVisible();
  await expect(page.getByTestId("active-contract-count")).toHaveText("1");
  await expect(page.getByRole("row").filter({ hasText: "Northstar Sourcing GmbH" })).toHaveCount(1);
  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByLabel("Search contracts")).toHaveValue("");
  await expect(page.getByTestId("active-contract-count")).toHaveText("2");
  await page.goForward();
  await expect(page).toHaveURL(/\/dashboard\?search=C%26A\+%2B\+100%25$/);
  await expect(page.getByLabel("Search contracts")).toHaveValue(specialSearch);
  await expect(page.getByTestId("active-contract-count")).toHaveText("1");
  await expect(page.getByRole("row").filter({ hasText: "Legacy Master Vendor" })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("button", { name: "Copy filtered view link" })).toHaveCount(0);
  await expect(page.getByTestId("active-contract-count")).toHaveText("2");

  await page.goto("/dashboard?search=C%26A%20%2B%20100%25");
  await expect(page.getByLabel("Search contracts")).toHaveValue(specialSearch);
  expect(new URL(page.url()).searchParams.get("search")).toBe(specialSearch);
  await expect(page.getByTestId("active-contract-count")).toHaveText("1");
  await expect(page.getByRole("row").filter({ hasText: "Northstar Sourcing GmbH" })).toHaveCount(1);
  await page.getByRole("button", { name: "Clear search" }).click();

  await page.goto("/dashboard?documentType=amendment&search=C%26A%20%2B%20100%25");
  await expect(documentTypeFilter).toHaveValue("amendment");
  await expect(page.getByLabel("Search contracts")).toHaveValue(specialSearch);
  expect(new URL(page.url()).searchParams.get("search")).toBe(specialSearch);
  await expect(page.getByTestId("active-contract-count")).toHaveText("1");
  await expect(page.getByRole("row").filter({ hasText: "Northstar Sourcing GmbH" })).toHaveCount(1);
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page).toHaveURL(/\/dashboard\?documentType=amendment$/);
  await expect(documentTypeFilter).toHaveValue("amendment");
  await expect(page.getByLabel("Search contracts")).toHaveValue("");
  await expect(page.getByTestId("active-contract-count")).toHaveText("1");
  await expect(page.getByRole("row").filter({ hasText: "Northstar Sourcing GmbH" })).toHaveCount(1);

  await page.getByLabel("Search contracts").fill(sharedSearchTerm);
  await expect(page).toHaveURL(/\/dashboard\?documentType=amendment&search=Northstar\+%26\+Sourcing$/);
  expect(new URL(page.url()).searchParams.get("search")).toBe(sharedSearchTerm);
  await expect(documentTypeFilter).toHaveValue("amendment");
  await expect(page.getByLabel("Search contracts")).toHaveValue(sharedSearchTerm);
  await expect(page.getByTestId("active-contract-count")).toHaveText("1");
  await expect(page.getByRole("row").filter({ hasText: "Northstar Sourcing GmbH" })).toHaveCount(1);
  await expect(page.getByRole("row").filter({ hasText: "Legacy Master Vendor" })).toHaveCount(0);

  await page.reload();
  await expect(page).toHaveURL(/\/dashboard\?documentType=amendment&search=Northstar\+%26\+Sourcing$/);
  await expect(documentTypeFilter).toHaveValue("amendment");
  await expect(page.getByLabel("Search contracts")).toHaveValue(sharedSearchTerm);
  await expect(page.getByTestId("active-contract-count")).toHaveText("1");
  await expect(page.getByRole("row").filter({ hasText: "Northstar Sourcing GmbH" })).toHaveCount(1);
  await expect(page.getByRole("row").filter({ hasText: "Legacy Master Vendor" })).toHaveCount(0);

  await page.goto(`/dashboard?documentType=amendment&search=${encodeURIComponent(sharedSearchTerm)}`);
  await expect(documentTypeFilter).toHaveValue("amendment");
  await expect(page.getByLabel("Search contracts")).toHaveValue(sharedSearchTerm);
  await expect(page.getByTestId("active-contract-count")).toHaveText("1");
  await expect(page.getByRole("row").filter({ hasText: "Northstar Sourcing GmbH" })).toHaveCount(1);
  await expect(page.getByRole("row").filter({ hasText: "Legacy Master Vendor" })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page).toHaveURL(/\/dashboard\?documentType=amendment$/);
  await expect(documentTypeFilter).toHaveValue("amendment");
  await page.getByRole("button", { name: "Clear document type filter" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const scrollerMetrics = await page.locator("table").evaluate((table) => {
    const scroller = table.parentElement;
    return {
      clientWidth: scroller?.clientWidth ?? 0,
      scrollWidth: scroller?.scrollWidth ?? 0,
      overflowX: scroller ? getComputedStyle(scroller).overflowX : "",
    };
  });
  expect(scrollerMetrics.overflowX).toBe("auto");
  expect(scrollerMetrics.scrollWidth).toBeGreaterThan(scrollerMetrics.clientWidth);

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(documentTypeFilter).toBeVisible();
  await documentTypeFilter.selectOption("master_agreement");
  await expect(page.getByTestId("active-contract-count")).toHaveText("1");
  await expect(page.getByRole("row").filter({ hasText: "Legacy Master Vendor" })).toHaveCount(1);
  await expect(page.getByRole("row").filter({ hasText: "Northstar Sourcing GmbH" })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear document type filter" }).click();

  await page.goto("/dashboard?documentType=amendment");
  await expect(documentTypeFilter).toHaveValue("amendment");
  await expect(page.getByTestId("active-contract-count")).toHaveText("1");
  await expect(page.getByRole("row").filter({ hasText: "Northstar Sourcing GmbH" })).toHaveCount(1);

  await page.reload();
  await expect(documentTypeFilter).toHaveValue("amendment");
  await expect(page.getByRole("row").filter({ hasText: "Legacy Master Vendor" })).toHaveCount(0);
  const reloadedAmendmentRow = page.getByRole("row").filter({ hasText: "Northstar Sourcing GmbH" });
  await expect(reloadedAmendmentRow).toHaveCount(1);
  await expect(reloadedAmendmentRow).toContainText("USD 240,000 · annual");
  await expect(reloadedAmendmentRow).toContainText("02.10.2027");
  await expect(reloadedAmendmentRow).toContainText("Avery Stone");
  expect(listRequests).toBeGreaterThanOrEqual(2);

  await page.goto("/action-items");
  await expect(page).toHaveURL(/\/action-items$/);
  await expect(page.locator("main h1")).toHaveText("Action Items");
  await expect(page.getByRole("heading", { name: "Contract Registry", exact: true })).toHaveCount(0);
  await expect(page.locator("table")).toHaveCount(0);
});
