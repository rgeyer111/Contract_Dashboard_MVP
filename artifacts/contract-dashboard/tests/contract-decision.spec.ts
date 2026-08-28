import { expect, test } from "@playwright/test";

const evidence = (value: unknown, quote = "Verbatim renewal clause.") => ({
  value,
  status: "found",
  confidence: "high",
  page: 2,
  clause: "4.2",
  quote,
  note: null,
  alternatives: [],
});

const savedContract = {
  id: "decision-contract",
  filename: "alpine-platform.pdf",
  documentType: "master_agreement",
  sourceAvailable: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-08-28T08:00:00.000Z",
  contract: {
    fields: {
      documentType: evidence("master_agreement"),
      documentLanguage: evidence("en"),
      vendorLegalName: evidence("Alpine Platform AG"),
      buyerLegalEntity: evidence("Helvetia Retail AG"),
      contractTitle: evidence("Platform Subscription"),
      contractNumber: evidence("APS-42"),
      contractType: evidence("saas_subscription"),
      signatureDate: evidence("2025-12-20"),
      effectiveDate: evidence("2026-01-01"),
      initialTermLength: evidence({ amount: 12, unit: "months" }),
      initialTermEndDate: evidence("2026-12-31"),
      renewalMechanism: evidence("auto_renew"),
      renewalTermLength: evidence({ amount: 12, unit: "months" }),
      noticePeriod: evidence({
        amount: 3,
        unit: "months",
        anchor: "term_end",
        purpose: "non_renewal",
      }),
      noticeDeadline: evidence(null, ""),
      noticeDelivery: evidence({ method: "email", address: "legal@alpine.example", cc: [] }),
      contractValue: evidence({ amount: 42000, currency: "CHF", basis: "annual" }),
      billingFrequency: evidence("annual"),
    },
    assignment: {
      owner: "Avery Stone",
      ownerEmail: "avery@example.com",
      negotiationBufferDays: 30,
      negotiationBufferSource: "global_default",
      status: "Review Open",
    },
    computed: {
      exitDate: "2027-09-30",
      noticeDeadline: "2026-09-30",
      actionDate: "2026-08-31",
      daysRemaining: 3,
      status: "red",
      reasonCode: null,
      reason: null,
    },
    alert: {
      owner: "Avery Stone",
      ownerEmail: "avery@example.com",
      actionDate: "2026-08-31",
      noticeDeadline: "2026-09-30",
      state: "due",
      dismissedReason: null,
    },
  },
};

test("records and reloads recurring decisions while keeping evidence secondary", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const decisions: Array<{
    id: string;
    contractId: string;
    decision: "renew" | "renegotiate" | "cancel" | "snooze";
    actor: string;
    snoozeUntil: string | null;
    decidedAt: string;
  }> = [];
  let decisionRequest: Record<string, unknown> | undefined;

  await page.route("**/api/contracts/decision-contract", async (route) => {
    await route.fulfill({ json: savedContract });
  });
  await page.route("**/api/contracts/decision-contract/decisions", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: decisions });
      return;
    }
    decisionRequest = route.request().postDataJSON() as Record<string, unknown>;
    const next = {
      id: `decision-${decisions.length + 1}`,
      contractId: savedContract.id,
      decision: decisionRequest.decision as "renew" | "renegotiate" | "cancel" | "snooze",
      actor: String(decisionRequest.actor),
      snoozeUntil: (decisionRequest.snoozeUntil as string | null) ?? null,
      decidedAt: `2026-08-28T09:0${decisions.length}:00.000Z`,
    };
    decisions.unshift(next);
    await route.fulfill({ status: 201, json: next });
  });

  await page.goto("/contracts/decision-contract");
  const primary = page.getByTestId("decision-primary-tier");
  await expect(primary).toContainText("Alpine Platform AG");
  await expect(primary).toContainText("CHF 42'000 · annual");
  await expect(primary).toContainText("30.09.2026");
  await expect(primary).toContainText("31.08.2026");
  await expect(primary).toContainText("3 days until action");
  await expect(primary).toContainText(
    "If nothing is done by 30.09.2026, this renews for 12 months at CHF 42'000.",
  );
  const primaryBox = await primary.boundingBox();
  expect(primaryBox).not.toBeNull();
  expect(primaryBox!.y + primaryBox!.height).toBeLessThanOrEqual(900);

  await expect(page.getByText("Verbatim renewal clause.", { exact: true })).toHaveCount(0);
  await page.getByTestId("action-renew").click();
  await page.getByTestId("input-actor").fill("Nina Reviewer");
  await page.getByTestId("button-save-decision").click();
  await expect(page.getByTestId("latest-decision")).toContainText("Renew");
  await expect(page.getByTestId("latest-decision")).toContainText("Nina Reviewer");
  expect(decisionRequest).toEqual({
    decision: "renew",
    actor: "Nina Reviewer",
    snoozeUntil: null,
  });

  await page.reload();
  await expect(page.getByTestId("latest-decision")).toContainText("Nina Reviewer");

  await page.getByTestId("action-snooze").click();
  await expect(page.getByTestId("input-snooze-date")).toHaveAttribute("min", "2026-08-28");
  await expect(page.getByTestId("button-save-decision")).toBeDisabled();
  await page.getByTestId("input-snooze-date").fill("2099-02-02");
  await page.getByTestId("button-save-decision").click();
  await expect(page.getByTestId("latest-decision")).toContainText("Snooze");
  await expect(page.getByTestId("latest-decision")).toContainText("02.02.2099");

  await page.getByTestId("toggle-reference").click();
  await expect(page.getByText(/Verbatim renewal clause\./).first()).toBeVisible();
  await expect(page.getByTestId("link-source-pdf")).toHaveText("View Source PDF");

  await page.getByLabel("Interface language").selectOption("de-CH");
  await expect(primary).toContainText(
    "Wenn bis zum 30.09.2026 nichts unternommen wird, verlängert sich der Vertrag um 12 Monate für CHF 42'000.",
  );
  await expect(page.getByTestId("link-source-pdf")).toHaveText("Quell-PDF anzeigen");
});