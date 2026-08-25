import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
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
  ShieldCheck
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { 
  Contract, 
  contractFields, 
  contractTypes
} from "@/lib/contracts";

const FieldGroup = ({ title, children }: { title: string, children: React.ReactNode }) => (
  <div className="bg-card border rounded-xl shadow-sm overflow-hidden transition-all duration-200 hover:shadow-md">
    <div className="bg-muted/40 border-b px-6 py-4 flex items-center justify-between">
      <h3 className="text-sm font-extrabold text-foreground tracking-wide uppercase">{title}</h3>
    </div>
    <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
      {children}
    </div>
  </div>
);

const isRequired = (key: string) => contractFields.find(f => f.key === key)?.requiredAtConfirmation;
const getLabel = (key: string) => contractFields.find(f => f.key === key)?.label || key;

const Field = ({ fieldKey, children }: { fieldKey: string, children: React.ReactNode }) => {
  const req = isRequired(fieldKey);
  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold text-foreground flex items-center gap-1">
        {getLabel(fieldKey)}
        {req && <span className="text-destructive font-bold">*</span>}
      </label>
      {children}
    </div>
  );
};

const TextInput = ({ value, onChange, placeholder, required }: any) => (
  <input 
    type="text" 
    value={value || ''} 
    onChange={e => onChange(e.target.value)}
    placeholder={placeholder}
    className={`w-full h-10 px-3 rounded-md border bg-background text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all ${required && !value ? 'border-destructive/60 ring-4 ring-destructive/10 focus:ring-destructive/30 bg-destructive/5' : 'border-input hover:border-border/80'}`}
  />
);

const SelectInput = ({ value, onChange, options, required }: any) => (
  <select 
    value={value || ''} 
    onChange={e => onChange(e.target.value)}
    className={`w-full h-10 px-3 rounded-md border bg-background text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all ${required && !value ? 'border-destructive/60 ring-4 ring-destructive/10 focus:ring-destructive/30 bg-destructive/5 text-destructive font-bold' : 'border-input hover:border-border/80'}`}
  >
    <option value="" disabled>Select an option...</option>
    {options.map((opt: string) => (
      <option key={opt} value={opt}>{opt}</option>
    ))}
  </select>
);

