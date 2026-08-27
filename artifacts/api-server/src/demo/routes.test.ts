import request from "supertest";
import { describe, expect, it } from "vitest";
import { db, contractsTable } from "@workspace/db";
import { createApp } from "../app";

describe("published TEA-23 demo API", () => {
  it("serves fixtures without changing contract rows", async () => {
    const before = await db.select({ id: contractsTable.id }).from(contractsTable);
    const app = await createApp();
    const response = await request(app).get("/api/demo/contracts");
    const after = await db.select({ id: contractsTable.id }).from(contractsTable);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(7);
    expect(after).toEqual(before);
  });

});