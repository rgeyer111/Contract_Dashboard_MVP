import { useState, useMemo, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  FileText,
  Save,
  Bell,
  Search,
  ExternalLink,
  Pencil,
  AlertTriangle,
  History,
  CheckCircle2,
  XCircle,
  Clock
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useGetContract,
  getGetContractQueryKey,
  useListContractDecisions,
  getListContractDecisionsQueryKey,
  useRecordContractDecision,
  type ContractDecisionType
} from "@workspace/api-client-react";
import { useLanguage, translateDomainOption, translate, translateComputedReasonOrDetail } from "@/lib/i18n";
import {
  formatContractValue,
  formatDaysRemaining,
  formatRegistryDate,
  formatSwissDateTime,
  formatSwissNumber,
  getSwissDateOnly,
} from "@/lib/registry";
import { detailGroups, getBlockedReasonTargets, getField, displayValue, displayEvidenceValue, statusLabel, hasValue, reviewerEditNote } from "@/lib/review";
import { LanguageSwitch } from "@/lib/i18n";

export default function ContractDecisionPage() {
  const params = useParams();
  const id = params?.id ?? "";
  const { language, t } = useLanguage();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: savedContract, isLoading, isError } = useGetContract(id, {
    query: {
      enabled: !!id,
      queryKey: getGetContractQueryKey(id),
    }
  });

  const { data: decisions, isLoading: isLoadingDecisions } = useListContractDecisions(id, {
    query: {
      enabled: !!id,
      queryKey: getListContractDecisionsQueryKey(id),
    }
  });

  const recordDecision = useRecordContractDecision({
    mutation: {
      onSuccess: () => {
        setSaveError(null);
        queryClient.invalidateQueries({ queryKey: getListContractDecisionsQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getGetContractQueryKey(id) });
        setLocalDecision(null);
        setLocalSnoozeDate("");
      },
      onError: () => {
        setSaveError(t("decision.saveError"));
      }
    }
  });

  const latestDecision = decisions?.[0];

  const contract = savedContract?.contract;
  const draft = contract;

  const [localDecision, setLocalDecision] = useState<ContractDecisionType | null>(null);
  const [localActor, setLocalActor] = useState("");
  const [localSnoozeDate, setLocalSnoozeDate] = useState("");
  const [referenceExpanded, setReferenceExpanded] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const todayStr = useMemo(() => getSwissDateOnly(), []);

  // Set default actor
  useEffect(() => {
    if (contract && !localActor) {
      setLocalActor(contract.assignment.owner);
    }
  }, [contract, localActor]);

  if (isLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-muted/20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (isError || !savedContract || !draft) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-muted/20">
        <h1 className="text-2xl font-extrabold">{t("notFound.title")}</h1>
        <Button onClick={() => setLocation("/dashboard")} variant="outline" className="mt-4">
          {t("ui.back.to.registry")}
        </Button>
      </div>
    );
  }

  const vendor = getField(draft, "vendorLegalName").value || t("ui.untitled.contract");
  const contractValue = getField(draft, "contractValue").value;
  const billingFrequency = getField(draft, "billingFrequency").value;
  const renewalMechanism = getField(draft, "renewalMechanism").value;
  const renewalTerm = getField(draft, "renewalTermLength").value;

  const { noticeDeadline, actionDate, daysRemaining, status, reasonCode } = draft.computed;
  const isBlocked = status === "blocked";
  const blockedTargets = getBlockedReasonTargets(draft);

  let consequence = "";
  if (renewalMechanism === "auto_renew") {
    const period = renewalTerm ? translate(language, "review.amountUnit", { amount: String(renewalTerm.amount), unit: translateDomainOption(language, renewalTerm.unit) }) : t("ui.unknown");
    const date = formatRegistryDate(noticeDeadline, language);
    if (hasValue(contractValue)) {
      consequence = t("decision.consequence.auto_renew", {
        date,
        period,
        value: `${contractValue.currency} ${formatSwissNumber(contractValue.amount)}`,
      });
    } else {
      consequence = t("decision.consequence.auto_renew.no_value", { date, period });
    }
  } else if (renewalMechanism === "expires") {
    consequence = t("decision.consequence.expires", { date: formatRegistryDate(draft.computed.exitDate, language) });
  } else if (renewalMechanism === "indefinite") {
    consequence = t("decision.consequence.indefinite");
  } else if (renewalMechanism === "by_mutual_agreement") {
    consequence = t("decision.consequence.mutual", { date: formatRegistryDate(draft.computed.exitDate, language) });
  } else {
    consequence = t("decision.consequence.unknown", { date: formatRegistryDate(actionDate, language) });
  }

  // Derive colors from status
  let statusColor = "bg-emerald-500/10 text-emerald-700 border-emerald-500/20";
  let statusBg = "bg-emerald-500";
  if (status === "amber") {
    statusColor = "bg-amber-500/10 text-amber-700 border-amber-500/20";
    statusBg = "bg-amber-500";
  } else if (status === "red") {
    statusColor = "bg-destructive/10 text-destructive border-destructive/20";
    statusBg = "bg-destructive";
  } else if (status === "expired" || status === "blocked") {
    statusColor = "bg-orange-500/10 text-orange-700 border-orange-500/20";
    statusBg = "bg-orange-500";
  }

  const handleSave = () => {
    setSaveError(null);
    if (!localDecision || !localActor.trim()) return;
    
    if (localDecision === "snooze") {
      if (!localSnoozeDate) return;
      if (localSnoozeDate < todayStr) {
        setSaveError(t("decision.invalidSnooze"));
        return;
      }
    }

    recordDecision.mutate({
      id,
      data: {
        decision: localDecision,
        actor: localActor.trim(),
        snoozeUntil: localDecision === "snooze" ? localSnoozeDate : null
      }
    });
  };

  const getDecisionIcon = (type: string) => {
    switch (type) {
      case "renew": return <CheckCircle2 className="h-5 w-5" />;
      case "renegotiate": return <History className="h-5 w-5" />;
      case "cancel": return <XCircle className="h-5 w-5" />;
      case "snooze": return <Clock className="h-5 w-5" />;
      default: return null;
    }
  };

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between border-b bg-card px-4 shadow-sm sm:px-6">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setLocation("/dashboard")} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shadow-inner">
            <FileText className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-bold tracking-tight text-lg">{t("decision.title")}</span>
        </div>
        <div className="flex items-center gap-3">
          <LanguageSwitch />
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-xs font-bold text-primary">
            {draft.assignment.owner ? draft.assignment.owner.substring(0, 2).toUpperCase() : "US"}
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Top Tier: Decision Board (Must fit in 1440x900) */}
        <div className="flex shrink-0 flex-col border-b border-border bg-card p-6 lg:p-8" data-testid="decision-primary-tier">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 lg:flex-row">
            {/* Left Col: Contract Context */}
            <div className="flex-1 space-y-6">
              <div>
                <h1 className="text-3xl font-extrabold tracking-tight text-foreground">{vendor}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${statusColor}`}>
                    {status === "blocked" ? t("ui.blocked") : status === "expired" ? t("ui.expired") : t("ui.active")}
                  </span>
                  <span className="text-sm font-semibold text-muted-foreground">{getField(draft, "contractTitle").value || savedContract.filename}</span>
                </div>
              </div>

              {isBlocked ? (
                <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-5" data-testid="blocked-guidance">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" />
                    <div>
                      <h3 className="font-bold text-orange-800">{t("decision.blocked")}</h3>
                      <p className="mt-1 text-sm font-medium text-orange-700/90">{translateComputedReasonOrDetail(language, draft.computed.reasonCode, draft.computed.reason) || t("ui.blocked.not.enough.contract.data.to.compute.dates")}</p>
                      
                      {blockedTargets.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {blockedTargets.map(target => (
                            <span key={target.key} className="inline-flex rounded border border-orange-500/20 bg-background px-2 py-1 text-[11px] font-bold text-orange-700">
                              {t(target.label as Parameters<typeof t>[0])}
                            </span>
                          ))}
                        </div>
                      )}
                      
                      <Button onClick={() => setLocation(`/contracts/${id}/edit`)} variant="outline" className="mt-4 gap-2 border-orange-500/30 text-orange-800 hover:bg-orange-500/10" size="sm">
                        <Pencil className="h-4 w-4" />
                        {t("decision.blocked.edit")}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-muted/20 p-5 sm:grid-cols-4">
                  <div>
                    <div className="text-[11px] font-extrabold uppercase tracking-wide text-muted-foreground">{t("ui.contract.value")}</div>
                    <div className="mt-1 text-base font-extrabold">{hasValue(contractValue) ? formatContractValue(contractValue, language) : t("ui.not.stated")}</div>
                    {hasValue(contractValue) && billingFrequency && (
                      <div className="text-[11px] font-medium text-muted-foreground">
                        {translateDomainOption(language, billingFrequency)} {t("ui.billing")}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-[11px] font-extrabold uppercase tracking-wide text-muted-foreground">{t("ui.notice.deadline")}</div>
                    <div className="mt-1 text-base font-extrabold">{formatRegistryDate(noticeDeadline, language)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-extrabold uppercase tracking-wide text-muted-foreground">{t("ui.action.date")}</div>
                    <div className="mt-1 text-base font-extrabold">{formatRegistryDate(actionDate, language)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-extrabold uppercase tracking-wide text-muted-foreground">{t("ui.days.remaining")}</div>
                    <div className="mt-1 text-base font-extrabold text-foreground">{formatDaysRemaining(daysRemaining, language)}</div>
                  </div>
                </div>
              )}

              {!isBlocked && consequence && (
                <p className="text-lg font-bold text-foreground">
                  {consequence}
                </p>
              )}
            </div>

            {/* Right Col: Interactive Decision Panel */}
            <div className="w-full max-w-sm shrink-0">
              <div className="relative flex flex-col justify-between overflow-hidden rounded-xl border-2 border-primary/20 bg-card p-6 shadow-sm">
                <div className={`absolute left-0 top-0 h-1 w-full ${statusBg}`} />
                
                <div>
                  <h2 className="text-lg font-extrabold tracking-tight">{t("decision.title")}</h2>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    {(["renew", "renegotiate", "cancel", "snooze"] as ContractDecisionType[]).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        data-testid={`action-${opt}`}
                        onClick={() => {
                          setLocalDecision(opt);
                          if (opt !== "snooze") setLocalSnoozeDate("");
                        }}
                        className={`group relative flex flex-col items-center gap-2 rounded-lg border p-3 text-center transition-all ${localDecision === opt ? "border-primary bg-primary/5 text-primary ring-1 ring-primary" : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:bg-muted/50"}`}
                      >
                        {getDecisionIcon(opt)}
                        <span className="text-xs font-bold">{t(`decision.${opt}` as Parameters<typeof t>[0])}</span>
                      </button>
                    ))}
                  </div>

                  {localDecision === "snooze" && (
                    <div className="mt-4 animate-in fade-in slide-in-from-top-2">
                      <label className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">{t("decision.snoozeDate")}</label>
                      <input 
                        type="date" 
                        data-testid="input-snooze-date"
                        min={todayStr}
                        value={localSnoozeDate}
                        onChange={(e) => setLocalSnoozeDate(e.target.value)}
                        className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-semibold outline-none focus:border-primary focus:ring-1 focus:ring-primary" 
                      />
                    </div>
                  )}

                  <div className="mt-4">
                    <label className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">{t("decision.actor")}</label>
                    <input 
                      type="text" 
                      data-testid="input-actor"
                      value={localActor}
                      onChange={(e) => setLocalActor(e.target.value)}
                      placeholder={t("decision.actorPlaceholder")}
                      className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-semibold outline-none focus:border-primary focus:ring-1 focus:ring-primary" 
                    />
                  </div>
                </div>

                <div>
                  {saveError && (
                    <div className="mb-3 text-[11px] font-bold text-destructive">
                      {saveError}
                    </div>
                  )}
                  <Button 
                    onClick={handleSave} 
                    disabled={!localDecision || !localActor.trim() || (localDecision === "snooze" && !localSnoozeDate) || recordDecision.isPending}
                    className="w-full font-bold shadow-sm"
                    data-testid="button-save-decision"
                  >
                    {recordDecision.isPending ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" /> : <Save className="mr-2 h-4 w-4" />}
                    {t("decision.save")}
                  </Button>
                </div>
              </div>

              {/* Latest Decision History */}
              <div className="mt-4 rounded-xl border border-border bg-muted/20 p-4" data-testid="latest-decision">
                {latestDecision ? (
                  <div>
                    <div className="text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">{t("decision.latest")}</div>
                    <div className="mt-1.5 flex items-center gap-2 text-sm font-bold">
                      <span className="text-primary">{t(`decision.${latestDecision.decision}` as Parameters<typeof t>[0])}</span>
                      <span className="text-muted-foreground">{t("decision.by")} {latestDecision.actor}</span>
                    </div>
                    <div className="mt-1 text-[11px] font-medium text-muted-foreground">
                      {t("decision.savedAt", { time: formatSwissDateTime(latestDecision.decidedAt) })}
                      {latestDecision.snoozeUntil && ` · ${t("decision.snoozeDate")}: ${formatRegistryDate(latestDecision.snoozeUntil, language)}`}
                    </div>
                  </div>
                ) : (
                  <div className="text-sm font-medium text-muted-foreground">{t("decision.noDecision")}</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Tier: Reference Details */}
        <div className="flex-1 overflow-auto bg-muted/10 p-6 lg:p-8">
          <div className="mx-auto w-full max-w-7xl">
            <button
              type="button"
              data-testid="toggle-reference"
              onClick={() => setReferenceExpanded(!referenceExpanded)}
              className="flex w-full items-center justify-between rounded-xl border border-border bg-card p-4 text-left shadow-sm hover:border-primary/30 hover:bg-muted/30 transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                  <Search className="h-4 w-4" />
                </div>
                <span className="font-extrabold text-foreground">{t("decision.reference")}</span>
              </div>
              {referenceExpanded ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
            </button>

            {referenceExpanded && (
              <div className="mt-4 animate-in fade-in slide-in-from-top-2 grid gap-6 lg:grid-cols-[1fr_300px]">
                <div className="space-y-6">
                  {detailGroups.map((group) => (
                    <section key={group.title} className="rounded-xl border border-border bg-card shadow-sm">
                      <h3 className="border-b border-border bg-muted/20 px-5 py-3 text-xs font-extrabold uppercase tracking-wide text-foreground">
                        {t(group.title as Parameters<typeof t>[0])}
                      </h3>
                      <div className="divide-y divide-border">
                        {group.fields.map((fieldDef) => {
                          const field = getField(draft, fieldDef.key);
                          const valueDisplay = displayValue(field.value, language);
                          
                          return (
                            <div key={fieldDef.key} className="p-5 hover:bg-muted/10">
                              <div className="mb-2 flex items-start justify-between gap-4">
                                <div>
                                  <div className="font-extrabold text-sm">{t(fieldDef.label as Parameters<typeof t>[0])}</div>
                                  <div className={`mt-0.5 text-sm ${hasValue(field.value) ? "font-medium text-foreground" : "font-medium italic text-muted-foreground"}`}>
                                    {valueDisplay}
                                  </div>
                                </div>
                                <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${field.status === "found" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700" : field.status === "ambiguous" || field.status === "conflicting" ? "border-amber-500/20 bg-amber-500/10 text-amber-700" : "border-destructive/20 bg-destructive/10 text-destructive"}`}>
                                  {statusLabel(field.status, language)}
                                </span>
                              </div>
                              
                              {(field.page || field.quote || field.note || field.alternatives?.length) ? (
                                <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3 text-xs">
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    <div>
                                      <span className="font-extrabold uppercase tracking-wide text-muted-foreground">{t("ui.confidence")}</span>
                                      <div className="mt-0.5 font-semibold capitalize">{translateDomainOption(language, field.confidence)}</div>
                                    </div>
                                    <div>
                                      <span className="font-extrabold uppercase tracking-wide text-muted-foreground">{t("ui.source")}</span>
                                      <div className="mt-0.5 font-semibold">
                                        {field.page ? `${t("ui.page.2")} ${field.page}${field.clause ? ` · ${t("ui.clause")} ${field.clause}` : ""}` : t("ui.no.source.page")}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="mt-3">
                                    <span className="font-extrabold uppercase tracking-wide text-muted-foreground">{t("ui.verbatim.quote")}</span>
                                    <div className={`mt-0.5 font-medium ${field.quote ? "italic" : "text-muted-foreground"}`}>
                                      {field.quote ? `“${field.quote}”` : t("ui.no.quote.in.the.source.document")}
                                    </div>
                                  </div>
                                  {field.note && field.note !== reviewerEditNote && (
                                    <div className="mt-3">
                                      <span className="font-extrabold uppercase tracking-wide text-muted-foreground">{t("ui.extraction.note")}</span>
                                      <div className="mt-0.5 whitespace-pre-wrap font-medium">{field.note}</div>
                                    </div>
                                  )}
                                  {field.alternatives && field.alternatives.length > 0 && (
                                    <div className="mt-3">
                                      <span className="font-extrabold uppercase tracking-wide text-muted-foreground">{t("ui.competing.readings")}</span>
                                      <div className="mt-1 space-y-1.5">
                                        {field.alternatives.map((alt, i) => (
                                          <div key={i} className="rounded border bg-background px-2.5 py-2">
                                            <div className="font-extrabold">{t("ui.reading")} {i + 1}: {displayEvidenceValue(alt.value, language)}</div>
                                            <div className="mt-0.5 font-medium text-muted-foreground">
                                              {t("ui.page.2")} {alt.page}{alt.clause ? ` · ${t("ui.clause")} ${alt.clause}` : ""} · “{alt.quote}”
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
                
                <div className="space-y-4">
                  <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                    <h3 className="font-extrabold tracking-tight">{t("ui.source.document")}</h3>
                    <p className="mt-1 text-sm font-medium text-muted-foreground">{savedContract.filename}</p>
                    {savedContract.sourceAvailable ? (
                      <Button
                        type="button"
                        data-testid="link-source-pdf"
                        onClick={() => window.open(`/api/contracts/${id}/source`, '_blank')}
                        className="mt-4 w-full gap-2 font-bold"
                        variant="secondary"
                      >
                        <ExternalLink className="h-4 w-4" /> {t("decision.viewSourcePdf")}
                      </Button>
                    ) : (
                      <div className="mt-4 rounded-md bg-muted/50 p-3 text-center text-xs font-medium text-muted-foreground">
                        {t("decision.sourcePdfUnavailable")}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
