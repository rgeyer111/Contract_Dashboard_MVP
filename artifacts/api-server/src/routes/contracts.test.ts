import request from "supertest";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, contractsTable } from "@workspace/db";
import app from "../app";

const pdfLike = (body: string | Buffer = "%PDF-1.7\nnot a readable PDF") =>
  Buffer.isBuffer(body) ? body : Buffer.from(body);

const missing = {
  value: null,
  status: "not_found",
  confidence: "low",
  page: null,
  clause: null,
  quote: null,
  note: null,
};
const found = (value: unknown) => ({
  value,
  status: "found",
  confidence: "high",
  page: 1,
  clause: null,
  quote: "Verbatim source evidence." as string | null,
  note: null,
});
const reviewerEdited = (value: unknown) => ({
  value,
  status: "ambiguous",
  confidence: "low",
  page: null,
  clause: null,
  quote: null,
  note: "Reviewer-supplied value; original extraction evidence was cleared.",
});
const contract = {
  fields: {
    documentType: found("master_agreement"),
    documentLanguage: found("en"),
    vendorLegalName: found("Regression Vendor GmbH"),
    buyerLegalEntity: found("Regression Buyer AG"),
    contractTitle: found("Regression Coverage"),
    contractNumber: found("REG-2026-001"),
    contractType: found("software_license"),
    signatureDate: found("2025-12-20"),
    effectiveDate: found("2026-01-01"),
    initialTermLength: found({ amount: 12, unit: "months" }),
    initialTermEndDate: found("2026-12-31"),
    renewalMechanism: found("auto_renew"),
    renewalTermLength: found({ amount: 12, unit: "months" }),
    noticePeriod: found({
      amount: 60,
      unit: "days",
      anchor: "term_end",
      purpose: "non_renewal",
    }),
    noticeDeadline: { ...missing, note: "Computed by the application." },
    noticeDelivery: found({ method: "email", address: "legal@example.com", cc: [] }),
    contractValue: found({ amount: 240000, currency: "USD", basis: "annual" }),
    billingFrequency: found("annual"),
  },
  assignment: {
    owner: "John Doe",
    ownerEmail: "john.doe@example.com",
    negotiationBufferDays: 30,
    negotiationBufferSource: "global_default",
    status: "Review Open",
  },
  computed: {
    exitDate: "2026-12-31",
    noticeDeadline: "2026-11-01",
    actionDate: "2026-10-02",
    status: "green",
    reason: null,
  },
  alert: {
    owner: "John Doe",
    ownerEmail: "john.doe@example.com",
    actionDate: "2026-10-02",
    noticeDeadline: "2026-11-01",
    state: "pending",
    dismissedReason: null,
  },
};

describe("saved contract persistence", () => {
  it("lists, creates, reads, and updates a saved contract", async () => {
    const filename = `saved-contract-regression-${Date.now()}.pdf`;
    const createResponse = await request(app)
      .post("/api/contracts")
      .send({ filename, contract });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body).toMatchObject({
      id: expect.any(String),
      filename,
      contract,
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
        }),
      ]),
    );

    const readResponse = await request(app).get(`/api/contracts/${id}`);
    expect(readResponse.status).toBe(200);
    expect(readResponse.body).toMatchObject({
      id,
      filename,
      contract,
    });

    const updatedContract = {
      ...contract,
      fields: {
        ...contract.fields,
        vendorLegalName: found("Updated Regression Vendor GmbH"),
        contractTitle: found("Updated Coverage"),
      },
    };
    const updateResponse = await request(app)
      .put(`/api/contracts/${id}`)
      .send({
        filename: "updated-saved-contract.pdf",
        contract: updatedContract,
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.id).toBe(id);
    expect(updateResponse.body.filename).toBe("updated-saved-contract.pdf");
    expect(updateResponse.body.contract.fields.vendorLegalName).toEqual(
      reviewerEdited("Updated Regression Vendor GmbH"),
    );
    expect(updateResponse.body.contract.fields.contractTitle).toEqual(
      reviewerEdited("Updated Coverage"),
    );
    expect(updateResponse.body.contract.fields.contractValue.value).toEqual({
      amount: 240000,
      currency: "USD",
      basis: "annual",
    });
    expect(updateResponse.body.contract.assignment.owner).toBe("John Doe");
  });

  it("rejects field values that claim found status without source evidence", async () => {
    const inconsistent = structuredClone(contract);
    inconsistent.fields.vendorLegalName = {
      ...inconsistent.fields.vendorLegalName,
      quote: null,
    };

    const response = await request(app)
      .post("/api/contracts")
      .send({ filename: "inconsistent-provenance.pdf", contract: inconsistent });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/provenance is inconsistent/i);
  });

  it("persists a dismissed alert and its reason", async () => {
    const filename = `dismiss-alert-${crypto.randomUUID()}.pdf`;
    const created = await request(app).post("/api/contracts").send({ filename, contract });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    try {
      expect(created.body.contract.alert.state).toBe("pending");
      const dismissed = await request(app)
        .post(`/api/contracts/${id}/alert/dismiss`)
        .send({ reason: "Renewal already approved" });
      expect(dismissed.status).toBe(200);
      expect(dismissed.body.contract.alert).toMatchObject({
        state: "dismissed",
        dismissedReason: "Renewal already approved",
      });
      const reopened = await request(app).get(`/api/contracts/${id}`);
      expect(reopened.body.contract.alert.state).toBe("dismissed");
      expect(reopened.body.contract.alert.dismissedReason).toBe("Renewal already approved");
    } finally {
      await db.delete(contractsTable).where(eq(contractsTable.id, id));
    }
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
    expect(response.body).toEqual({
      error:
        "We could not read text from this PDF, including with OCR. Make sure the scan is clear and try again.",
    });
    expect(response.body).not.toHaveProperty("extraction");
  });
});

describe("saved contract persistence", () => {
  it("keeps a confirmed contract available through list, detail, and update", async () => {
    const filename = `regression-${crypto.randomUUID()}.pdf`;
    let id: string | undefined;

    try {
      const created = await request(app)
        .post("/api/contracts")
        .send({ filename, contract });

      expect(created.status).toBe(201);
      expect(created.body.filename).toBe(filename);
      expect(created.body.contract).toEqual(contract);
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
          }),
        ]),
      );

      const detail = await request(app).get(`/api/contracts/${id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.contract.fields.vendorLegalName.value).toBe("Regression Vendor GmbH");

      const updatedContract = {
        ...contract,
        fields: {
          ...contract.fields,
          vendorLegalName: found("Northstar Sourcing GmbH"),
        },
        assignment: {
          ...contract.assignment,
          status: "In Negotiation",
        },
      };
      const updated = await request(app)
        .put(`/api/contracts/${id}`)
        .send({ filename, contract: updatedContract });

      expect(updated.status).toBe(200);
      expect(updated.body.contract.fields.vendorLegalName).toEqual(
        reviewerEdited("Northstar Sourcing GmbH"),
      );
      expect(updated.body.contract.assignment.status).toBe("In Negotiation");
      expect(updated.body).not.toHaveProperty("extraction");

      const reopened = await request(app).get(`/api/contracts/${id}`);
      expect(reopened.status).toBe(200);
      expect(reopened.body.contract.fields.vendorLegalName).toEqual(
        reviewerEdited("Northstar Sourcing GmbH"),
      );
      expect(reopened.body.contract.assignment.status).toBe("In Negotiation");
    } finally {
      if (id) {
        await db.delete(contractsTable).where(eq(contractsTable.id, id));
      }
    }
  });
});