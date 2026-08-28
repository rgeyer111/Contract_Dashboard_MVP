import { useEffect, useState } from "react";
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
  Upload,
  FileUp,
  LoaderCircle,
  X,
  Mail,
  Ban,
  Link2,
  Check,
  Bookmark,
  Pin,
  RotateCcw,
  ChevronUp,
  ChevronDown,
  Pencil,
  Trash2,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getListContractsQueryKey,
  useDismissContractAlert,
  useListContracts,
  useUpdateContract,
} from "@workspace/api-client-react";
import { contractTypeOptions, documentTypeOptions, getDocumentTypeCounts } from "@/lib/contracts";
import {
  formatContractType,
  formatDocumentType,
  formatContractValue,
  formatDaysRemaining,
  formatNegotiationBufferSource,
  formatPeriod,
  formatRegistryDate,
  formatRenewalMechanism,
  statusClasses,
  statusRowClasses,
} from "@/lib/registry";
import { useContractUpload } from "@/hooks/use-contract-upload";
import { useRegistryFilters } from "@/hooks/use-registry-filters";
import { useSavedRegistryViews } from "@/hooks/use-saved-registry-views";
import { LanguageSwitch, translateComputedReasonOrDetail, translateDomainOption, useLanguage } from "@/lib/i18n";
import { demoNavigationPath, isDemoLocation, useDemoContracts } from "@/lib/demo-mode";

