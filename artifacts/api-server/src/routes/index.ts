import { Router, type IRouter } from "express";
import healthRouter from "./health";
import proxyRouter from "./proxy";
import scanRouter from "./scan";

const router: IRouter = Router();

router.use(healthRouter);
router.use(proxyRouter);
router.use(scanRouter);

export default router;
