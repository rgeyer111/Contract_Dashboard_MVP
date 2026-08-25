import { expect, test } from "@playwright/test";

test("shows upload success and API error states", async ({ page }) => {
  let responseMode: "success" | "error" = "success";
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
          contract: {
            vendor: "Acme",
            contractNumber: "AC-100",
            contractName: "Support",
            contractType: "Maintenance",
            contractValue: { status: "unknown", amount: null, currency: null },
            startDate: "2026-01-01",
            contractDuration: "12 months",
            endDate: "2026-12-31",
            noticePeriod: "60 days",
            noticeDeadline: "",
            negotiationBuffer: "30 days",
            owner: "John Doe",
            status: "Review Open",
          },
          confidence: Object.fromEntries(
            [
              "vendor", "contractNumber", "contractName", "contractType",
              "contractValue", "startDate", "contractDuration", "endDate",
              "noticePeriod", "noticeDeadline", "negotiationBuffer", "owner", "status",
            ].map((key) => [key, "High"]),
          ),
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
  await expect(page.getByRole("heading", { name: "Review Extracted Contract" })).toBeVisible();
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

test("keeps a confirmed contract available after reload and update", async ({ page }) => {
  const confidence = Object.fromEntries(
    [
      "vendor", "contractNumber", "contractName", "contractType",
      "contractValue", "startDate", "contractDuration", "endDate",
      "noticePeriod", "noticeDeadline", "negotiationBuffer", "owner", "status",
    ].map((key) => [key, "High"]),
  );
  const contract = {
    vendor: "Northstar Sourcing",
    contractNumber: "NS-2026-014",
    contractName: "Sourcing Agreement",
    contractType: "Software License",
    contractValue: { status: "stated", amount: 240000, currency: "USD" },
    startDate: "2026-01-01",
    contractDuration: "12 months",
    endDate: "2026-12-31",
    noticePeriod: "60 days",
    noticeDeadline: "2026-11-01",
    negotiationBuffer: "30 days",
    owner: "John Doe",
    status: "Review Open",
  };
  const saved = {
    id: "saved-northstar-contract",
    filename: "northstar.pdf",
    contract,
    confidence,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  let createPayload: { filename: string; contract: typeof contract; confidence: typeof confidence } | undefined;
  let updatePayload: { filename: string; contract: typeof contract; confidence: typeof confidence } | undefined;

  await page.route("**/api/contracts", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: [saved] });
    }
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      createPayload = body;
      saved.filename = body.filename;
      saved.contract = body.contract;
      saved.confidence = body.confidence;
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
      saved.confidence = body.confidence;
      saved.updatedAt = "2026-01-02T00:00:00.000Z";
      return route.fulfill({ json: saved });
    }
    return route.continue();
  });

  await page.goto("/review");
  await page.evaluate(({ filename, contract, confidence }) => {
    sessionStorage.setItem(
      "contract-dashboard.extraction",
      JSON.stringify({ filename, extraction: { contract, confidence } }),
    );
  }, saved);
  await page.reload();

  await expect(page.getByRole("button", { name: "Confirm contract" })).toBeEnabled();
  await page.getByRole("button", { name: "Confirm contract" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(createPayload).toEqual({
    filename: "northstar.pdf",
    contract,
    confidence,
  });
  await expect(page.getByText("Northstar Sourcing", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText("Northstar Sourcing", { exact: true })).toBeVisible();
  await page.getByText("Northstar Sourcing", { exact: true }).click();
  await expect(page).toHaveURL(/\/review\?id=saved-northstar-contract$/);
  await expect(page.getByDisplayValue("Northstar Sourcing")).toBeVisible();

  await page.getByDisplayValue("Northstar Sourcing").fill("Northstar Sourcing GmbH");
  await page.getByRole("button", { name: "Confirm contract" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(updatePayload).toEqual({
    filename: "northstar.pdf",
    contract: {
      ...contract,
      vendor: "Northstar Sourcing GmbH",
    },
    confidence,
  });
  expect(saved.confidence).toEqual(confidence);
  await expect(page.getByText("Northstar Sourcing GmbH", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText("Northstar Sourcing GmbH", { exact: true })).toBeVisible();
});