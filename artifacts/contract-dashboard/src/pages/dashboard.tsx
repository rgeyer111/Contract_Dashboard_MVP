import { useState, type DragEvent, type ChangeEvent } from "react";
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
  Ban
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getListContractsQueryKey, useDismissContractAlert, useExtractContract, useListContracts } from "@workspace/api-client-react";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [dismissReason, setDismissReason] = useState("");
  const queryClient = useQueryClient();
  const contractsQuery = useListContracts();
  const contracts = contractsQuery.data ?? [];
  const alerts = contracts.filter((saved) => saved.contract.alert);
  const dismissAlert = useDismissContractAlert({
    mutation: {
      onSuccess: async () => {
        setDismissingId(null);
        setDismissReason("");
        await queryClient.invalidateQueries({ queryKey: getListContractsQueryKey() });
      },
    },
  });
  const extraction = useExtractContract({
    mutation: {
      onSuccess: (result) => {
        sessionStorage.setItem("contract-dashboard.extraction", JSON.stringify(result));
        setLocation("/review");
      },
      onError: (error) => {
        setUploadError(
          error instanceof Error
            ? error.message
            : "We could not extract this contract. Please try again.",
        );
      },
    },
  });

  const chooseFile = (file: File | undefined) => {
    if (!file) return;

    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setSelectedFile(null);
      setUploadError("Choose a PDF contract to continue.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setSelectedFile(null);
      setUploadError("PDF files must be 10 MB or smaller.");
      return;
    }

    setSelectedFile(file);
    setUploadError(null);
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
    chooseFile(event.dataTransfer.files[0]);
  };

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    chooseFile(event.target.files?.[0]);
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
          <Link href="/dashboard" className="flex items-center gap-3 px-3 py-2.5 bg-primary/10 text-primary rounded-md font-semibold text-sm transition-colors">
            <FileText className="h-4 w-4" />
            Contracts
          </Link>
          <div className="flex items-center gap-3 px-3 py-2.5 text-muted-foreground hover:bg-muted/50 rounded-md font-medium text-sm transition-colors cursor-not-allowed">
            <Clock className="h-4 w-4" />
            Renewals
          </div>
          <a href="#action-items" className="flex items-center gap-3 px-3 py-2.5 text-muted-foreground hover:bg-muted/50 rounded-md font-medium text-sm transition-colors">
            <AlertCircle className="h-4 w-4" />
            Action Items
          </a>
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
              <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Welcome back, John</h1>
              <p className="text-muted-foreground mt-1 font-medium text-sm">Here's the status of your contract renewals this week.</p>
            </div>
            <Button onClick={() => setUploadOpen(true)} className="shrink-0 gap-2 shadow-sm font-semibold">
              <Plus className="h-4 w-4" />
              New Contract
            </Button>
          </div>

          {uploadOpen && (
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
                      setSelectedFile(null);
                      setUploadError(null);
                    }
                  }}
                  disabled={extraction.isPending}
                  aria-label="Close contract upload"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <input id="contract-pdf-file" type="file" accept="application/pdf,.pdf" className="sr-only" onChange={handleInput} />
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
                    : selectedFile
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
                ) : selectedFile ? (
                  <>
                    <FileText className="h-8 w-8 text-emerald-600 mb-3" />
                    <span className="font-extrabold text-sm text-foreground">{selectedFile.name}</span>
                    <span className="text-xs text-muted-foreground font-medium mt-1">{(selectedFile.size / 1024 / 1024).toFixed(1)} MB · Ready to extract</span>
                  </>
                ) : (
                  <>
                    <Upload className="h-8 w-8 text-primary mb-3 transition-transform group-hover:-translate-y-0.5" />
                    <span className="font-extrabold text-sm">Drop a contract PDF here, or choose a file</span>
                    <span className="text-xs text-muted-foreground font-medium mt-1">Text-based PDFs up to 10 MB</span>
                  </>
                )}
              </label>

              {uploadError && (
                <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm font-semibold text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{uploadError}</span>
                </div>
              )}

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-medium text-muted-foreground">Your PDF is used to create an editable review draft. Confirmed details are saved securely.</p>
                <Button
                  type="button"
                  onClick={() => selectedFile && extraction.mutate({ data: { file: selectedFile } })}
                  disabled={!selectedFile || extraction.isPending}
                  className="gap-2 font-bold"
                >
                  {extraction.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
                  Extract contract
                </Button>
              </div>
            </section>
          )}
          
          {/* Metric Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Card 1 */}
            <div className="bg-card border rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
              <div className="absolute -top-4 -right-4 p-6 opacity-5 group-hover:opacity-10 transition-opacity transform group-hover:scale-110 duration-300">
                <AlertCircle className="h-32 w-32 text-destructive" />
              </div>
              <div className="flex items-center gap-3 text-sm font-bold text-destructive mb-3 relative z-10">
                <div className="h-2 w-2 rounded-full bg-destructive animate-pulse shadow-[0_0_8px_rgba(220,38,38,0.5)]" />
                Critical Renewals
              </div>
              <div className="text-4xl font-extrabold mb-1 relative z-10">{contracts.filter((c) => c.contract.computed.status === 'red').length}</div>
              <p className="text-sm font-medium text-muted-foreground relative z-10">Past the legal notice deadline</p>
            </div>
            
            {/* Card 2 */}
            <div className="bg-card border rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
              <div className="absolute -top-4 -right-4 p-6 opacity-5 group-hover:opacity-10 transition-opacity transform group-hover:scale-110 duration-300">
                <Clock className="h-32 w-32 text-primary" />
              </div>
              <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground mb-3 relative z-10">
                <Clock className="h-4 w-4 text-primary" />
                Upcoming
              </div>
              <div className="text-4xl font-extrabold mb-1 relative z-10">{contracts.length}</div>
              <p className="text-sm font-medium text-muted-foreground relative z-10">Total Active Contracts</p>
            </div>
            
            {/* Card 3 */}
            <div className="bg-card border rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
              <div className="absolute -top-4 -right-4 p-6 opacity-5 group-hover:opacity-10 transition-opacity transform group-hover:scale-110 duration-300">
                <CheckCircle2 className="h-32 w-32 text-green-500" />
              </div>
              <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground mb-3 relative z-10">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                Negotiated YTD
              </div>
              <div className="text-4xl font-extrabold mb-1 relative z-10">$1.2M</div>
              <p className="text-sm font-medium text-muted-foreground relative z-10">In total contract value saved</p>
            </div>
          </div>

          <section id="action-items" className="space-y-4 scroll-mt-24">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold tracking-tight">Action Items</h2>
                <p className="mt-1 text-sm font-medium text-muted-foreground">Who needs to act, on what, and by when.</p>
              </div>
              <span className="rounded-full border bg-card px-3 py-1 text-xs font-bold">{alerts.filter((saved) => saved.contract.alert?.state !== 'dismissed').length} open</span>
            </div>
            <div className="grid gap-3">
              {alerts.map((saved) => {
                const alert = saved.contract.alert!;
                const vendor = saved.contract.fields.vendorLegalName.value || 'Unknown Vendor';
                const mailto = `mailto:${alert.ownerEmail}?subject=${encodeURIComponent(`Contract action: ${vendor}`)}&body=${encodeURIComponent(`Hi ${alert.owner},\n\n${vendor} needs attention.\nStart action by: ${alert.actionDate}\nLegal notice deadline: ${alert.noticeDeadline}\n\nOpen contract: ${window.location.origin}/review?id=${saved.id}`)}`;
                return (
                  <article key={saved.id} className={`rounded-xl border bg-card p-5 shadow-sm ${alert.state === 'dismissed' ? 'opacity-60' : ''}`}>
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`rounded-full px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide ${alert.state === 'overdue' ? 'bg-destructive/10 text-destructive' : alert.state === 'due' ? 'bg-amber-500/10 text-amber-700' : alert.state === 'dismissed' ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}`}>{alert.state}</span>
                          <span className="text-xs font-semibold text-muted-foreground">Act {alert.actionDate}</span>
                        </div>
                        <h3 className="mt-2 font-extrabold">{vendor}</h3>
                        <p className="mt-1 text-xs font-medium text-muted-foreground">{alert.owner} · {alert.ownerEmail} · Notice deadline {alert.noticeDeadline}</p>
                        {alert.dismissedReason && <p className="mt-2 text-xs font-semibold">Dismissed: {alert.dismissedReason}</p>}
                      </div>
                      {alert.state !== 'dismissed' && (
                        <div className="flex flex-wrap items-center gap-2">
                          <a href={mailto} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-xs font-bold text-primary-foreground shadow-sm"><Mail className="h-3.5 w-3.5" />Send now</a>
                          <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => setDismissingId(saved.id)}><Ban className="h-3.5 w-3.5" />Dismiss</Button>
                        </div>
                      )}
                    </div>
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
          </section>
          
          {/* Recent Contracts Section */}
          <div className="space-y-4 pt-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold tracking-tight">Contract Registry</h2>
              <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80 font-semibold">View All</Button>
            </div>
            
            <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted/30 border-b text-muted-foreground text-xs uppercase tracking-wider">
                    <tr>
                      <th className="px-6 py-4 font-bold">Vendor</th>
                      <th className="px-6 py-4 font-bold">Value</th>
                      <th className="px-6 py-4 font-bold">Owner</th>
                       <th className="px-6 py-4 font-bold">Deadlines</th>
                      <th className="px-6 py-4 font-bold">Status</th>
                      <th className="px-6 py-4 font-bold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {contracts.map((saved) => {
                      const contract = saved.contract;
                      const vendor = contract.fields.vendorLegalName.value || 'Unknown Vendor';
                      const title = contract.fields.contractTitle.value || 'Untitled Contract';
                      const val = contract.fields.contractValue.value;
                      const valueIsUnknown = !val;
                      const valueStr = valueIsUnknown
                        ? 'Unknown / not stated'
                        : `${val.currency === 'USD' ? '$' : ''}${val.amount?.toLocaleString()} ${val.basis.replace(/_/g, ' ')}`;
                      const owner = contract.assignment.owner || 'Unassigned';
                      const status = contract.computed.status;
                      const isBlocked = status === 'blocked';
                      const deadlineIsUrgent = status === 'red' || status === 'expired';
                      const statusClass = status === 'red'
                        ? 'bg-destructive/10 text-destructive border-destructive/20'
                        : status === 'expired'
                          ? 'bg-orange-500/10 text-orange-700 border-orange-500/20'
                          : status === 'amber'
                            ? 'bg-amber-500/10 text-amber-600 border-amber-500/20'
                            : status === 'green'
                              ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20'
                              : 'bg-muted text-muted-foreground border-border';
                      
                      return (
                        <tr key={saved.id} className="hover:bg-muted/30 transition-colors group cursor-pointer" onClick={() => setLocation(`/review?id=${saved.id}`)}>
                          <td className="px-6 py-4">
                            <div className="font-bold text-foreground text-sm">{vendor}</div>
                            <div className="text-muted-foreground text-xs font-medium mt-0.5">{title}</div>
                          </td>
                          <td className={`px-6 py-4 font-semibold ${valueIsUnknown ? 'text-destructive' : 'text-foreground'}`}>
                            {valueStr}
                            {valueIsUnknown && <div className="text-[10px] font-bold uppercase tracking-wide mt-1">Needs review</div>}
                          </td>
                          <td className="px-6 py-4">
                            <div className="font-semibold text-foreground text-xs">{owner}</div>
                            <div className="text-muted-foreground text-[10px] uppercase tracking-wide mt-1">Contract owner</div>
                          </td>
                          <td className="px-6 py-4">
                            {isBlocked ? (
                              <div className="max-w-64 rounded-md border border-destructive/20 bg-destructive/5 px-2.5 py-2">
                                <div className="flex items-center gap-1.5 text-xs font-extrabold text-destructive">
                                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                                  Deadline unavailable
                                </div>
                                {contract.computed.reason && (
                                  <p className="mt-1 text-[10px] font-semibold leading-relaxed text-destructive/90">
                                    {contract.computed.reason}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <div className={`flex flex-col items-start gap-0.5 font-bold text-xs w-fit px-2.5 py-1 rounded-md whitespace-nowrap ${deadlineIsUrgent ? 'text-destructive bg-destructive/5' : 'text-muted-foreground bg-muted/50'}`}>
                                {deadlineIsUrgent && <AlertCircle className="h-3.5 w-3.5" />}
                                <span>Notice {contract.computed.noticeDeadline}</span>
                                {contract.computed.actionDate && <span className="font-medium">Act {contract.computed.actionDate}</span>}
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider font-bold border ${statusClass}`}>
                              {status}
                            </span>
                            {!isBlocked && contract.computed.reason && <div className="mt-1 max-w-56 text-[10px] font-semibold text-destructive normal-case">{contract.computed.reason}</div>}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 transition-opacity" onClick={(event) => { event.stopPropagation(); setLocation(`/review?id=${saved.id}`); }}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!contractsQuery.isLoading && contracts.length === 0 && (
                  <div className="p-10 text-center text-sm font-medium text-muted-foreground">No confirmed contracts yet. Upload a PDF to get started.</div>
                )}
              </div>
            </div>
          </div>
          
        </div>
      </main>
    </div>
  );
}
