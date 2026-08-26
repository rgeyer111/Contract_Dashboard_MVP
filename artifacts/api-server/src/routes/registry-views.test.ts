import request from "supertest";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db, registryViewsTable } from "@workspace/db";
import app from "../app";

describe("saved registry views", () => {
  const createdIds: string[] = [];

  afterEach(async () => {
    await Promise.all(
      createdIds.splice(0).map((id) =>
        db.delete(registryViewsTable).where(eq(registryViewsTable.id, id)),
      ),
    );
  });

  it("creates, lists, renames, and deletes a registry view", async () => {
    const createResponse = await request(app)
      .post("/api/registry-views")
      .send({
        name: "Renewal review queue",
        search: "Acme",
        documentType: "master_agreement",
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body).toMatchObject({
      id: expect.any(String),
      name: "Renewal review queue",
      search: "Acme",
      documentType: "master_agreement",
      isPinned: false,
    });
    const id = createResponse.body.id as string;
    createdIds.push(id);

    const listResponse = await request(app).get("/api/registry-views");
    expect(listResponse.status).toBe(200);
    expect(listResponse.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id,
          name: "Renewal review queue",
          search: "Acme",
          documentType: "master_agreement",
        }),
      ]),
    );

    const updateResponse = await request(app)
      .put(`/api/registry-views/${id}`)
      .send({
        name: "Priority renewals",
        search: "Acme",
        documentType: "master_agreement",
      });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body).toMatchObject({
      id,
      name: "Priority renewals",
      search: "Acme",
      documentType: "master_agreement",
    });

    const deleteResponse = await request(app).delete(`/api/registry-views/${id}`);
    expect(deleteResponse.status).toBe(204);
    createdIds.splice(createdIds.indexOf(id), 1);

    const missingDeleteResponse = await request(app).delete(`/api/registry-views/${id}`);
    expect(missingDeleteResponse.status).toBe(404);
  });

  it("rejects blank names and invalid document types", async () => {
    const blankNameResponse = await request(app)
      .post("/api/registry-views")
      .send({ name: "   ", search: "", documentType: null });
    expect(blankNameResponse.status).toBe(400);

    const invalidTypeResponse = await request(app)
      .post("/api/registry-views")
      .send({ name: "Invalid type", search: "", documentType: "nda" });
    expect(invalidTypeResponse.status).toBe(400);
  });

  it("persists pin state and keeps pinned views first in pin order", async () => {
    const firstResponse = await request(app)
      .post("/api/registry-views")
      .send({ name: "First pinned queue", search: "first", documentType: null });
    const secondResponse = await request(app)
      .post("/api/registry-views")
      .send({ name: "Second pinned queue", search: "second", documentType: null });
    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);

    const firstId = firstResponse.body.id as string;
    const secondId = secondResponse.body.id as string;
    createdIds.push(firstId, secondId);

    const pinFirstResponse = await request(app)
      .patch(`/api/registry-views/${firstId}/pin`)
      .send({ pinned: true });
    expect(pinFirstResponse.status).toBe(200);
    expect(pinFirstResponse.body).toMatchObject({ id: firstId, isPinned: true });

    await new Promise((resolve) => setTimeout(resolve, 5));
    const pinSecondResponse = await request(app)
      .patch(`/api/registry-views/${secondId}/pin`)
      .send({ pinned: true });
    expect(pinSecondResponse.status).toBe(200);
    expect(pinSecondResponse.body).toMatchObject({ id: secondId, isPinned: true });

    const pinnedListResponse = await request(app).get("/api/registry-views");
    const pinnedCreatedViews = pinnedListResponse.body.filter(
      (view: { id: string }) => view.id === firstId || view.id === secondId,
    );
    expect(pinnedCreatedViews.map((view: { id: string }) => view.id)).toEqual([firstId, secondId]);

    const unpinFirstResponse = await request(app)
      .patch(`/api/registry-views/${firstId}/pin`)
      .send({ pinned: false });
    expect(unpinFirstResponse.status).toBe(200);
    expect(unpinFirstResponse.body).toMatchObject({ id: firstId, isPinned: false });

    const unpinnedListResponse = await request(app).get("/api/registry-views");
    const reorderedCreatedViews = unpinnedListResponse.body.filter(
      (view: { id: string }) => view.id === firstId || view.id === secondId,
    );
    expect(reorderedCreatedViews.map((view: { id: string }) => view.id)).toEqual([secondId, firstId]);

    const invalidPinResponse = await request(app)
      .patch(`/api/registry-views/${firstId}/pin`)
      .send({ pinned: "yes" });
    expect(invalidPinResponse.status).toBe(400);
  });

  it("reorders every pinned view without changing its saved filters or pin state", async () => {
    const originalListResponse = await request(app).get("/api/registry-views");
    const originalPinnedIds = originalListResponse.body
      .filter((view: { isPinned: boolean }) => view.isPinned)
      .map((view: { id: string }) => view.id);
    const views = await Promise.all(
      [
        ["Review first", "first", "master_agreement"],
        ["Review second", "second", "sow"],
        ["Review third", "third", null],
      ].map(([name, search, documentType]) =>
        request(app)
          .post("/api/registry-views")
          .send({ name, search, documentType }),
      ),
    );
    views.forEach((response) => expect(response.status).toBe(201));

    const ids = views.map((response) => response.body.id as string);
    createdIds.push(...ids);
    for (const id of ids) {
      const response = await request(app)
        .patch(`/api/registry-views/${id}/pin`)
        .send({ pinned: true });
      expect(response.status).toBe(200);
    }
    const desiredIds = [ids[2], ids[0], ids[1], ...originalPinnedIds];

    try {
      const reorderResponse = await request(app)
        .patch("/api/registry-views/order")
        .send({ orderedIds: desiredIds });
      expect(reorderResponse.status).toBe(200);
      expect(
        reorderResponse.body
          .filter((view: { id: string }) => ids.includes(view.id))
          .map((view: { id: string }) => view.id),
      ).toEqual([ids[2], ids[0], ids[1]]);
      expect(reorderResponse.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: ids[0],
            name: "Review first",
            search: "first",
            documentType: "master_agreement",
            isPinned: true,
          }),
          expect.objectContaining({
            id: ids[1],
            name: "Review second",
            search: "second",
            documentType: "sow",
            isPinned: true,
          }),
          expect.objectContaining({
            id: ids[2],
            name: "Review third",
            search: "third",
            documentType: null,
            isPinned: true,
          }),
        ]),
      );

      const persistedResponse = await request(app).get("/api/registry-views");
      expect(
        persistedResponse.body
          .filter((view: { id: string }) => ids.includes(view.id))
          .map((view: { id: string }) => view.id),
      ).toEqual([ids[2], ids[0], ids[1]]);

      const incompleteResponse = await request(app)
        .patch("/api/registry-views/order")
        .send({ orderedIds: desiredIds.slice(0, -1) });
      expect(incompleteResponse.status).toBe(400);

      const duplicateResponse = await request(app)
        .patch("/api/registry-views/order")
        .send({ orderedIds: [...desiredIds.slice(0, -1), desiredIds[0]] });
      expect(duplicateResponse.status).toBe(400);
    } finally {
      for (const id of ids) {
        await request(app)
          .patch(`/api/registry-views/${id}/pin`)
          .send({ pinned: false });
      }
      if (originalPinnedIds.length > 0) {
        await request(app)
          .patch("/api/registry-views/order")
          .send({ orderedIds: originalPinnedIds });
      }
    }
  });

  it("assigns distinct shared positions when views are pinned concurrently", async () => {
    const createResponses = await Promise.all(
      ["Concurrent first", "Concurrent second", "Concurrent third"].map((name) =>
        request(app)
          .post("/api/registry-views")
          .send({ name, search: "", documentType: null }),
      ),
    );
    createResponses.forEach((response) => expect(response.status).toBe(201));
    const ids = createResponses.map((response) => response.body.id as string);
    createdIds.push(...ids);

    const pinResponses = await Promise.all(
      ids.map((id) =>
        request(app)
          .patch(`/api/registry-views/${id}/pin`)
          .send({ pinned: true }),
      ),
    );
    pinResponses.forEach((response) => expect(response.status).toBe(200));

    const records = await db
      .select({
        id: registryViewsTable.id,
        pinnedOrder: registryViewsTable.pinnedOrder,
      })
      .from(registryViewsTable);
    const createdRecords = records.filter((record) => ids.includes(record.id));
    expect(createdRecords).toHaveLength(ids.length);
    expect(createdRecords.every((record) => record.pinnedOrder !== null)).toBe(true);
    expect(new Set(createdRecords.map((record) => record.pinnedOrder)).size).toBe(ids.length);
  });
});