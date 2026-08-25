import request from "supertest";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, contractsTable } from "@workspace/db";
import app from "../app";

const pdfLike = (body: string | Buffer = "%PDF-1.7\nnot a readable PDF") =>
  Buffer.isBuffer(body) ? body : Buffer.from(body);

const contract = {
  vendor: "Regression Vendor",
  contractNumber: "REG-2026-001",
  contractName: "Regression Coverage",
  contractType: "Software License",
  contractValue: { status: "unknown", amount: null, currency: null },
  startDate: "2026-01-01",
  contractDuration: "12 months",
  endDate: "2026-12-31",
  noticePeriod: "60 days",
  noticeDeadline: "",
  negotiationBuffer: "30 days",
  owner: "John Doe",
  status: "Review Open",
};

const confidence = Object.fromEntries(
  [
    "vendor",
    "contractNumber",
    "contractName",
    "contractType",
    "contractValue",
    "startDate",
    "contractDuration",
    "endDate",
    "noticePeriod",
    "noticeDeadline",
    "negotiationBuffer",
    "owner",
    "status",
  ].map((field) => [field, "High"]),
);

describe("saved contract persistence", () => {
  it("lists, creates, reads, and updates a saved contract", async () => {
    const filename = `saved-contract-regression-${Date.now()}.pdf`;
    const createResponse = await request(app)
      .post("/api/contracts")
      .send({ filename, contract, confidence });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body).toMatchObject({
      id: expect.any(String),
      filename,
      contract,
      confidence,
    });
    const id = createResponse.body.id as string;

    const listResponse = await request(app).get("/api/contracts");
    expect(listResponse.status).toBe(200);
    expect(listResponse.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id,
          filename,
          contract,
          confidence,
        }),
      ]),
    );

    const readResponse = await request(app).get(`/api/contracts/${id}`);
    expect(readResponse.status).toBe(200);
    expect(readResponse.body).toMatchObject({
      id,
      filename,
      contract,
      confidence,
    });

    const updatedContract = {
      ...contract,
      vendor: "Updated Regression Vendor",
      contractName: "Updated Coverage",
      owner: "John Doe",
      contractValue: { status: "unknown", amount: null, currency: null },
    };
    const updateResponse = await request(app)
      .put(`/api/contracts/${id}`)
      .send({
        filename: "updated-saved-contract.pdf",
        contract: updatedContract,
        confidence,
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body).toMatchObject({
      id,
      filename: "updated-saved-contract.pdf",
      contract: updatedContract,
      confidence,
    });
    expect(updateResponse.body.contract.contractValue).toEqual({
      status: "unknown",
      amount: null,
      currency: null,
    });
    expect(updateResponse.body.contract.owner).toBe("John Doe");
  });
});

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

describe("saved contract persistence", () => {
  it("keeps a confirmed contract available through list, detail, and update", async () => {
    const filename = `regression-${crypto.randomUUID()}.pdf`;
    const contract = {
      vendor: "Northstar Sourcing",
      contractNumber: "NS-2026-014",
      contractName: "Sourcing Agreement",
      contractType: "Software License",
      contractValue: { status: "stated", amount: 240000, currency: "USD" },
      startDate: "2026-01-01",
      contractDuration: "12 months",
      endDate: "2026-12-31",
      noticePeriod: "60 days",
      noticeDeadline: "2026-11-01",
      negotiationBuffer: "30 days",
      owner: "John Doe",
      status: "Review Open",
    };
    const confidence = Object.fromEntries(
      [
        "vendor",
        "contractNumber",
        "contractName",
        "contractType",
        "contractValue",
        "startDate",
        "contractDuration",
        "endDate",
        "noticePeriod",
        "noticeDeadline",
        "negotiationBuffer",
        "owner",
        "status",
      ].map((field) => [field, "High"]),
    );
    let id: string | undefined;

    try {
      const created = await request(app)
        .post("/api/contracts")
        .send({ filename, contract, confidence });

      expect(created.status).toBe(201);
      expect(created.body.filename).toBe(filename);
      expect(created.body.contract).toEqual(contract);
      expect(created.body.confidence).toEqual(confidence);
      expect(created.body.id).toEqual(expect.any(String));
      expect(created.body.createdAt).toEqual(expect.any(String));
      expect(created.body.updatedAt).toEqual(expect.any(String));
      expect(created.body).not.toHaveProperty("extraction");
      id = created.body.id;

      const listed = await request(app).get("/api/contracts");
      expect(listed.status).toBe(200);
      expect(listed.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id,
            filename,
            contract,
            confidence,
          }),
        ]),
      );

      const detail = await request(app).get(`/api/contracts/${id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.contract.vendor).toBe("Northstar Sourcing");

      const updatedContract = {
        ...contract,
        vendor: "Northstar Sourcing GmbH",
        status: "In Negotiation",
      };
      const updated = await request(app)
        .put(`/api/contracts/${id}`)
        .send({ filename, contract: updatedContract, confidence });

      expect(updated.status).toBe(200);
      expect(updated.body.contract).toEqual(updatedContract);
      expect(updated.body.confidence).toEqual(confidence);
      expect(updated.body).not.toHaveProperty("extraction");

      const reopened = await request(app).get(`/api/contracts/${id}`);
      expect(reopened.status).toBe(200);
      expect(reopened.body.contract.vendor).toBe("Northstar Sourcing GmbH");
      expect(reopened.body.contract.status).toBe("In Negotiation");
    } finally {
      if (id) {
        await db.delete(contractsTable).where(eq(contractsTable.id, id));
      }
    }
  });
});