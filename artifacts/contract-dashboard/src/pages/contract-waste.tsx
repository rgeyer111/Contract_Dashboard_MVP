import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, FileText, LoaderCircle, ShieldAlert, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListContractWasteQueryKey,
  useEmptyContractWaste,
  useListContractWaste,
  usePurgeContractWasteItem,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LanguageSwitch, useLanguage } from "@/lib/i18n";

type PurgeTarget = "selected" | "all" | null;

export default function ContractWaste() {
  const { language, t } = useLanguage();
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [purgeTarget, setPurgeTarget] = useState<PurgeTarget>(null);
  const [purgeError, setPurgeError] = useState(false);
  const wasteQuery = useListContractWaste();
  const refresh = async () => {
    setSelectedIds(new Set());
    setPurgeTarget(null);
    setPurgeError(false);
    await queryClient.invalidateQueries({ queryKey: getListContractWasteQueryKey(), refetchType: "all" });
  };
  const emptyWaste = useEmptyContractWaste({
    mutation: {
      onSuccess: refresh,
      onError: () => setPurgeError(true),
    },
  });
  const purgeItem = usePurgeContractWasteItem();
  const waste = wasteQuery.data ?? [];
  const isForbidden = wasteQuery.error && "status" in wasteQuery.error && wasteQuery.error.status === 403;
  const isPurging = emptyWaste.isPending || purgeItem.isPending;

  const purgeSelected = async () => {
    setPurgeError(false);
    try {
      for (const id of selectedIds) await purgeItem.mutateAsync({ id });
      await refresh();
    } catch {
      setPurgeError(true);
    }
  };

  return (
    <main className="min-h-[100dvh] bg-muted/20">
      <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b bg-card px-5 shadow-sm sm:px-8">
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          {t("ui.back.to.registry")}
        </Link>
        <LanguageSwitch />
      </header>

      <div className="mx-auto max-w-6xl space-y-6 p-5 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold text-destructive">
              <Trash2 className="h-4 w-4" />
              {t("ui.administration")}
            </div>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight">{t("ui.contract.waste")}</h1>
            <p className="mt-2 max-w-2xl text-sm font-medium text-muted-foreground">{t("ui.contract.waste.description")}</p>
          </div>
          {!isForbidden && waste.length > 0 && (
            <Button
              type="button"
              variant="destructive"
              className="gap-2"
              onClick={() => {
                setPurgeError(false);
                setPurgeTarget("all");
              }}
            >
              <Trash2 className="h-4 w-4" />
              {t("ui.empty.all.waste")}
            </Button>
          )}
        </div>

        {isForbidden ? (
          <section data-testid="contract-waste-forbidden" className="rounded-xl border border-destructive/20 bg-card p-8 text-center shadow-sm">
            <ShieldAlert className="mx-auto h-10 w-10 text-destructive" />
            <h2 className="mt-3 text-lg font-extrabold">{t("ui.administrator.access.required")}</h2>
            <p className="mt-1 text-sm font-medium text-muted-foreground">{t("ui.contract.waste.forbidden")}</p>
          </section>
        ) : wasteQuery.isLoading ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border bg-card p-10 text-sm font-bold text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            {t("ui.loading.deleted.files")}
          </div>
        ) : wasteQuery.isError ? (
          <div className="rounded-xl border border-destructive/20 bg-card p-6 text-sm font-bold text-destructive">
            {t("ui.deleted.files.could.not.be.loaded")}
          </div>
        ) : waste.length === 0 ? (
          <div data-testid="contract-waste-empty" className="rounded-xl border bg-card p-10 text-center shadow-sm">
            <Trash2 className="mx-auto h-9 w-9 text-muted-foreground" />
            <h2 className="mt-3 font-extrabold">{t("ui.contract.waste.empty")}</h2>
            <p className="mt-1 text-sm font-medium text-muted-foreground">{t("ui.contract.waste.empty.description")}</p>
          </div>
        ) : (
          <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
              <span className="text-xs font-bold text-muted-foreground">{t("waste.fileCount", { count: waste.length })}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={selectedIds.size === 0}
                onClick={() => {
                  setPurgeError(false);
                  setPurgeTarget("selected");
                }}
                className="gap-2 text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("waste.emptySelected", { count: selectedIds.size })}
              </Button>
            </div>
            <div className="divide-y">
              {waste.map((item) => {
                const identity = item.contractTitle || item.vendorLegalName || item.filename;
                return (
                  <article key={item.id} data-testid={`contract-waste-item-${item.id}`} className="flex items-start gap-3 p-4 sm:items-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={(event) => {
                        setSelectedIds((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(item.id);
                          else next.delete(item.id);
                          return next;
                        });
                      }}
                      aria-label={t("waste.selectFile", { name: identity })}
                      className="mt-1 h-4 w-4 accent-primary sm:mt-0"
                    />
                    <FileText className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground sm:mt-0" />
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-sm font-extrabold">{identity}</h2>
                      <p className="mt-0.5 truncate text-xs font-semibold text-muted-foreground">
                        {[item.vendorLegalName, item.contractNumber, item.filename].filter(Boolean).join(" · ")}
                      </p>
                      <p className="mt-1 text-[11px] font-medium text-muted-foreground">
                        {t("waste.deletedOn", {
                          date: new Intl.DateTimeFormat(language === "de-CH" ? "de-CH" : "en-US", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(new Date(item.deletedAt)),
                        })}
                      </p>
                    </div>
                    <a
                      href={`/api/admin/contract-waste/${item.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-9 items-center rounded-md border px-3 text-xs font-bold hover:bg-muted"
                    >
                      {t("ui.inspect.pdf")}
                    </a>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </div>

      <AlertDialog
        open={purgeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !isPurging) {
            setPurgeTarget(null);
            setPurgeError(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{purgeTarget === "all" ? t("ui.empty.all.waste.question") : t("ui.empty.selected.waste.question")}</AlertDialogTitle>
            <AlertDialogDescription>
              {purgeTarget === "all"
                ? t("waste.emptyAllWarning", { count: waste.length })
                : t("waste.emptySelectedWarning", { count: selectedIds.size })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {purgeError && <p className="text-sm font-semibold text-destructive">{t("ui.waste.could.not.be.emptied")}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPurging}>{t("ui.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPurging}
              onClick={(event) => {
                event.preventDefault();
                if (purgeTarget === "all") emptyWaste.mutate();
                else void purgeSelected();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isPurging ? t("ui.deleting") : t("ui.delete.permanently")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}