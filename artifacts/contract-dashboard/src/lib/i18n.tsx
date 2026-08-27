import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type UiLanguage = "en" | "de-CH";

const LANGUAGE_STORAGE_KEY = "contract-dashboard.language";
const missingUiMessages = new Set<string>();

const de: Record<string, string> = {
  "English": "Englisch",
  "Interface language": "Oberflächensprache",
  "Contracts": "Verträge",
  "Renewals": "Verlängerungen",
  "Action Items": "Aufgaben",
  "Settings": "Einstellungen",
  "Log out": "Abmelden",
  "Search contracts...": "Verträge suchen...",
  "Search contracts": "Verträge suchen",
  "Clear search": "Suche löschen",
  "Notifications": "Benachrichtigungen",
  "Welcome back, John": "Willkommen zurück, John",
  "Here's the status of your contract renewals this week.": "Hier ist der Stand Ihrer Vertragsverlängerungen in dieser Woche.",
  "Stay ahead of the contract decisions that need your attention.": "Behalten Sie anstehende Vertragsentscheidungen im Blick.",
  "New Contract": "Neuer Vertrag",
  "New contract": "Neuer Vertrag",
  "Upload a PDF to extract its details": "PDF hochladen und Vertragsdetails extrahieren",
  "We'll prepare an editable draft with confidence ratings for every field.": "Wir erstellen einen bearbeitbaren Entwurf mit Konfidenzwerten für jedes Feld.",
  "Close contract upload": "Vertragsupload schliessen",
  "Reading and extracting your contract...": "Vertrag wird gelesen und extrahiert...",
  "This usually takes a few seconds.": "Dies dauert normalerweise nur wenige Sekunden.",
  "Drop a contract PDF here, or choose a file": "Vertrags-PDF hier ablegen oder Datei auswählen",
  "Select up to 20 PDFs · 10 MB each": "Bis zu 20 PDFs auswählen · je 10 MB",
  "Selected contract files": "Ausgewählte Vertragsdateien",
  "Ingest run": "Importlauf",
  "Processing…": "Wird verarbeitet…",
  "Ready for review": "Bereit zur Prüfung",
  "Duplicate skipped": "Duplikat übersprungen",
  "Retry": "Erneut versuchen",
  "Your PDF is used to create an editable review draft. Confirmed details are saved securely.": "Aus Ihrem PDF wird ein bearbeitbarer Prüfentwurf erstellt. Bestätigte Angaben werden sicher gespeichert.",
  "Extract contract": "Vertrag extrahieren",
  "Only PDF files up to 10 MB can be added.": "Es können nur PDF-Dateien bis 10 MB hinzugefügt werden.",
  "Could not process this PDF.": "Dieses PDF konnte nicht verarbeitet werden.",
  "Could not save this ingest run.": "Dieser Importlauf konnte nicht gespeichert werden.",
  "This PDF has no readable contract text.": "Dieses PDF enthält keinen lesbaren Vertragstext.",
  "The extraction service is temporarily unavailable.": "Der Extraktionsdienst ist vorübergehend nicht verfügbar.",
  "Critical Renewals": "Kritische Verlängerungen",
  "Past the legal notice deadline": "Rechtliche Kündigungsfrist überschritten",
  "Upcoming": "Bevorstehend",
  "Total Active Contracts": "Aktive Verträge insgesamt",
  "Open action items": "Offene Aufgaben",
  "open": "offen",
  "Who needs to act, on what, and by when.": "Wer muss bis wann welche Aufgabe erledigen.",
  "Send now": "Jetzt senden",
  "Contract action": "Vertragsaktion",
  "Hi": "Guten Tag",
  "needs attention.": "erfordert Ihre Aufmerksamkeit.",
  "Start action by:": "Aktion beginnen bis:",
  "Open contract:": "Vertrag öffnen:",
  "Dismiss": "Verwerfen",
  "Confirm dismissal": "Verwerfen bestätigen",
  "Cancel": "Abbrechen",
  "Why is this handled?": "Warum ist dies erledigt?",
  "No actionable alerts. Blocked and expired contracts are excluded.": "Keine umsetzbaren Hinweise. Blockierte und abgelaufene Verträge sind ausgeschlossen.",
  "Saved views": "Gespeicherte Ansichten",
  "Save common registry queues and reopen them with one click.": "Speichern Sie häufig verwendete Registerfilter und öffnen Sie sie mit einem Klick.",
  "Save current view": "Aktuelle Ansicht speichern",
  "View name": "Name der Ansicht",
  "e.g. Renewal review queue": "z. B. Prüfwarteschlange Verlängerungen",
  "all searches": "alle Suchanfragen",
  "all document types": "alle Dokumenttypen",
  "Saving…": "Wird gespeichert…",
  "Saves ": "Speichert ",
  "Search: ": "Suche: ",
  "Rename": "Umbenennen",
  "Originally extracted as ": "Ursprünglich extrahiert als ",
  "This only removes the saved shortcut; your contracts are not affected.": "Dadurch wird nur die gespeicherte Verknüpfung entfernt; Ihre Verträge bleiben unverändert.",
  "Past legal notice deadline": "Rechtliche Kündigungsfrist überschritten",
  "Save view": "Ansicht speichern",
  "Loading saved views…": "Gespeicherte Ansichten werden geladen…",
  "Saved views could not be loaded. Refresh and try again.": "Gespeicherte Ansichten konnten nicht geladen werden. Aktualisieren Sie die Seite und versuchen Sie es erneut.",
  "This view could not be saved. Check the name and try again.": "Diese Ansicht konnte nicht gespeichert werden. Prüfen Sie den Namen und versuchen Sie es erneut.",
  "This view could not be renamed. Check the name and try again.": "Diese Ansicht konnte nicht umbenannt werden. Prüfen Sie den Namen und versuchen Sie es erneut.",
  "This view's pin state could not be updated. Please try again.": "Der Anheftungsstatus dieser Ansicht konnte nicht aktualisiert werden. Versuchen Sie es erneut.",
  "This view order could not be saved. Please try again.": "Die Reihenfolge der Ansichten konnte nicht gespeichert werden. Versuchen Sie es erneut.",
  "This view could not be deleted. Please try again.": "Diese Ansicht konnte nicht gelöscht werden. Versuchen Sie es erneut.",
  "Give this view a clear name before saving.": "Geben Sie dieser Ansicht vor dem Speichern einen eindeutigen Namen.",
  "A saved view needs a name.": "Eine gespeicherte Ansicht benötigt einen Namen.",
  "No saved views yet. Save the current search and document type filters to create a reusable queue.": "Noch keine Ansichten gespeichert. Speichern Sie die aktuelle Suche und die Dokumenttypfilter als wiederverwendbare Warteschlange.",
  "Save": "Speichern",
  "Pinned": "Angeheftet",
  "Active": "Aktiv",
  "All searches": "Alle Suchanfragen",
  "All document types": "Alle Dokumenttypen",
  "Deleting…": "Wird gelöscht…",
  "Delete": "Löschen",
  "Contract Registry": "Vertragsregister",
  "Document type": "Dokumenttyp",
  "Filter by document type": "Nach Dokumenttyp filtern",
  "Clear document type filter": "Dokumenttypfilter löschen",
  "Clear type": "Typ löschen",
  "Copy filtered view link": "Link zur gefilterten Ansicht kopieren",
  "Link copied": "Link kopiert",
  "Copy failed — try again": "Kopieren fehlgeschlagen — erneut versuchen",
  "Copy view link": "Ansichtslink kopieren",
  "View All": "Alle anzeigen",
  "Extracted contract details": "Extrahierte Vertragsdetails",
  "Computed runway": "Berechneter Zeitplan",
  "Extracted value": "Extrahierter Wert",
  "Assigned ownership": "Zugewiesene Verantwortung",
  "Vendor": "Anbieter",
  "Contract type": "Vertragstyp",
  "End date": "Enddatum",
  "Renewal mechanism": "Verlängerungsmechanismus",
  "Notice period": "Kündigungsfrist",
  "Action date": "Aktionsdatum",
  "Notice deadline": "Kündigungsfrist",
  "notice deadline": "Kündigungsfrist",
  "Days remaining": "Verbleibende Tage",
  "Status": "Status",
  "Status reason": "Statusgrund",
  "Value": "Wert",
  "Owner": "Verantwortliche Person",
  "Negotiation buffer": "Verhandlungspuffer",
  "Unknown vendor": "Unbekannter Anbieter",
  "Unknown Vendor": "Unbekannter Anbieter",
  "Within action runway": "Innerhalb des Aktionszeitraums",
  "Action window approaching": "Aktionszeitraum rückt näher",
  "Contract end date has passed": "Vertragsenddatum ist verstrichen",
  "Dates blocked — review required": "Datumsberechnung blockiert — Prüfung erforderlich",
  "blocked — not enough contract data to compute dates": "blockiert — unzureichende Vertragsdaten zur Berechnung der Fristen",
  "Select type": "Typ auswählen",
  "Not computable": "Nicht berechenbar",
  "Computed exit": "Berechnetes Vertragsende",
  "Extracted rule": "Extrahierte Regel",
  "Negotiation start": "Verhandlungsbeginn",
  "Legal deadline": "Rechtliche Frist",
  "Legal notice deadline:": "Rechtliche Kündigungsfrist:",
  "Until action": "Bis zur Aktion",
  "overdue": "überfällig",
  "Needs review": "Prüfung erforderlich",
  "Unassigned": "Nicht zugewiesen",
  "Assigned owner": "Zugewiesene Person",
  "Default": "Standard",
  "global default": "globaler Standard",
  "contract type default": "Standard des Vertragstyps",
  "contract override": "vertragsspezifische Vorgabe",
  "Contract type could not be saved. Please try again.": "Der Vertragstyp konnte nicht gespeichert werden. Versuchen Sie es erneut.",
  "We could not save this contract. Please try again.": "Der Vertrag konnte nicht gespeichert werden. Versuchen Sie es erneut.",
  "No confirmed contracts yet. Upload a PDF to get started.": "Noch keine bestätigten Verträge. Laden Sie ein PDF hoch, um zu beginnen.",
  "No contracts match the current filters.": "Keine Verträge entsprechen den aktuellen Filtern.",
  "Type not stated": "Typ nicht angegeben",
  "Value not stated": "Wert nicht angegeben",
  "Notice terms not stated": "Kündigungsbedingungen nicht angegeben",
  "before": "vor",
  "Action date unavailable": "Aktionsdatum nicht verfügbar",
  "Action starts today": "Aktion beginnt heute",
  "Not stated": "Nicht angegeben",
  "Review workspace": "Prüfbereich",
  "Back to registry": "Zurück zum Register",
  "Contract review": "Vertragsprüfung",
  "Resolve the open decisions": "Offene Entscheidungen klären",
  "Confirm only what is uncertain. The full extracted record stays available when you need it.": "Bestätigen Sie nur unsichere Angaben. Der vollständige extrahierte Datensatz bleibt jederzeit verfügbar.",
  "Confirm review": "Prüfung bestätigen",
  "Set an application owner and email so notices have a clear recipient.": "Legen Sie eine verantwortliche Person und E-Mail fest, damit Hinweise eindeutig zugestellt werden.",
  "Set an application owner so notices have a clear recipient.": "Legen Sie eine verantwortliche Person fest, damit Hinweise eindeutig zugestellt werden.",
  "Enter a valid owner email so alerts can be delivered.": "Geben Sie eine gültige E-Mail-Adresse ein, damit Hinweise zugestellt werden können.",
  "All confirmation fields are ready.": "Alle Bestätigungsfelder sind bereit.",
  "No contract loaded": "Kein Vertrag geladen",
  "Return to the dashboard to upload a PDF or choose a saved contract.": "Kehren Sie zum Dashboard zurück, um ein PDF hochzuladen oder einen gespeicherten Vertrag auszuwählen.",
  "Contract value": "Vertragswert",
  "Value status is unresolved": "Wertstatus ist ungeklärt",
  "Current term ends": "Aktuelle Laufzeit endet",
  "Deadline unavailable": "Frist nicht verfügbar",
  "Source document": "Quelldokument",
  "Embedded text extraction": "Extraktion aus eingebettetem Text",
  "Needs your decision": "Ihre Entscheidung erforderlich",
  "All clear": "Alles geklärt",
  "Resolve the flagged points below; confirmed fields stay out of your way.": "Klären Sie die markierten Punkte; bestätigte Felder werden ausgeblendet.",
  "Assignment · required": "Zuweisung · erforderlich",
  "Who owns the renewal decision?": "Wer ist für die Verlängerungsentscheidung verantwortlich?",
  "This person receives the action alert and is accountable for the next move.": "Diese Person erhält den Aktionshinweis und verantwortet den nächsten Schritt.",
  "Confirm the accountable person and a deliverable address for renewal alerts.": "Bestätigen Sie die verantwortliche Person und eine zustellbare Adresse für Verlängerungshinweise.",
  "Owner email": "E-Mail der verantwortlichen Person",
  "Enter a valid email address.": "Geben Sie eine gültige E-Mail-Adresse ein.",
  "e.g. John Doe": "z. B. John Doe",
  "Resolution": "Lösung",
  "Resolve": "Klären",
  "The review is resolved": "Die Prüfung ist abgeschlossen",
  "All tracked decisions have a value or an explicit reviewer resolution.": "Alle erfassten Entscheidungen haben einen Wert oder eine ausdrückliche Prüflösung.",
  "Full extraction": "Vollständige Extraktion",
  "Secondary view": "Sekundäransicht",
  "Secondary view ·": "Sekundäransicht ·",
  "extracted fields": "extrahierte Felder",
  "Review progress": "Prüffortschritt",
  "Nothing else is blocking confirmation.": "Die Bestätigung wird durch nichts Weiteres blockiert.",
  "Renewal timeline": "Verlängerungszeitplan",
  "Resolve the timing fields to calculate this contract's deadlines.": "Klären Sie die Zeitangaben, um die Vertragsfristen zu berechnen.",
  "Start negotiation": "Verhandlung beginnen",
  "Legal notice": "Rechtliche Kündigung",
  "Exit date": "Vertragsenddatum",
  "Assignment": "Zuweisung",
  "Negotiation buffer (days)": "Verhandlungspuffer (Tage)",
  "Contract override": "Vertragsspezifische Vorgabe",
  "Inherited from contract type": "Vom Vertragstyp übernommen",
  "Inherited global default": "Globalen Standard übernommen",
  "Select an option": "Option auswählen",
  "Amount": "Betrag",
  "Days": "Tage",
  "Notice period amount": "Dauer der Kündigungsfrist",
  "Notice period unit": "Einheit der Kündigungsfrist",
  "Notice period anchor": "Bezugsdatum der Kündigungsfrist",
  "page": "Seite",
  "Page": "Seite",
  "clause": "Klausel",
  "Currency": "Währung",
  "Leave blank to record “not stated”.": "Leer lassen, um «nicht angegeben» zu erfassen.",
  "Enter JSON": "JSON eingeben",
  "Structured contract value": "Strukturierter Vertragswert",
  "Enter a value": "Wert eingeben",
  "computed by the application": "von der Anwendung berechnet",
  "Confidence": "Konfidenz",
  "No source page": "Keine Quellseite",
  "Verbatim quote": "Wörtliches Zitat",
  "No quote in the source document": "Kein Zitat im Quelldokument",
  "Extraction note": "Extraktionshinweis",
  "Competing readings": "Abweichende Lesarten",
  "Reading": "Lesart",
  "Originally extracted": "Ursprünglich extrahiert",
  "Email": "E-Mail",
  "Missing": "Fehlt",
  "reviewer supplied": "durch Prüfer ergänzt",
  "reviewed": "geprüft",
  "found": "gefunden",
  "not found": "nicht gefunden",
  "ambiguous": "mehrdeutig",
  "conflicting": "widersprüchlich",
  "Source": "Quelle",
  "Untitled contract": "Vertrag ohne Titel",
  "Not calculated": "Nicht berechnet",
  "Document": "Dokument",
  "Language": "Sprache",
  "Contract title": "Vertragstitel",
  "Buyer legal entity": "Rechtliche Einheit des Käufers",
  "Dates & renewal": "Daten & Verlängerung",
  "Signature date": "Unterschriftsdatum",
  "Renewal term length": "Verlängerungslaufzeit",
  "Notice delivery": "Zustellung der Kündigung",
  "Billing frequency": "Abrechnungshäufigkeit",
  "Vendor legal name": "Rechtlicher Anbietername",
  "Identity": "Identität",
  "Which legal entity is the supplier?": "Welche Rechtseinheit ist der Anbieter?",
  "This name is used across the registry and owner notifications.": "Dieser Name wird im Register und in Benachrichtigungen verwendet.",
  "Commercial terms": "Kaufmännische Bedingungen",
  "Which contract category best matches this agreement?": "Welche Vertragskategorie passt am besten zu dieser Vereinbarung?",
  "Used to compare similar renewal exposure.": "Wird zum Vergleich ähnlicher Verlängerungsrisiken verwendet.",
  "Contract number": "Vertragsnummer",
  "What identifier should the team use to find this agreement?": "Mit welcher Kennung soll das Team diese Vereinbarung finden?",
  "Use the document number, reference, or internal ID.": "Verwenden Sie Dokumentnummer, Referenz oder interne ID.",
  "Effective date": "Gültigkeitsdatum",
  "Timing": "Zeitplan",
  "When did this agreement become effective?": "Wann wurde diese Vereinbarung wirksam?",
  "The effective date anchors the contract timeline.": "Das Gültigkeitsdatum bildet die Grundlage des Vertragszeitplans.",
  "Initial term length": "Anfängliche Laufzeit",
  "How long is the initial term?": "Wie lange dauert die anfängliche Laufzeit?",
  "Enter the duration exactly as the agreement defines it.": "Geben Sie die Dauer genau wie in der Vereinbarung definiert ein.",
  "Initial term end date": "Enddatum der anfänglichen Laufzeit",
  "When does the current term end?": "Wann endet die aktuelle Laufzeit?",
  "This is the anchor for renewal and notice calculations.": "Dies ist die Grundlage für Verlängerungs- und Kündigungsberechnungen.",
  "Renewal": "Verlängerung",
  "How does this agreement continue or end?": "Wie wird diese Vereinbarung fortgesetzt oder beendet?",
  "Choose the clause behavior, not the business team's preference.": "Wählen Sie die Wirkung der Klausel, nicht die Präferenz des Teams.",
  "How much notice is required before the term ends?": "Welche Kündigungsfrist gilt vor Ende der Laufzeit?",
  "The legal notice deadline is calculated from this value.": "Aus diesem Wert wird die rechtliche Kündigungsfrist berechnet.",
  "What value should the registry track?": "Welcher Wert soll im Register erfasst werden?",
  "Leave it as not stated when the document provides no reliable value.": "Belassen Sie «nicht angegeben», wenn das Dokument keinen verlässlichen Wert enthält.",
  "months": "Monate",
  "month": "Monat",
  "days": "Tage",
  "day": "Tag",
  "years": "Jahre",
  "year": "Jahr",
  "annual": "jährlich",
  "monthly": "monatlich",
  "quarterly": "vierteljährlich",
  "one time": "einmalig",
  "milestone": "Meilenstein",
  "usage": "Nutzung",
  "total contract value": "Gesamtvertragswert",
  "per unit": "pro Einheit",
  "not to exceed": "Höchstbetrag",
  "variable": "variabel",
  "maintenance": "Wartung",
  "software license": "Softwarelizenz",
  "saas subscription": "SaaS-Abonnement",
  "real estate": "Immobilien",
  "infrastructure": "Infrastruktur",
  "professional services": "Professionelle Dienstleistungen",
  "data services": "Datendienste",
  "equipment lease": "Geräteleasing",
  "other": "Sonstiges",
  "auto renew": "automatische Verlängerung",
  "expires": "läuft aus",
  "by mutual agreement": "im gegenseitigen Einvernehmen",
  "indefinite": "unbefristet",
  "term end": "Laufzeitende",
  "weeks": "Wochen",
  "week": "Woche",
  "renewal date": "Verlängerungsdatum",
  "anniversary": "Jahrestag",
  "period end month": "Monatsende",
  "period end quarter": "Quartalsende",
  "period end year": "Jahresende",
  "any time": "jederzeit",
  "unknown": "unbekannt",
  "High": "Hohe",
  "Medium": "Mittlere",
  "Low": "Geringe",
  "legibility": "Lesbarkeit",
  "due": "fällig",
  "dismissed": "verworfen",
  "blocked": "blockiert",
  "expired": "abgelaufen",
  "green": "grün",
  "amber": "orange",
  "red": "rot",
  "At Risk": "Gefährdet",
  "Review Open": "Prüfung offen",
  "In Negotiation": "In Verhandlung",
  "master agreement": "Rahmenvertrag",
  "service agreement": "Dienstleistungsvertrag",
  "order form": "Bestellformular",
  "statement of work": "Leistungsbeschreibung",
  "amendment": "Nachtrag",
  "renewal letter": "Verlängerungsschreiben",
  "termination notice": "Kündigungsschreiben",
  "quote or proposal": "Angebot oder Offerte",
  "addendum": "Ergänzung",
  "nda": "Geheimhaltungsvereinbarung",
  "licence": "Lizenz",
  "perpetual": "unbefristet",
  "fixed term": "befristet",
  "manual renewal": "manuelle Verlängerung",
  "non renewal": "Nichtverlängerung",
  "Operations Workspace": "Operationsbereich",
  "Stay ahead of": "Behalten Sie",
  "contract renewals.": "Vertragsverlängerungen im Blick.",
  "Contract Dashboard is the dedicated workspace for operations teams to track, manage, and negotiate agreements before they expire. No surprises, just leverage.": "Contract Dashboard ist der zentrale Arbeitsbereich für Operations-Teams, um Verträge vor ihrem Ablauf zu verfolgen, zu verwalten und neu zu verhandeln. Keine Überraschungen, sondern Handlungsspielraum.",
  "Continue to Contract Dashboard": "Weiter zu Contract Dashboard",
  "Enterprise Grade": "Für Unternehmen geeignet",
  "Real-time Alerts": "Hinweise in Echtzeit",
  "Expires in 3d": "Läuft in 3 Tagen ab",
  "Vendor Approved": "Anbieter freigegeben",
  "Savings Captured": "Einsparungen erfasst",
  "Negotiated rate": "Ausgehandelter Preis",
  "404 Page Not Found": "404 Seite nicht gefunden",
  "Did you forget to add the page to the router?": "Wurde diese Seite noch nicht zum Router hinzugefügt?",
};

