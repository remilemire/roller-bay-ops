import { WorkOrderCancellationModule } from './features/work-orders/cancellation/work-order-cancellation.module.js';
import { ProductionModule } from './features/production/production.module.js';
import { AuditModule } from './features/audit/audit.module.js';
import { AllocationsModule } from './features/allocations/allocations.module.js';
import { StockReceiptsModule } from './features/stock-receipts/stock-receipts.module.js';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config/environment.js';
import { HealthModule } from './features/health/health.module.js';
import { RedisModule } from './redis/redis.module.js';
import { FabricCatalogModule } from './features/fabric-catalog/fabric-catalog.module.js';
import { AuthModule } from './features/auth/auth.module.js';
import { LocationsModule } from './features/locations/locations.module.js';
import { StockItemsModule } from './features/stock-items/stock-items.module.js';
import { WorkOrdersModule } from './features/work-orders/work-orders.module.js';
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
