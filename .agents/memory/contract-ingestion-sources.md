---
name: Contract ingestion sources
description: Durable source abstraction and content-based duplicate rules for contract ingestion.
---

Keep extraction and register code independent of where files originate by ingesting through the `ContractSource` list/fetch contract. Identify uploaded content by SHA-256 of the file bytes; filenames are display metadata only.

**Why:** Folder and cloud connectors must be swappable without rebuilding extraction. Filenames are neither stable nor unique, while a content hash prevents duplicate rows even when a file is renamed.

**How to apply:** New source implementations provide metadata plus fetched bytes. Persist the source hash with the confirmed contract, reject a matching saved hash, and report duplicates as per-file skipped outcomes rather than failing a batch.