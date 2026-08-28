import supertest from "supertest";

export const TEST_ACCOUNT_ID = "legacy-development-owner";

export function requestAs(app: Parameters<typeof supertest.agent>[0], accountId: string) {
  return supertest.agent(app).set("x-test-user-id", accountId);
}

export default function authenticatedRequest(app: Parameters<typeof supertest.agent>[0]) {
  return requestAs(app, TEST_ACCOUNT_ID);
}