import { getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";

declare global {
  namespace Express {
    interface Request {
      authAccountId?: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const testUserId = process.env.NODE_ENV === "test"
    ? req.header("x-test-user-id")?.trim()
    : undefined;
  const auth = getAuth(req);
  const claimedUserId = auth?.sessionClaims?.userId;
  const userId = testUserId ||
    (typeof claimedUserId === "string" ? claimedUserId : undefined) ||
    auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.authAccountId = userId;
  next();
}

export function accountIdFor(req: Request): string {
  if (!req.authAccountId) {
    throw new Error("Authenticated account ID is unavailable.");
  }
  return req.authAccountId;
}