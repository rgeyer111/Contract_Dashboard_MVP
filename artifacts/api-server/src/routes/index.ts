import { Router, type IRouter } from "express";
import contractsRouter from "./contracts";
import healthRouter from "./health";
import { requireAuth } from "../middlewares/require-auth";

export async function createRouter(): Promise<IRouter> {
  const router: IRouter = Router();
  router.use(healthRouter);
  const { default: demoRouter } = await import("../demo/routes");
  router.use(demoRouter);
  router.use(requireAuth, contractsRouter);
  return router;
}
