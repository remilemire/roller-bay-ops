import { z } from 'zod';

export const oauthTransactionSchema = z.object({
  state: z.string(),
  nonce: z.string(),
  verifier: z.string(),
  expiresAt: z.number(),
});

export type OAuthTransaction = z.infer<typeof oauthTransactionSchema>;
export type CreateOAuthTransaction = Omit<OAuthTransaction, 'expiresAt'>;
