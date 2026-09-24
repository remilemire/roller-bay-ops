import { WorkOrderCancellationModule } from './features/work-order-cancellation/index.js';
import { ProductionModule } from './features/production/index.js';
import { AuditModule } from './features/audit/index.js';
import { AllocationsModule } from './features/allocations/index.js';
import { StockReceiptsModule } from './features/stock-receipts/index.js';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config/environment.js';
import { HealthModule } from './features/health/index.js';
import { RedisModule } from './redis/redis.module.js';
import { FabricCatalogModule } from './features/fabric-catalog/index.js';
import { AuthModule } from './features/auth/index.js';
import { LocationsModule } from './features/locations/index.js';
import { StockItemsModule } from './features/stock-items/index.js';
import { WorkOrdersModule } from './features/work-orders/index.js';
import { RateLimitingModule } from './rate-limiting/rate-limiting.module.js';
import { FrontendProxyModule } from './frontend-proxy/frontend-proxy.module.js';
import { ErrorsModule } from './common/errors/errors.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    ErrorsModule,
    AuditModule,
    ProductionModule,
    RedisModule,
    // Middleware runs in import order among modules only AppModule imports.
    // The proxy check comes first so direct requests never spend a rate-limit
    // budget and the limiter sees the verified client address.
    FrontendProxyModule,
    RateLimitingModule,
    AuthModule,
    HealthModule,
    FabricCatalogModule,
    LocationsModule,
    StockItemsModule,
    StockReceiptsModule,
    WorkOrdersModule,
    WorkOrderCancellationModule,
    AllocationsModule,
  ],
})
export class AppModule {}
