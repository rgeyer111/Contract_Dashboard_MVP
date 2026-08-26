import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Bell,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  CircleHelp,
  FileText,
  GitBranch,
  Layers3,
  LogOut,
  Save,
  Search,
  Settings,
  ShieldCheck,
  User,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useCreateContract,
  useGetContract,
  useListContracts,
  useUpdateContract,
  type ContractExtractionResult,
  type ContractReviewRecord,
  type ProvenanceMetadata,
} from "@workspace/api-client-react";
import {
  assignmentStatusOptions,
  billingFrequencyOptions,
  contractTypeOptions,
  contractValueBasisOptions,
  createEmptyContractReviewRecord,
  documentTypeOptions,
  languageOptions,
  periodUnitOptions,
  renewalMechanismOptions,
} from "@/lib/contracts";

const extractionStorageKey = "contract-dashboard.extraction";
const extractionQueueStorageKey = "contract-dashboard.extraction-queue";
const reviewerEditNote = "Reviewer-supplied value; original extraction evidence was cleared.";
const noticeAnchorOptions = [
  "term_end",
  "renewal_date",
  "anniversary",
  "period_end_month",
  "period_end_quarter",
  "period_end_year",
  "any_time",
  "unknown",
] as const;

type FieldKey = keyof ContractReviewRecord["fields"];
type AnyField = ProvenanceMetadata & { value: any };

type IssueDefinition = {
  key: FieldKey;
  label: string;
  section: string;
  prompt: string;
  hint: string;
};

const issueDefinitions: IssueDefinition[] = [
  {
    key: "vendorLegalName",
    label: "Vendor legal name",
    section: "Identity",
    prompt: "Which legal entity is the supplier?",
    hint: "This name is used across the registry and owner notifications.",
  },
  {
    key: "contractType",
    label: "Contract type",
    section: "Commercial terms",
    prompt: "Which contract category best matches this agreement?",
    hint: "Used to compare similar renewal exposure.",
  },
  {
    key: "contractNumber",
    label: "Contract number",
    section: "Identity",
    prompt: "What identifier should the team use to find this agreement?",
    hint: "Use the document number, reference, or internal ID.",
  },
  {
    key: "effectiveDate",
    label: "Effective date",
    section: "Timing",
    prompt: "When did this agreement become effective?",
    hint: "The effective date anchors the contract timeline.",
  },
  {
    key: "initialTermLength",
    label: "Initial term length",
    section: "Timing",
    prompt: "How long is the initial term?",
    hint: "Enter the duration exactly as the agreement defines it.",
  },
  {
    key: "initialTermEndDate",
    label: "Initial term end date",
    section: "Timing",
    prompt: "When does the current term end?",
    hint: "This is the anchor for renewal and notice calculations.",
  },
  {
    key: "renewalMechanism",
    label: "Renewal mechanism",
    section: "Renewal",
    prompt: "How does this agreement continue or end?",
    hint: "Choose the clause behavior, not the business team's preference.",
  },
  {
    key: "noticePeriod",
    label: "Notice period",
    section: "Renewal",
    prompt: "How much notice is required before the term ends?",
    hint: "The legal notice deadline is calculated from this value.",
  },
  {
    key: "contractValue",
    label: "Contract value",
    section: "Commercial terms",
    prompt: "What value should the registry track?",
    hint: "Leave it as not stated when the document provides no reliable value.",
  },
];

const detailGroups: Array<{ title: string; fields: Array<{ key: FieldKey; label: string; kind: "text" | "select" | "period" | "json" | "value" }> }> = [
  {
    title: "Document",
    fields: [
      { key: "documentType", label: "Document type", kind: "select" },
      { key: "documentLanguage", label: "Language", kind: "select" },
      { key: "contractTitle", label: "Contract title", kind: "text" },
      { key: "buyerLegalEntity", label: "Buyer legal entity", kind: "text" },
    ],
  },
  {
    title: "Dates & renewal",
    fields: [
      { key: "signatureDate", label: "Signature date", kind: "text" },
      { key: "renewalTermLength", label: "Renewal term length", kind: "period" },
      { key: "noticeDelivery", label: "Notice delivery", kind: "json" },
      { key: "billingFrequency", label: "Billing frequency", kind: "select" },
    ],
  },
];

