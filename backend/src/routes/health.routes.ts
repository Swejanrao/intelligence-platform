import { Router } from "express";
import { prisma } from "../config/database";

const router = Router();

router.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.status(200).json({ status: "ok", message: "Assessment API is running", database: "connected", timestamp: new Date().toISOString() });
  } catch {
    return res.status(503).json({ status: "error", message: "API is running but database is unavailable" });
  }
});

export default router;
