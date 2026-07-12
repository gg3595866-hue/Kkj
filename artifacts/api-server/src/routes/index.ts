import { Router, type IRouter } from "express";
import healthRouter from "./health";
import proxyRouter from "./proxy";
import scanRouter from "./scan";
import probeRouter from "./probe";

const router: IRouter = Router();

router.use(healthRouter);
router.use(proxyRouter);
router.use(scanRouter);
router.use(probeRouter);

export default router;