const ContractValueControl = ({ value, onChange }: { value: any, onChange: (v: any) => void }) => {
  const isUnknown = value?.status === 'unknown';
  return (
    <div className="col-span-1 md:col-span-2 space-y-4">
      <div className="space-y-2">
        <label className="text-xs font-semibold text-foreground flex items-center gap-1">
          Contract Value Status
          <span className="text-destructive font-bold">*</span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onChange({ status: 'stated', amount: value?.amount || 0, currency: value?.currency || 'USD' })}
            className={`px-4 py-2.5 text-xs font-extrabold tracking-wide uppercase rounded-md border transition-all ${!isUnknown ? 'bg-primary text-primary-foreground border-primary shadow-sm' : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          >
            Stated Value
          </button>
          <button
            type="button"
            onClick={() => onChange({ status: 'unknown' })}
            className={`px-4 py-2.5 text-xs font-extrabold tracking-wide uppercase rounded-md border transition-all ${isUnknown ? 'bg-destructive/10 text-destructive border-destructive/30 shadow-sm ring-4 ring-destructive/10' : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          >
            Unknown / Not Stated
          </button>
        </div>
      </div>
      
      {!isUnknown && (
        <div className="flex gap-4 p-5 border rounded-lg bg-muted/20 animate-in fade-in slide-in-from-top-1">
          <div className="flex-1 space-y-2">
            <label className="text-xs font-semibold text-foreground">Amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold text-sm">
                {value?.currency === 'USD' ? '$' : value?.currency === 'EUR' ? '€' : value?.currency === 'GBP' ? '£' : ''}
              </span>
              <input 
                type="number"
                value={value?.amount || ''}
                onChange={e => onChange({ ...value, amount: parseFloat(e.target.value) || 0 })}
                className={`w-full h-10 px-3 rounded-md border border-input bg-background text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all hover:border-border/80 ${value?.currency ? 'pl-7' : ''}`}
                placeholder="0.00"
              />
            </div>
          </div>
          <div className="w-32 space-y-2">
            <label className="text-xs font-semibold text-foreground">Currency</label>
            <select
              value={value?.currency || 'USD'}
              onChange={e => onChange({ ...value, currency: e.target.value })}
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all hover:border-border/80"
            >
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
          </div>
        </div>
      )}
      {isUnknown && (
        <div className="p-5 bg-destructive/5 border border-destructive/20 rounded-lg flex items-start gap-3 animate-in fade-in slide-in-from-top-1">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-extrabold text-destructive tracking-tight">Value Flagged for Review</p>
            <p className="text-xs font-semibold text-destructive/80 mt-1">This value could not be extracted automatically. Operations will verify manually after confirmation.</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Review() {
  const [, setLocation] = useLocation();

  const [draft, setDraft] = useState<Partial<Contract>>({
    vendor: 'TechFlow Solutions',
    contractNumber: '', 
    contractName: 'Enterprise SaaS Agreement',
    contractType: 'Software License',
    contractValue: { status: 'unknown' },
    startDate: 'Oct 01, 2023',
    contractDuration: '24 months',
    endDate: 'Oct 01, 2025',
    noticePeriod: '60 days',
    noticeDeadline: 'Aug 02, 2025',
    negotiationBuffer: '30 days',
    owner: 'John Doe',
    status: 'Review Open',
  });

  const updateField = (key: keyof Contract, value: any) => {
    setDraft(prev => ({ ...prev, [key]: value }));
  };

  const missingRequiredFields = useMemo(() => {
    return contractFields.filter(f => f.requiredAtConfirmation).filter(f => {
      const val = draft[f.key];
      if (f.key === 'contractValue') {
        const cv = val as Contract['contractValue'];
        return !cv || !cv.status || (cv.status === 'stated' && !cv.amount);
      }
      return val === undefined || val === null || String(val).trim() === '';
    });
  }, [draft]);

  const isComplete = missingRequiredFields.length === 0;

  const handleConfirm = () => {
    if (!isComplete) return;
    setLocation('/dashboard');
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
          <div className="max-w-4xl mx-auto space-y-8 pb-20 animate-in fade-in duration-500">
            
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-2 border-b">
              <div>
                <button 
                  onClick={() => setLocation('/dashboard')}
                  className="inline-flex items-center text-sm font-bold text-muted-foreground hover:text-foreground mb-5 transition-colors"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" /> Back to Dashboard
                </button>
                <h1 className="text-3xl font-extrabold tracking-tight text-foreground flex items-center gap-3">
                  <ShieldCheck className="h-8 w-8 text-primary" />
                  Review Extracted Contract
                </h1>
                <p className="text-muted-foreground mt-2 font-medium text-sm max-w-xl">
                  Please review and confirm the extracted data below. Complete all required fields to advance this record.
                </p>
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <Button 
                  onClick={handleConfirm} 
                  disabled={!isComplete}
                  className="gap-2 shadow-md font-bold transition-all h-11 px-8 text-sm uppercase tracking-wide"
                >
                  <Save className="h-4 w-4" />
                  Confirm contract
                </Button>
                {!isComplete && (
                  <span className="text-[11px] font-bold text-destructive uppercase tracking-wider flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-pulse" />
                    {missingRequiredFields.length} Required Field{missingRequiredFields.length !== 1 ? 's' : ''} Missing
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-8">
              <FieldGroup title="General Information">
                <Field fieldKey="vendor">
                  <TextInput value={draft.vendor} onChange={(v: string) => updateField('vendor', v)} required={isRequired('vendor')} />
                </Field>
                <Field fieldKey="contractNumber">
                  <TextInput value={draft.contractNumber} onChange={(v: string) => updateField('contractNumber', v)} required={isRequired('contractNumber')} placeholder="e.g. SF-2024-1234" />
                </Field>
                <Field fieldKey="contractName">
                  <TextInput value={draft.contractName} onChange={(v: string) => updateField('contractName', v)} required={isRequired('contractName')} />
                </Field>
                <Field fieldKey="contractType">
                  <SelectInput 
                    value={draft.contractType} 
                    onChange={(v: string) => updateField('contractType', v)} 
                    options={contractTypes} 
                    required={isRequired('contractType')} 
                  />
                </Field>
              </FieldGroup>

              <FieldGroup title="Timeline & Deadlines">
                <Field fieldKey="startDate">
                  <TextInput value={draft.startDate} onChange={(v: string) => updateField('startDate', v)} required={isRequired('startDate')} placeholder="e.g. Oct 01, 2023" />
                </Field>
                <Field fieldKey="endDate">
                  <TextInput value={draft.endDate} onChange={(v: string) => updateField('endDate', v)} required={isRequired('endDate')} placeholder="e.g. Oct 01, 2025" />
                </Field>
                <Field fieldKey="contractDuration">
                  <TextInput value={draft.contractDuration} onChange={(v: string) => updateField('contractDuration', v)} required={isRequired('contractDuration')} placeholder="e.g. 24 months" />
                </Field>
                <Field fieldKey="noticePeriod">
                  <TextInput value={draft.noticePeriod} onChange={(v: string) => updateField('noticePeriod', v)} required={isRequired('noticePeriod')} placeholder="e.g. 60 days" />
                </Field>
                <Field fieldKey="negotiationBuffer">
                  <TextInput value={draft.negotiationBuffer} onChange={(v: string) => updateField('negotiationBuffer', v)} required={isRequired('negotiationBuffer')} placeholder="e.g. 30 days" />
                </Field>
                <Field fieldKey="noticeDeadline">
                  <TextInput value={draft.noticeDeadline} onChange={(v: string) => updateField('noticeDeadline', v)} required={isRequired('noticeDeadline')} placeholder="e.g. Aug 02, 2025" />
                </Field>
              </FieldGroup>

              <FieldGroup title="Financials">
                <ContractValueControl 
                  value={draft.contractValue} 
                  onChange={(v: any) => updateField('contractValue', v)} 
                />
              </FieldGroup>

              <FieldGroup title="Administration">
                <Field fieldKey="owner">
                  <TextInput value={draft.owner} onChange={(v: string) => updateField('owner', v)} required={isRequired('owner')} />
                </Field>
                <Field fieldKey="status">
                  <SelectInput 
                    value={draft.status} 
                    onChange={(v: string) => updateField('status', v)} 
                    options={['At Risk', 'Review Open', 'In Negotiation']} 
                    required={isRequired('status')} 
                  />
                </Field>
              </FieldGroup>
            </div>
            
          </div>
        </div>
      </main>
    </div>
  );
}
