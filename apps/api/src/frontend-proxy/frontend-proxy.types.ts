declare module 'express-serve-static-core' {
  interface Request {
    /** Client address reported by the authenticated frontend proxy. */
    verifiedClientIp?: string;
  }
}

export {};
