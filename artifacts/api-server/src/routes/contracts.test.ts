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
  reviewed: false,
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

  it.skip("replays amendments by effective date without blanking untouched fields", async () => {
    let parentId: string | undefined;
    let amendmentId: string | undefined;
    let secondParentId: string | undefined;
    const suffix = Date.now();
    const amendment = {
      ...contract,
      fields: {
        ...Object.fromEntries(Object.keys(contract.fields).map((key) => [key, { ...missing }])),
        documentType: found("amendment"),
        documentLanguage: found("en"),
        contractTitle: found("Regression Price Amendment"),
        contractNumber: found(`AMD-${suffix}`),
        effectiveDate: found("2026-06-01"),
        contractValue: found({ amount: 280000, currency: "USD", basis: "annual" }),
      },
    };

    try {
      const parent = await request(app)
        .post("/api/contracts")
        .send({ filename: `family-parent-${suffix}.pdf`, parentContractId: null, contract });
      expect(parent.status).toBe(201);
      parentId = parent.body.id;

      const child = await request(app)
        .post("/api/contracts")
        .send({ filename: `family-amendment-${suffix}.pdf`, parentContractId: parentId, contract: amendment });
      expect(child.status).toBe(201);
      amendmentId = child.body.id;

      const invalidNestedChild = await request(app)
        .post("/api/contracts")
        .send({
          filename: `family-nested-${suffix}.pdf`,
          parentContractId: amendmentId,
          contract: amendment,
        });
      expect(invalidNestedChild.status).toBe(400);
      expect(invalidNestedChild.body.error).toMatch(/directly to a root agreement/i);

      const amendmentUpdate = await request(app)
        .put(`/api/contracts/${amendmentId}`)
        .send({
          filename: `family-amendment-${suffix}.pdf`,
          contract: amendment,
        });
      expect(amendmentUpdate.status).toBe(200);
      expect(amendmentUpdate.body.parentContractId).toBe(parentId);

      const secondParent = await request(app)
        .post("/api/contracts")
        .send({
          filename: `family-second-parent-${suffix}.pdf`,
          parentContractId: null,
          contract: {
            ...contract,
            fields: {
              ...contract.fields,
              contractNumber: found(`ROOT-SECOND-${suffix}`),
            },
          },
        });
      expect(secondParent.status).toBe(201);
      secondParentId = secondParent.body.id;

      const invalidRootMove = await request(app)
        .put(`/api/contracts/${parentId}`)
        .send({
          filename: `family-parent-${suffix}.pdf`,
          parentContractId: secondParentId,
          contract,
        });
      expect(invalidRootMove.status).toBe(400);
      expect(invalidRootMove.body.error).toMatch(/related documents cannot be reparented/i);

      const family = await request(app).get(`/api/contracts/${parentId}`);
      expect(family.status).toBe(200);
      expect(family.body.family.documentCount).toBe(2);
      expect(family.body.family.documents.map((document: { id: string }) => document.id)).toEqual([
        parentId,
        amendmentId,
      ]);
      expect(family.body.family.effectiveContract.fields.contractValue.value).toEqual({
        amount: 280000,
        currency: "USD",
        basis: "annual",
      });
      expect(family.body.family.effectiveContract.fields.noticePeriod.value).toEqual(
        contract.fields.noticePeriod.value,
      );
      expect(family.body.family.effectiveContract.fields.vendorLegalName.value).toBe(
        "Regression Vendor GmbH",
      );
      expect(family.body.family.documents[1].fieldValues.contractValue).toMatchObject({
        value: amendment.fields.contractValue.value,
        sourceFilename: `family-amendment-${suffix}.pdf`,
        provenance: "document",
      });

      const reviewerValue = { amount: 310000, currency: "USD", basis: "annual" };
      const reviewerUpdate = await request(app)
        .put(`/api/contracts/${amendmentId}`)
        .send({
          filename: `family-amendment-${suffix}.pdf`,
          contract: {
            ...amendment,
            fields: {
              ...amendment.fields,
              contractValue: reviewerEdited(reviewerValue),
            },
          },
        });
      expect(reviewerUpdate.status).toBe(200);

      const reloadedFamily = await request(app).get(`/api/contracts/${parentId}`);
      expect(reloadedFamily.status).toBe(200);
      expect(reloadedFamily.body.family.effectiveContract.fields.contractValue.value).toEqual(
        reviewerValue,
      );
      expect(reloadedFamily.body.family.documents[1].fieldValues.contractValue).toMatchObject({
        value: reviewerValue,
        sourceFilename: `family-amendment-${suffix}.pdf`,
        provenance: "reviewer_supplied",
      });
    } finally {
      if (secondParentId) await db.delete(contractsTable).where(eq(contractsTable.id, secondParentId));
      if (amendmentId) await db.delete(contractsTable).where(eq(contractsTable.id, amendmentId));
      if (parentId) await db.delete(contractsTable).where(eq(contractsTable.id, parentId));
    }
  });

  it.skip("lets a later-effective root supersede an earlier linked document", async () => {
    let parentId: string | undefined;
    let amendmentId: string | undefined;
    const suffix = crypto.randomUUID();
    const earlierAmendment = {
      ...contract,
      fields: {
        ...Object.fromEntries(Object.keys(contract.fields).map((key) => [key, { ...missing }])),
        documentType: found("amendment"),
        documentLanguage: found("en"),
        contractTitle: found("Earlier Price Amendment"),
        contractNumber: found(`AMD-EARLY-${suffix}`),
        effectiveDate: found("2025-06-01"),
        contractValue: found({ amount: 500000, currency: "USD", basis: "annual" }),
      },
    };

    try {
      const parent = await request(app)
        .post("/api/contracts")
        .send({ filename: `later-root-${suffix}.pdf`, parentContractId: null, contract });
      expect(parent.status).toBe(201);
      parentId = parent.body.id;

      const child = await request(app)
        .post("/api/contracts")
        .send({
          filename: `earlier-amendment-${suffix}.pdf`,
          parentContractId: parentId,
          contract: earlierAmendment,
        });
      expect(child.status).toBe(201);
      amendmentId = child.body.id;

      const family = await request(app).get(`/api/contracts/${parentId}`);
      expect(family.status).toBe(200);
      expect(family.body.family.effectiveContract.fields.contractValue.value).toEqual(
        contract.fields.contractValue.value,
      );
      expect(family.body.family.documents).toEqual([
        expect.objectContaining({ id: amendmentId, isCurrent: false }),
        expect.objectContaining({ id: parentId, isCurrent: true }),
      ]);
    } finally {
      if (amendmentId) await db.delete(contractsTable).where(eq(contractsTable.id, amendmentId));
      if (parentId) await db.delete(contractsTable).where(eq(contractsTable.id, parentId));
    }
  });

  it.skip("dismisses an alert produced by the effective family replay", async () => {
    let parentId: string | undefined;
    let amendmentId: string | undefined;
    const suffix = crypto.randomUUID();
    const blockedRoot = {
      ...contract,
      fields: {
        ...contract.fields,
        noticePeriod: { ...missing },
      },
    };
    const actionableAmendment = {
      ...contract,
      fields: {
        ...Object.fromEntries(Object.keys(contract.fields).map((key) => [key, { ...missing }])),
        documentType: found("amendment"),
        documentLanguage: found("en"),
        contractTitle: found("Notice Amendment"),
        contractNumber: found(`AMD-NOTICE-${suffix}`),
        effectiveDate: found("2026-06-01"),
        noticePeriod: contract.fields.noticePeriod,
      },
    };

    try {
      const parent = await request(app)
        .post("/api/contracts")
        .send({ filename: `blocked-root-${suffix}.pdf`, parentContractId: null, contract: blockedRoot });
      expect(parent.status).toBe(201);
      parentId = parent.body.id;
      expect(parent.body.contract.alert).toBeNull();

      const child = await request(app)
        .post("/api/contracts")
        .send({
          filename: `notice-amendment-${suffix}.pdf`,
          parentContractId: parentId,
          contract: actionableAmendment,
        });
      expect(child.status).toBe(201);
      amendmentId = child.body.id;

      const actionableFamily = await request(app).get(`/api/contracts/${parentId}`);
      expect(actionableFamily.body.family.effectiveContract.alert.state).toBe("pending");

      const dismissed = await request(app)
        .post(`/api/contracts/${parentId}/alert/dismiss`)
        .send({ reason: "Family renewal handled" });
      expect(dismissed.status).toBe(200);
      expect(dismissed.body.family.effectiveContract.alert).toMatchObject({
        state: "dismissed",
        dismissedReason: "Family renewal handled",
      });

      const reopened = await request(app).get(`/api/contracts/${parentId}`);
      expect(reopened.body.family.effectiveContract.alert).toMatchObject({
        state: "dismissed",
        dismissedReason: "Family renewal handled",
      });

      const nonAlertUpdate = {
        ...blockedRoot,
        fields: {
          ...blockedRoot.fields,
          vendorLegalName: found("Updated Vendor Name"),
        },
      };
      const updated = await request(app)
        .put(`/api/contracts/${parentId}`)
        .send({
          filename: `blocked-root-${suffix}.pdf`,
          contract: nonAlertUpdate,
        });
      expect(updated.status).toBe(200);

      const stillDismissed = await request(app).get(`/api/contracts/${amendmentId}`);
      expect(stillDismissed.body.family.effectiveContract.alert).toMatchObject({
        state: "dismissed",
        dismissedReason: "Family renewal handled",
      });

      const ownerUpdate = {
        ...nonAlertUpdate,
        assignment: {
          ...nonAlertUpdate.assignment,
          owner: "Jane Smith",
          ownerEmail: "jane.smith@example.com",
        },
      };
      const reassigned = await request(app)
        .put(`/api/contracts/${parentId}`)
        .send({
          filename: `blocked-root-${suffix}.pdf`,
          contract: ownerUpdate,
        });
      expect(reassigned.status).toBe(200);
      expect(reassigned.body.family.effectiveContract.alert).toMatchObject({
        owner: "Jane Smith",
        state: "pending",
        dismissedReason: null,
      });
    } finally {
      if (amendmentId) await db.delete(contractsTable).where(eq(contractsTable.id, amendmentId));
      if (parentId) await db.delete(contractsTable).where(eq(contractsTable.id, parentId));
    }
  });

  it("stores agreements and amendments as independent contracts", async () => {
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
          parentContractId: agreementId,
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