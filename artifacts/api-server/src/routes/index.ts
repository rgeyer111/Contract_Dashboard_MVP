import { Router, type IRouter } from "express";
import contractsRouter from "./contracts";
import healthRouter from "./health";

export async function createRouter(): Promise<IRouter> {
  const router: IRouter = Router();
  router.use(healthRouter);
  router.use(contractsRouter);
  const { default: demoRouter } = await import("../demo/routes");
  router.use(demoRouter);
  return router;
}
