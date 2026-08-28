import supertest from "supertest";
import { describe, expect, it } from "vitest";
import app from "../app";

describe("API authentication boundary", () => {
  it("keeps health and demo public while rejecting persistent routes", async () => {
    const [health, demo, contracts, views, ingest] = await Promise.all([
      supertest(app).get("/api/healthz"),
      supertest(app).get("/api/demo/contracts"),
      supertest(app).get("/api/contracts"),
      supertest(app).get("/api/registry-views"),
      supertest(app).get("/api/contracts/ingest-runs/current"),
    ]);
    expect(health.status).toBe(200);
    expect(demo.status).toBe(200);
    expect([contracts.status, views.status, ingest.status]).toEqual([401, 401, 401]);
  });

  it("does not grant credentialed cross-origin access", async () => {
    const response = await supertest(app)
      .get("/api/demo/contracts")
      .set("Origin", "https://untrusted.example");

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
  });
});