function readStoredExtraction(): ContractExtractionResult | null {
  try {
    const saved = sessionStorage.getItem(extractionStorageKey);
    if (!saved) return null;
    const parsed = JSON.parse(saved) as ContractExtractionResult;
    return parsed?.filename && parsed?.extraction?.contract ? parsed : null;
  } catch {
    return null;
  }
}

function readExtractionQueue(): ContractExtractionResult[] {
  try {
    const saved = sessionStorage.getItem(extractionQueueStorageKey);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item) => item?.filename && item?.extraction?.contract)
      : [];
  } catch {
    return [];
  }
}

function getField(record: ContractReviewRecord, key: FieldKey): AnyField {
  return record.fields[key] as AnyField;
}

function hasValue(value: unknown) {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).some((item) => item !== null && item !== "");
  return true;
}

function displayValue(value: any): string {
  if (!hasValue(value)) return "Not stated";
  if (typeof value === "object") {
    if ("amount" in value) return `${value.amount ?? ""} ${value.unit ?? ""}`.trim();
    if ("currency" in value) return `${value.currency ?? ""} ${value.amount?.toLocaleString?.() ?? ""}`.trim();
    return Object.entries(value)
      .map(([key, item]) => `${key}: ${Array.isArray(item) ? item.join(", ") : item}`)
      .join(" · ");
  }
  return String(value).replace(/_/g, " ");
}

function statusLabel(status: AnyField["status"]) {
  return status.replace("_", " ");
}

function isIssue(field: AnyField) {
  return !field.reviewed && (field.status !== "found" || !hasValue(field.value));
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not calculated";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}.${month}.${year}`;
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value || ""}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-semibold outline-none transition focus:ring-2 focus:ring-primary/20"
    />
  );
}

function SelectInput({
  value,
  onChange,
  options,
}: {
  value: string | null;
  onChange: (value: string) => void;
  options: readonly string[];
}) {
  return (
    <select
      value={value || ""}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-semibold outline-none transition focus:ring-2 focus:ring-primary/20"
    >
      <option value="" disabled>Select an option</option>
      {options.map((option) => (
        <option key={option} value={option}>{option.replace(/_/g, " ")}</option>
      ))}
    </select>
  );
}

