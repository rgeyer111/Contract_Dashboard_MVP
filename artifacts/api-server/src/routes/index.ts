import { Router, type IRouter } from "express";
import contractsRouter from "./contracts";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(contractsRouter);

export default router;
