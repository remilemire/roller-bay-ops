import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import {
  recutRequestSchema,
  recutAssignmentSchema,
  recutSignoffSchema,
  recutWithdrawalSchema,
} from '@roller-bay/shared/production';
import { correctionKeySchema } from '@roller-bay/shared/corrections';
import { z } from 'zod';
import type { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { requireStation } from './production-access.js';
import { RecutsService } from './recuts.service.js';
// Accept outstanding requests from clients that used to send a routing choice.
const requestBodySchema = recutRequestSchema.extend({
  needsAssembly: z.boolean().optional(),
});
const keyPipe = new ZodValidationPipe(correctionKeySchema);
@Controller('production')
@Roles('production')
export class RecutsController {
  constructor(private readonly recuts: RecutsService) {}
  @Get('recuts/pending-count') @Roles('staff') pendingCount() {
    return this.recuts.pendingCount();
  }
  @Get('orders/:id/recuts') list(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    requireStation(req.currentUser!);
    return this.recuts.list(id);
  }
  @Get(['orders/:id/recut-blinds', 'checking/orders/:id/recut-blinds']) blinds(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    requireStation(req.currentUser!);
    return this.recuts.blinds(id);
  }
  @Post(['orders/:id/recuts', 'checking/orders/:id/recuts']) request(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(requestBodySchema))
    input: z.infer<typeof requestBodySchema>,
    @Headers('idempotency-key') key: string,
    @Req() req: Request,
  ) {
    requireStation(req.currentUser!);
    return this.recuts.request(
      id,
      input,
      req.currentUser!.id,
      keyPipe.transform(key),
    );
  }
  @Get('recuts/:id/stock') @Roles('staff') candidates(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.recuts.candidates(id);
  }
  @Post('recuts/:id/assign') @Roles('staff') assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(recutAssignmentSchema))
    input: z.infer<typeof recutAssignmentSchema>,
    @Headers('idempotency-key') key: string,
    @Req() req: Request,
  ) {
    return this.recuts.assign(
      id,
      input,
      req.currentUser!.id,
      keyPipe.transform(key),
    );
  }
  @Post('recuts/:id/withdraw') @Roles('staff') withdraw(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(recutWithdrawalSchema))
    input: z.infer<typeof recutWithdrawalSchema>,
    @Headers('idempotency-key') key: string,
    @Req() req: Request,
  ) {
    return this.recuts.withdraw(
      id,
      input,
      req.currentUser!.id,
      keyPipe.transform(key),
    );
  }
  @Post(':station/recuts/:id/complete') complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('station', new ZodValidationPipe(z.enum(['assembly', 'checking'])))
    station: 'assembly' | 'checking',
    @Body(new ZodValidationPipe(recutSignoffSchema))
    input: z.infer<typeof recutSignoffSchema>,
    @Headers('idempotency-key') key: string,
    @Req() req: Request,
  ) {
    requireStation(req.currentUser!, station);
    return this.recuts.signoff(
      station,
      id,
      input,
      req.currentUser!.id,
      keyPipe.transform(key),
    );
  }
}
