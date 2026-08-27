import request from "supertest";
import { describe, expect, it } from "vitest";
import { db, contractsTable } from "@workspace/db";
import { createApp } from "../app";

describe("development-only TEA-23 API", () => {
  it("serves fixtures in development without changing contract rows", async () => {
    const before = await db.select({ id: contractsTable.id }).from(contractsTable);
    const app = await createApp("development");
    const response = await request(app).get("/api/demo/contracts");
    const after = await db.select({ id: contractsTable.id }).from(contractsTable);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(7);
    expect(after).toEqual(before);
  });

  it("does not mount the fixture endpoint in production", async () => {
    const app = await createApp("production");
    const response = await request(app).get("/api/demo/contracts");
    expect(response.status).toBe(404);
  });
});