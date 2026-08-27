import { useQuery } from "@tanstack/react-query";
import type { SavedContract } from "@workspace/api-client-react";

export const DEMO_QUERY_PARAM = "demo";

export function isDemoLocation(search = window.location.search) {
  return new URLSearchParams(search).get(DEMO_QUERY_PARAM) === "1";
}

export function demoNavigationPath(path: string, demo: boolean) {
  if (!demo) return path;
  const params = new URLSearchParams(window.location.search);
  params.set(DEMO_QUERY_PARAM, "1");
  return `${path}?${params.toString()}`;
}

export function useDemoContracts(enabled: boolean) {
  return useQuery<SavedContract[]>({
    queryKey: ["/api/demo/contracts"],
    enabled,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/demo/contracts", { signal });
      if (!response.ok) {
        throw new Error(`Demo contracts could not be loaded (${response.status}).`);
      }
      return response.json() as Promise<SavedContract[]>;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}