import { useState, type ChangeEvent, type DragEvent } from "react";
import {
  useExtractContract,
  type ContractExtractionResult,
} from "@workspace/api-client-react";

export type UploadRunEntry = {
  name: string;
  state: "processing" | "ready" | "duplicate" | "failed";
  message?: string;
};

export function useContractUpload(navigate: (path: string) => void) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [runLog, setRunLog] = useState<UploadRunEntry[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const extraction = useExtractContract();

  const chooseFiles = (files: File[]) => {
    const validFiles = files.filter((file) => {
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      return isPdf && file.size <= 10 * 1024 * 1024;
    });
    setUploadError(validFiles.length !== files.length ? "Only PDF files up to 10 MB can be added." : null);
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
          setRunLog((current) => current.map((entry) => entry.name === file.name
            ? { ...entry, state: "duplicate", message: "Duplicate skipped" }
            : entry));
          continue;
        }
        if (hash) batchHashes.add(hash);
        results.push(result);
        setRunLog((current) => current.map((entry) => entry.name === file.name
          ? { ...entry, state: "ready", message: "Ready for review" }
          : entry));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not process this PDF.";
        const duplicate = /duplicate|already been uploaded/i.test(message);
        setRunLog((current) => current.map((entry) => entry.name === file.name
          ? { ...entry, state: duplicate ? "duplicate" : "failed", message: duplicate ? "Duplicate skipped" : message }
          : entry));
      }
    }
    if (results.length > 0) {
      sessionStorage.setItem("contract-dashboard.extraction", JSON.stringify(results[0]));
      sessionStorage.setItem("contract-dashboard.extraction-queue", JSON.stringify(results.slice(1)));
      navigate("/review");
    }
  };

  const chooseFilesFromDrop = (files: FileList | File[]) => {
    chooseFiles(Array.from(files));
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
    handleDrop,
    handleInput,
    processFiles,
    resetUpload,
  };
}