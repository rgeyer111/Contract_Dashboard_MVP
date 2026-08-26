import { Fragment, useState, type DragEvent, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { 
  FileText, 
  Search, 
  Bell, 
  Settings, 
  LogOut, 
  Plus, 
  AlertCircle,
  Clock,
  CheckCircle2,
  MoreHorizontal,
  Upload,
  FileUp,
  LoaderCircle,
  X,
  Mail,
  Ban,
  ChevronDown,
  ChevronRight,
  GitBranch,
  CalendarDays,
  WalletCards,
  ListFilter
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getListContractsQueryKey, useDismissContractAlert, useExtractContract, useListContracts, type ContractExtractionResult } from "@workspace/api-client-react";

const registryIssueKeys = [
  "vendorLegalName",
  "contractType",
  "contractNumber",
  "effectiveDate",
  "initialTermLength",
  "initialTermEndDate",
  "renewalMechanism",
  "noticePeriod",
  "contractValue",
] as const;

function getRegistryIssueCount(contract: any) {
  return registryIssueKeys.filter((key) => {
    const field = contract.fields?.[key];
    return !field || (!field.reviewed && (field.status !== "found" || field.value === null || field.value === undefined || field.value === ""));
  }).length;
}

function registryDate(value: string | null | undefined) {
  if (!value) return "Not set";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}.${month}.${year}` : value;
}

function registryStatusLabel(status: string) {
  return status === "red" ? "At risk"
    : status === "amber" ? "Upcoming"
      : status === "green" ? "On track"
        : status === "expired" ? "Expired"
          : "Blocked";
}

export default function Dashboard() {
  const [location, setLocation] = useLocation();
  const isActionItemsPage = location === "/action-items";
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [runLog, setRunLog] = useState<Array<{ name: string; state: "processing" | "ready" | "duplicate" | "failed"; message?: string }>>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [dismissReason, setDismissReason] = useState("");
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(new Set());
  const [registryQuery, setRegistryQuery] = useState("");
  const queryClient = useQueryClient();
  const contractsQuery = useListContracts();
  const contracts = contractsQuery.data ?? [];
  const familyRoots = contracts.filter((saved) => saved.family.id === saved.id);
  const filteredFamilyRoots = familyRoots.filter((saved) => {
    const contract = saved.family.effectiveContract;
    const query = registryQuery.trim().toLowerCase();
    if (!query) return true;
    return [
      contract.fields.vendorLegalName.value,
      contract.fields.contractTitle.value,
      contract.fields.contractType.value,
      contract.assignment.owner,
      saved.filename,
    ].some((value) => String(value ?? "").toLowerCase().includes(query));
  });
  const alerts = familyRoots.filter((saved) => saved.family.effectiveContract.alert);
  const openIssueCount = familyRoots.reduce((total, saved) => total + getRegistryIssueCount(saved.family.effectiveContract), 0);
  const statedValueCount = familyRoots.filter((saved) => saved.family.effectiveContract.fields.contractValue.value).length;
  const dismissAlert = useDismissContractAlert({
    mutation: {
      onSuccess: async () => {
        setDismissingId(null);
        setDismissReason("");
        await queryClient.invalidateQueries({ queryKey: getListContractsQueryKey() });
      },
    },
  });
  const extraction = useExtractContract();

  const chooseFiles = (files: File[]) => {
    const validFiles = files.filter((file) => {
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      return isPdf && file.size <= 10 * 1024 * 1024;
    });
    if (validFiles.length !== files.length) {
      setUploadError("Only PDF files up to 10 MB can be added.");
    } else {
      setUploadError(null);
    }
    setSelectedFiles(validFiles.slice(0, 20));
    setRunLog([]);
  };

  const processFiles = async () => {
    const results: ContractExtractionResult[] = [];
    const batchHashes = new Set<string>();
    setUploadError(null);
    for (const file of selectedFiles) {
      setRunLog((current) => [...current, { name: file.name, state: "processing" }]);
      try {
        const result = await extraction.mutateAsync({ data: { files: [file] } });
        const hash = result.extraction.contract.source?.hash;
        if (hash && batchHashes.has(hash)) {
          setRunLog((current) => current.map((entry) => entry.name === file.name ? { ...entry, state: "duplicate", message: "Duplicate skipped" } : entry));
          continue;
        }
        if (hash) batchHashes.add(hash);
        results.push(result);
        setRunLog((current) => current.map((entry) => entry.name === file.name ? { ...entry, state: "ready", message: "Ready for review" } : entry));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not process this PDF.";
        const duplicate = /duplicate|already been uploaded/i.test(message);
        setRunLog((current) => current.map((entry) => entry.name === file.name ? { ...entry, state: duplicate ? "duplicate" : "failed", message: duplicate ? "Duplicate skipped" : message } : entry));
      }
    }
    if (results.length > 0) {
      sessionStorage.setItem("contract-dashboard.extraction", JSON.stringify(results[0]));
      sessionStorage.setItem("contract-dashboard.extraction-queue", JSON.stringify(results.slice(1)));
      setLocation("/review");
    }
  };

  const chooseFilesFromDrop = (files: FileList | File[]) => {
    chooseFiles(Array.from(files));
    setUploadError(null);
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
    chooseFilesFromDrop(event.dataTransfer.files);
  };

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) chooseFilesFromDrop(event.target.files);
    event.currentTarget.value = "";
  };

  return (
    <div className="min-h-[100dvh] w-full bg-muted/20 flex flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="w-full md:w-64 bg-card border-r border-border flex flex-col sticky top-0 md:h-[100dvh] z-20 shadow-sm hidden md:flex">
        <div className="p-6 border-b flex items-center gap-3">
          <div className="bg-primary h-8 w-8 rounded-lg flex items-center justify-center shadow-inner">
            <FileText className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-bold tracking-tight text-lg text-foreground">Contract Dash</span>
        </div>
        
        <nav className="flex-1 p-4 space-y-1">
          <Link href="/dashboard" className={`flex items-center gap-3 px-3 py-2.5 rounded-md font-semibold text-sm transition-colors ${!isActionItemsPage ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/50"}`}>
            <FileText className="h-4 w-4" />
            Contracts
          </Link>
          <div className="flex items-center gap-3 px-3 py-2.5 text-muted-foreground hover:bg-muted/50 rounded-md font-medium text-sm transition-colors cursor-not-allowed">
            <Clock className="h-4 w-4" />
            Renewals
          </div>
          <Link href="/action-items" className={`flex items-center gap-3 px-3 py-2.5 rounded-md font-medium text-sm transition-colors ${isActionItemsPage ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:bg-muted/50"}`}>
            <AlertCircle className="h-4 w-4" />
            Action Items
          </Link>
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
      
      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Header */}
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
        
        {/* Scrollable Area */}
        <div className="flex-1 overflow-auto p-6 lg:p-8 space-y-8 animate-in fade-in duration-500">
          
          {/* Page Header */}
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight text-foreground">{isActionItemsPage ? "Action Items" : "Contract portfolio"}</h1>
              <p className="text-muted-foreground mt-1 font-medium text-sm">{isActionItemsPage ? "Stay ahead of the contract decisions that need your attention." : "Compare renewal exposure, ownership, value, and open decisions in one view."}</p>
            </div>
            {!isActionItemsPage && (
              <Button onClick={() => setUploadOpen(true)} className="shrink-0 gap-2 shadow-sm font-semibold">
                <Plus className="h-4 w-4" />
                New Contract
              </Button>
            )}
          </div>

          {!isActionItemsPage && uploadOpen && (
            <section className="bg-card border rounded-xl shadow-sm p-5 sm:p-6 animate-in fade-in slide-in-from-top-2 duration-300" aria-labelledby="upload-contract-heading">
              <div className="flex items-start justify-between gap-4 mb-5">
                <div>
                  <div className="flex items-center gap-2 text-primary font-bold text-sm">
                    <FileUp className="h-4 w-4" />
                    New contract
                  </div>
                  <h2 id="upload-contract-heading" className="text-xl font-extrabold tracking-tight mt-1">Upload a PDF to extract its details</h2>
                  <p className="text-sm text-muted-foreground font-medium mt-1">We'll prepare an editable draft with confidence ratings for every field.</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    if (!extraction.isPending) {
                      setUploadOpen(false);
                      setSelectedFiles([]);
                      setRunLog([]);
                      setUploadError(null);
                    }
                  }}
                  disabled={extraction.isPending}
                  aria-label="Close contract upload"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

               <input id="contract-pdf-file" type="file" multiple accept="application/pdf,.pdf" className="sr-only" onChange={handleInput} />
              <label
                htmlFor="contract-pdf-file"
                onDragEnter={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`group flex flex-col items-center justify-center min-h-40 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-all cursor-pointer ${
                  isDragging
                    ? "border-primary bg-primary/5 ring-4 ring-primary/10"
                    : selectedFiles.length
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : "border-border hover:border-primary/50 hover:bg-muted/30"
                } ${extraction.isPending ? "pointer-events-none opacity-70" : ""}`}
              >
                {extraction.isPending ? (
                  <>
                    <LoaderCircle className="h-8 w-8 text-primary animate-spin mb-3" />
                    <span className="font-extrabold text-sm">Reading and extracting your contract...</span>
                    <span className="text-xs text-muted-foreground font-medium mt-1">This usually takes a few seconds.</span>
                  </>
                ) : selectedFiles.length ? (
                  <>
                    <FileText className="h-8 w-8 text-emerald-600 mb-3" />
                    <span className="font-extrabold text-sm text-foreground">{selectedFiles.length} PDF{selectedFiles.length === 1 ? "" : "s"} selected</span>
                    <span className="text-xs text-muted-foreground font-medium mt-1">{selectedFiles.map((file) => file.name).join(" · ")}</span>
                  </>
                ) : (
                  <>
                    <Upload className="h-8 w-8 text-primary mb-3 transition-transform group-hover:-translate-y-0.5" />
                    <span className="font-extrabold text-sm">Drop a contract PDF here, or choose a file</span>
                   <span className="text-xs text-muted-foreground font-medium mt-1">Select up to 20 PDFs · 10 MB each</span>
                  </>
                )}
              </label>

              {uploadError && (
                <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm font-semibold text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{uploadError}</span>
                </div>
              )}
              {runLog.length > 0 && (
                <div className="mt-4 rounded-lg border bg-muted/20 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-extrabold uppercase tracking-wide">Ingest run</span>
                    <span className="text-xs font-semibold text-muted-foreground">{runLog.filter((entry) => entry.state !== "processing").length}/{runLog.length} complete</span>
                  </div>
                  <div className="space-y-2">
                    {runLog.map((entry) => (
                      <div key={entry.name} className="flex items-center justify-between gap-3 text-xs">
                        <span className="min-w-0 truncate font-semibold">{entry.name}</span>
                        <span className={`shrink-0 font-bold ${entry.state === "ready" ? "text-emerald-600" : entry.state === "duplicate" || entry.state === "failed" ? "text-destructive" : "text-primary"}`}>
                          {entry.state === "processing" ? "Processing…" : entry.message}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-medium text-muted-foreground">Your PDF is used to create an editable review draft. Confirmed details are saved securely.</p>
                <Button
                  type="button"
                   onClick={processFiles}
                   disabled={!selectedFiles.length || extraction.isPending}
                  className="gap-2 font-bold"
                >
                  {extraction.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
                  Extract contract
                </Button>
              </div>
            </section>
          )}
          
          {!isActionItemsPage && <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {/* Card 1 */}
            <div className="bg-card border rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
              <div className="absolute -top-4 -right-4 p-6 opacity-5 group-hover:opacity-10 transition-opacity transform group-hover:scale-110 duration-300">
                <AlertCircle className="h-32 w-32 text-destructive" />
              </div>
              <div className="flex items-center gap-3 text-sm font-bold text-destructive mb-3 relative z-10">
                <div className="h-2 w-2 rounded-full bg-destructive animate-pulse shadow-[0_0_8px_rgba(220,38,38,0.5)]" />
                Critical Renewals
              </div>
              <div className="text-4xl font-extrabold mb-1 relative z-10">{familyRoots.filter((c) => c.family.effectiveContract.computed.status === 'red' || c.family.effectiveContract.computed.status === 'expired').length}</div>
              <p className="text-sm font-medium text-muted-foreground relative z-10">At risk or past deadline</p>
            </div>
            
            {/* Card 2 */}
            <div className="bg-card border rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
              <div className="absolute -top-4 -right-4 p-6 opacity-5 group-hover:opacity-10 transition-opacity transform group-hover:scale-110 duration-300">
                <CalendarDays className="h-32 w-32 text-primary" />
              </div>
              <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground mb-3 relative z-10">
                <Clock className="h-4 w-4 text-primary" />
                Active families
              </div>
              <div className="text-4xl font-extrabold mb-1 relative z-10">{familyRoots.length}</div>
              <p className="text-sm font-medium text-muted-foreground relative z-10">One row per effective family</p>
            </div>
            
            {/* Card 3 */}
            <div className="bg-card border rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
              <div className="absolute -top-4 -right-4 p-6 opacity-5 group-hover:opacity-10 transition-opacity transform group-hover:scale-110 duration-300">
                <WalletCards className="h-32 w-32 text-green-500" />
              </div>
              <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground mb-3 relative z-10">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                Values captured
              </div>
              <div className="text-4xl font-extrabold mb-1 relative z-10">{statedValueCount}<span className="ml-1 text-lg text-muted-foreground">/ {familyRoots.length}</span></div>
              <p className="text-sm font-medium text-muted-foreground relative z-10">Families with a stated value</p>
            </div>
            <div className="bg-card border rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
              <div className="absolute -top-4 -right-4 p-6 opacity-5 group-hover:opacity-10 transition-opacity transform group-hover:scale-110 duration-300">
                <ListFilter className="h-32 w-32 text-amber-500" />
              </div>
              <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground mb-3 relative z-10">
                <AlertCircle className="h-4 w-4 text-amber-500" />
                Open decisions
              </div>
              <div className="text-4xl font-extrabold mb-1 relative z-10">{openIssueCount}</div>
              <p className="text-sm font-medium text-muted-foreground relative z-10">Fields needing review</p>
            </div>
          </div>}

          {isActionItemsPage && <section id="action-items" className="space-y-4 scroll-mt-24">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold tracking-tight">Action Items</h2>
                <p className="mt-1 text-sm font-medium text-muted-foreground">Who needs to act, on what, and by when.</p>
              </div>
              <span className="rounded-full border bg-card px-3 py-1 text-xs font-bold">{alerts.filter((saved) => saved.family.effectiveContract.alert?.state !== 'dismissed').length} open</span>
            </div>
            <div className="grid gap-3">
              {alerts.map((saved) => {
                const alert = saved.family.effectiveContract.alert!;
                const vendor = saved.family.effectiveContract.fields.vendorLegalName.value || 'Unknown Vendor';
                const mailto = `mailto:${alert.ownerEmail}?subject=${encodeURIComponent(`Contract action: ${vendor}`)}&body=${encodeURIComponent(`Hi ${alert.owner},\n\n${vendor} needs attention.\nStart action by: ${alert.actionDate}\nLegal notice deadline: ${alert.noticeDeadline}\n\nOpen contract: ${window.location.origin}/review?id=${saved.id}`)}`;
                return (
                  <article key={saved.id} className={`rounded-xl border bg-card px-4 py-3 shadow-sm ${alert.state === 'dismissed' ? 'opacity-60' : ''}`}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className={`rounded-full px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide ${alert.state === 'overdue' ? 'bg-destructive/10 text-destructive' : alert.state === 'due' ? 'bg-amber-500/10 text-amber-700' : alert.state === 'dismissed' ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}`}>{alert.state}</span>
                        <div className="min-w-0">
                          <h3 className="truncate font-extrabold">{vendor}</h3>
                          <p className="mt-0.5 text-xs font-medium text-muted-foreground">Act by {alert.actionDate}</p>
                        </div>
                      </div>
                      {alert.state !== 'dismissed' && (
                        <div className="flex flex-wrap items-center gap-2">
                          <a href={mailto} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-xs font-bold text-primary-foreground shadow-sm"><Mail className="h-3.5 w-3.5" />Send now</a>
                          <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => setDismissingId(saved.id)}><Ban className="h-3.5 w-3.5" />Dismiss</Button>
                        </div>
                      )}
                    </div>
                    {alert.dismissedReason && <p className="mt-2 text-xs font-semibold text-muted-foreground">Dismissed: {alert.dismissedReason}</p>}
                    {dismissingId === saved.id && (
                      <div className="mt-4 flex flex-col gap-2 border-t pt-4 sm:flex-row">
                        <input value={dismissReason} onChange={(event) => setDismissReason(event.target.value)} placeholder="Why is this handled?" className="h-9 flex-1 rounded-md border bg-background px-3 text-sm" />
                        <Button size="sm" disabled={!dismissReason.trim() || dismissAlert.isPending} onClick={() => dismissAlert.mutate({ id: saved.id, data: { reason: dismissReason.trim() } })}>Confirm dismissal</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setDismissingId(null); setDismissReason(""); }}>Cancel</Button>
                      </div>
                    )}
                  </article>
                );
              })}
              {!contractsQuery.isLoading && alerts.length === 0 && <div className="rounded-xl border border-dashed bg-card p-8 text-center text-sm font-medium text-muted-foreground">No actionable alerts. Blocked and expired contracts are excluded.</div>}
            </div>
          </section>}
          
          {/* Recent Contracts Section */}
          {!isActionItemsPage && <div className="space-y-4 pt-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-xl font-bold tracking-tight">Contract Registry</h2>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={registryQuery}
                    onChange={(event) => setRegistryQuery(event.target.value)}
                    placeholder="Filter registry..."
                    className="h-9 w-full rounded-md border bg-card pl-9 pr-3 text-xs font-semibold outline-none transition focus:ring-2 focus:ring-primary/20 sm:w-56"
                  />
                </div>
                <span className="whitespace-nowrap text-xs font-bold text-muted-foreground">{filteredFamilyRoots.length} of {familyRoots.length}</span>
              </div>
            </div>
            
            <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted/30 border-b text-muted-foreground text-xs uppercase tracking-wider">
                    <tr>
                      <th className="px-5 py-4 font-bold">Contract family</th>
                      <th className="px-5 py-4 font-bold">Type</th>
                      <th className="px-5 py-4 font-bold">Value</th>
                      <th className="px-5 py-4 font-bold">Renewal</th>
                      <th className="px-5 py-4 font-bold">Notice / action</th>
                      <th className="px-5 py-4 font-bold">Owner</th>
                      <th className="px-5 py-4 font-bold">Signal</th>
                      <th className="px-6 py-4 font-bold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredFamilyRoots.map((saved) => {
                      const contract = saved.family.effectiveContract;
                      const vendor = contract.fields.vendorLegalName.value || 'Unknown Vendor';
                      const title = contract.fields.contractTitle.value || 'Untitled Contract';
                      const val = contract.fields.contractValue.value;
                      const contractType = contract.fields.contractType.value;
                      const valueIsUnknown = !val;
                      const valueStr = valueIsUnknown
                        ? 'Unknown / not stated'
                        : `${val.currency === 'USD' ? '$' : `${val.currency} `}${val.amount?.toLocaleString()} · ${val.basis.replace(/_/g, ' ')}`;
                      const owner = contract.assignment.owner || 'Unassigned';
                      const status = contract.computed.status;
                      const isBlocked = status === 'blocked';
                      const deadlineIsUrgent = status === 'red' || status === 'expired';
                      const issueCount = getRegistryIssueCount(contract);
                      const renewalDate = contract.fields.initialTermEndDate.value || contract.computed.exitDate;
                      const statusClass = status === 'red'
                        ? 'bg-destructive/10 text-destructive border-destructive/20'
                        : status === 'expired'
                          ? 'bg-orange-500/10 text-orange-700 border-orange-500/20'
                          : status === 'amber'
                            ? 'bg-amber-500/10 text-amber-600 border-amber-500/20'
                            : status === 'green'
                              ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20'
                              : 'bg-muted text-muted-foreground border-border';
                      const signalClass = issueCount > 0
                        ? 'bg-amber-500/10 text-amber-700 border-amber-500/20'
                        : statusClass;
                      
                      const isExpanded = expandedFamilies.has(saved.family.id);
                      const familyDocuments = saved.family.documents;
                      const formatHistoryValue = (key: string, value: unknown) => {
                        if (key === "contractValue" && value && typeof value === "object") {
                          const item = value as { amount?: number; currency?: string };
                          return `${item.currency ?? ""} ${item.amount?.toLocaleString() ?? ""}`.trim();
                        }
                        if (key === "noticePeriod" && value && typeof value === "object") {
                          const item = value as { amount?: number; unit?: string };
                          return `${item.amount ?? ""} ${item.unit ?? ""}`.trim();
                        }
                        return String(value ?? "");
                      };

                      return (
                        <Fragment key={saved.id}>
                        <tr className="hover:bg-muted/30 transition-colors group">
                          <td className="px-5 py-4">
                            <div className="flex items-start gap-2">
                              <button
                                type="button"
                                className="mt-0.5 rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                                disabled={saved.family.documentCount === 1}
                                aria-label={isExpanded ? "Collapse contract family" : "Expand contract family"}
                                onClick={() => setExpandedFamilies((current) => {
                                  const next = new Set(current);
                                  if (next.has(saved.family.id)) next.delete(saved.family.id);
                                  else next.add(saved.family.id);
                                  return next;
                                })}
                              >
                                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </button>
                              <div>
                                <button type="button" onClick={() => setLocation(`/review?id=${saved.id}`)} className="font-bold text-foreground text-sm hover:text-primary">{vendor}</button>
                                <div className="text-muted-foreground text-xs font-medium mt-0.5">{title}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <div className="text-xs font-extrabold capitalize">{String(contractType || "Unclassified").replace(/_/g, " ")}</div>
                            <div className="mt-1 text-[10px] font-semibold capitalize text-muted-foreground">{contract.fields.renewalMechanism.value ? String(contract.fields.renewalMechanism.value).replace(/_/g, " ") : "Renewal unknown"}</div>
                          </td>
                          <td className={`px-5 py-4 font-semibold ${valueIsUnknown ? 'text-destructive' : 'text-foreground'}`}>
                            {valueStr}
                            {valueIsUnknown && <div className="text-[10px] font-bold uppercase tracking-wide mt-1">{contract.fields.contractValue.reviewed ? "Reviewed unknown" : "Needs review"}</div>}
                          </td>
                          <td className="px-5 py-4">
                            <div className="text-xs font-extrabold">{registryDate(renewalDate)}</div>
                            <div className="mt-1 text-[10px] font-semibold text-muted-foreground">
                              {contract.fields.renewalTermLength.value
                                ? `Renews for ${contract.fields.renewalTermLength.value.amount} ${contract.fields.renewalTermLength.value.unit}`
                                : "Term length unknown"}
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            {isBlocked ? (
                              <div className="max-w-52 rounded-md border border-destructive/20 bg-destructive/5 px-2.5 py-2">
                                <div className="flex items-center gap-1.5 text-xs font-extrabold text-destructive">
                                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                                  Deadline unavailable
                                </div>
                              </div>
                            ) : (
                              <div className={`text-xs font-bold ${deadlineIsUrgent ? "text-destructive" : "text-foreground"}`}>
                                <span>Notice {registryDate(contract.computed.noticeDeadline)}</span>
                                <div className="mt-1 text-[10px] font-semibold text-muted-foreground">Act {registryDate(contract.computed.actionDate)}</div>
                              </div>
                            )}
                          </td>
                          <td className="px-5 py-4">
                            <div className="font-semibold text-foreground text-xs">{owner}</div>
                            <div className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-muted-foreground"><GitBranch className="h-3 w-3" /> {saved.family.documentCount} doc{saved.family.documentCount === 1 ? "" : "s"}</div>
                          </td>
                          <td className="px-5 py-4">
                            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider font-bold border ${signalClass}`}>
                              {issueCount > 0 ? `${issueCount} issue${issueCount === 1 ? "" : "s"}` : registryStatusLabel(status)}
                            </span>
                            <div className={`mt-1 text-[10px] font-semibold ${issueCount > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                              {issueCount > 0 ? "Open decisions" : registryStatusLabel(status)}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => setLocation(`/review?id=${saved.id}`)}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-muted/20">
                            <td colSpan={8} className="px-8 py-5">
                              <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <h3 className="text-sm font-extrabold">Contract family history</h3>
                                    <p className="text-xs font-medium text-muted-foreground">Replayed by effective date. An amendment changes only fields it explicitly addresses.</p>
                                  </div>
                                </div>
                                <div className="grid gap-3 lg:grid-cols-3">
                                  {(["contractValue", "noticePeriod", "vendorLegalName"] as const).map((key) => {
                                    const history = familyDocuments
                                      .map((document) => {
                                        const field = document.fieldValues[key] as { value?: unknown; sourceFilename?: string } | undefined;
                                        return field?.value == null ? null : { document, field };
                                      })
                                      .filter(Boolean) as Array<{ document: typeof familyDocuments[number]; field: { value?: unknown; sourceFilename?: string } }>;
                                    if (history.length < 2) return null;
                                    return (
                                      <div key={key} className="rounded-lg border bg-card p-3">
                                        <div className="text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">{key.replace(/([A-Z])/g, " $1")}</div>
                                        <div className="mt-2 space-y-2">
                                          {history.map(({ document, field }, index) => (
                                            <div key={document.id} className="flex items-start gap-2 text-xs">
                                              <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${index === history.length - 1 ? "bg-primary" : "bg-muted-foreground/40"}`} />
                                              <div>
                                                <div className={index === history.length - 1 ? "font-extrabold" : "font-semibold line-through decoration-muted-foreground/50"}>{formatHistoryValue(key, field.value)}</div>
                                                <button type="button" onClick={() => setLocation(`/review?id=${document.id}`)} className="text-[10px] font-semibold text-primary hover:underline">{field.sourceFilename}</button>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                                <div className="space-y-2">
                                  {familyDocuments.map((document, index) => (
                                    <button key={document.id} type="button" onClick={() => setLocation(`/review?id=${document.id}`)} className="flex w-full items-center justify-between rounded-lg border bg-card px-4 py-3 text-left hover:border-primary/30 hover:bg-primary/[0.02]">
                                      <div className="flex items-center gap-3">
                                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-extrabold text-primary">{index + 1}</span>
                                        <div>
                                          <div className="text-xs font-extrabold">{document.filename}</div>
                                          <div className="mt-0.5 text-[10px] font-semibold text-muted-foreground">{document.documentType?.replace(/_/g, " ") ?? "unknown type"} · Effective {document.effectiveDate ?? "date unknown"}</div>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        {document.isParent && <span className="rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase">Parent</span>}
                                        {document.isCurrent && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-bold uppercase text-primary">Current</span>}
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
                {!contractsQuery.isLoading && familyRoots.length === 0 && (
                  <div className="p-10 text-center text-sm font-medium text-muted-foreground">No confirmed contracts yet. Upload a PDF to get started.</div>
                )}
              </div>
            </div>
          </div>}
          
        </div>
      </main>
    </div>
  );
}
