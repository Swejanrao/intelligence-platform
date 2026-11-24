import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

export type AuthUser = { id: string; email: string; name: string; role: "ADMIN" | "CANDIDATE" };

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is required");
  return secret;
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, jwtSecret(), { expiresIn: "12h" });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authorization = req.header("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue" } });

  try {
    req.user = jwt.verify(token, jwtSecret()) as AuthUser;
    return next();
  } catch {
    return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Your session is invalid or expired" } });
  }
}

export function requireRole(role: AuthUser["role"]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.role !== role) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "You do not have permission to perform this action" } });
    }
    return next();
  };
}

export function errorResponse(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}
