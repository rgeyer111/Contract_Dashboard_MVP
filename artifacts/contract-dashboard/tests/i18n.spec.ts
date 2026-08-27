import { expect, test } from "@playwright/test";
import {
  translate,
  translateDomainOption,
  translateComputedReasonOrDetail,
} from "../src/lib/i18n";
import { displayEvidenceValue } from "../src/lib/review";
import { createEmptyContractReviewRecord } from "../src/lib/contracts";

test("German catalog translates every registered message", () => {
  expect(translate("de-CH", "ui.contracts")).toBe("Verträge");
  expect(translate("de-CH", "review.requiredFieldCount", { count: 2 }))
    .toBe("2 Pflichtfelder müssen vor der Bestätigung ergänzt werden.");
  expect(translate("de-CH", "registry.daysUntilAction", { count: 1 })).toBe("1 Tag bis zur Aktion");
  expect(translate("de-CH", "registry.daysUntilAction", { count: 2 })).toBe("2 Tage bis zur Aktion");
  expect(translateDomainOption("de-CH", "pending")).toBe("ausstehend");
  expect(translate("de-CH", "upload.errorSuperseded"))
    .toBe("Dieser Upload wurde durch einen neueren ersetzt. Verwenden Sie das aktuelle Ergebnis.");
});

test("interpolation preserves user and source values verbatim", () => {
  const name = "Acme (Original) / «Nord»";
  const date = "03.04.2027";

  expect(translate("de-CH", "alert.dueTo", { date, owner: name }))
    .toBe(`Hinweis fällig am ${date} für ${name}`);
  expect(translate("de-CH", "view.confirmDelete", { name }))
    .toBe(`«${name}» löschen?`);
  expect(displayEvidenceValue("Acme_Corp", "de-CH")).toBe("Acme_Corp");
  expect(displayEvidenceValue({ unit: "business_days" }, "de-CH"))
    .toBe('{"unit":"business_days"}');
  expect(translateComputedReasonOrDetail("de-CH", null, "toString")).toBe("toString");
  expect(translateComputedReasonOrDetail(
    "de-CH",
    "NOTICE_CLAUSE_NOT_FOUND",
    null,
  )).toBe("Es wurde keine Kündigungsklausel gefunden. Ergänzen oder bestätigen Sie die anwendbare Kündigungsfrist und die Vertragsstelle.");
  expect(translateComputedReasonOrDetail(
    "de-CH",
    "NOTICE_CLAUSE_NOT_FOUND",
    "Clause reference supplied by backend",
  )).toBe("Es wurde keine Kündigungsklausel gefunden. Ergänzen oder bestätigen Sie die anwendbare Kündigungsfrist und die Vertragsstelle. — Clause reference supplied by backend");
  expect(translateComputedReasonOrDetail("de-CH", null, "Backend supplied reason — unchanged"))
    .toBe("Backend supplied reason — unchanged");
});

test("fresh German reviews contain no English deadline fallback", () => {
  const computed = createEmptyContractReviewRecord().computed;
  const explanation = translateComputedReasonOrDetail(
    "de-CH",
    computed.reasonCode,
    computed.reason,
  );

  expect(computed.reason).toBeNull();
  expect(explanation).toBe(
    "Das Vertragsende kann nicht bestimmt werden. Ergänzen Sie das Ende der Erstlaufzeit oder bestätigen Sie Wirksamkeitsdatum und Laufzeit.",
  );
  expect(explanation).not.toContain("blocked");
});