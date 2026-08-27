import { Router, type IRouter, type Request, type Response } from "express";
import { generateTea23Fixtures } from "./tea-23-generator";

const router: IRouter = Router();

router.get("/demo/contracts", (_req: Request, res: Response): void => {
  res.json(generateTea23Fixtures().records);
});

export default router;