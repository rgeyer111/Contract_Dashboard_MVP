import request from "supertest";
import { describe, expect, it } from "vitest";
import app from "../app";

const pdfLike = (body: string | Buffer = "%PDF-1.7\nnot a readable PDF") =>
  Buffer.isBuffer(body) ? body : Buffer.from(body);

describe("POST /api/contracts/extract upload guards", () => {
  it("rejects a missing upload", async () => {
    const response = await request(app).post("/api/contracts/extract");
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Choose one PDF/i);
  });

  it("rejects an invalid MIME type even when the filename is a PDF", async () => {
    const response = await request(app)
      .post("/api/contracts/extract")
      .attach("file", pdfLike(), { filename: "contract.pdf", contentType: "text/plain" });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Only valid PDF/i);
  });

  it("rejects a fake PDF signature even when the MIME type is PDF", async () => {
    const response = await request(app)
      .post("/api/contracts/extract")
      .attach("file", Buffer.from("not a PDF"), {
        filename: "contract.pdf",
        contentType: "application/pdf",
      });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Only valid PDF/i);
  });

  it("rejects uploads larger than 10 MB", async () => {
    const response = await request(app)
      .post("/api/contracts/extract")
      .attach("file", Buffer.concat([pdfLike(), Buffer.alloc(10 * 1024 * 1024)]), {
        filename: "large.pdf",
        contentType: "application/pdf",
      });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/10 MB or smaller/i);
  });

  it("returns a readable error for an unreadable PDF", async () => {
    const response = await request(app)
      .post("/api/contracts/extract")
      .attach("file", pdfLike(), {
        filename: "broken.pdf",
        contentType: "application/pdf",
      });
    expect(response.status).toBe(422);
    expect(response.body.error).toMatch(/could not read text/i);
  });
});