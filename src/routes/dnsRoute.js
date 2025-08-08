import { Router } from "express";
import {
  addDomain,
  verifyDomain,
} from "../controller/dnsController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

const router = Router();
router.use(authMiddleware);

router.post("/generate-dns-records", addDomain);
router.get("/verify-dns-record/:id", verifyDomain);

export default router;
