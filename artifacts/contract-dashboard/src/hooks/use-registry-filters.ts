import { useEffect, useMemo, useState } from "react";
import type { SavedContract, SavedRegistryView } from "@workspace/api-client-react";
import {
  filterContracts,
  getDocumentTypeFromUrl,
  getSearchTermFromLocation,
  parseDocumentType,
  sortContractsByUrgency,
  updateRegistryUrl,
  DOCUMENT_TYPE_QUERY_PARAM,
  SEARCH_QUERY_PARAM,
} from "@/lib/registry";

export function useRegistryFilters(contracts: SavedContract[], location: string) {
  const [searchTerm, setSearchTerm] = useState(() => getSearchTermFromLocation(window.location.search));
  const [documentTypeFilter, setDocumentTypeFilter] = useState(getDocumentTypeFromUrl);
  const [shareStatus, setShareStatus] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    const syncFiltersFromUrl = () => {
      setSearchTerm(getSearchTermFromLocation(window.location.search));
      setDocumentTypeFilter(getDocumentTypeFromUrl());
      setShareStatus("idle");
    };
    syncFiltersFromUrl();
    window.addEventListener("popstate", syncFiltersFromUrl);
    return () => window.removeEventListener("popstate", syncFiltersFromUrl);
  }, [location]);

  const filteredContracts = useMemo(
    () => filterContracts(contracts, searchTerm, documentTypeFilter),
    [contracts, documentTypeFilter, searchTerm],
  );
  const sortedFilteredContracts = useMemo(
    () => sortContractsByUrgency(filteredContracts),
    [filteredContracts],
  );

  const updateDocumentTypeFilter = (value: string) => {
    const params = new URLSearchParams(window.location.search);
    if (value) params.set(DOCUMENT_TYPE_QUERY_PARAM, value);
    else params.delete(DOCUMENT_TYPE_QUERY_PARAM);
    setDocumentTypeFilter(parseDocumentType(value));
    setShareStatus("idle");
    updateRegistryUrl(params, "push");
  };

  const updateSearchTerm = (value: string) => {
    const params = new URLSearchParams(window.location.search);
    const hadSearchTerm = Boolean(params.get(SEARCH_QUERY_PARAM)?.trim());
    if (value.trim()) params.set(SEARCH_QUERY_PARAM, value);
    else params.delete(SEARCH_QUERY_PARAM);
    setSearchTerm(value);
    setShareStatus("idle");
    const hasSearchTerm = Boolean(value.trim());
    updateRegistryUrl(params, hadSearchTerm === hasSearchTerm ? "replace" : "push");
  };

  const copyFilteredViewLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareStatus("copied");
      window.setTimeout(() => setShareStatus("idle"), 2400);
    } catch {
      setShareStatus("error");
    }
  };

  const openSavedView = (view: SavedRegistryView) => {
    const params = new URLSearchParams(window.location.search);
    if (view.search) params.set(SEARCH_QUERY_PARAM, view.search);
    else params.delete(SEARCH_QUERY_PARAM);
    if (view.documentType) params.set(DOCUMENT_TYPE_QUERY_PARAM, view.documentType);
    else params.delete(DOCUMENT_TYPE_QUERY_PARAM);
    setSearchTerm(view.search);
    setDocumentTypeFilter(view.documentType ?? "");
    setShareStatus("idle");
    updateRegistryUrl(params, "push");
  };

  return {
    searchTerm,
    documentTypeFilter,
    shareStatus,
    filteredContracts,
    sortedFilteredContracts,
    updateDocumentTypeFilter,
    updateSearchTerm,
    copyFilteredViewLink,
    openSavedView,
  };
}