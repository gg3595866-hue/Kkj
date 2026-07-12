import { Router, type IRouter } from "express";
import healthRouter from "./health";
import proxyRouter from "./proxy";
import scanRouter from "./scan";
import probeRouter from "./probe";
import bypassRouter from "./bypass";

const router: IRouter = Router();

router.use(healthRouter);
router.use(proxyRouter);
router.use(scanRouter);
router.use(probeRouter);
router.use(bypassRouter);

export default router;
