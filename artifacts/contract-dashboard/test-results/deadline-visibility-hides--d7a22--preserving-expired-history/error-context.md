# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: deadline-visibility.spec.ts >> hides blocked dates in registry and review while preserving expired history
- Location: tests/deadline-visibility.spec.ts:69:1

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  getByRole('row').filter({ hasText: 'Blocked Vendor' })
Expected: 1
Received: 0
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" with timeout 5000ms
  - waiting for getByRole('row').filter({ hasText: 'Blocked Vendor' })
    14 × locator resolved to 0 elements
       - unexpected value "0"

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e4]:
    - heading "Something went wrong" [level=1] [ref=e5]
    - paragraph [ref=e6]: This part of the app hit an error. The rest of the app is still running.
    - generic [ref=e7]: Cannot read properties of undefined (reading 'id')
    - button "Try again" [ref=e8]
  - region "Notifications (F8)":
    - list
```

# Test source

```ts
  2   | 
  3   | const blockedDates = {
  4   |   exitDate: "2099-01-11",
  5   |   noticeDeadline: "2099-02-22",
  6   |   actionDate: "2099-03-03",
  7   | };
  8   | 
  9   | const expiredDates = {
  10  |   exitDate: "2020-01-11",
  11  |   noticeDeadline: "2020-02-22",
  12  |   actionDate: "2020-03-03",
  13  | };
  14  | 
  15  | const provenance = (value: unknown = null) => ({
  16  |   value,
  17  |   status: value === null ? "not_found" : "found",
  18  |   confidence: value === null ? "low" : "high",
  19  |   page: null,
  20  |   clause: null,
  21  |   quote: null,
  22  |   note: null,
  23  | });
  24  | 
  25  | const makeContract = (
  26  |   vendor: string,
  27  |   computed: {
  28  |     exitDate: string;
  29  |     noticeDeadline: string;
  30  |     actionDate: string;
  31  |     status: "blocked" | "expired";
  32  |     reason: string;
  33  |   },
  34  | ) => ({
  35  |   fields: {
  36  |     documentType: provenance("master_agreement"),
  37  |     documentLanguage: provenance("en"),
  38  |     vendorLegalName: provenance(vendor),
  39  |     buyerLegalEntity: provenance("Example Buyer AG"),
  40  |     contractTitle: provenance("Deadline Visibility Coverage"),
  41  |     contractNumber: provenance("VIS-2026-001"),
  42  |     contractType: provenance("saas_subscription"),
  43  |     signatureDate: provenance("2025-12-20"),
  44  |     effectiveDate: provenance("2026-01-01"),
  45  |     initialTermLength: provenance({ amount: 12, unit: "months" }),
  46  |     initialTermEndDate: provenance("2026-12-31"),
  47  |     renewalMechanism: provenance("auto_renew"),
  48  |     renewalTermLength: provenance({ amount: 12, unit: "months" }),
  49  |     noticePeriod: provenance({
  50  |       amount: 60,
  51  |       unit: "days",
  52  |       anchor: "term_end",
  53  |       purpose: "non_renewal",
  54  |     }),
  55  |     noticeDeadline: provenance(),
  56  |     noticeDelivery: provenance({ method: "email", address: "legal@example.com", cc: [] }),
  57  |     contractValue: provenance({ amount: 240000, currency: "USD", basis: "annual" }),
  58  |     billingFrequency: provenance("annual"),
  59  |   },
  60  |   assignment: {
  61  |     owner: "John Doe",
  62  |     negotiationBufferDays: 30,
  63  |     negotiationBufferSource: "global_default",
  64  |     status: "Review Open",
  65  |   },
  66  |   computed,
  67  | });
  68  | 
  69  | test("hides blocked dates in registry and review while preserving expired history", async ({ page }) => {
  70  |   const blockedContract = makeContract("Blocked Vendor", {
  71  |     ...blockedDates,
  72  |     status: "blocked",
  73  |     reason: "blocked — missing a trusted contract timing anchor",
  74  |   });
  75  |   const expiredContract = makeContract("Expired Vendor", {
  76  |     ...expiredDates,
  77  |     status: "expired",
  78  |     reason: "expired — historical dates retained for reference",
  79  |   });
  80  |   const savedContracts = [
  81  |     { id: "blocked-deadline", filename: "blocked.pdf", contract: blockedContract },
  82  |     { id: "expired-deadline", filename: "expired.pdf", contract: expiredContract },
  83  |   ];
  84  | 
  85  |   await page.route("**/api/contracts", async (route) => {
  86  |     if (route.request().method() === "GET") {
  87  |       await route.fulfill({ json: savedContracts });
  88  |       return;
  89  |     }
  90  |     await route.continue();
  91  |   });
  92  |   await page.route("**/api/contracts/blocked-deadline", async (route) => {
  93  |     await route.fulfill({ json: savedContracts[0] });
  94  |   });
  95  |   await page.route("**/api/contracts/expired-deadline", async (route) => {
  96  |     await route.fulfill({ json: savedContracts[1] });
  97  |   });
  98  | 
  99  |   await page.goto("/dashboard");
  100 | 
  101 |   const blockedRow = page.getByRole("row").filter({ hasText: "Blocked Vendor" });
> 102 |   await expect(blockedRow).toHaveCount(1);
      |                            ^ Error: expect(locator).toHaveCount(expected) failed
  103 |   await expect(blockedRow).toContainText("Deadline unavailable");
  104 |   await expect(blockedRow).not.toContainText(blockedDates.exitDate);
  105 |   await expect(blockedRow).not.toContainText(blockedDates.noticeDeadline);
  106 |   await expect(blockedRow).not.toContainText(blockedDates.actionDate);
  107 |   await expect(blockedRow.getByText(/^Notice /)).toHaveCount(0);
  108 |   await expect(blockedRow.getByText(/^Act /)).toHaveCount(0);
  109 | 
  110 |   const expiredRow = page.getByRole("row").filter({ hasText: "Expired Vendor" });
  111 |   await expect(expiredRow).toHaveCount(1);
  112 |   await expect(expiredRow).toContainText(expiredDates.noticeDeadline);
  113 |   await expect(expiredRow).toContainText(expiredDates.actionDate);
  114 |   await expect(expiredRow).toContainText(expiredContract.computed.reason);
  115 | 
  116 |   await page.goto("/review?id=blocked-deadline");
  117 |   const blockedPanel = page
  118 |     .getByText("No dates are shown until the contract timing can be trusted.", { exact: true })
  119 |     .locator("xpath=../..");
  120 |   await expect(blockedPanel).toContainText("Deadline unavailable");
  121 |   await expect(blockedPanel.getByText("Exit date", { exact: true })).toHaveCount(0);
  122 |   await expect(blockedPanel.getByText("Legal notice deadline", { exact: true })).toHaveCount(0);
  123 |   await expect(blockedPanel.getByText("Start negotiation", { exact: true })).toHaveCount(0);
  124 |   await expect(blockedPanel).not.toContainText(blockedDates.exitDate);
  125 |   await expect(blockedPanel).not.toContainText(blockedDates.noticeDeadline);
  126 |   await expect(blockedPanel).not.toContainText(blockedDates.actionDate);
  127 | 
  128 |   await page.goto("/review?id=expired-deadline");
  129 |   const expiredPanel = page.getByText("Exit date", { exact: true }).locator("xpath=../..");
  130 |   await expect(expiredPanel).toContainText(expiredDates.exitDate);
  131 |   await expect(expiredPanel).toContainText(expiredDates.noticeDeadline);
  132 |   await expect(expiredPanel).toContainText(expiredDates.actionDate);
  133 |   await expect(expiredPanel).toContainText(expiredContract.computed.reason);
  134 | });
```