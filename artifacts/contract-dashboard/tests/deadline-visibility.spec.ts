import { expect, test } from "@playwright/test";

const blockedDates = {
  exitDate: "2099-01-11",
  noticeDeadline: "2099-02-22",
  actionDate: "2099-03-03",
};

const expiredDates = {
  exitDate: "2020-01-11",
  noticeDeadline: "2020-02-22",
  actionDate: "2020-03-03",
};

const provenance = (value: unknown = null) => ({
  value,
  status: value === null ? "not_found" : "found",
  confidence: value === null ? "low" : "high",
  page: null,
  clause: null,
  quote: null,
  note: null,
});

const makeContract = (
  vendor: string,
  computed: {
    exitDate: string;
    noticeDeadline: string;
    actionDate: string;
    status: "blocked" | "expired";
    reason: string;
  },
) => ({
  fields: {
    documentType: provenance("master_agreement"),
    documentLanguage: provenance("en"),
    vendorLegalName: provenance(vendor),
    buyerLegalEntity: provenance("Example Buyer AG"),
    contractTitle: provenance("Deadline Visibility Coverage"),
    contractNumber: provenance("VIS-2026-001"),
    contractType: provenance("saas_subscription"),
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
    noticeDeadline: provenance(),
    noticeDelivery: provenance({ method: "email", address: "legal@example.com", cc: [] }),
    contractValue: provenance({ amount: 240000, currency: "USD", basis: "annual" }),
    billingFrequency: provenance("annual"),
  },
  assignment: {
    owner: "John Doe",
    negotiationBufferDays: 30,
    negotiationBufferSource: "global_default",
    status: "Review Open",
  },
  computed,
});

test("hides blocked dates in registry and review while preserving expired history", async ({ page }) => {
  const blockedContract = makeContract("Blocked Vendor", {
    ...blockedDates,
    status: "blocked",
    reason: "blocked — missing a trusted contract timing anchor",
  });
  const expiredContract = makeContract("Expired Vendor", {
    ...expiredDates,
    status: "expired",
    reason: "expired — historical dates retained for reference",
  });
  const savedContracts = [
    { id: "blocked-deadline", filename: "blocked.pdf", contract: blockedContract },
    { id: "expired-deadline", filename: "expired.pdf", contract: expiredContract },
  ];

  await page.route("**/api/contracts", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: savedContracts });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/contracts/blocked-deadline", async (route) => {
    await route.fulfill({ json: savedContracts[0] });
  });
  await page.route("**/api/contracts/expired-deadline", async (route) => {
    await route.fulfill({ json: savedContracts[1] });
  });

  await page.goto("/dashboard");

  const blockedRow = page.getByRole("row").filter({ hasText: "Blocked Vendor" });
  await expect(blockedRow).toHaveCount(1);
  await expect(blockedRow).toContainText("Deadline unavailable");
  await expect(blockedRow).not.toContainText(blockedDates.exitDate);
  await expect(blockedRow).not.toContainText(blockedDates.noticeDeadline);
  await expect(blockedRow).not.toContainText(blockedDates.actionDate);
  await expect(blockedRow.getByText(/^Notice /)).toHaveCount(0);
  await expect(blockedRow.getByText(/^Act /)).toHaveCount(0);

  const expiredRow = page.getByRole("row").filter({ hasText: "Expired Vendor" });
  await expect(expiredRow).toHaveCount(1);
  await expect(expiredRow).toContainText(expiredDates.noticeDeadline);
  await expect(expiredRow).toContainText(expiredDates.actionDate);
  await expect(expiredRow).toContainText(expiredContract.computed.reason);

  await page.goto("/review?id=blocked-deadline");
  const blockedPanel = page
    .getByText("No dates are shown until the contract timing can be trusted.", { exact: true })
    .locator("xpath=../..");
  await expect(blockedPanel).toContainText("Deadline unavailable");
  await expect(blockedPanel.getByText("Exit date", { exact: true })).toHaveCount(0);
  await expect(blockedPanel.getByText("Legal notice deadline", { exact: true })).toHaveCount(0);
  await expect(blockedPanel.getByText("Start negotiation", { exact: true })).toHaveCount(0);
  await expect(blockedPanel).not.toContainText(blockedDates.exitDate);
  await expect(blockedPanel).not.toContainText(blockedDates.noticeDeadline);
  await expect(blockedPanel).not.toContainText(blockedDates.actionDate);

  await page.goto("/review?id=expired-deadline");
  const expiredPanel = page.getByText("Exit date", { exact: true }).locator("xpath=../..");
  await expect(expiredPanel).toContainText(expiredDates.exitDate);
  await expect(expiredPanel).toContainText(expiredDates.noticeDeadline);
  await expect(expiredPanel).toContainText(expiredDates.actionDate);
  await expect(expiredPanel).toContainText(expiredContract.computed.reason);
});