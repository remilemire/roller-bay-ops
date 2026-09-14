import type { CurrentUser } from '@roller-bay/shared/auth';

declare module 'express-session' {
  interface SessionData {
    auth?: { userId: string; authenticatedAt: number; expiresAt: number };
    oauthExpiresAt?: number;
  }
}

declare module 'express-serve-static-core' {
  interface Request {
    currentUser?: CurrentUser;
  }
}
