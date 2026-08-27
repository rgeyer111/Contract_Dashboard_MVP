import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
  useAbandonIngestRun,
  useExtractContract,
  useGetCurrentIngestRun,
  useRegisterIngestRun,
  useRetryIngestItem,
  type ContractExtractionResult,
} from "@workspace/api-client-react";

export type UploadRunEntry = {
  id: string;
  name: string;
  state: "processing" | "ready" | "duplicate" | "failed";
  message?: string;
};

function fileId(runId: string, index: number) {
  return `${runId}:${index}`;
}

export function useContractUpload(navigate: (path: string) => void) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [runLog, setRunLog] = useState<UploadRunEntry[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const successfulExtractions = useRef(new Map<string, ContractExtractionResult>());
  const activeRunId = useRef<string | null>(null);
  const extractionMutation = useExtractContract();
  const abandonMutation = useAbandonIngestRun();
  const registerRun = useRegisterIngestRun();
  const retryMutation = useRetryIngestItem();
  const currentRun = useGetCurrentIngestRun();
  const isPending = extractionMutation.isPending || registerRun.isPending || retryMutation.isPending;

  useEffect(() => {
    const run = currentRun.data;
    const items = run?.items;
    if (!run || !items?.length || selectedFiles.length > 0) return;
    activeRunId.current = run.id;
    const entries = items.map((item) => ({
      id: item.id,
      name: item.filename,
      state: item.state,
      message: item.message ?? undefined,
    }));
    successfulExtractions.current.clear();
    items.forEach((item) => {
      if (item.extraction) successfulExtractions.current.set(item.id, item.extraction);
    });
    setRunLog(entries);
  }, [currentRun.data, selectedFiles.length]);

  const handOffReadyExtractions = (entries: UploadRunEntry[]) => {
    if (entries.some((entry) => entry.state === "failed" || entry.state === "processing")) return;
    const results = entries
      .map((entry) => successfulExtractions.current.get(entry.id))
      .filter((result): result is ContractExtractionResult => Boolean(result));
    if (!results.length) return;
    sessionStorage.setItem("contract-dashboard.extraction", JSON.stringify(results[0]));
    sessionStorage.setItem("contract-dashboard.extraction-queue", JSON.stringify(results.slice(1)));
    navigate("/review");
  };

  const chooseFiles = (files: File[]) => {
    const previousRunId = activeRunId.current;
    if (previousRunId && runLog.length > 0) {
      void abandonMutation.mutateAsync({ runId: previousRunId })
        .catch(() => undefined)
        .finally(() => {
          void currentRun.refetch();
        });
    }
    const validFiles = files.filter((file) => {
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      return isPdf && file.size <= 10 * 1024 * 1024;
    });
    activeRunId.current = crypto.randomUUID();
    setUploadError(validFiles.length !== files.length ? "Only PDF files up to 10 MB can be added." : null);
    setSelectedFiles(validFiles.slice(0, 20));
    setRunLog([]);
    successfulExtractions.current.clear();
  };

  const processFiles = async (retryId?: string) => {
    const runId = activeRunId.current;
    if (!runId) return;
    const filesToProcess = selectedFiles
      .map((file, index) => ({ file, id: fileId(runId, index) }))
      .filter(({ id }) => retryId ? id === retryId : runLog.length === 0);
    if (!filesToProcess.length && retryId) {
      let nextRunLog = runLog.map((entry) => entry.id === retryId
        ? { ...entry, state: "processing" as const, message: undefined }
        : entry);
      setRunLog(nextRunLog);
      setUploadError(null);
      try {
        const result = await retryMutation.mutateAsync({ runId, itemId: retryId });
        successfulExtractions.current.set(retryId, result);
        nextRunLog = nextRunLog.map((entry) => entry.id === retryId
          ? { ...entry, state: "ready", message: "Ready for review" }
          : entry);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not process this PDF.";
        const duplicate = /duplicate|already been uploaded/i.test(message);
        if (duplicate) successfulExtractions.current.delete(retryId);
        nextRunLog = nextRunLog.map((entry) => entry.id === retryId
          ? { ...entry, state: duplicate ? "duplicate" : "failed", message: duplicate ? "Duplicate skipped" : message }
          : entry);
      }
      setRunLog(nextRunLog);
      handOffReadyExtractions(nextRunLog);
      return;
    }
    if (!filesToProcess.length) return;

    setUploadError(null);
    let nextRunLog: UploadRunEntry[] = runLog.length > 0
      ? runLog.map((entry) => filesToProcess.some(({ id }) => id === entry.id)
        ? { ...entry, state: "processing" as const, message: undefined }
        : entry)
      : selectedFiles.map((file, index) => ({
        id: fileId(runId, index),
        name: file.name,
        state: "processing" as const,
      }));
    setRunLog(nextRunLog);

    if (!retryId) {
      try {
        await registerRun.mutateAsync({
          data: {
            files: selectedFiles,
            runId,
            itemIds: selectedFiles.map((_, index) => fileId(runId, index)),
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not save this ingest run.";
        setUploadError(message);
        setRunLog(nextRunLog.map((entry) => ({ ...entry, state: "failed", message })));
        return;
      }
    }

    for (const { file, id } of filesToProcess) {
      try {
        const result = await extractionMutation.mutateAsync({
          data: { files: [file], ingestRunId: runId, ingestItemId: id },
        });
        const hash = result.extraction.contract.source?.hash;
        const alreadyExtracted = [...successfulExtractions.current.values()]
          .some((entry) => entry.extraction.contract.source?.hash === hash);
        if (hash && alreadyExtracted) {
          successfulExtractions.current.delete(id);
          nextRunLog = nextRunLog.map((entry) => entry.id === id
            ? { ...entry, state: "duplicate", message: "Duplicate skipped" }
            : entry);
        } else {
          successfulExtractions.current.set(id, result);
          nextRunLog = nextRunLog.map((entry) => entry.id === id
            ? { ...entry, state: "ready", message: "Ready for review" }
            : entry);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not process this PDF.";
        const duplicate = /duplicate|already been uploaded/i.test(message);
        if (duplicate) successfulExtractions.current.delete(id);
        nextRunLog = nextRunLog.map((entry) => entry.id === id
          ? { ...entry, state: duplicate ? "duplicate" : "failed", message: duplicate ? "Duplicate skipped" : message }
          : entry);
      }
      setRunLog(nextRunLog);
    }

    handOffReadyExtractions(nextRunLog);
  };

  const chooseFilesFromDrop = (files: FileList | File[]) => {
    chooseFiles(Array.from(files));
  };

  const removeFile = (index: number) => {
    setSelectedFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
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

  const resetUpload = () => {
    const runId = activeRunId.current;
    if (runId && runLog.length > 0) {
      void abandonMutation.mutateAsync({ runId })
        .catch(() => undefined)
        .finally(() => {
          void currentRun.refetch();
        });
    }
    setSelectedFiles([]);
    setRunLog([]);
    setUploadError(null);
    setIsDragging(false);
    activeRunId.current = null;
    successfulExtractions.current.clear();
  };

  return {
    selectedFiles,
    runLog,
    isDragging,
    uploadError,
    extraction: { isPending },
    hasResumableRun: selectedFiles.length === 0 && runLog.length > 0,
    setIsDragging,
    chooseFilesFromDrop,
    removeFile,
    handleDrop,
    handleInput,
    processFiles,
    retryFile: (id: string) => processFiles(id),
    resetUpload,
  };
}