export default function Dashboard() {
  const { language, t } = useLanguage();
  const [location, setLocation] = useLocation();
  const isDemo = isDemoLocation();
  const isActionItemsPage = location.split("?")[0] === "/action-items";
  const [uploadOpen, setUploadOpen] = useState(false);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [dismissReason, setDismissReason] = useState("");
  const [savingContractTypeId, setSavingContractTypeId] = useState<string | null>(null);
  const [contractTypeErrorId, setContractTypeErrorId] = useState<string | null>(null);
  const [contractTypeSaveError, setContractTypeSaveError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const realContractsQuery = useListContracts({
    query: {
      enabled: !isDemo,
      queryKey: getListContractsQueryKey(),
    },
  });
  const demoContractsQuery = useDemoContracts(isDemo);
  const contractsQuery = isDemo ? demoContractsQuery : realContractsQuery;
  const contracts = contractsQuery.data ?? [];
  const documentTypeCounts = getDocumentTypeCounts(contracts);
  const upload = useContractUpload(setLocation, !isDemo);
  const {
    selectedFiles,
    runLog,
    isDragging,
    uploadError,
    extraction,
    hasResumableRun,
    setIsDragging,
    removeFile,
    handleDrop,
    handleInput,
    processFiles,
    retryFile,
    resetUpload,
  } = upload;
  useEffect(() => {
    if (!isDemo && hasResumableRun && !isActionItemsPage) setUploadOpen(true);
    if (isDemo) setUploadOpen(false);
  }, [hasResumableRun, isActionItemsPage, isDemo]);
  const {
    searchTerm,
    documentTypeFilter,
    shareStatus,
    filteredContracts,
    sortedFilteredContracts,
    updateDocumentTypeFilter,
    updateSearchTerm,
    copyFilteredViewLink,
    openSavedView,
  } = useRegistryFilters(contracts, location);
  const savedViewState = useSavedRegistryViews(searchTerm, documentTypeFilter, !isDemo);
  const {
    registryViewsQuery,
    savedViews,
    savedViewName,
    setSavedViewName,
    saveViewOpen,
    setSaveViewOpen,
    editingViewId,
    setEditingViewId,
    editingViewName,
    setEditingViewName,
    deletingViewId,
    setDeletingViewId,
    savedViewError,
    setSavedViewError,
    savedViewMoveStatus,
    createRegistryView,
    updateRegistryView,
    pinRegistryView,
    reorderRegistryViews,
    deleteRegistryView,
    saveCurrentView,
    startRename,
    renameView,
    confirmDelete,
    deleteView,
    togglePin,
    movePinnedView,
  } = savedViewState;
  const alerts = contracts.filter((saved) => saved.contract.alert);
  const openAlerts = alerts.filter((saved) => saved.contract.alert?.state !== "dismissed");
  const dismissAlert = useDismissContractAlert({
    mutation: {
      onSuccess: async () => {
        setDismissingId(null);
        setDismissReason("");
        await queryClient.invalidateQueries({ queryKey: getListContractsQueryKey() });
      },
    },
  });
  const updateContract = useUpdateContract({
    mutation: {
      onSuccess: async () => {
        setSavingContractTypeId(null);
        setContractTypeErrorId(null);
        setContractTypeSaveError(null);
        await queryClient.invalidateQueries({ queryKey: getListContractsQueryKey() });
      },
      onError: () => {
        setSavingContractTypeId(null);
        setContractTypeSaveError(t("ui.contract.type.could.not.be.saved.please.try.again"));
      },
    },
  });
  const saveContractType = (saved: typeof contracts[number], value: typeof contractTypeOptions[number]) => {
    if (isDemo || value === saved.contract.fields.contractType.value || updateContract.isPending) return;
    setSavingContractTypeId(saved.id);
    setContractTypeErrorId(saved.id);
    setContractTypeSaveError(null);
    updateContract.mutate({
      id: saved.id,
      data: {
        filename: saved.filename,
        contract: {
          ...saved.contract,
          fields: {
            ...saved.contract.fields,
            contractType: {
              ...saved.contract.fields.contractType,
              value,
              reviewed: true,
            },
          },
        },
      },
    });
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
          <Link data-testid="link-dashboard" href={demoNavigationPath("/dashboard", isDemo)} className={`flex items-center gap-3 px-3 py-2.5 rounded-md font-semibold text-sm transition-colors ${!isActionItemsPage ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/50"}`}>
            <FileText className="h-4 w-4" />
            {t("ui.contracts")}
          </Link>
          <div className="flex items-center gap-3 px-3 py-2.5 text-muted-foreground hover:bg-muted/50 rounded-md font-medium text-sm transition-colors cursor-not-allowed">
            <Clock className="h-4 w-4" />
            {t("ui.renewals")}
          </div>
          <Link data-testid="link-action-items" href={demoNavigationPath("/action-items", isDemo)} className={`flex items-center gap-3 px-3 py-2.5 rounded-md font-medium text-sm transition-colors ${isActionItemsPage ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:bg-muted/50"}`}>
            <AlertCircle className="h-4 w-4" />
            {t("ui.action.items")}
          </Link>
        </nav>
        
        <div className="p-4 border-t space-y-1">
          <div className="flex items-center gap-3 px-3 py-2.5 text-muted-foreground hover:bg-muted/50 rounded-md font-medium text-sm transition-colors cursor-not-allowed">
            <Settings className="h-4 w-4" />
            {t("ui.settings")}
          </div>
          <Link href="/" className="flex items-center gap-3 px-3 py-2.5 text-muted-foreground hover:bg-muted/50 rounded-md font-medium text-sm transition-colors">
            <LogOut className="h-4 w-4" />
            {t("ui.log.out")}
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
                value={searchTerm}
                onChange={(event) => updateSearchTerm(event.target.value)}
                placeholder={t("ui.search.contracts")}
                className="w-full h-9 pl-9 pr-4 rounded-md border bg-muted/30 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/70"
                aria-label={t("ui.search.contracts.2")}
              />
              {searchTerm && (
                <button
                  type="button"
                  aria-label={t("ui.clear.search")}
                  onClick={() => updateSearchTerm("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <LanguageSwitch />
            <button type="button" aria-label={t("ui.notifications")} className="relative p-2 text-muted-foreground hover:bg-muted rounded-full transition-colors">
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
          {isDemo && (
            <div data-testid="banner-demo-mode" className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
              <p className="text-sm font-extrabold text-primary">{t("demo.bannerTitle")}</p>
              <p className="mt-0.5 text-xs font-medium text-muted-foreground">{t("demo.bannerExplanation")}</p>
            </div>
          )}
          
          {/* Page Header */}
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight text-foreground">{isActionItemsPage ? t("ui.action.items") : t("ui.welcome.back.john")}</h1>
              <p className="text-muted-foreground mt-1 font-medium text-sm">{isActionItemsPage ? t("ui.stay.ahead.of.the.contract.decisions.that.need.your.attention") : t("ui.here.s.the.status.of.your.contract.renewals.this.week")}</p>
            </div>
            {!isActionItemsPage && !isDemo && (
              <Button onClick={() => setUploadOpen(true)} className="shrink-0 gap-2 shadow-sm font-semibold">
                <Plus className="h-4 w-4" />
                {t("ui.new.contract")}
              </Button>
            )}
          </div>

          {!isActionItemsPage && !isDemo && uploadOpen && (
            <section className="bg-card border rounded-xl shadow-sm p-5 sm:p-6 animate-in fade-in slide-in-from-top-2 duration-300" aria-labelledby="upload-contract-heading">
              <div className="flex items-start justify-between gap-4 mb-5">
                <div>
                  <div className="flex items-center gap-2 text-primary font-bold text-sm">
                    <FileUp className="h-4 w-4" />
                    {t("ui.new.contract.2")}
                  </div>
                  <h2 id="upload-contract-heading" className="text-xl font-extrabold tracking-tight mt-1">{t("ui.upload.a.pdf.to.extract.its.details")}</h2>
                  <p className="text-sm text-muted-foreground font-medium mt-1">{t("ui.we.ll.prepare.an.editable.draft.with.confidence.ratings.for.every.field")}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    if (!extraction.isPending) {
                      setUploadOpen(false);
                      resetUpload();
                    }
                  }}
                  disabled={extraction.isPending}
                  aria-label={t("ui.close.contract.upload")}
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
                    <span className="font-extrabold text-sm">{t("ui.reading.and.extracting.your.contract")}</span>
                    <span className="text-xs text-muted-foreground font-medium mt-1">{t("ui.this.usually.takes.a.few.seconds")}</span>
                  </>
                ) : selectedFiles.length ? (
                  <>
                    <FileText className="h-8 w-8 text-emerald-600 mb-3" />
                     <span className="font-extrabold text-sm text-foreground">{t("dashboard.pdfSelected", { count: selectedFiles.length })}</span>
                    <span className="text-xs text-muted-foreground font-medium mt-1">{selectedFiles.map((file) => file.name).join(" · ")}</span>
                  </>
                ) : (
                  <>
                    <Upload className="h-8 w-8 text-primary mb-3 transition-transform group-hover:-translate-y-0.5" />
                    <span className="font-extrabold text-sm">{t("ui.drop.a.contract.pdf.here.or.choose.a.file")}</span>
                   <span className="text-xs text-muted-foreground font-medium mt-1">{t("ui.select.up.to.20.pdfs.10.mb.each")}</span>
                  </>
                )}
              </label>

              {selectedFiles.length > 0 && !extraction.isPending && (
                <div className="mt-4 space-y-2" aria-label={t("ui.selected.contract.files")}>
                  {selectedFiles.map((file, index) => (
                    <div
                      key={`${file.name}-${file.lastModified}-${index}`}
                      className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate text-sm font-semibold" title={file.name}>{file.name}</span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={() => removeFile(index)}
                        disabled={runLog.length > 0}
                         aria-label={t("file.remove", { name: file.name })}
                         title={t("file.remove", { name: file.name })}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {uploadError && (
                <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm font-semibold text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                   <span>{t(uploadError)}</span>
                </div>
              )}
              {runLog.length > 0 && (
                <div className="mt-4 rounded-lg border bg-muted/20 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-extrabold uppercase tracking-wide">{t("ui.ingest.run")}</span>
                     <span className="text-xs font-semibold text-muted-foreground">{t("dashboard.ingestComplete", { done: runLog.filter((entry) => entry.state !== "processing").length, total: runLog.length })}</span>
                  </div>
                  <div className="space-y-2">
                    {runLog.map((entry) => (
                      <div key={entry.id} className="flex items-center justify-between gap-3 text-xs">
                        <span className="min-w-0 truncate font-semibold">{entry.name}</span>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className={`font-bold ${entry.state === "ready" ? "text-emerald-600" : entry.state === "duplicate" || entry.state === "failed" ? "text-destructive" : "text-primary"}`}>
                             {entry.state === "processing" ? t("ui.processing") : entry.message ? t(entry.message) : ""}
                          </span>
                          {entry.state === "failed" && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1 px-2 text-xs"
                              onClick={() => retryFile(entry.id)}
                              disabled={extraction.isPending}
                               aria-label={t("file.retry", { name: entry.name })}
                            >
                              <RotateCcw className="h-3 w-3" />
                              {t("ui.retry")}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-medium text-muted-foreground">{t("ui.your.pdf.is.used.to.create.an.editable.review.draft.confirmed.details.are.saved.securely")}</p>
                <Button
                  type="button"
                   onClick={() => processFiles()}
                   disabled={!selectedFiles.length || extraction.isPending || runLog.length > 0}
                  className="gap-2 font-bold"
                >
                  {extraction.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
                  {t("ui.extract.contract")}
                </Button>
              </div>
            </section>
          )}
          
          {!isActionItemsPage && <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
             {/* Card 1 */}
             <div className="bg-card border rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
              <div className="absolute -top-4 -right-4 p-6 opacity-5 group-hover:opacity-10 transition-opacity transform group-hover:scale-110 duration-300">
                <AlertCircle className="h-32 w-32 text-destructive" />
              </div>
              <div className="flex items-center gap-3 text-sm font-bold text-destructive mb-3 relative z-10">
                <div className="h-2 w-2 rounded-full bg-destructive animate-pulse shadow-[0_0_8px_rgba(220,38,38,0.5)]" />
                {t("ui.critical.renewals")}
              </div>
              <div className="text-4xl font-extrabold mb-1 relative z-10">{contracts.filter((c) => c.contract.computed.status === 'red').length}</div>
              <p className="text-sm font-medium text-muted-foreground relative z-10">{t("ui.past.the.legal.notice.deadline")}</p>
            </div>
            
            {/* Card 2 */}
            <div className="bg-card border rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
              <div className="absolute -top-4 -right-4 p-6 opacity-5 group-hover:opacity-10 transition-opacity transform group-hover:scale-110 duration-300">
                <Clock className="h-32 w-32 text-primary" />
              </div>
              <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground mb-3 relative z-10">
                <Clock className="h-4 w-4 text-primary" />
                {t("ui.upcoming")}
              </div>
               <div data-testid="active-contract-count" className="text-4xl font-extrabold mb-1 relative z-10">{filteredContracts.length}</div>
              <p className="text-sm font-medium text-muted-foreground relative z-10">{t("ui.total.active.contracts")}</p>
            </div>
            
              {/* Card 3 */}
              <button type="button" data-testid="button-open-action-items" onClick={() => setLocation(demoNavigationPath("/action-items", isDemo))} className="w-full bg-card border rounded-xl p-6 text-left shadow-sm transition-shadow hover:shadow-md cursor-pointer relative overflow-hidden group">
                <div className="absolute -top-4 -right-4 p-6 opacity-5 group-hover:opacity-10 transition-opacity transform group-hover:scale-110 duration-300">
                  <CheckCircle2 className="h-32 w-32 text-green-500" />
                </div>
                <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground mb-3 relative z-10">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  {t("ui.action.items")}
                </div>
                <div className="text-4xl font-extrabold mb-1 relative z-10">{openAlerts.length}</div>
                <p className="text-sm font-medium text-muted-foreground relative z-10">{t("ui.open.action.items")}</p>
              </button>
          </div>}

          {isActionItemsPage && <section id="action-items" className="space-y-4 scroll-mt-24">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold tracking-tight">{t("ui.action.items")}</h2>
                <p className="mt-1 text-sm font-medium text-muted-foreground">{t("ui.who.needs.to.act.on.what.and.by.when")}</p>
              </div>
              <span className="rounded-full border bg-card px-3 py-1 text-xs font-bold">{t("dashboard.openCount", { count: openAlerts.length })}</span>
            </div>
            <div className="grid gap-3">
              {alerts.map((saved) => {
                const alert = saved.contract.alert!;
                const vendor = saved.contract.fields.vendorLegalName.value || t("ui.unknown.vendor.2");
                const contractTitle = saved.contract.fields.contractTitle.value || saved.filename;
                const contractNumber = saved.contract.fields.contractNumber.value || t("ui.not.stated");
                const contractReference = t("alert.contractReference", { title: contractTitle, number: contractNumber });
                const daysRemaining = saved.contract.computed.daysRemaining == null
                  ? t("ui.not.stated")
                  : t("common.days", { count: saved.contract.computed.daysRemaining });
                const renewalMechanism = saved.contract.fields.renewalMechanism.value;
                const outcome = renewalMechanism
                  ? translateDomainOption(language, renewalMechanism)
                  : t("ui.not.stated");
                const contractUrl = `${window.location.origin}/contracts/${saved.id}`;
                const mailto = `mailto:${alert.ownerEmail}?subject=${encodeURIComponent(t("alert.emailSubject", { vendor, contract: contractTitle }))}&body=${encodeURIComponent(t("alert.emailBody", {
                  owner: alert.owner,
                  vendor,
                  contract: contractReference,
                  actionDate: formatRegistryDate(alert.actionDate, language),
                  noticeDeadline: formatRegistryDate(alert.noticeDeadline, language),
                  daysRemaining,
                  outcome,
                  url: contractUrl,
                }))}`;
                return (
                  <article key={saved.id} className={`rounded-xl border bg-card px-4 py-3 shadow-sm ${alert.state === 'dismissed' ? 'opacity-60' : ''}`}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                          <span className={`rounded-full px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide ${alert.state === 'overdue' ? 'bg-destructive/10 text-destructive' : alert.state === 'due' ? 'bg-amber-500/10 text-amber-700' : alert.state === 'dismissed' ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}`}>{translateDomainOption(language, alert.state)}</span>
                        <div className="min-w-0">
                          <h3 className="truncate font-extrabold">{vendor}</h3>
                           <p className="mt-0.5 truncate text-xs font-semibold text-foreground">{contractReference}</p>
                           <p className="mt-0.5 text-xs font-medium text-muted-foreground">{t("alert.dueTo", { date: formatRegistryDate(alert.actionDate, language), owner: alert.owner })}</p>
                            <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">{t("alert.recipient", { email: alert.ownerEmail })}</p>
                           <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">{t("alert.legalDeadline", { date: formatRegistryDate(alert.noticeDeadline, language) })}</p>
                        </div>
                      </div>
                      {alert.state !== 'dismissed' && !isDemo && (
                        <div className="flex flex-wrap items-center gap-2">
                          <a href={mailto} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-xs font-bold text-primary-foreground shadow-sm"><Mail className="h-3.5 w-3.5" />{t("ui.send.now")}</a>
                          <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => setDismissingId(saved.id)}><Ban className="h-3.5 w-3.5" />{t("ui.dismiss")}</Button>
                        </div>
                      )}
                    </div>
                    {alert.dismissedReason && <p className="mt-2 text-xs font-semibold text-muted-foreground">{t("alert.dismissedReason", { reason: alert.dismissedReason })}</p>}
                    {dismissingId === saved.id && (
                      <div className="mt-4 flex flex-col gap-2 border-t pt-4 sm:flex-row">
                        <input value={dismissReason} onChange={(event) => setDismissReason(event.target.value)} placeholder={t("ui.why.is.this.handled")} className="h-9 flex-1 rounded-md border bg-background px-3 text-sm" />
                        <Button size="sm" disabled={!dismissReason.trim() || dismissAlert.isPending} onClick={() => dismissAlert.mutate({ id: saved.id, data: { reason: dismissReason.trim() } })}>{t("ui.confirm.dismissal")}</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setDismissingId(null); setDismissReason(""); }}>{t("ui.cancel")}</Button>
                      </div>
                    )}
                  </article>
                );
              })}
              {!contractsQuery.isLoading && alerts.length === 0 && <div className="rounded-xl border border-dashed bg-card p-8 text-center text-sm font-medium text-muted-foreground">{t("ui.no.actionable.alerts.blocked.and.expired.contracts.are.excluded")}</div>}
            </div>
          </section>}
          
          {!isActionItemsPage && !isDemo && <section aria-labelledby="saved-views-heading" className="space-y-4 pt-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-primary">
                  <Bookmark className="h-4 w-4" />
                  <h2 id="saved-views-heading" className="text-xl font-bold tracking-tight text-foreground">{t("ui.saved.views")}</h2>
                </div>
                <p className="mt-1 text-sm font-medium text-muted-foreground">{t("ui.save.common.registry.queues.and.reopen.them.with.one.click")}</p>
              </div>
              {!saveViewOpen && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSavedViewError(null);
                    setSaveViewOpen(true);
                    setSavedViewName("");
                  }}
                  className="gap-2 font-semibold"
                >
                  <Save className="h-3.5 w-3.5" />
                  {t("ui.save.current.view")}
                </Button>
              )}
            </div>

            {saveViewOpen && (
              <form
                className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-end"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveCurrentView();
                }}
              >
                <div className="flex-1">
                  <label htmlFor="saved-view-name" className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("ui.view.name")}</label>
                  <input
                    id="saved-view-name"
                    data-testid="saved-view-name"
                    value={savedViewName}
                    onChange={(event) => setSavedViewName(event.target.value)}
                    placeholder={t("ui.e.g.renewal.review.queue")}
                    maxLength={100}
                    autoFocus
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <p className="mt-1 text-xs font-medium text-muted-foreground">
                    {t("view.saveSummary", {
                      search: searchTerm.trim() ? `“${searchTerm.trim()}”` : t("ui.all.searches"),
                      documentType: documentTypeFilter ? formatDocumentType(documentTypeFilter, language) : t("ui.all.document.types"),
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button type="submit" size="sm" disabled={createRegistryView.isPending} className="gap-2 font-semibold">
                    <Save className="h-3.5 w-3.5" />
                    {createRegistryView.isPending ? t("ui.saving") : t("ui.save.view")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSaveViewOpen(false);
                      setSavedViewName("");
                      setSavedViewError(null);
                    }}
                  >
                    {t("ui.cancel")}
                  </Button>
                </div>
              </form>
            )}

            {savedViewError && <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm font-semibold text-destructive">{t(savedViewError)}</p>}
            <p className="sr-only" role="status" aria-live="polite">{savedViewMoveStatus}</p>

            <div className="rounded-xl border bg-card shadow-sm">
              {registryViewsQuery.isLoading ? (
                <div className="flex items-center gap-2 p-5 text-sm font-medium text-muted-foreground">
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  {t("ui.loading.saved.views")}
                </div>
              ) : registryViewsQuery.isError ? (
                <div className="p-5 text-sm font-medium text-destructive">{t("ui.saved.views.could.not.be.loaded.refresh.and.try.again")}</div>
              ) : savedViews.length === 0 ? (
                <div className="p-6 text-center text-sm font-medium text-muted-foreground">
                  {t("ui.no.saved.views.yet.save.the.current.search.and.document.type.filters.to.create.a.reusable.queue")}
                </div>
              ) : (
                <div className="divide-y">
                  {savedViews.map((view) => {
                    const isActive = view.search === searchTerm && (view.documentType ?? "") === documentTypeFilter;
                    const pinnedViews = savedViews.filter((item) => item.isPinned);
                    const pinnedIndex = pinnedViews.findIndex((item) => item.id === view.id);
                    return (
                      <div key={view.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                        {editingViewId === view.id ? (
                          <form
                            className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center"
                            onSubmit={(event) => {
                              event.preventDefault();
                              renameView(view);
                            }}
                          >
                            <label htmlFor={`rename-view-${view.id}`} className="sr-only">{t("ui.rename")} {view.name}</label>
                            <input
                              id={`rename-view-${view.id}`}
                              value={editingViewName}
                              onChange={(event) => setEditingViewName(event.target.value)}
                              maxLength={100}
                              autoFocus
                              className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary/20"
                            />
                            <div className="flex items-center gap-2">
                              <Button type="submit" size="sm" disabled={updateRegistryView.isPending}>{t("ui.save")}</Button>
                              <Button type="button" size="sm" variant="ghost" onClick={() => { setEditingViewId(null); setEditingViewName(""); setSavedViewError(null); }}>{t("ui.cancel")}</Button>
                            </div>
                          </form>
                        ) : deletingViewId === view.id ? (
                          <div className="flex min-w-0 flex-1 flex-col gap-1">
                             <p className="text-sm font-bold">{t("view.confirmDelete", { name: view.name })}</p>
                            <p className="text-xs font-medium text-muted-foreground">{t("ui.this.only.removes.the.saved.shortcut.your.contracts.are.not.affected")}</p>
                          </div>
                        ) : (
                           <button type="button" onClick={() => openSavedView(view)} className="min-w-0 flex-1 text-left" aria-label={t("view.open", { name: view.name })}>
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-extrabold text-foreground hover:text-primary">{view.name}</span>
                              {view.isPinned && (
                                <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                                  <Pin className="h-3 w-3" />
                                  {t("ui.pinned")}
                                </span>
                              )}
                              {isActive && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-primary">{t("ui.active")}</span>}
                            </span>
                            <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium text-muted-foreground">
                              <span>{view.search ? `${t("ui.search")}“${view.search}”` : t("ui.all.searches.2")}</span>
                              <span>{view.documentType ? formatDocumentType(view.documentType, language) : t("ui.all.document.types.2")}</span>
                            </span>
                          </button>
                        )}
                        {deletingViewId === view.id ? (
                          <div className="flex shrink-0 items-center gap-2">
                            <Button type="button" size="sm" variant="destructive" disabled={deleteRegistryView.isPending} onClick={() => deleteView(view)}>
                              {deleteRegistryView.isPending ? t("ui.deleting") : t("ui.delete")}
                            </Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => { setDeletingViewId(null); setSavedViewError(null); }}>{t("ui.cancel")}</Button>
                          </div>
                        ) : editingViewId !== view.id ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                                aria-label={view.isPinned ? t("view.unpin", { name: view.name }) : t("view.pin", { name: view.name })}
                                title={view.isPinned ? t("view.unpin", { name: view.name }) : t("view.pin", { name: view.name })}
                              disabled={pinRegistryView.isPending}
                              onClick={() => togglePin(view)}
                            >
                              <Pin className={`h-3.5 w-3.5 ${view.isPinned ? "fill-current text-amber-600 dark:text-amber-300" : "text-muted-foreground"}`} />
                            </Button>
                            {view.isPinned && (
                              <>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                    aria-label={t("view.moveUp", { name: view.name, atBoundary: pinnedIndex <= 0 })}
                                    title={t("view.moveUpTitle")}
                                  disabled={pinnedIndex <= 0 || reorderRegistryViews.isPending}
                                  onClick={() => movePinnedView(view.id, "up")}
                                >
                                  <ChevronUp className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                    aria-label={t("view.moveDown", { name: view.name, atBoundary: pinnedIndex === pinnedViews.length - 1 })}
                                    title={t("view.moveDownTitle")}
                                  disabled={pinnedIndex === pinnedViews.length - 1 || reorderRegistryViews.isPending}
                                  onClick={() => movePinnedView(view.id, "down")}
                                >
                                  <ChevronDown className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            )}
                            <Button type="button" variant="ghost" size="icon" aria-label={t("view.rename", { name: view.name })} title={t("view.rename", { name: view.name })} onClick={() => startRename(view)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button type="button" variant="ghost" size="icon" aria-label={t("view.delete", { name: view.name })} title={t("view.delete", { name: view.name })} onClick={() => confirmDelete(view)}>
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>}

          {/* Recent Contracts Section */}
          {!isActionItemsPage && <div className="space-y-4 pt-4">
             <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-xl font-bold tracking-tight">{t("ui.contract.registry")}</h2>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <label htmlFor="document-type-filter" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  {t("ui.document.type")}
                </label>
                <div className="flex flex-wrap items-center gap-2">
                 <select
                  id="document-type-filter"
                  aria-label={t("ui.filter.by.document.type")}
                   value={documentTypeFilter}
                    onChange={(event) => updateDocumentTypeFilter(event.target.value)}
                   className="h-9 rounded-md border border-input bg-background px-3 text-xs font-semibold capitalize outline-none focus:ring-2 focus:ring-primary/20"
                 >
                    <option value="">{t("registry.allDocumentTypesCount", { count: contracts.length })}</option>
                   {documentTypeOptions.map((option) => (
                      <option key={option} value={option}>{formatDocumentType(option, language)} ({documentTypeCounts[option] ?? 0})</option>
                   ))}
                 </select>
                {documentTypeFilter && (
                   <Button
                     type="button"
                     variant="ghost"
                     size="sm"
                     onClick={() => updateDocumentTypeFilter("")}
                     aria-label={t("ui.clear.document.type.filter")}
                     title={t("ui.clear.document.type.filter")}
                     className="gap-1.5 text-primary hover:text-primary/80 font-semibold"
                   >
                     <X className="h-3.5 w-3.5" />
                     {t("ui.clear.type")}
                   </Button>
                 )}
                  {(documentTypeFilter || searchTerm.trim()) && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={copyFilteredViewLink}
                       aria-label={t("ui.copy.filtered.view.link")}
                       title={t("ui.copy.filtered.view.link")}
                      className="gap-1.5 font-semibold"
                    >
                      {shareStatus === "copied" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Link2 className="h-3.5 w-3.5" />}
                       {shareStatus === "copied" ? t("ui.link.copied") : shareStatus === "error" ? t("ui.copy.failed.try.again") : t("ui.copy.view.link")}
                    </Button>
                  )}
                 {!documentTypeFilter && !searchTerm && (
                   <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80 font-semibold">{t("ui.view.all")}</Button>
                 )}
                </div>
               </div>
             </div>
              {(documentTypeFilter || searchTerm) && (
               <p className="text-xs font-semibold text-muted-foreground">
                  {t("dashboard.showingContracts", { shown: filteredContracts.length, total: contracts.length })}
               </p>
             )}
            
             <div data-testid="contract-registry" className="bg-card border rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                 <table className="w-full min-w-[1780px] text-sm text-left">
                   <thead className="border-b text-xs uppercase tracking-wider">
                     <tr className="border-b bg-muted/20 text-[10px] font-extrabold tracking-[0.14em]">
                        <th colSpan={5} className="border-r border-border px-4 py-2.5 text-left text-primary">{t("ui.extracted.contract.details")}</th>
                        <th colSpan={5} className="border-r border-border bg-primary/[0.035] px-4 py-2.5 text-left text-primary">{t("ui.computed.runway")}</th>
                        <th className="border-r border-border bg-muted/30 px-4 py-2.5 text-left text-primary">{t("ui.extracted.value")}</th>
                        <th colSpan={2} className="bg-amber-500/[0.04] px-4 py-2.5 text-left text-amber-700 dark:text-amber-300">{t("ui.assigned.ownership")}</th>
                     </tr>
                    <tr>
                        <th className="bg-muted/30 px-4 py-3 font-bold text-muted-foreground">{t("ui.vendor")}</th>
                        <th className="bg-muted/30 px-4 py-3 font-bold text-muted-foreground">{t("ui.contract.type")}</th>
                        <th className="bg-muted/30 px-4 py-3 font-bold text-muted-foreground">{t("ui.end.date")}</th>
                        <th className="bg-muted/30 px-4 py-3 font-bold text-muted-foreground">{t("ui.renewal.mechanism")}</th>
                         <th className="border-r border-border bg-muted/30 px-4 py-3 font-bold text-muted-foreground">{t("ui.notice.period")}</th>
                        <th className="bg-primary/[0.035] px-4 py-3 font-bold text-muted-foreground">{t("ui.action.date")}</th>
                        <th className="bg-primary/[0.035] px-4 py-3 font-bold text-muted-foreground">{t("ui.notice.deadline")}</th>
                        <th className="bg-primary/[0.035] px-4 py-3 font-bold text-muted-foreground">{t("ui.days.remaining")}</th>
                        <th className="bg-primary/[0.035] px-4 py-3 font-bold text-muted-foreground">{t("ui.status")}</th>
                        <th className="border-r border-border bg-primary/[0.035] px-4 py-3 font-bold text-muted-foreground">{t("ui.status.reason")}</th>
                         <th className="border-r border-border bg-muted/30 px-4 py-3 font-bold text-muted-foreground">{t("ui.value")}</th>
                        <th className="bg-amber-500/[0.04] px-4 py-3 font-bold text-muted-foreground">{t("ui.owner")}</th>
                        <th className="bg-amber-500/[0.04] px-4 py-3 font-bold text-muted-foreground">{t("ui.negotiation.buffer")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                     {sortedFilteredContracts.map((saved) => {
                       const contract = saved.contract;
                        const vendor = contract.fields.vendorLegalName.value || t("ui.unknown.vendor");
                        const title = contract.fields.contractTitle.value || saved.filename;
                        const originallyExtractedContractType =
                          typeof contract.fields.contractType.originalValue === "string"
                            ? contract.fields.contractType.originalValue
                            : null;
                       const value = contract.fields.contractValue.value;
                       const valueIsUnknown = !value;
                       const status = contract.computed.status;
                       const isBlocked = status === "blocked";
                       const isContractTypeSaving = savingContractTypeId === saved.id;
                        const translatedReason = translateComputedReasonOrDetail(
                          language,
                          contract.computed.reasonCode,
                          contract.computed.reason,
                        );
                        const statusReason = translatedReason
                          ? translatedReason
                          : status === "green"
                            ? t("ui.within.action.runway")
                            : status === "amber"
                              ? t("ui.action.window.approaching")
                              : status === "red"
                                ? t("ui.past.legal.notice.deadline")
                                : status === "expired"
                                  ? t("ui.contract.end.date.has.passed")
                                  : t("ui.dates.blocked.review.required");
                       return (
                         <tr key={saved.id} data-testid={`contract-registry-row-${saved.id}`} className={`${statusRowClasses(status)} hover:bg-muted/30 transition-colors`}>
                           <td className="max-w-[190px] bg-muted/[0.12] px-4 py-3 align-top">
                              {isDemo ? (
                                <span className="block max-w-full truncate text-left text-xs font-extrabold text-foreground" title={vendor}>{vendor}</span>
                              ) : (
                                <button type="button" onClick={() => setLocation(`/contracts/${saved.id}`)} className="block max-w-full truncate text-left text-xs font-extrabold text-foreground hover:text-primary" title={vendor}>{vendor}</button>
                              )}
                             <div className="mt-1 max-w-full truncate text-[10px] font-medium text-muted-foreground" title={title}>{title}</div>
                           </td>
                           <td className="bg-muted/[0.12] px-4 py-3 align-top">
                             <select
                               data-testid={`contract-type-select-${saved.id}`}
                                 aria-label={t("contract.typeFor", { name: vendor })}
                               value={contract.fields.contractType.value || ""}
                                disabled={isDemo || isContractTypeSaving || updateContract.isPending}
                               onChange={(event) => saveContractType(saved, event.target.value as typeof contractTypeOptions[number])}
                                className="h-8 w-[150px] rounded-md border border-input bg-background px-2 text-xs font-bold capitalize outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                             >
                                {!contract.fields.contractType.value && <option value="" disabled>{t("ui.select.type")}</option>}
                                {contractTypeOptions.map((option) => <option key={option} value={option}>{formatContractType(option, language)}</option>)}
                             </select>
                              {originallyExtractedContractType && (
                                 <div className="mt-1 max-w-[150px] truncate text-[10px] font-semibold text-amber-700 dark:text-amber-300" title={`${t("ui.originally.extracted.as")}${originallyExtractedContractType}`}>
                                    {t("contract.editedExtracted")} {originallyExtractedContractType}
                               </div>
                             )}
                              {isContractTypeSaving && <div className="mt-1 text-[10px] font-bold text-primary">{t("ui.saving")}</div>}
                             {contractTypeErrorId === saved.id && contractTypeSaveError && !isContractTypeSaving && <div className="mt-1 max-w-[150px] text-[10px] font-bold text-destructive">{contractTypeSaveError}</div>}
                           </td>
                           <td className="bg-muted/[0.12] px-4 py-3 align-top">
                               <div className={`text-xs font-extrabold ${isBlocked ? "text-destructive" : "text-foreground"}`}>{isBlocked ? t("ui.not.computable") : formatRegistryDate(contract.computed.exitDate, language)}</div>
                               <div className="mt-1 text-[10px] font-semibold text-muted-foreground">{t("ui.computed.exit")}</div>
                           </td>
                           <td className="bg-muted/[0.12] px-4 py-3 align-top">
                               <div className="max-w-[150px] text-xs font-bold capitalize text-foreground">{formatRenewalMechanism(contract.fields.renewalMechanism.value, "ui.not.stated", language)}</div>
                              <div className="mt-1 text-[10px] font-semibold text-muted-foreground">{t("ui.extracted.rule")}</div>
                           </td>
                            <td className="border-r border-border bg-muted/[0.12] px-4 py-3 align-top">
                              <div className="max-w-[170px] text-xs font-bold text-foreground">{formatPeriod(contract.fields.noticePeriod.value, language)}</div>
                           </td>
                           <td className="bg-primary/[0.02] px-4 py-3 align-top">
                              <div className={`text-xs font-extrabold ${isBlocked ? "text-destructive" : "text-foreground"}`}>{isBlocked ? t("ui.not.computable") : formatRegistryDate(contract.computed.actionDate, language)}</div>
                              <div className="mt-1 text-[10px] font-semibold text-muted-foreground">{t("ui.negotiation.start")}</div>
                           </td>
                           <td className="bg-primary/[0.02] px-4 py-3 align-top">
                              <div className={`text-xs font-extrabold ${isBlocked ? "text-destructive" : "text-foreground"}`}>{isBlocked ? t("ui.not.computable") : formatRegistryDate(contract.computed.noticeDeadline, language)}</div>
                              <div className="mt-1 text-[10px] font-semibold text-muted-foreground">{t("ui.legal.deadline")}</div>
                           </td>
                           <td className="bg-primary/[0.02] px-4 py-3 align-top">
                              <div className={`whitespace-nowrap text-xs font-extrabold ${isBlocked ? "text-destructive" : "text-foreground"}`}>{isBlocked ? "—" : formatDaysRemaining(contract.computed.daysRemaining, language)}</div>
                              <div className="mt-1 text-[10px] font-semibold text-muted-foreground">{isBlocked ? t("ui.not.computable") : t("ui.until.action")}</div>
                           </td>
                           <td className="bg-primary/[0.02] px-4 py-3 align-top">
                                <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider ${statusClasses(status)}`}>{translateDomainOption(language, status === "red" ? "overdue" : status)}</span>
                           </td>
                            <td className="max-w-[320px] border-r border-border bg-primary/[0.02] px-4 py-3 align-top">
                               <div className={`max-w-[310px] whitespace-normal text-xs font-semibold leading-relaxed ${status === "green" ? "text-muted-foreground" : "text-destructive"}`} title={statusReason}>{statusReason}</div>
                           </td>
                            <td className="border-r border-border bg-muted/[0.12] px-4 py-3 align-top">
                               <div className={`max-w-[150px] text-xs font-extrabold ${valueIsUnknown ? "text-destructive" : "text-foreground"}`}>{formatContractValue(value, language)}</div>
                               {valueIsUnknown && <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-destructive">{t("ui.needs.review")}</div>}
                            </td>
                           <td className="bg-amber-500/[0.025] px-4 py-3 align-top">
                              <div className={`text-xs font-bold ${contract.assignment.owner ? "text-foreground" : "text-destructive"}`}>{contract.assignment.owner || t("ui.unassigned")}</div>
                              <div className="mt-1 text-[10px] font-semibold text-muted-foreground">{t("ui.assigned.owner")}</div>
                           </td>
                           <td className="bg-amber-500/[0.025] px-4 py-3 align-top">
                               <div className="whitespace-nowrap text-xs font-extrabold text-foreground">{t("common.days", { count: contract.assignment.negotiationBufferDays })}</div>
                               <div className="mt-1 text-[10px] font-semibold capitalize text-muted-foreground">{formatNegotiationBufferSource(contract.assignment.negotiationBufferSource, language)}</div>
                           </td>
                         </tr>
                       );
                     })}
                  </tbody>
                </table>
                 {!contractsQuery.isLoading && filteredContracts.length === 0 && (
                    <div data-testid="contract-registry-empty" className="p-10 text-center text-sm font-medium text-muted-foreground">
                     {contracts.length === 0
                         ? t("ui.no.confirmed.contracts.yet.upload.a.pdf.to.get.started")
                        : t("ui.no.contracts.match.the.current.filters")}
                   </div>
                )}
              </div>
            </div>
          </div>}
          
        </div>
      </main>
    </div>
  );
}
