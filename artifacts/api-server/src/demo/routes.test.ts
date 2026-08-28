import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { generateTea23Fixtures } from "./tea-23-generator";

describe("published TEA-23 demo API", () => {
  it("serves fixtures independently of the contract registry", async () => {
    const app = await createApp();
    const response = await request(app).get("/api/demo/contracts");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(generateTea23Fixtures().records);
  });
});
