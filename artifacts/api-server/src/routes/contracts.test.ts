import request from "supertest";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
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
  alternatives: [],
  reviewed: false,
});
const utcToday = new Date();
const todayAtUtcMidnight = Date.UTC(
  utcToday.getUTCFullYear(),
  utcToday.getUTCMonth(),
  utcToday.getUTCDate(),
);
const daysUntil = (date: string) =>
  Math.round((new Date(`${date}T00:00:00.000Z`).getTime() - todayAtUtcMidnight) / (24 * 60 * 60 * 1000));
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
    daysRemaining: daysUntil("2026-10-02"),
    status: "green",
    reasonCode: null,
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
  it("rejects fetched saved PDF bytes before extraction using their persisted SHA-256", async () => {
    const bytes = pdfLike("%PDF-1.7\npersisted SHA-256 duplicate regression");
    const hash = createHash("sha256").update(bytes).digest("hex");
    const filename = `persisted-hash-${crypto.randomUUID()}.pdf`;
    const contractWithSource = {
      ...contract,
      source: {
        id: "stored-object-id",
        name: filename,
        modifiedAt: null,
        size: bytes.length,
        hash,
      },
    };

    try {
      const saved = await request(app)
        .post("/api/contracts")
        .send({ filename, contract: contractWithSource });
      expect(saved.status).toBe(201);

      const refetched = await request(app).get(`/api/contracts/${saved.body.id}`);
      expect(refetched.status).toBe(200);
      expect(refetched.body.contract.source.hash).toBe(hash);

      for (const uploadName of ["same-after-refetch.pdf", "same-on-repeat.pdf"]) {
        const duplicate = await request(app)
          .post("/api/contracts/extract")
          .attach("file", bytes, { filename: uploadName, contentType: "application/pdf" });
        expect(duplicate.status).toBe(409);
        expect(duplicate.body.error).toMatch(/already been uploaded/i);
      }

      const records = await db
        .select({ id: contractsTable.id })
        .from(contractsTable)
        .where(eq(contractsTable.fileHash, hash));
      expect(records).toHaveLength(1);
    } finally {
      await db.delete(contractsTable).where(eq(contractsTable.fileHash, hash));
    }
  });

  it("enforces one saved contract per PDF hash even for concurrent requests", async () => {
    const hash = crypto.randomUUID().replaceAll("-", "").padEnd(64, "0").slice(0, 64);
    const contractWithSource = {
      ...contract,
      source: {
        id: hash,
        name: "concurrent-duplicate.pdf",
        modifiedAt: null,
        size: 1024,
        hash,
      },
    };

    const responses = await Promise.all([
      request(app).post("/api/contracts").send({ filename: "concurrent-a.pdf", contract: contractWithSource }),
      request(app).post("/api/contracts").send({ filename: "concurrent-b.pdf", contract: contractWithSource }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const records = await db
      .select({ id: contractsTable.id })
      .from(contractsTable)
      .where(eq(contractsTable.fileHash, hash));
    expect(records).toHaveLength(1);

    await db.delete(contractsTable).where(eq(contractsTable.fileHash, hash));
  });

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
      {
        ...reviewerEdited("Updated Regression Vendor GmbH"),
        originalValue: "Regression Vendor GmbH",
      },
    );
    expect(updateResponse.body.contract.fields.contractTitle).toEqual(
      {
        ...reviewerEdited("Updated Coverage"),
        originalValue: "Regression Coverage",
      },
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

  it("rejects competing readings that do not match their field type", async () => {
    const invalidAlternatives = structuredClone(contract) as any;
    invalidAlternatives.fields.contractType = {
      ...found("maintenance"),
      status: "conflicting",
      confidence: "low",
      note: "Two incompatible readings.",
      alternatives: [
        { value: "maintenance", page: 1, clause: null, quote: "Maintenance agreement." },
        { value: { invalid: true }, page: 2, clause: null, quote: "Software services." },
      ],
    };

    const response = await request(app)
      .post("/api/contracts")
      .send({ filename: "invalid-alternative.pdf", contract: invalidAlternatives });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/provenance is inconsistent/i);
  });

  it("rejects a contract whose owner email cannot receive alerts", async () => {
    const invalidAssignment = structuredClone(contract);
    invalidAssignment.assignment.ownerEmail = "not-an-email";

    const response = await request(app)
      .post("/api/contracts")
      .send({ filename: "invalid-owner-email.pdf", contract: invalidAssignment });

    expect(response.status).toBe(400);
  });

  it("rejects whitespace-only owners at the API boundary", async () => {
    const invalidAssignment = structuredClone(contract);
    invalidAssignment.assignment.owner = "   ";

    const response = await request(app)
      .post("/api/contracts")
      .send({ filename: "blank-owner.pdf", contract: invalidAssignment });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/owner/i);
  });

  it("keeps a null first extraction through repeated corrections and reload", async () => {
    const initialContract = structuredClone(contract) as any;
    initialContract.fields.vendorLegalName = { ...missing };

    const created = await request(app)
      .post("/api/contracts")
      .send({ filename: "repeated-null-correction.pdf", contract: initialContract });
    expect(created.status).toBe(201);

    const firstContract = structuredClone(created.body.contract);
    firstContract.fields.vendorLegalName = {
      ...reviewerEdited("First reviewer value"),
      originalValue: null,
    };
    const first = await request(app)
      .put(`/api/contracts/${created.body.id}`)
      .send({ filename: "repeated-null-correction.pdf", contract: firstContract });
    expect(first.status).toBe(200);
    expect(first.body.contract.fields.vendorLegalName.originalValue).toBeNull();

    const secondContract = structuredClone(first.body.contract);
    secondContract.fields.vendorLegalName = {
      ...reviewerEdited("Second reviewer value"),
      originalValue: "forged client history",
    };
    const second = await request(app)
      .put(`/api/contracts/${created.body.id}`)
      .send({ filename: "repeated-null-correction.pdf", contract: secondContract });
    expect(second.status).toBe(200);
    expect(second.body.contract.fields.vendorLegalName.originalValue).toBeNull();

    const reopened = await request(app).get(`/api/contracts/${created.body.id}`);
    expect(reopened.status).toBe(200);
    expect(reopened.body.contract.fields.vendorLegalName).toMatchObject({
      value: "Second reviewer value",
      originalValue: null,
    });
  });

  it("preserves source provenance when only reviewer resolution changes", async () => {
    const filename = `review-resolution-${crypto.randomUUID()}.pdf`;
    let id: string | undefined;
    try {
      const created = await request(app)
        .post("/api/contracts")
        .send({ filename, contract });
      expect(created.status).toBe(201);
      id = created.body.id;

      const spoofedProvenance = {
        ...contract,
        fields: {
          ...contract.fields,
          vendorLegalName: {
            ...contract.fields.vendorLegalName,
            status: "ambiguous",
            confidence: "low",
            page: null,
            clause: null,
            quote: null,
            note: "Client attempted to replace source provenance.",
            reviewed: true,
          },
        },
      };
      const updated = await request(app)
        .put(`/api/contracts/${id}`)
        .send({ filename, contract: spoofedProvenance });

      expect(updated.status).toBe(200);
      expect(updated.body.contract.fields.vendorLegalName).toMatchObject({
        value: "Regression Vendor GmbH",
        status: "found",
        confidence: "high",
        page: 1,
        quote: "Verbatim source evidence.",
        reviewed: true,
      });
      expect(updated.body.contract.fields.vendorLegalName.note).toBeNull();

      const reviewerSupplied = {
        ...spoofedProvenance,
        fields: {
          ...spoofedProvenance.fields,
          vendorLegalName: {
            ...spoofedProvenance.fields.vendorLegalName,
            value: "Reviewer Supplied Vendor GmbH",
            reviewed: true,
          },
        },
      };
      const edited = await request(app)
        .put(`/api/contracts/${id}`)
        .send({ filename, contract: reviewerSupplied });

      expect(edited.status).toBe(200);
      expect(edited.body.contract.fields.vendorLegalName).toEqual({
        ...reviewerEdited("Reviewer Supplied Vendor GmbH"),
        reviewed: true,
        originalValue: "Regression Vendor GmbH",
      });
    } finally {
      if (id) await db.delete(contractsTable).where(eq(contractsTable.id, id));
    }
  });

  it("retains the originally extracted contract type across reviewer corrections", async () => {
    const filename = `contract-type-correction-${crypto.randomUUID()}.pdf`;
    let id: string | undefined;
    try {
      const created = await request(app)
        .post("/api/contracts")
        .send({ filename, contract });
      expect(created.status).toBe(201);
      id = created.body.id;

      const firstCorrection = structuredClone(created.body.contract);
      firstCorrection.fields.contractType.value = "saas_subscription";
      firstCorrection.fields.contractType.reviewed = true;
      const firstUpdate = await request(app)
        .put(`/api/contracts/${id}`)
        .send({ filename, contract: firstCorrection });

      expect(firstUpdate.status).toBe(200);
      expect(firstUpdate.body.contract.fields.contractType).toMatchObject({
        value: "saas_subscription",
        originalValue: "software_license",
        status: "ambiguous",
        confidence: "low",
        reviewed: true,
      });

      const secondCorrection = structuredClone(firstUpdate.body.contract);
      secondCorrection.fields.contractType.value = "maintenance";
      const secondUpdate = await request(app)
        .put(`/api/contracts/${id}`)
        .send({ filename, contract: secondCorrection });

      expect(secondUpdate.status).toBe(200);
      expect(secondUpdate.body.contract.fields.contractType).toMatchObject({
        value: "maintenance",
        originalValue: "software_license",
        reviewed: true,
      });
    } finally {
      if (id) await db.delete(contractsTable).where(eq(contractsTable.id, id));
    }
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
      code: "UNREADABLE",
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
        {
          ...reviewerEdited("Northstar Sourcing GmbH"),
          originalValue: "Regression Vendor GmbH",
        },
      );
      expect(updated.body.contract.assignment.status).toBe("In Negotiation");
      expect(updated.body).not.toHaveProperty("extraction");

      const reopened = await request(app).get(`/api/contracts/${id}`);
      expect(reopened.status).toBe(200);
      expect(reopened.body.contract.fields.vendorLegalName).toEqual(
        {
          ...reviewerEdited("Northstar Sourcing GmbH"),
          originalValue: "Regression Vendor GmbH",
        },
      );
      expect(reopened.body.contract.assignment.status).toBe("In Negotiation");
    } finally {
      if (id) {
        await db.delete(contractsTable).where(eq(contractsTable.id, id));
      }
    }
  });

  it("stores every document as an independent contract", async () => {
    let agreementId: string | undefined;
    let amendmentId: string | undefined;
    const suffix = crypto.randomUUID();
    const amendment = {
      ...contract,
      fields: {
        ...contract.fields,
        documentType: found("amendment"),
        contractTitle: found("Independent Price Amendment"),
        contractNumber: found(`AMD-${suffix}`),
        contractValue: found({ amount: 310000, currency: "USD", basis: "annual" }),
      },
    };

    try {
      const agreement = await request(app)
        .post("/api/contracts")
        .send({ filename: `agreement-${suffix}.pdf`, contract });
      expect(agreement.status).toBe(201);
      agreementId = agreement.body.id;

      const savedAmendment = await request(app)
        .post("/api/contracts")
        .send({
          filename: `amendment-${suffix}.pdf`,
          contract: amendment,
        });
      expect(savedAmendment.status).toBe(201);
      amendmentId = savedAmendment.body.id;
      expect(savedAmendment.body).not.toHaveProperty("parentContractId");
      expect(savedAmendment.body).not.toHaveProperty("family");

      const listed = await request(app).get("/api/contracts");
      const agreementRecord = listed.body.find((item: { id: string }) => item.id === agreementId);
      const amendmentRecord = listed.body.find((item: { id: string }) => item.id === amendmentId);
      expect(agreementRecord.contract.fields.contractValue.value).toEqual(
        contract.fields.contractValue.value,
      );
      expect(amendmentRecord.contract.fields.contractValue.value).toEqual(
        amendment.fields.contractValue.value,
      );
      expect(agreementRecord).not.toHaveProperty("family");
      expect(amendmentRecord).not.toHaveProperty("family");
    } finally {
      if (amendmentId) await db.delete(contractsTable).where(eq(contractsTable.id, amendmentId));
      if (agreementId) await db.delete(contractsTable).where(eq(contractsTable.id, agreementId));
    }
  });

  it("dismisses alerts only on the selected contract", async () => {
    let firstId: string | undefined;
    let secondId: string | undefined;
    const suffix = crypto.randomUUID();
    try {
      const first = await request(app)
        .post("/api/contracts")
        .send({ filename: `alert-first-${suffix}.pdf`, contract });
      const second = await request(app)
        .post("/api/contracts")
        .send({
          filename: `alert-second-${suffix}.pdf`,
          contract: {
            ...contract,
            fields: {
              ...contract.fields,
              contractNumber: found(`ALERT-${suffix}`),
            },
          },
        });
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      firstId = first.body.id;
      secondId = second.body.id;

      const dismissed = await request(app)
        .post(`/api/contracts/${firstId}/alert/dismiss`)
        .send({ reason: "Handled independently" });
      expect(dismissed.status).toBe(200);
      expect(dismissed.body.contract.alert).toMatchObject({
        state: "dismissed",
        dismissedReason: "Handled independently",
      });

      const untouched = await request(app).get(`/api/contracts/${secondId}`);
      expect(untouched.body.contract.alert).toMatchObject({
        state: "pending",
        dismissedReason: null,
      });
    } finally {
      if (secondId) await db.delete(contractsTable).where(eq(contractsTable.id, secondId));
      if (firstId) await db.delete(contractsTable).where(eq(contractsTable.id, firstId));
    }
  });
});