---
name: Contract deletion retention
description: Product rule for permanent contract deletion and retained source PDFs.
---

Deleting a contract permanently removes its active database record and dependent contract data. If a retained source PDF exists, preserve it in waste storage indefinitely; do not expire it automatically.

**Why:** The user chose permanent record deletion with PDF retention until an administrator explicitly empties waste.

**How to apply:** Any registry deletion, bulk cleanup, restore tooling, or future waste-bin administration must preserve this distinction between immediately deleted structured data and indefinitely retained waste files.