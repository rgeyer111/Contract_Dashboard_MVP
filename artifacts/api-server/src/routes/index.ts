import { Router, type IRouter } from "express";
import contractsRouter from "./contracts";
import healthRouter from "./health";

export async function createRouter(runtime: string | undefined = process.env.NODE_ENV): Promise<IRouter> {
  const router: IRouter = Router();
  router.use(healthRouter);
  router.use(contractsRouter);
  if (runtime === "development") {
    const { default: demoRouter } = await import("../demo/routes");
    router.use(demoRouter);
  }
  return router;
}
