import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  useCreateContract,
  useCompleteIngestItem,
  useGetContract,
  useUpdateContract,
  type ContractReviewRecord,
} from "@workspace/api-client-react";
import { createEmptyContractReviewRecord } from "@/lib/contracts";
import {
  extractionQueueStorageKey,
  extractionStorageKey,
  getField,
  hasValue,
  isIssue,
  issuePriority,
  issueDefinitions,
  isValidOwnerEmail,
  readExtractionQueue,
  readStoredExtraction,
  reviewerEditNote,
  type FieldKey,
} from "@/lib/review";

const pendingHandoffStorageKey = "contract-dashboard.pending-ingest-handoff";

const requiredKeys: FieldKey[] = [
  "vendorLegalName",
  "contractType",
  "contractNumber",
  "effectiveDate",
  "initialTermLength",
  "initialTermEndDate",
  "noticePeriod",
];

export function useContractReview() {
  const [, navigate] = useLocation();
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
    storedExtraction ? storedExtraction.extraction.contract : createEmptyContractReviewRecord(),
  );
  const [filename, setFilename] = useState(storedExtraction?.filename ?? "confirmed-contract.pdf");
  const [resolvedKeys, setResolvedKeys] = useState<Set<FieldKey>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (savedContractQuery.data) {
      setFilename(savedContractQuery.data.filename);
      setDraft(savedContractQuery.data.contract);
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
          originalValue: Object.prototype.hasOwnProperty.call(previous.fields[key], "originalValue")
            ? (previous.fields[key] as { originalValue?: unknown }).originalValue
            : previous.fields[key].value ?? null,
          value: populated ? value : null,
          status: populated ? "ambiguous" : "not_found",
          confidence: "low",
          page: null,
          clause: null,
          quote: null,
          note: populated ? reviewerEditNote : null,
          alternatives: [],
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
        [key]: { ...previous.fields[key], reviewed: true },
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

  const updateNegotiationBuffer = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    const negotiationBufferDays = Number.isFinite(parsed)
      ? Math.max(0, Math.min(365, parsed))
      : 0;
    setDraft((previous) => ({
      ...previous,
      assignment: {
        ...previous.assignment,
        negotiationBufferDays,
        negotiationBufferSource: "contract_override",
      },
    }));
  };

  const openIssues = useMemo(
    () => issueDefinitions
      .filter((issue) => !resolvedKeys.has(issue.key) && isIssue(getField(draft, issue.key)))
      .sort((left, right) => issuePriority(getField(draft, left.key)) - issuePriority(getField(draft, right.key))),
    [draft, resolvedKeys],
  );
  const missingRequired = requiredKeys.filter((key) => !hasValue(getField(draft, key).value));
  const ownerMissing = !draft.assignment.owner.trim();
  const ownerEmailInvalid = !isValidOwnerEmail(draft.assignment.ownerEmail);
  const assignmentInvalid = ownerMissing || ownerEmailInvalid;
  const totalOpenIssues = openIssues.length + (assignmentInvalid ? 1 : 0);
  const isComplete = missingRequired.length === 0 && !assignmentInvalid;
  const progress = Math.round(((issueDefinitions.length + 1 - totalOpenIssues) / (issueDefinitions.length + 1)) * 100);
  const createContract = useCreateContract();
  const completeIngestItem = useCompleteIngestItem();
  const updateContract = useUpdateContract();
  const isSaving = createContract.isPending || updateContract.isPending || completeIngestItem.isPending;

  const handleConfirm = async () => {
    if (!isComplete) return;
    setSaveError(null);
    try {
      if (savedId) {
        await updateContract.mutateAsync({ id: savedId, data: { filename, contract: draft } });
      } else {
        let pendingHandoff: { runId?: string; itemId?: string } | null = null;
        try {
          pendingHandoff = JSON.parse(sessionStorage.getItem(pendingHandoffStorageKey) ?? "null");
        } catch {
          sessionStorage.removeItem(pendingHandoffStorageKey);
        }
        const matchesCurrentExtraction = Boolean(
          pendingHandoff?.runId &&
          pendingHandoff.itemId &&
          storedExtraction?.ingestRunId &&
          storedExtraction.ingestItemId &&
          pendingHandoff.runId === storedExtraction.ingestRunId &&
          pendingHandoff.itemId === storedExtraction.ingestItemId,
        );
        if (!matchesCurrentExtraction) {
          sessionStorage.removeItem(pendingHandoffStorageKey);
          await createContract.mutateAsync({ data: { filename, contract: draft } });
          if (storedExtraction?.ingestRunId && storedExtraction.ingestItemId) {
            sessionStorage.setItem(pendingHandoffStorageKey, JSON.stringify({
              runId: storedExtraction.ingestRunId,
              itemId: storedExtraction.ingestItemId,
            }));
          }
        }
      }
      if (storedExtraction?.ingestRunId && storedExtraction.ingestItemId) {
        await completeIngestItem.mutateAsync({
          runId: storedExtraction.ingestRunId,
          itemId: storedExtraction.ingestItemId,
        });
        sessionStorage.removeItem(pendingHandoffStorageKey);
      }
      await queryClient.invalidateQueries({
        queryKey: ["/api/contracts"],
        refetchType: "all",
      });
      const queue = readExtractionQueue();
      const next = queue.shift();
      if (next) {
        sessionStorage.setItem(extractionStorageKey, JSON.stringify(next));
        sessionStorage.setItem(extractionQueueStorageKey, JSON.stringify(queue));
        navigate("/review?batch=next");
        window.setTimeout(() => window.location.reload(), 0);
      } else {
        sessionStorage.removeItem(extractionStorageKey);
        sessionStorage.removeItem(extractionQueueStorageKey);
        navigate("/dashboard");
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "We could not save this contract. Please try again.");
    }
  };

  return {
    savedContractQuery,
    storedExtraction,
    draft,
    filename,
    saveError,
    openIssues,
    missingRequired,
    ownerMissing,
    ownerEmailInvalid,
    assignmentInvalid,
    totalOpenIssues,
    isComplete,
    progress,
    isSaving,
    updateField,
    resolveField,
    updateAssignment,
    updateNegotiationBuffer,
    handleConfirm,
  };
}