function PeriodInput({ value, onChange }: { value: any; onChange: (value: any) => void }) {
  const amount = value?.amount ?? "";
  const unit = value?.unit ?? "months";
  return (
    <div className="flex gap-2">
      <input
        type="number"
        min="1"
        value={amount}
        onChange={(event) => onChange({ amount: Number(event.target.value) || 0, unit })}
        className="h-10 w-24 rounded-md border border-input bg-background px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary/20"
        placeholder="Amount"
      />
      <select
        value={unit}
        onChange={(event) => onChange({ amount: Number(amount) || 0, unit: event.target.value })}
        className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary/20"
      >
        {periodUnitOptions.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </div>
  );
}

function NoticePeriodInput({ value, onChange }: { value: any; onChange: (value: any) => void }) {
  const current = Array.isArray(value) ? value[0] : value;
  const amount = current?.amount ?? "";
  const unit = current?.unit ?? "days";
  const anchor = current?.anchor ?? "term_end";
  const purpose = current?.purpose ?? "non_renewal";
  const update = (next: Partial<{ amount: number; unit: string; anchor: string; purpose: string | null }>) => {
    onChange({ amount: Number(amount) || 0, unit, anchor, purpose, ...next });
  };
  return (
    <div className="grid gap-2 sm:grid-cols-[90px_1fr_1.35fr]">
      <input
        type="number"
        min="1"
        value={amount}
        onChange={(event) => update({ amount: Number(event.target.value) || 0 })}
        className="h-10 rounded-md border border-input bg-background px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary/20"
        placeholder="Days"
        aria-label="Notice period amount"
      />
      <select value={unit} onChange={(event) => update({ unit: event.target.value })} className="h-10 rounded-md border border-input bg-background px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary/20" aria-label="Notice period unit">
        {periodUnitOptions.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
      <select value={anchor} onChange={(event) => update({ anchor: event.target.value })} className="h-10 rounded-md border border-input bg-background px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary/20" aria-label="Notice period anchor">
        {noticeAnchorOptions.map((option) => <option key={option} value={option}>{option.replace(/_/g, " ")}</option>)}
      </select>
    </div>
  );
}

function ContractValueInput({ value, onChange }: { value: any; onChange: (value: any) => void }) {
  const amount = value?.amount ?? "";
  const currency = value?.currency ?? "USD";
  const basis = value?.basis ?? "annual";
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="number"
          min="0"
          value={amount}
          onChange={(event) => onChange({ amount: Number(event.target.value) || 0, currency, basis })}
          className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary/20"
          placeholder="Amount"
        />
        <input
          type="text"
          maxLength={3}
          value={currency}
          onChange={(event) => onChange({ amount: Number(amount) || 0, currency: event.target.value.toUpperCase(), basis })}
          className="h-10 w-20 rounded-md border border-input bg-background px-3 text-sm font-semibold uppercase outline-none focus:ring-2 focus:ring-primary/20"
          placeholder="USD"
          aria-label="Currency"
        />
      </div>
      <select
        value={basis}
        onChange={(event) => onChange({ amount: Number(amount) || 0, currency, basis: event.target.value })}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary/20"
      >
        {contractValueBasisOptions.map((option) => <option key={option} value={option}>{option.replace(/_/g, " ")}</option>)}
      </select>
      <p className="text-[11px] font-medium text-muted-foreground">Leave blank to record “not stated”.</p>
    </div>
  );
}

function JsonInput({ value, onChange }: { value: any; onChange: (value: any) => void }) {
  const [text, setText] = useState(() => value ? JSON.stringify(value, null, 2) : "");
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setText(value ? JSON.stringify(value, null, 2) : "");
    setHasError(false);
  }, [value]);

  return (
    <textarea
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        try {
          const next = text.trim() ? JSON.parse(text) : null;
          onChange(next);
          setHasError(false);
        } catch {
          setHasError(true);
        }
      }}
      className={`min-h-20 w-full rounded-md border bg-background p-3 font-mono text-xs outline-none focus:ring-2 focus:ring-primary/20 ${hasError ? "border-destructive" : "border-input"}`}
      placeholder="Enter JSON"
      aria-label="Structured contract value"
    />
  );
}

function FieldEditor({
  fieldKey,
  field,
  kind,
  onChange,
}: {
  fieldKey: FieldKey;
  field: AnyField;
  kind: "text" | "select" | "period" | "notice" | "json" | "value";
  onChange: (value: any) => void;
}) {
  if (kind === "select") {
    const options = fieldKey === "documentType"
      ? documentTypeOptions
      : fieldKey === "documentLanguage"
        ? languageOptions
        : fieldKey === "contractType"
          ? contractTypeOptions
          : fieldKey === "renewalMechanism"
            ? renewalMechanismOptions
            : billingFrequencyOptions;
    return <SelectInput value={field.value} onChange={onChange} options={options} />;
  }
  if (kind === "period") return <PeriodInput value={field.value} onChange={onChange} />;
  if (kind === "notice") return <NoticePeriodInput value={field.value} onChange={onChange} />;
  if (kind === "json") return <JsonInput value={field.value} onChange={onChange} />;
  if (kind === "value") return <ContractValueInput value={field.value} onChange={onChange} />;
  return <TextInput value={field.value} onChange={onChange} placeholder="Enter a value" />;
}

