import { UnauthorizedException } from '@nestjs/common';

export class MicrosoftAccountNotEligibleException extends UnauthorizedException {
  constructor() {
    super('This Microsoft account is not eligible to sign in.');
  }
}
