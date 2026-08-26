import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
  useExtractContract,
  type ContractExtractionResult,
} from "@workspace/api-client-react";

export type UploadRunEntry = {
  id: string;
  name: string;
  state: "processing" | "ready" | "duplicate" | "failed";
  message?: string;
};

function fileId(file: File, index: number) {
  return `${index}:${file.name}:${file.size}:${file.lastModified}`;
}

export function useContractUpload(navigate: (path: string) => void) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [runLog, setRunLog] = useState<UploadRunEntry[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const successfulExtractions = useRef(new Map<string, ContractExtractionResult>());
  const extraction = useExtractContract();

  const chooseFiles = (files: File[]) => {
    const validFiles = files.filter((file) => {
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      return isPdf && file.size <= 10 * 1024 * 1024;
    });
    setUploadError(validFiles.length !== files.length ? "Only PDF files up to 10 MB can be added." : null);
    setSelectedFiles(validFiles.slice(0, 20));
    setRunLog([]);
    successfulExtractions.current.clear();
  };

  const processFiles = async (retryId?: string) => {
    const filesToProcess = selectedFiles
      .map((file, index) => ({ file, id: fileId(file, index) }))
      .filter(({ id }) => retryId ? id === retryId : runLog.length === 0);
    if (!filesToProcess.length) return;

    setUploadError(null);
    let nextRunLog: UploadRunEntry[] = runLog.length > 0
      ? runLog.map((entry) => filesToProcess.some(({ id }) => id === entry.id)
        ? { ...entry, state: "processing" as const, message: undefined }
        : entry)
      : selectedFiles.map((file, index) => ({
        id: fileId(file, index),
        name: file.name,
        state: "processing" as const,
      }));
    setRunLog(nextRunLog);

    for (const { file, id } of filesToProcess) {
      try {
        const result = await extraction.mutateAsync({ data: { files: [file] } });
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

    const results = selectedFiles
      .map((file, index) => successfulExtractions.current.get(fileId(file, index)))
      .filter((result): result is ContractExtractionResult => Boolean(result));
    if (results.length > 0 && !nextRunLog.some((entry) => entry.state === "failed" || entry.state === "processing")) {
      sessionStorage.setItem("contract-dashboard.extraction", JSON.stringify(results[0]));
      sessionStorage.setItem("contract-dashboard.extraction-queue", JSON.stringify(results.slice(1)));
      navigate("/review");
    }
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
    setSelectedFiles([]);
    setRunLog([]);
    setUploadError(null);
    setIsDragging(false);
  };

  return {
    selectedFiles,
    runLog,
    isDragging,
    uploadError,
    extraction,
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