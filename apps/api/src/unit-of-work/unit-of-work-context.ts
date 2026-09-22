import type { DatabaseExecutor } from '../database/database-executor.js';
import { AllocationsRepository } from '../features/allocations/allocations.repository.js';
import { AuditRepository } from '../features/audit/audit.repository.js';
import { CuttingWorksheetsRepository } from '../features/cutting-worksheets/cutting-worksheets.repository.js';
import { EmployeesRepository } from '../features/employees/employees.repository.js';
import { FabricColorsRepository } from '../features/fabric-catalog/colors/fabric-colors.repository.js';
import { ManufacturersRepository } from '../features/fabric-catalog/manufacturers/manufacturers.repository.js';
import { FabricMaterialsRepository } from '../features/fabric-catalog/materials/fabric-materials.repository.js';
import { LocationLevelsRepository } from '../features/locations/levels/location-levels.repository.js';
import { LocationOrderRepository } from '../features/locations/location-order.repository.js';
import { LocationSectionsRepository } from '../features/locations/sections/location-sections.repository.js';
import { LocationZonesRepository } from '../features/locations/zones/location-zones.repository.js';
import { ProductionRepository } from '../features/production/production.repository.js';
import { StockItemsRepository } from '../features/stock-items/stock-items.repository.js';
import { StockReceiptsRepository } from '../features/stock-receipts/stock-receipts.repository.js';
import { UsersRepository } from '../features/users/users.repository.js';
import { WorkOrdersRepository } from '../features/work-orders/work-orders.repository.js';

/** Repositories live only for the callback that created them. */
export type UnitOfWorkContext = Readonly<ReturnType<typeof createRepositories>>;

export function createRepositories(executor: DatabaseExecutor) {
  return {
    allocations: new AllocationsRepository(executor),
    stockItems: new StockItemsRepository(executor),
    stockReceipts: new StockReceiptsRepository(executor),
    workOrders: new WorkOrdersRepository(executor),
    cuttingWorksheets: new CuttingWorksheetsRepository(executor),
    production: new ProductionRepository(executor),
    audit: new AuditRepository(executor),
    users: new UsersRepository(executor),
    employees: new EmployeesRepository(executor),
    manufacturers: new ManufacturersRepository(executor),
    fabricMaterials: new FabricMaterialsRepository(executor),
    fabricColors: new FabricColorsRepository(executor),
    locationZones: new LocationZonesRepository(executor),
    locationSections: new LocationSectionsRepository(executor),
    locationLevels: new LocationLevelsRepository(executor),
    locationOrder: new LocationOrderRepository(executor),
  };
}