export function localize(language: UiLanguage, value: string) {
  if (language === "en") return value;
  const direct = de[value];
  if (direct) return direct;
  const knownApiError = value.match(/^HTTP \d+ [^:]+: (This PDF has no readable contract text\.|The extraction service is temporarily unavailable\.)$/);
  if (knownApiError) return de[knownApiError[1]] ?? knownApiError[1];
  const allDocumentTypes = value.match(/^All document types \((\d+)\)$/);
  if (allDocumentTypes) return `Alle Dokumenttypen (${allDocumentTypes[1]})`;
  const replacements: Array<[RegExp, (...matches: string[]) => string]> = [
    [/^(\d+) PDF(s?) selected$/, (_, count) => `${count} PDF${count === "1" ? "" : "s"} ausgewählt`],
    [/^(\d+)\/(\d+) complete$/, (_, done, total) => `${done}/${total} abgeschlossen`],
    [/^Showing (\d+) of (\d+) contracts$/, (_, shown, total) => `${shown} von ${total} Verträgen angezeigt`],
    [/^(\d+) open$/, (_, count) => `${count} offen`],
    [/^(\d+) extracted fields$/, (_, count) => `${count} extrahierte Felder`],
    [/^(\d+) decision(s?) still needs attention\.$/, (_, count) => `${count} Entscheidung${count === "1" ? "" : "en"} muss noch bearbeitet werden.`],
    [/^(\d+) required field remains before confirmation\.$/, (_, count) => `${count} Pflichtfeld muss vor der Bestätigung ergänzt werden.`],
    [/^(\d+) required fields remain before confirmation\.$/, (_, count) => `${count} Pflichtfelder müssen vor der Bestätigung ergänzt werden.`],
    [/^(\d+) days? until action$/, (_, count) => `${count} Tag${count === "1" ? "" : "e"} bis zur Aktion`],
    [/^(\d+) days? past action date$/, (_, count) => `${count} Tag${count === "1" ? "" : "e"} nach dem Aktionsdatum`],
    [/^(\d+) days$/, (_, count) => `${count} Tage`],
    [/^([A-Z]{3} .+) · (.+)$/, (_, amount, basis) => `${amount} · ${de[basis] ?? basis}`],
    [/^(\d+) (days|months|years)(?: before (.+))?$/, (_, count, unit, anchor) =>
      `${count} ${de[unit] ?? unit}${anchor ? ` vor ${de[anchor] ?? anchor}` : ""}`],
    [/^(.+) \((\d+)\)$/, (_, label, count) => `${de[label] ?? label} (${count})`],
    [/^Alert due (.+) to (.+)$/, (_, date, owner) => `Hinweis fällig am ${date} für ${owner}`],
    [/^Legal notice deadline (.+)$/, (_, date) => `Rechtliche Kündigungsfrist ${date}`],
    [/^Dismissed: (.+)$/, (_, reason) => `Verworfen: ${reason}`],
    [/^Edited · extracted (.+)$/, (_, value) => `Bearbeitet · extrahiert: ${value}`],
    [/^OCR · (High|Medium|Low|unknown) legibility$/, (_, level) => `OCR · ${de[level] ?? level} Lesbarkeit`],
    [/^Remove (.+)$/, (_, name) => `${name} entfernen`],
    [/^Retry (.+)$/, (_, name) => `${name} erneut versuchen`],
    [/^Contract type for (.+)$/, (_, name) => `Vertragstyp für ${name}`],
    [/^Open saved view (.+)$/, (_, name) => `Gespeicherte Ansicht ${name} öffnen`],
    [/^Pin saved view (.+)$/, (_, name) => `Gespeicherte Ansicht ${name} anheften`],
    [/^Unpin saved view (.+)$/, (_, name) => `Gespeicherte Ansicht ${name} lösen`],
    [/^Rename saved view (.+)$/, (_, name) => `Gespeicherte Ansicht ${name} umbenennen`],
    [/^Delete saved view (.+)$/, (_, name) => `Gespeicherte Ansicht ${name} löschen`],
    [/^Move (.+) up(?: \(already first\))?$/, (_, name) => `${name} nach oben verschieben`],
    [/^Move (.+) down(?: \(already last\))?$/, (_, name) => `${name} nach unten verschieben`],
    [/^Delete “(.+)”\?$/, (_, name) => `«${name}» löschen?`],
  ];
  for (const [pattern, replacement] of replacements) {
    const match = value.match(pattern);
    if (match) return replacement(...match);
  }
  return value;
}

