export class UserEmailConflictError extends Error {
  constructor(options?: ErrorOptions) {
    super('A user already has this email.', options);
    this.name = 'UserEmailConflictError';
  }
}
