import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: { id: number; username: string; email: string; role: string };
}

export const auth = (req: AuthRequest, res: Response, next: NextFunction) => {
  const tokenFromHeader = req.headers.authorization?.split(' ')[1];
  const tokenFromQuery = typeof req.query.token === 'string' ? req.query.token : undefined;
  const token = tokenFromHeader || tokenFromQuery;
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET!) as AuthRequest['user'];
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

export const adminOnly = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
};