export function translateUiMessage(language: UiLanguage, text: string) {
  const translated = localize(language, text);
  if (language === "de-CH" && !(text in de) && translated === text) {
    missingUiMessages.add(text);
    if (import.meta.env.DEV) {
      console.error(`[i18n] Missing de-CH interface translation: ${JSON.stringify(text)}`);
    }
  }
  return translated;
}

export function getMissingUiMessages() {
  return [...missingUiMessages];
}

export function resetMissingUiMessages() {
  missingUiMessages.clear();
}

type LanguageContextValue = {
  language: UiLanguage;
  setLanguage: (language: UiLanguage) => void;
  t: (text: string) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<UiLanguage>(() =>
    localStorage.getItem(LANGUAGE_STORAGE_KEY) === "de-CH" ? "de-CH" : "en",
  );

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = (next: UiLanguage) => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    setLanguageState(next);
  };

  return (
    <LanguageContext.Provider value={{
      language,
      setLanguage,
      t: (text) => translateUiMessage(language, text),
    }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within LanguageProvider");
  return context;
}

export function LanguageSwitch() {
  const { language, setLanguage, t } = useLanguage();
  return (
    <select
      value={language}
      onChange={(event) => setLanguage(event.target.value as UiLanguage)}
      aria-label={t("Interface language")}
      className="h-9 rounded-md border border-input bg-background px-2 text-xs font-bold outline-none focus:ring-2 focus:ring-primary/20"
    >
      <option value="en">{t("English")}</option>
      <option value="de-CH">Deutsch (Schweiz)</option>
    </select>
  );
}