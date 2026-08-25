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