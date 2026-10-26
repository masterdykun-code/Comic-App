import type { Request, Response } from 'express';
import type { z } from 'zod';
import type { AuthService } from '../services/auth.service';
import type { AuthLocals, RegisterInput, ProfileUpdate, ChangePasswordInput } from '../types/auth.types';
import type { loginSchema, refreshSchema } from '../middlewares/auth.validation';

type AuthResponse = Response<unknown, AuthLocals>;

export function createAuthController(service: AuthService) {
  return {
    async register(_req: Request, res: AuthResponse) {
      const data = await service.register(res.locals.authInput as RegisterInput);
      res.status(201).json({ success: true, message: 'Registration successful', data });
    },
    async login(_req: Request, res: AuthResponse) {
      const { email, password } = res.locals.authInput as z.infer<typeof loginSchema>;
      const data = await service.login(email, password);
      res.json({ success: true, message: 'Login successful', data });
    },
    async refresh(_req: Request, res: AuthResponse) {
      const { refreshToken } = res.locals.authInput as z.infer<typeof refreshSchema>;
      const data = await service.refresh(refreshToken);
      res.json({ success: true, message: 'Session refreshed', data });
    },
    async logout(_req: Request, res: AuthResponse) {
      const { refreshToken } = res.locals.authInput as z.infer<typeof refreshSchema>;
      await service.logout(refreshToken);
      res.json({ success: true, message: 'Logged out' });
    },
    me(_req: Request, res: AuthResponse) {
      res.json({ success: true, message: 'Profile retrieved', data: res.locals.auth.user });
    },
    async updateMe(_req: Request, res: AuthResponse) {
      const { user, sessionId } = res.locals.auth;
      const data = await service.updateProfile(user.id, sessionId, res.locals.authInput as ProfileUpdate);
      res.json({ success: true, message: 'Profile updated', data });
    },
    async changePassword(_req: Request, res: AuthResponse) {
      const { user, sessionId } = res.locals.auth;
      await service.changePassword(user.id, sessionId, res.locals.authInput as ChangePasswordInput);
      res.json({ success: true, message: 'Password changed. Sign in again.', data: { sessionsRevoked: true } });
    },
  };
}