function StatusPill({ field }: { field: AnyField }) {
  if (field.reviewed) {
    return (
      <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-primary">
        reviewed
      </span>
    );
  }
  const tone = field.status === "found"
    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700"
    : field.status === "ambiguous" || field.status === "conflicting"
      ? "border-amber-500/20 bg-amber-500/10 text-amber-700"
      : "border-destructive/20 bg-destructive/10 text-destructive";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${tone}`}>
      {statusLabel(field.status)}
    </span>
  );
}

function IssueCard({
  issue,
  field,
  children,
  onResolve,
  canResolve,
}: {
  issue: IssueDefinition;
  field: AnyField;
  children: ReactNode;
  onResolve: () => void;
  canResolve: boolean;
}) {
  return (
    <article className="rounded-xl border border-amber-500/25 bg-card shadow-sm">
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-700">
            <CircleHelp className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-amber-700">{issue.section}</span>
              <StatusPill field={field} />
            </div>
            <h3 className="mt-1 text-base font-extrabold tracking-tight">{issue.label}</h3>
            <p className="mt-1 text-sm font-medium text-muted-foreground">{issue.prompt}</p>
          </div>
        </div>
        {field.quote && (
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs font-medium italic text-muted-foreground">
            “{field.quote}”
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <label className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">Resolution</label>
            {children}
            <p className="mt-1.5 text-[11px] font-medium text-muted-foreground">{issue.hint}</p>
          </div>
          <Button type="button" onClick={onResolve} disabled={!canResolve} className="gap-2 sm:min-w-28">
            <Check className="h-3.5 w-3.5" /> Resolve
          </Button>
        </div>
      </div>
      {(field.page || field.clause) && (
        <div className="border-t bg-muted/20 px-5 py-2 text-[11px] font-semibold text-muted-foreground">
          Source {field.page ? `page ${field.page}` : ""}{field.page && field.clause ? " · " : ""}{field.clause ? `clause ${field.clause}` : ""}
        </div>
      )}
    </article>
  );
}

export default function ReviewCompact() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const savedId = new URLSearchParams(window.location.search).get("id") ?? "";
  const savedContractQuery = useGetContract(savedId, {
    query: {
      enabled: Boolean(savedId),
      queryKey: [`/api/contracts/${savedId}`],
    },
  });
  const contractsQuery = useListContracts();
  const [storedExtraction] = useState(readStoredExtraction);
  const [draft, setDraft] = useState<ContractReviewRecord>(() =>
    storedExtraction ? storedExtraction.extraction.contract : createEmptyContractReviewRecord(),
  );
  const [filename, setFilename] = useState(storedExtraction?.filename ?? "confirmed-contract.pdf");
  const [parentContractId, setParentContractId] = useState<string | null>(null);
  const [resolvedKeys, setResolvedKeys] = useState<Set<FieldKey>>(new Set());
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (savedContractQuery.data) {
      setFilename(savedContractQuery.data.filename);
      setDraft(savedContractQuery.data.contract);
      setParentContractId(savedContractQuery.data.parentContractId ?? null);
      setResolvedKeys(new Set());
    }
  }, [savedContractQuery.data]);

  const updateField = (key: FieldKey, value: any) => {
    const populated = hasValue(value);
    setDraft((previous) => ({
      ...previous,
      fields: {
        ...previous.fields,
        [key]: {
          ...previous.fields[key],
          value: populated ? value : null,
          status: populated ? "ambiguous" : "not_found",
          confidence: populated ? "low" : "low",
          page: null,
          clause: null,
          quote: null,
          note: populated ? reviewerEditNote : null,
          reviewed: false,
        },
      },
    }));
  };

  const resolveField = (key: FieldKey) => {
    setDraft((previous) => ({
      ...previous,
      fields: {
        ...previous.fields,
        [key]: {
          ...previous.fields[key],
          reviewed: true,
        },
      },
    }));
    setResolvedKeys((previous) => new Set(previous).add(key));
  };

  const updateAssignment = (key: keyof ContractReviewRecord["assignment"], value: any) => {
    setDraft((previous) => ({
      ...previous,
      assignment: { ...previous.assignment, [key]: value },
    }));
  };

  const openIssues = useMemo(
    () => issueDefinitions.filter((issue) => !resolvedKeys.has(issue.key) && isIssue(getField(draft, issue.key))),
    [draft, resolvedKeys],
  );

  const requiredKeys: FieldKey[] = [
    "vendorLegalName",
    "contractType",
    "contractNumber",
    "effectiveDate",
    "initialTermLength",
    "initialTermEndDate",
    "noticePeriod",
  ];
  const missingRequired = requiredKeys.filter((key) => !hasValue(getField(draft, key).value));
  const ownerMissing = !draft.assignment.owner.trim() || !draft.assignment.ownerEmail.trim();
  const totalOpenIssues = openIssues.length + (ownerMissing ? 1 : 0);
  const isComplete = missingRequired.length === 0 && !ownerMissing;
  const progress = Math.round(((issueDefinitions.length + 1 - totalOpenIssues) / (issueDefinitions.length + 1)) * 100);
  const createContract = useCreateContract();
  const updateContract = useUpdateContract();
  const isSaving = createContract.isPending || updateContract.isPending;

  const handleConfirm = async () => {
    if (!isComplete) return;
    setSaveError(null);
    try {
      if (savedId) {
        await updateContract.mutateAsync({
          id: savedId,
          data: { filename, parentContractId, contract: draft },
        });
      } else {
        await createContract.mutateAsync({
          data: { filename, parentContractId, contract: draft },
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      const queue = readExtractionQueue();
      const next = queue.shift();
      if (next) {
        sessionStorage.setItem(extractionStorageKey, JSON.stringify(next));
        sessionStorage.setItem(extractionQueueStorageKey, JSON.stringify(queue));
        setLocation("/review?batch=next");
        window.setTimeout(() => window.location.reload(), 0);
      } else {
        sessionStorage.removeItem(extractionStorageKey);
        sessionStorage.removeItem(extractionQueueStorageKey);
        setLocation("/dashboard");
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "We could not save this contract. Please try again.");
    }
  };

  const vendor = getField(draft, "vendorLegalName").value || "Untitled contract";
  const title = getField(draft, "contractTitle").value || filename;
  const value = getField(draft, "contractValue").value;
  const source = storedExtraction?.extraction.source;
  const ocrConfidence = storedExtraction?.extraction.ocrConfidence;
  const actionIssue = ownerMissing
    ? "Set an application owner and email so notices have a clear recipient."
    : missingRequired.length
      ? `${missingRequired.length} required ${missingRequired.length === 1 ? "field remains" : "fields remain"} before confirmation.`
      : "All confirmation fields are ready.";

  return (
    <div className="min-h-[100dvh] w-full bg-muted/20 md:flex">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-card md:flex md:h-[100dvh] md:sticky md:top-0">
        <div className="flex items-center gap-3 border-b p-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shadow-inner">
            <FileText className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <div className="font-bold tracking-tight text-lg">Contract Dash</div>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Review workspace</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-4">
          <Link href="/dashboard" className="flex items-center gap-3 rounded-md bg-primary/10 px-3 py-2.5 text-sm font-semibold text-primary">
            <FileText className="h-4 w-4" /> Contracts
          </Link>
          <Link href="/action-items" className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-muted/50">
            <AlertCircle className="h-4 w-4" /> Action Items
          </Link>
        </nav>
        <div className="space-y-1 border-t p-4">
          <div className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground">
            <Settings className="h-4 w-4" /> Settings
          </div>
          <Link href="/" className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-muted/50">
            <LogOut className="h-4 w-4" /> Log out
          </Link>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-card px-4 shadow-sm sm:px-6">
          <div className="relative hidden w-full max-w-sm sm:block">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input disabled placeholder="Search contracts..." className="h-9 w-full rounded-md border bg-muted/30 pl-9 pr-4 text-sm font-medium outline-none" />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <button type="button" className="relative rounded-full p-2 text-muted-foreground hover:bg-muted" aria-label="Notifications">
              <Bell className="h-5 w-5" />
              {totalOpenIssues > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full border border-card bg-destructive" />}
            </button>
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-xs font-bold text-primary">JD</div>
          </div>
        </header>

        <div className="overflow-auto p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl space-y-5 pb-16">
            <div className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <button type="button" onClick={() => setLocation("/dashboard")} className="mb-3 inline-flex items-center text-xs font-bold text-muted-foreground transition hover:text-foreground">
                  <ChevronLeft className="mr-1 h-4 w-4" /> Back to registry
                </button>
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.16em] text-primary">
                  <span>Contract review</span>
                  {savedContractQuery.data?.family.documentCount && (
                    <span className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-1 text-muted-foreground">
                      <GitBranch className="h-3 w-3" /> {savedContractQuery.data.family.documentCount} documents
                    </span>
                  )}
                </div>
                <h1 className="mt-2 flex items-center gap-2 text-2xl font-extrabold tracking-tight sm:text-3xl">
                  <ShieldCheck className="h-7 w-7 text-primary" /> Resolve the open decisions
                </h1>
                <p className="mt-1 max-w-2xl text-sm font-medium text-muted-foreground">
                  Confirm only what is uncertain. The full extracted record stays available when you need it.
                </p>
              </div>
              <div className="flex flex-col items-stretch gap-2 sm:items-end">
                <Button onClick={handleConfirm} disabled={!isComplete || isSaving || savedContractQuery.isLoading} className="h-10 gap-2 px-5 font-bold">
                  <Save className="h-4 w-4" /> Confirm review
                </Button>
                {!isComplete && <span className="text-right text-[11px] font-bold text-destructive">{actionIssue}</span>}
                {saveError && <span className="max-w-sm text-right text-[11px] font-bold text-destructive">{saveError}</span>}
              </div>
            </div>

            {!storedExtraction && !savedContractQuery.data && (
              <div className="flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                <div>
                  <p className="text-sm font-extrabold text-destructive">No contract loaded</p>
                  <p className="mt-1 text-xs font-semibold text-destructive/80">Return to the dashboard to upload a PDF or choose a saved contract.</p>
                </div>
              </div>
            )}

            <section className="grid gap-3 rounded-xl border bg-card p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
              <div className="min-w-0">
                <div className="text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">Vendor</div>
                <div className="mt-1 truncate text-sm font-extrabold">{vendor}</div>
                <div className="truncate text-xs font-medium text-muted-foreground">{title}</div>
              </div>
              <div>
                <div className="text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">Contract value</div>
                <div className={`mt-1 text-sm font-extrabold ${hasValue(value) ? "text-foreground" : "text-destructive"}`}>{displayValue(value)}</div>
                <div className="text-xs font-medium text-muted-foreground">{hasValue(value) ? value.basis?.replace(/_/g, " ") : "Value status is unresolved"}</div>
              </div>
              <div>
                <div className="text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">Current term ends</div>
                <div className="mt-1 text-sm font-extrabold">{formatDate(draft.computed.exitDate || getField(draft, "initialTermEndDate").value)}</div>
                <div className="text-xs font-medium text-muted-foreground">{draft.computed.status === "blocked" ? "Deadline unavailable" : `${formatDate(draft.computed.noticeDeadline)} notice deadline`}</div>
              </div>
              <div>
                <div className="text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">Source document</div>
                <div className="mt-1 truncate text-sm font-extrabold">{filename}</div>
                <div className="text-xs font-medium text-muted-foreground">{source === "ocr" ? `OCR · ${ocrConfidence ?? "unknown"} legibility` : "Embedded text extraction"}</div>
              </div>
            </section>

            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
              <section className="space-y-4">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-extrabold tracking-tight">Needs your decision</h2>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${totalOpenIssues ? "bg-amber-500/10 text-amber-700" : "bg-emerald-500/10 text-emerald-700"}`}>
                        {totalOpenIssues ? `${totalOpenIssues} open` : "All clear"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs font-medium text-muted-foreground">Resolve the flagged points below; confirmed fields stay out of your way.</p>
                  </div>
                </div>

                {ownerMissing && (
                  <article className="rounded-xl border border-destructive/25 bg-card shadow-sm">
                    <div className="flex items-start gap-3 p-4 sm:p-5">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive"><User className="h-4 w-4" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-destructive">Assignment · required</div>
                        <h3 className="mt-1 text-base font-extrabold">Who owns the renewal decision?</h3>
                        <p className="mt-1 text-sm font-medium text-muted-foreground">This person receives the action alert and is accountable for the next move.</p>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <label className="text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">
                            Owner
                            <input value={draft.assignment.owner} onChange={(event) => updateAssignment("owner", event.target.value)} placeholder="e.g. John Doe" className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-semibold normal-case tracking-normal outline-none focus:ring-2 focus:ring-primary/20" />
                          </label>
                          <label className="text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">
                            Owner email
                            <input type="email" value={draft.assignment.ownerEmail} onChange={(event) => updateAssignment("ownerEmail", event.target.value)} placeholder="owner@example.com" className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-semibold normal-case tracking-normal outline-none focus:ring-2 focus:ring-primary/20" />
                          </label>
                        </div>
                      </div>
                    </div>
                  </article>
                )}

                {openIssues.map((issue) => {
                  const field = getField(draft, issue.key);
                  const editorKind = issue.key === "contractValue"
                    ? "value"
                    : issue.key === "noticePeriod"
                      ? "notice"
                      : issue.key === "initialTermLength"
                      ? "period"
                      : issue.key === "contractType" || issue.key === "renewalMechanism"
                        ? "select"
                        : "text";
                  const options = issue.key === "contractType"
                    ? contractTypeOptions
                    : issue.key === "renewalMechanism"
                      ? renewalMechanismOptions
                      : [];
                  return (
                    <IssueCard
                      key={issue.key}
                      issue={issue}
                      field={field}
                      onResolve={() => resolveField(issue.key)}
                      canResolve={hasValue(field.value) || issue.key === "contractValue"}
                    >
                      {editorKind === "select"
                        ? <SelectInput value={field.value} onChange={(value) => updateField(issue.key, value)} options={options} />
                        : <FieldEditor fieldKey={issue.key} field={field} kind={editorKind} onChange={(value) => updateField(issue.key, value)} />}
                    </IssueCard>
                  );
                })}

                {!openIssues.length && !ownerMissing && (
                  <div className="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                    <div>
                      <p className="text-sm font-extrabold text-emerald-800">The review is resolved</p>
                      <p className="mt-1 text-xs font-semibold text-emerald-700/80">All tracked decisions have a value or an explicit reviewer resolution.</p>
                    </div>
                  </div>
                )}

                <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
                  <button type="button" onClick={() => setDetailsOpen((open) => !open)} className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition hover:bg-muted/30 sm:px-5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Layers3 className="h-4 w-4" /></div>
                      <div>
                        <h2 className="text-sm font-extrabold">Full extraction</h2>
                        <p className="mt-0.5 text-xs font-medium text-muted-foreground">Secondary view · {Object.keys(draft.fields).length} extracted fields</p>
                      </div>
                    </div>
                    {detailsOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </button>
                  {detailsOpen && (
                    <div className="space-y-5 border-t bg-muted/10 p-4 sm:p-5">
                      {detailGroups.map((group) => (
                        <div key={group.title}>
                          <h3 className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">{group.title}</h3>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            {group.fields.map(({ key, label, kind }) => {
                              const field = getField(draft, key);
                              return (
                                <div key={key} className="rounded-lg border bg-card p-3">
                                  <div className="mb-2 flex items-center justify-between gap-2">
                                    <label className="text-xs font-extrabold">{label}</label>
                                    <StatusPill field={field} />
                                  </div>
                                  <FieldEditor fieldKey={key} field={field} kind={kind} onChange={(value) => updateField(key, value)} />
                                  {(field.quote || field.note) && <p className="mt-2 text-[11px] font-medium text-muted-foreground">{field.note || field.quote}</p>}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </section>

              <aside className="space-y-4 xl:sticky xl:top-20">
                <section className="rounded-xl border bg-card p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-extrabold"><CheckCircle2 className="h-4 w-4 text-primary" /> Review progress</div>
                    <span className="text-sm font-extrabold text-primary">{Math.max(0, Math.min(100, progress))}%</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} /></div>
                  <p className="mt-3 text-xs font-medium leading-relaxed text-muted-foreground">{totalOpenIssues ? `${totalOpenIssues} decision${totalOpenIssues === 1 ? "" : "s"} still needs attention.` : "Nothing else is blocking confirmation."}</p>
                </section>

                <section className={`rounded-xl border p-5 shadow-sm ${draft.computed.status === "blocked" ? "border-destructive/20 bg-destructive/5" : "bg-card"}`}>
                  <div className="flex items-center gap-2 text-sm font-extrabold"><CalendarClock className={`h-4 w-4 ${draft.computed.status === "blocked" ? "text-destructive" : "text-primary"}`} /> Renewal timeline</div>
                  {draft.computed.status === "blocked" ? (
                    <div className="mt-3">
                      <p className="text-sm font-extrabold text-destructive">Deadline unavailable</p>
                      <p className="mt-1 text-xs font-semibold leading-relaxed text-destructive/80">{draft.computed.reason || "Resolve the timing fields to calculate this contract's deadlines."}</p>
                    </div>
                  ) : (
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div><div className="text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">Start negotiation</div><div className="mt-1 text-sm font-extrabold">{formatDate(draft.computed.actionDate)}</div></div>
                      <div><div className="text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">Legal notice</div><div className="mt-1 text-sm font-extrabold">{formatDate(draft.computed.noticeDeadline)}</div></div>
                      <div className="col-span-2 border-t pt-3"><div className="text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">Exit date</div><div className="mt-1 text-sm font-extrabold">{formatDate(draft.computed.exitDate)}</div></div>
                    </div>
                  )}
                </section>

                <section className="rounded-xl border bg-card p-5 shadow-sm">
                  <div className="flex items-center gap-2 text-sm font-extrabold"><BriefcaseBusiness className="h-4 w-4 text-primary" /> Family context</div>
                  <label className="mt-4 block text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">
                    Parent agreement
                    <select value={parentContractId ?? ""} onChange={(event) => setParentContractId(event.target.value || null)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-xs font-semibold normal-case tracking-normal outline-none focus:ring-2 focus:ring-primary/20">
                      <option value="">No parent · root agreement</option>
                      {(contractsQuery.data ?? [])
                        .filter((candidate) => candidate.id !== savedId && !candidate.parentContractId)
                        .map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.contract.fields.vendorLegalName.value || "Unknown vendor"} · {candidate.contract.fields.contractTitle.value || candidate.filename}
                          </option>
                        ))}
                    </select>
                  </label>
                  <p className="mt-2 text-[11px] font-medium leading-relaxed text-muted-foreground">Amendments and renewals stay linked while the registry shows the effective family values.</p>
                </section>

                <section className="rounded-xl border bg-card p-5 shadow-sm">
                  <div className="flex items-center gap-2 text-sm font-extrabold"><WalletCards className="h-4 w-4 text-primary" /> Assignment</div>
                  <div className="mt-3 space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-3"><span className="font-medium text-muted-foreground">Owner</span><span className="font-extrabold">{draft.assignment.owner || "Unassigned"}</span></div>
                    <div className="flex items-center justify-between gap-3"><span className="font-medium text-muted-foreground">Status</span><span className="font-extrabold">{draft.assignment.status}</span></div>
                    <div className="flex items-center justify-between gap-3"><span className="font-medium text-muted-foreground">Buffer</span><span className="font-extrabold">{draft.assignment.negotiationBufferDays} days</span></div>
                  </div>
                  <select value={draft.assignment.status} onChange={(event) => updateAssignment("status", event.target.value)} className="mt-4 h-9 w-full rounded-md border border-input bg-background px-3 text-xs font-semibold outline-none focus:ring-2 focus:ring-primary/20">
                    {assignmentStatusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </section>
              </aside>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}