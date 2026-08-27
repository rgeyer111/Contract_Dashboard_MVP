import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListRegistryViewsQueryKey,
  useCreateRegistryView,
  useDeleteRegistryView,
  useListRegistryViews,
  usePinRegistryView,
  useReorderRegistryViews,
  useUpdateRegistryView,
  type RegistryViewSaveRequestDocumentType,
  type SavedRegistryView,
} from "@workspace/api-client-react";
import { useLanguage, type MessageId } from "@/lib/i18n";

export function useSavedRegistryViews(searchTerm: string, documentTypeFilter: string) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [savedViewName, setSavedViewName] = useState("");
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [editingViewId, setEditingViewId] = useState<string | null>(null);
  const [editingViewName, setEditingViewName] = useState("");
  const [deletingViewId, setDeletingViewId] = useState<string | null>(null);
  const [savedViewError, setSavedViewError] = useState<MessageId | null>(null);
  const [savedViewMoveStatus, setSavedViewMoveStatus] = useState<string | null>(null);

  const registryViewsQuery = useListRegistryViews();
  const savedViews = registryViewsQuery.data ?? [];
  const createRegistryView = useCreateRegistryView({
    mutation: {
      onSuccess: async () => {
        setSaveViewOpen(false);
        setSavedViewName("");
        setSavedViewError(null);
        await queryClient.invalidateQueries({ queryKey: getListRegistryViewsQueryKey() });
      },
      onError: () => setSavedViewError("ui.this.view.could.not.be.saved.check.the.name.and.try.again"),
    },
  });
  const updateRegistryView = useUpdateRegistryView({
    mutation: {
      onSuccess: async () => {
        setEditingViewId(null);
        setEditingViewName("");
        setSavedViewError(null);
        await queryClient.invalidateQueries({ queryKey: getListRegistryViewsQueryKey() });
      },
      onError: () => setSavedViewError("ui.this.view.could.not.be.renamed.check.the.name.and.try.again"),
    },
  });
  const pinRegistryView = usePinRegistryView({
    mutation: {
      onSuccess: async () => {
        setSavedViewError(null);
        await queryClient.invalidateQueries({ queryKey: getListRegistryViewsQueryKey() });
      },
      onError: () => setSavedViewError("ui.this.view.s.pin.state.could.not.be.updated.please.try.again"),
    },
  });
  const reorderRegistryViews = useReorderRegistryViews({
    mutation: {
      onSuccess: async () => {
        setSavedViewError(null);
        await queryClient.invalidateQueries({ queryKey: getListRegistryViewsQueryKey() });
      },
      onError: () => setSavedViewError("ui.this.view.order.could.not.be.saved.please.try.again"),
    },
  });
  const deleteRegistryView = useDeleteRegistryView({
    mutation: {
      onSuccess: async () => {
        setDeletingViewId(null);
        setSavedViewError(null);
        await queryClient.invalidateQueries({ queryKey: getListRegistryViewsQueryKey() });
      },
      onError: () => setSavedViewError("ui.this.view.could.not.be.deleted.please.try.again"),
    },
  });

  const saveCurrentView = () => {
    const name = savedViewName.trim();
    if (!name) {
      setSavedViewError("ui.give.this.view.a.clear.name.before.saving");
      return;
    }
    setSavedViewError(null);
    createRegistryView.mutate({
      data: {
        name,
        search: searchTerm,
        documentType: (documentTypeFilter || null) as RegistryViewSaveRequestDocumentType,
      },
    });
  };

  const startRename = (view: SavedRegistryView) => {
    setSavedViewError(null);
    setDeletingViewId(null);
    setEditingViewId(view.id);
    setEditingViewName(view.name);
  };

  const renameView = (view: SavedRegistryView) => {
    const name = editingViewName.trim();
    if (!name) {
      setSavedViewError("ui.a.saved.view.needs.a.name");
      return;
    }
    setSavedViewError(null);
    updateRegistryView.mutate({
      id: view.id,
      data: { name, search: view.search, documentType: view.documentType },
    });
  };

  const confirmDelete = (view: SavedRegistryView) => {
    setSavedViewError(null);
    setEditingViewId(null);
    setDeletingViewId(view.id);
  };

  const deleteView = (view: SavedRegistryView) => {
    deleteRegistryView.mutate({ id: view.id });
  };

  const togglePin = (view: SavedRegistryView) => {
    setSavedViewError(null);
    pinRegistryView.mutate({ id: view.id, data: { pinned: !view.isPinned } });
  };

  const movePinnedView = (viewId: string, direction: "up" | "down") => {
    const pinnedViews = savedViews.filter((view) => view.isPinned);
    const currentIndex = pinnedViews.findIndex((view) => view.id === viewId);
    const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= pinnedViews.length || reorderRegistryViews.isPending) return;
    const reordered = [...pinnedViews];
    const [movedView] = reordered.splice(currentIndex, 1);
    reordered.splice(nextIndex, 0, movedView);
    const successMessage = t("view.movedPosition", {
      name: movedView.name,
      direction,
      position: nextIndex + 1,
      total: pinnedViews.length,
    });
    setSavedViewMoveStatus(null);
    reorderRegistryViews.mutate(
      { data: { orderedIds: reordered.map((item) => item.id) } },
      { onSuccess: () => setSavedViewMoveStatus(successMessage) },
    );
  };

  return {
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
  };
}