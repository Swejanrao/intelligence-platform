import "express-async-errors";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import healthRoutes from "./routes/health.routes";
import authRoutes from "./routes/auth.routes";
import questionRoutes from "./routes/questions.routes";
import assessmentRoutes from "./routes/assessments.routes";
import attemptRoutes from "./routes/attempts.routes";

export const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173", credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.get("/", (_req, res) => res.json({ name: "Assessment Intelligence Platform API", version: "1.0.0" }));
app.use("/api", healthRoutes);
app.use("/api", authRoutes);
app.use("/api", questionRoutes);
app.use("/api", assessmentRoutes);
app.use("/api", attemptRoutes);
app.use((_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } }));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(500).json({ error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" } });
});
