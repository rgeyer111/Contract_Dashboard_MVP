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
});