import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  type ContractSource,
  loadContractSourceFile,
} from "./contract-source";

describe("loadContractSourceFile", () => {
  it("lists then fetches a non-upload source and identifies fetched bytes by SHA-256", async () => {
    const bytes = Buffer.from("%PDF-1.7\nsource-owned bytes");
    const list = vi.fn(async () => [{
      id: "cloud-file-42",
      name: "renamed-contract.pdf",
      modifiedAt: "2026-03-01T12:00:00.000Z",
      size: bytes.length,
      hash: "untrusted-metadata-hash",
    }]);
    const fetch = vi.fn(async (id: string) => {
      expect(id).toBe("cloud-file-42");
      return Buffer.from(bytes);
    });
    const source: ContractSource = { list, fetch };

    const loaded = await loadContractSourceFile(source, "cloud-file-42");

    expect(list).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(loaded.bytes).toEqual(bytes);
    expect(loaded.hash).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("fails before fetch when the requested source id is missing", async () => {
    const fetch = vi.fn(async () => Buffer.from("must not fetch"));
    const source: ContractSource = {
      list: async () => [],
      fetch,
    };

    await expect(loadContractSourceFile(source, "missing-id"))
      .rejects.toThrow("Contract source file missing-id was not found.");
    expect(fetch).not.toHaveBeenCalled();
  });
});