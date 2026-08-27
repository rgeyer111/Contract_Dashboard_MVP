import { expect, test } from "@playwright/test";
import {
  translate,
  translateDomainOption,
  translateGeneratedReasonOrRaw,
} from "../src/lib/i18n";
import { displayEvidenceValue } from "../src/lib/review";

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
  expect(translateGeneratedReasonOrRaw("de-CH", "toString")).toBe("toString");
  expect(translateGeneratedReasonOrRaw(
    "de-CH",
    "blocked — no notice clause was found. Add or confirm the applicable notice period and cite its contract clause.",
  )).toBe("blockiert — unzureichende Vertragsdaten zur Berechnung der Fristen");
  expect(translateGeneratedReasonOrRaw("de-CH", "Backend supplied reason — unchanged"))
    .toBe("Backend supplied reason — unchanged");
});