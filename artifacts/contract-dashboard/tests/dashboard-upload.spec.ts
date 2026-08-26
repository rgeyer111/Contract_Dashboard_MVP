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
    ownerEmail: "john.doe@example.com",
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

const savedResponse = <T extends { id: string; filename: string; contract: ReturnType<typeof makeContract> }>(saved: T) => ({
  ...saved,
  parentContractId: null,
  documentType: "master_agreement",
  family: {
    id: saved.id,
    documentCount: 1,
    effectiveContract: saved.contract,
    documents: [
      {
        id: saved.id,
        filename: saved.filename,
        documentType: "master_agreement",
        effectiveDate: saved.contract.fields.effectiveDate.value,
        isParent: true,
        isCurrent: true,
        fieldValues: {},
      },
    ],
  },
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
  await expect(page.getByRole("heading", { name: "Resolve the open decisions" })).toBeVisible();
  await expect(page.getByText(/acme\.pdf/)).toBeVisible();
  await expect(page.getByText("Embedded text extraction", { exact: true })).toBeVisible();

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
  const contract = makeContract({
    vendor: "Northstar Sourcing",
    contractNumber: "NS-2026-014",
    contractTitle: "Sourcing Agreement",
    contractType: "software_license",
    contractValue: { amount: 240000, currency: "USD", basis: "annual" },
  });
  contract.fields.vendorLegalName = reviewerEdited("Northstar Sourcing");
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
      return route.fulfill({ json: [savedResponse(saved)] });
    }
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      createPayload = body;
      saved.filename = body.filename;
      saved.contract = body.contract;
      return route.fulfill({ status: 201, json: savedResponse(saved) });
    }
    return route.continue();
  });
  await page.route("**/api/contracts/saved-northstar-contract", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: savedResponse(saved) });
    }
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      updatePayload = body;
      saved.filename = body.filename;
      saved.contract = body.contract;
      saved.updatedAt = "2026-01-02T00:00:00.000Z";
      return route.fulfill({ json: savedResponse(saved) });
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

  await expect(page.getByRole("button", { name: "Confirm review" })).toBeEnabled();
  await page.getByRole("button", { name: "Confirm review" }).click();
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

test("keeps standalone contract rows reachable on narrow screens", async ({ page }) => {
  const rootId = "saved-family-parent";
  const amendmentId = "saved-family-amendment";
  const parentContract = makeContract({
    vendor: "Legacy Parent Vendor",
    contractNumber: "PARENT-001",
    contractTitle: "Original Support Agreement",
    contractValue: { amount: 120000, currency: "USD", basis: "annual" },
  });
  const amendmentBase = makeContract({
    vendor: "Northstar Sourcing GmbH",
    contractNumber: "PARENT-001",
    contractTitle: "Sourcing Agreement",
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
      id: rootId,
      filename: "parent-agreement.pdf",
      documentType: "master_agreement",
      contract: parentContract,
    },
    {
      id: amendmentId,
      filename: "commercial-amendment.pdf",
      documentType: "amendment",
      contract: amendmentContract,
    },
  ];
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

  const headers = page.locator("table thead th");
  await expect(headers).toHaveCount(5);
  await expect(headers).toHaveText([
    "Contract / commercial context",
    "Renewal",
    "Notice runway",
    "Owner",
    "Signal",
  ]);
  for (const removedHeader of ["Contract family", "Family / commercial context", "Type", "Value", "Notice / action", "Actions"]) {
    await expect(headers.filter({ hasText: new RegExp(`^${removedHeader}$`) })).toHaveCount(0);
  }

  const agreementRow = page.getByRole("row").filter({ hasText: "Legacy Parent Vendor" });
  const amendmentRow = page.getByRole("row").filter({ hasText: "Northstar Sourcing GmbH" });
  await expect(agreementRow).toHaveCount(1);
  await expect(amendmentRow).toHaveCount(1);
  await expect(agreementRow).toContainText("USD 120,000 · annual");
  await expect(amendmentRow).toContainText("Sourcing Agreement");
  await expect(amendmentRow).toContainText("USD 240,000 · annual");
  await expect(amendmentRow).toContainText("2027-12-31");
  await expect(amendmentRow).toContainText("manual renewal");
  await expect(amendmentRow).toContainText("90 days before term end");
  await expect(amendmentRow).toContainText("2027-10-02");
  await expect(amendmentRow).toContainText("Avery Stone");
  await expect(page.getByRole("button", { name: /contract family/i })).toHaveCount(0);
  await expect(page.getByTestId("contract-family-history")).toHaveCount(0);

  const typeCounts = page.getByTestId("agreement-type-counts");
  await expect(typeCounts).toContainText("All documents 2");
  await expect(typeCounts).toContainText("master agreement 1");
  await expect(typeCounts).toContainText("amendment 1");

  const documentTypeFilter = page.getByRole("combobox", { name: "Filter by document type" });
  await expect(documentTypeFilter).toBeVisible();
  await expect(documentTypeFilter.locator("option")).toHaveText([
    "All document types (2)",
    "master agreement (1)",
    "order form (0)",
    "sow (0)",
    "amendment (1)",
    "renewal letter (0)",
    "termination notice (0)",
    "quote or proposal (0)",
    "unknown (0)",
  ]);
  await documentTypeFilter.selectOption("amendment");
  await expect(page.getByTestId("active-contract-count")).toHaveText("1");
  await expect(page.getByRole("row").filter({ hasText: "Northstar Sourcing GmbH" })).toHaveCount(1);
  await expect(page.getByRole("row").filter({ hasText: "Legacy Parent Vendor" })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear document type filter" }).click();
  await expect(page.getByTestId("active-contract-count")).toHaveText("2");
  await expect(page.getByRole("row").filter({ hasText: "Legacy Parent Vendor" })).toHaveCount(1);

  await page.getByLabel("Search contracts").fill("Northstar");
  await expect(page.getByTestId("active-contract-count")).toHaveText("1");
  await expect(page.getByRole("row").filter({ hasText: "Northstar Sourcing GmbH" })).toHaveCount(1);
  await expect(page.getByRole("row").filter({ hasText: "Legacy Parent Vendor" })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.getByTestId("active-contract-count")).toHaveText("2");

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
  await expect(page.getByRole("row").filter({ hasText: "Legacy Parent Vendor" })).toHaveCount(1);
  await expect(page.getByRole("row").filter({ hasText: "Northstar Sourcing GmbH" })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear document type filter" }).click();

  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: "Legacy Parent Vendor" })).toHaveCount(1);
  const reloadedAmendmentRow = page.getByRole("row").filter({ hasText: "Northstar Sourcing GmbH" });
  await expect(reloadedAmendmentRow).toHaveCount(1);
  await expect(reloadedAmendmentRow).toContainText("USD 240,000 · annual");
  await expect(reloadedAmendmentRow).toContainText("2027-10-02");
  await expect(reloadedAmendmentRow).toContainText("Avery Stone");
  expect(listRequests).toBeGreaterThanOrEqual(2);

  await page.goto("/action-items");
  await expect(page).toHaveURL(/\/action-items$/);
  await expect(page.locator("main h1")).toHaveText("Action Items");
  await expect(page.getByRole("heading", { name: "Contract Registry", exact: true })).toHaveCount(0);
  await expect(page.locator("table")).toHaveCount(0);
});