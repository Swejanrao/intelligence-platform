import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../config/database";
import { errorResponse, signToken } from "../middleware/auth";

const router = Router();
const signInSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  password: z.string().min(1)
});

router.post("/auth/sign-in", async (req, res) => {
  const parsed = signInSchema.safeParse(req.body);
  if (!parsed.success) return errorResponse(res, 400, "VALIDATION_ERROR", "Enter a valid email and password");

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !user.isActive || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    return errorResponse(res, 401, "INVALID_CREDENTIALS", "Email or password is incorrect");
  }

  const safeUser = { id: user.id, email: user.email, name: user.name, role: user.role as "ADMIN" | "CANDIDATE" };
  return res.json({ token: signToken(safeUser), user: safeUser });
});

export default router;
