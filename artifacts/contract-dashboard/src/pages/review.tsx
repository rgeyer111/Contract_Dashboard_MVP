import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { 
  FileText, 
  Search, 
  Bell, 
  Settings, 
  LogOut, 
  Clock,
  AlertCircle,
  ChevronLeft,
  Save,
  ShieldCheck,
  User,
  Briefcase
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useCreateContract,
  useGetContract,
  useUpdateContract,
  type ContractExtractionResult,
  type ContractReviewRecord,
  type ProvenanceMetadata
} from "@workspace/api-client-react";
import {
  createEmptyContractReviewRecord,
  documentTypeOptions,
  languageOptions,
  contractTypeOptions,
  renewalMechanismOptions,
  billingFrequencyOptions,
  periodUnitOptions,
  contractValueBasisOptions,
  assignmentStatusOptions
} from "@/lib/contracts";

const extractionStorageKey = "contract-dashboard.extraction";
const extractionQueueStorageKey = "contract-dashboard.extraction-queue";

function readStoredExtraction(): ContractExtractionResult | null {
  try {
    const saved = sessionStorage.getItem(extractionStorageKey);
    if (!saved) return null;
    const parsed = JSON.parse(saved) as ContractExtractionResult;
    return parsed?.filename && parsed?.extraction?.contract
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function readExtractionQueue(): ContractExtractionResult[] {
  try {
    const saved = sessionStorage.getItem(extractionQueueStorageKey);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => item?.filename && item?.extraction?.contract) : [];
  } catch {
    return [];
  }
}

const FieldGroup = ({ title, children }: { title: string, children: React.ReactNode }) => (
  <div className="bg-card border rounded-xl shadow-sm overflow-hidden transition-all duration-200 hover:shadow-md">
    <div className="bg-muted/40 border-b px-6 py-4 flex items-center justify-between">
      <h3 className="text-sm font-extrabold text-foreground tracking-wide uppercase">{title}</h3>
    </div>
    <div className="p-6 grid grid-cols-1 gap-6">
      {children}
    </div>
  </div>
);

const ReviewField = ({
  label,
  field,
  children
}: {
  label: string;
  field: ProvenanceMetadata;
  children: React.ReactNode;
}) => {
  const statusColors = {
    found: 'bg-primary/10 text-primary border-primary/20',
    not_found: 'bg-destructive/10 text-destructive border-destructive/20',
    ambiguous: 'bg-amber-500/10 text-amber-600 dark:text-amber-500 border-amber-500/20',
    conflicting: 'bg-orange-500/10 text-orange-600 dark:text-orange-500 border-orange-500/20',
  };
  
  const bgClass =
    field.status === 'not_found' ? 'bg-destructive/5 border-destructive/20' :
    field.status === 'ambiguous' ? 'bg-amber-500/5 border-amber-500/20' :
    field.status === 'conflicting' ? 'bg-orange-500/5 border-orange-500/20' :
    'bg-card border-border hover:border-border/80';

  return (
    <div className={`p-5 rounded-xl border transition-all duration-200 ${bgClass} flex flex-col xl:flex-row gap-5`}>
      <div className="w-full xl:w-1/3 shrink-0 flex flex-col gap-2">
        <label className="text-sm font-extrabold text-foreground tracking-tight">{label}</label>
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <span className={`px-2 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider ${statusColors[field.status]}`}>
            {field.status.replace('_', ' ')}
          </span>
          <span className={`px-2 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider ${
            field.confidence === 'high' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-500 border-emerald-500/20' :
            field.confidence === 'medium' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-500 border-amber-500/20' :
            'bg-destructive/10 text-destructive border-destructive/20'
          }`}>
            {field.confidence}
          </span>
        </div>
        {(field.page || field.clause) && (
          <div className="text-xs font-semibold text-muted-foreground mt-2 space-y-1 bg-muted/40 p-2 rounded-md border border-border/50">
            {field.page && <div>Page {field.page}</div>}
            {field.clause && <div>Clause: {field.clause}</div>}
          </div>
        )}
      </div>

      <div className="w-full xl:w-2/3 flex flex-col gap-3">
        {children}
        
        {field.quote && (
          <div className="p-3 bg-muted/30 rounded-md border border-l-4 border-l-primary/40 text-xs text-muted-foreground italic leading-relaxed">
            "{field.quote}"
          </div>
        )}
        {field.note && (
          <div className="p-3 bg-primary/5 rounded-md border border-primary/10 text-xs font-medium text-foreground leading-relaxed">
            <span className="font-extrabold text-primary mr-1">Note:</span>
            {field.note}
          </div>
        )}
      </div>
    </div>
  );
};

const TextInput = ({ value, onChange, placeholder }: { value: string | null, onChange: (v: string) => void, placeholder?: string }) => (
  <input 
    type="text" 
    value={value || ''} 
    onChange={e => onChange(e.target.value)}
    placeholder={placeholder}
    className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all hover:border-border/80"
  />
);

const SelectInput = ({ value, onChange, options }: { value: string | null, onChange: (v: string) => void, options: readonly string[] }) => (
  <select 
    value={value || ''} 
    onChange={e => onChange(e.target.value)}
    className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all hover:border-border/80"
  >
    <option value="" disabled>Select an option...</option>
    {options.map((opt) => (
      <option key={opt} value={opt}>{opt.replace(/_/g, ' ')}</option>
    ))}
  </select>
);

const PeriodInput = ({ value, onChange }: { value: any, onChange: (v: any) => void }) => {
  const amount = value?.amount ?? '';
  const unit = value?.unit ?? 'months';
  return (
    <div className="flex items-center gap-2">
      <input type="number" placeholder="Amount" value={amount} onChange={(e) => onChange({ ...value, amount: parseInt(e.target.value) || 0, unit })} className="w-24 h-10 px-3 rounded-md border border-input bg-background text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20" />
      <select value={unit} onChange={(e) => onChange({ ...value, amount: amount || 0, unit: e.target.value })} className="h-10 px-3 rounded-md border border-input bg-background text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20">
        {periodUnitOptions.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
};

const ContractValueInput = ({ value, onChange }: { value: any, onChange: (v: any) => void }) => {
  const amount = value?.amount ?? '';
  const currency = value?.currency ?? 'CHF';
  const basis = value?.basis ?? 'total_contract_value';
  
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold text-sm">
          {currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : ''}
        </span>
        <input type="number" placeholder="Amount" value={amount} onChange={(e) => onChange({ ...value, amount: parseInt(e.target.value) || 0, currency, basis })} className={`w-36 h-10 px-3 ${currency ? 'pl-7' : ''} rounded-md border border-input bg-background text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20`} />
      </div>
      <input type="text" placeholder="Currency (CHF)" maxLength={3} value={currency} onChange={(e) => onChange({ ...value, amount: amount || 0, currency: e.target.value.toUpperCase(), basis })} className="w-24 h-10 px-3 rounded-md border border-input bg-background text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20" />
      <select value={basis} onChange={(e) => onChange({ ...value, amount: amount || 0, currency, basis: e.target.value })} className="h-10 px-3 rounded-md border border-input bg-background text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20">
        {contractValueBasisOptions.map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
      </select>
    </div>
  );
};

const JsonInput = ({ value, onChange, placeholder }: { value: any, onChange: (v: any) => void, placeholder?: string }) => {
  const [text, setText] = useState(() => value ? JSON.stringify(value, null, 2) : '');
  const [error, setError] = useState(false);

  useEffect(() => {
    setText(value ? JSON.stringify(value, null, 2) : '');
    setError(false);
  }, [value]);

  const handleBlur = () => {
    try {
      const parsed = text.trim() ? JSON.parse(text) : null;
      onChange(parsed);
      setText(parsed ? JSON.stringify(parsed, null, 2) : '');
      setError(false);
    } catch {
      setError(true);
    }
  };

  return (
    <textarea 
      value={text} 
      onChange={(e) => setText(e.target.value)} 
      onBlur={handleBlur}
      placeholder={placeholder}
      className={`min-h-[120px] w-full p-3 rounded-md border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all ${error ? 'border-destructive focus:ring-destructive/30' : 'border-input hover:border-border/80'}`} 
    />
  );
};

export default function Review() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const savedId = new URLSearchParams(window.location.search).get("id") ?? "";
  
  const savedContractQuery = useGetContract(savedId, {
    query: {
      enabled: Boolean(savedId),
      queryKey: [`/api/contracts/${savedId}`],
    },
  });

  const [storedExtraction] = useState(readStoredExtraction);
  const [draft, setDraft] = useState<ContractReviewRecord>(() =>
    storedExtraction ? storedExtraction.extraction.contract : createEmptyContractReviewRecord()
  );
  
  const [filename, setFilename] = useState(storedExtraction?.filename ?? "confirmed-contract.pdf");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (savedContractQuery.data) {
      setFilename(savedContractQuery.data.filename);
      setDraft(savedContractQuery.data.contract);
    }
  }, [savedContractQuery.data]);

  const updateField = (key: keyof ContractReviewRecord['fields'], value: any) => {
    setDraft(prev => ({
      ...prev,
      fields: {
        ...prev.fields,
        [key]: {
          ...prev.fields[key],
          value,
          status: "ambiguous",
          confidence: "low",
          page: null,
          clause: null,
          quote: null,
          note: "Reviewer-supplied value; original extraction evidence was cleared."
        }
      }
    }));
  };

  const updateAssignment = (key: keyof ContractReviewRecord['assignment'], value: any) => {
    setDraft(prev => ({
      ...prev,
      assignment: {
        ...prev.assignment,
        [key]: value
      }
    }));
  };

  const createContract = useCreateContract();
  const updateContract = useUpdateContract();
  const isSaving = createContract.isPending || updateContract.isPending;

  const isComplete = Boolean(draft.assignment.owner && draft.assignment.owner.trim() !== "");

  const handleConfirm = async () => {
    if (!isComplete) return;
    setSaveError(null);
    try {
      if (savedId) {
        await updateContract.mutateAsync({
          id: savedId,
          data: { filename, contract: draft },
        });
      } else {
        await createContract.mutateAsync({
          data: { filename, contract: draft },
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

  return (
    <div className="min-h-[100dvh] w-full bg-muted/20 flex flex-col md:flex-row">
      <aside className="w-full md:w-64 bg-card border-r border-border flex flex-col sticky top-0 md:h-[100dvh] z-20 shadow-sm hidden md:flex">
        <div className="p-6 border-b flex items-center gap-3">
          <div className="bg-primary h-8 w-8 rounded-lg flex items-center justify-center shadow-inner">
            <FileText className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-bold tracking-tight text-lg text-foreground">Contract Dash</span>
        </div>
        
        <nav className="flex-1 p-4 space-y-1">
          <Link href="/dashboard" className="flex items-center gap-3 px-3 py-2.5 bg-primary/10 text-primary rounded-md font-semibold text-sm transition-colors">
            <FileText className="h-4 w-4" />
            Contracts
          </Link>
          <div className="flex items-center gap-3 px-3 py-2.5 text-muted-foreground hover:bg-muted/50 rounded-md font-medium text-sm transition-colors cursor-not-allowed">
            <Clock className="h-4 w-4" />
            Renewals
          </div>
          <div className="flex items-center gap-3 px-3 py-2.5 text-muted-foreground hover:bg-muted/50 rounded-md font-medium text-sm transition-colors cursor-not-allowed">
            <AlertCircle className="h-4 w-4" />
            Action Items
          </div>
        </nav>
        
        <div className="p-4 border-t space-y-1">
          <div className="flex items-center gap-3 px-3 py-2.5 text-muted-foreground hover:bg-muted/50 rounded-md font-medium text-sm transition-colors cursor-not-allowed">
            <Settings className="h-4 w-4" />
            Settings
          </div>
          <Link href="/" className="flex items-center gap-3 px-3 py-2.5 text-muted-foreground hover:bg-muted/50 rounded-md font-medium text-sm transition-colors">
            <LogOut className="h-4 w-4" />
            Log out
          </Link>
        </div>
      </aside>
      
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <header className="h-16 bg-card border-b border-border flex items-center justify-between px-6 sticky top-0 z-10 shadow-sm">
          <div className="flex items-center gap-4 w-full max-w-md">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input 
                type="text" 
                placeholder="Search contracts..." 
                className="w-full h-9 pl-9 pr-4 rounded-md border bg-muted/30 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/70"
                disabled
              />
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <button className="relative p-2 text-muted-foreground hover:bg-muted rounded-full transition-colors">
              <Bell className="h-5 w-5" />
              <span className="absolute top-2 right-2 h-2 w-2 bg-destructive rounded-full border border-card"></span>
            </button>
            <div className="h-8 w-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center font-bold text-primary text-xs tracking-wider">
              JD
            </div>
          </div>
        </header>
        
        <div className="flex-1 overflow-auto p-6 lg:p-10 bg-background/50">
          <div className="max-w-5xl mx-auto space-y-8 pb-20 animate-in fade-in duration-500">
            
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-4 border-b">
              <div>
                <button 
                  onClick={() => setLocation('/dashboard')}
                  className="inline-flex items-center text-sm font-bold text-muted-foreground hover:text-foreground mb-5 transition-colors"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" /> Back to Dashboard
                </button>
                <h1 className="text-3xl font-extrabold tracking-tight text-foreground flex items-center gap-3">
                  <ShieldCheck className="h-8 w-8 text-primary" />
                  Review Contract Details
                </h1>
                <p className="text-muted-foreground mt-2 font-medium text-sm max-w-xl">
                   {storedExtraction
                     ? `Review the details extracted from ${storedExtraction.filename}. Resolve flagged fields to ensure data integrity.`
                     : savedContractQuery.data
                       ? `Review and update ${savedContractQuery.data.filename}. Your changes are saved to the registry.`
                     : "No uploaded contract is currently open. Return to the dashboard to upload a PDF."}
                </p>
                {storedExtraction?.extraction.source === "ocr" && storedExtraction.extraction.ocrConfidence && (
                  <div className="mt-4 inline-flex items-center gap-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-700">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    OCR used for this scan
                    <span className="font-semibold text-amber-700/80">
                      {storedExtraction.extraction.ocrConfidence} legibility
                    </span>
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <Button 
                  onClick={handleConfirm} 
                  disabled={!isComplete || isSaving || savedContractQuery.isLoading}
                  className="gap-2 shadow-md font-bold transition-all h-11 px-8 text-sm uppercase tracking-wide"
                >
                  <Save className="h-4 w-4" />
                  Confirm contract
                </Button>
                {saveError && <span className="text-[11px] font-bold text-destructive">{saveError}</span>}
                {!isComplete && (
                  <span className="text-[11px] font-bold text-destructive uppercase tracking-wider flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-pulse" />
                    Application Owner is required
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-8">
               {!storedExtraction && !savedContractQuery.data && (
                 <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-5 py-4 flex items-start gap-3">
                   <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                   <div>
                     <p className="text-sm font-extrabold text-destructive">No contract loaded</p>
                     <p className="text-xs font-semibold text-destructive/80 mt-1">Upload a PDF from the dashboard to begin a live review.</p>
                   </div>
                 </div>
               )}

              <FieldGroup title="Document Identification">
                <ReviewField label="Document Type" field={draft.fields.documentType}>
                  <SelectInput value={draft.fields.documentType.value} onChange={(v) => updateField('documentType', v)} options={documentTypeOptions} />
                </ReviewField>
                <ReviewField label="Document Language" field={draft.fields.documentLanguage}>
                  <SelectInput value={draft.fields.documentLanguage.value} onChange={(v) => updateField('documentLanguage', v)} options={languageOptions} />
                </ReviewField>
                <ReviewField label="Contract Title" field={draft.fields.contractTitle}>
                  <TextInput value={draft.fields.contractTitle.value} onChange={(v) => updateField('contractTitle', v)} placeholder="e.g. Master Services Agreement" />
                </ReviewField>
                <ReviewField label="Contract Number" field={draft.fields.contractNumber}>
                  <TextInput value={draft.fields.contractNumber.value} onChange={(v) => updateField('contractNumber', v)} placeholder="e.g. MSA-2023-001" />
                </ReviewField>
              </FieldGroup>

              <FieldGroup title="Parties & Entities">
                <ReviewField label="Vendor Legal Name" field={draft.fields.vendorLegalName}>
                  <TextInput value={draft.fields.vendorLegalName.value} onChange={(v) => updateField('vendorLegalName', v)} placeholder="e.g. Acme Corp LLC" />
                </ReviewField>
                <ReviewField label="Buyer Legal Entity" field={draft.fields.buyerLegalEntity}>
                  <TextInput value={draft.fields.buyerLegalEntity.value} onChange={(v) => updateField('buyerLegalEntity', v)} placeholder="e.g. Global Tech Inc." />
                </ReviewField>
              </FieldGroup>

              <FieldGroup title="Key Dates & Terms">
                <ReviewField label="Signature Date" field={draft.fields.signatureDate}>
                  <TextInput value={draft.fields.signatureDate.value} onChange={(v) => updateField('signatureDate', v)} placeholder="YYYY-MM-DD" />
                </ReviewField>
                <ReviewField label="Effective Date" field={draft.fields.effectiveDate}>
                  <TextInput value={draft.fields.effectiveDate.value} onChange={(v) => updateField('effectiveDate', v)} placeholder="YYYY-MM-DD" />
                </ReviewField>
                <ReviewField label="Initial Term Length" field={draft.fields.initialTermLength}>
                  <PeriodInput value={draft.fields.initialTermLength.value} onChange={(v) => updateField('initialTermLength', v)} />
                </ReviewField>
                <ReviewField label="Initial Term End Date" field={draft.fields.initialTermEndDate}>
                  <TextInput value={draft.fields.initialTermEndDate.value} onChange={(v) => updateField('initialTermEndDate', v)} placeholder="YYYY-MM-DD" />
                </ReviewField>
              </FieldGroup>

              <FieldGroup title="Renewals & Notice">
                <ReviewField label="Renewal Mechanism" field={draft.fields.renewalMechanism}>
                  <SelectInput value={draft.fields.renewalMechanism.value} onChange={(v) => updateField('renewalMechanism', v)} options={renewalMechanismOptions} />
                </ReviewField>
                <ReviewField label="Renewal Term Length" field={draft.fields.renewalTermLength}>
                  <PeriodInput value={draft.fields.renewalTermLength.value} onChange={(v) => updateField('renewalTermLength', v)} />
                </ReviewField>
                <ReviewField label="Notice Period" field={draft.fields.noticePeriod}>
                  <JsonInput value={draft.fields.noticePeriod.value} onChange={(v) => updateField('noticePeriod', v)} placeholder='[{"amount": 30, "unit": "days", "anchor": "term_end"}]' />
                </ReviewField>
                <ReviewField label="Notice Deadline" field={draft.fields.noticeDeadline}>
                  <TextInput value={draft.fields.noticeDeadline.value} onChange={(v) => updateField('noticeDeadline', v)} placeholder="YYYY-MM-DD" />
                </ReviewField>
                <ReviewField label="Notice Delivery" field={draft.fields.noticeDelivery}>
                  <JsonInput value={draft.fields.noticeDelivery.value} onChange={(v) => updateField('noticeDelivery', v)} placeholder='{"method": "email", "cc": ["legal@acme.com"]}' />
                </ReviewField>
              </FieldGroup>

              <FieldGroup title="Financials">
                <ReviewField label="Contract Type" field={draft.fields.contractType}>
                  <SelectInput value={draft.fields.contractType.value} onChange={(v) => updateField('contractType', v)} options={contractTypeOptions} />
                </ReviewField>
                <ReviewField label="Contract Value" field={draft.fields.contractValue}>
                  <ContractValueInput value={draft.fields.contractValue.value} onChange={(v) => updateField('contractValue', v)} />
                </ReviewField>
                <ReviewField label="Billing Frequency" field={draft.fields.billingFrequency}>
                  <SelectInput value={draft.fields.billingFrequency.value} onChange={(v) => updateField('billingFrequency', v)} options={billingFrequencyOptions} />
                </ReviewField>
              </FieldGroup>

              <div className="bg-primary/5 border border-primary/20 rounded-xl shadow-sm overflow-hidden mb-8">
                <div className="border-b border-primary/10 px-6 py-4 flex items-center gap-2">
                  <Briefcase className="h-5 w-5 text-primary" />
                  <h3 className="text-sm font-extrabold text-foreground tracking-wide uppercase">Application Assignment</h3>
                </div>
                <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-foreground flex items-center gap-1">
                      <User className="h-3 w-3" /> Owner <span className="text-destructive">*</span>
                    </label>
                    <input 
                      type="text" 
                      value={draft.assignment.owner} 
                      onChange={e => updateAssignment('owner', e.target.value)}
                      placeholder="e.g. John Doe"
                      className={`w-full h-10 px-3 rounded-md border bg-background text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all ${!draft.assignment.owner.trim() ? 'border-destructive/60 ring-4 ring-destructive/10' : 'border-input hover:border-border/80'}`}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-foreground flex items-center gap-1">
                      <User className="h-3 w-3" /> Owner Email <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="email"
                      value={draft.assignment.ownerEmail}
                      onChange={e => updateAssignment('ownerEmail', e.target.value)}
                      placeholder="owner@example.com"
                      className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all hover:border-border/80"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Negotiation Buffer (Days)
                    </label>
                    <input 
                      type="number" 
                      value={draft.assignment.negotiationBufferDays} 
                      onChange={e => {
                        updateAssignment('negotiationBufferDays', parseInt(e.target.value) || 0);
                        updateAssignment('negotiationBufferSource', 'contract_override');
                      }}
                      className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all hover:border-border/80"
                    />
                    <p className={`text-[11px] font-bold ${draft.assignment.negotiationBufferSource === 'contract_override' ? 'text-primary' : 'text-muted-foreground'}`}>
                      {draft.assignment.negotiationBufferSource === 'contract_override'
                        ? 'Contract override'
                        : draft.assignment.negotiationBufferSource === 'contract_type_default'
                          ? 'Inherited from contract type'
                          : 'Inherited global default'}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-foreground flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" /> Status
                    </label>
                    <select 
                      value={draft.assignment.status} 
                      onChange={e => updateAssignment('status', e.target.value)}
                      className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all hover:border-border/80"
                    >
                      {assignmentStatusOptions.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-1 md:col-span-3">
                    {draft.computed.status === 'blocked' ? (
                      <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 p-4 flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-extrabold text-destructive">Deadline unavailable</p>
                          <p className="mt-1 text-xs font-semibold leading-relaxed text-destructive/90">
                            {draft.computed.reason || 'Confirm the missing contract timing fields and their source clauses to calculate a deadline.'}
                          </p>
                          <p className="mt-2 text-[11px] font-bold text-destructive/80">
                            No dates are shown until the contract timing can be trusted.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="mb-4 grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-lg border bg-muted/20 p-4">
                        {[
                          ['Exit date', draft.computed.exitDate],
                          ['Legal notice deadline', draft.computed.noticeDeadline],
                          ['Start negotiation', draft.computed.actionDate],
                        ].map(([label, value]) => (
                          <div key={label}>
                            <div className="text-[10px] uppercase tracking-wide font-bold text-muted-foreground">{label}</div>
                            <div className="mt-1 text-sm font-extrabold">{value || 'Not computable'}</div>
                          </div>
                        ))}
                        {draft.computed.reason && (
                          <p className="sm:col-span-3 text-xs font-semibold text-destructive">{draft.computed.reason}</p>
                        )}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground font-medium">
                      These settings dictate how this contract is tracked internally and are not extracted from the document itself. 
                      The <strong className="text-foreground">Owner</strong> will receive notices based on the negotiation buffer.
                    </p>
                  </div>
                </div>
              </div>

            </div>
            
          </div>
        </div>
      </main>
    </div>
  );
}
