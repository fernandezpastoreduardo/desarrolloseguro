import {
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
  OnApplicationShutdown,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PostgresScanStore } from "@desarrolloseguro/persistence";
import { Pool } from "pg";
import { PublicScanController } from "./public-scan/public-scan.controller.js";
import { PublicScanService } from "./public-scan/public-scan.service.js";
import { PublicScanRateLimitGuard } from "./public-scan/public-scan-rate-limit.js";
import { PublicScanRateLimiter } from "./public-scan/public-scan-rate-limiter.js";
import { resolveDevelopmentSecurityDatabasePoolConfig } from "./database-pool-config.js";

@Injectable()
export class DevelopmentSecurityDatabase implements OnApplicationShutdown {
  readonly scanStore: PostgresScanStore;

  constructor() {
    this.scanStore = new PostgresScanStore(
      new Pool(resolveDevelopmentSecurityDatabasePoolConfig(process.env)),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.scanStore.close();
  }
}

@Injectable()
export class DevelopmentSecurityHealthService {
  constructor(
    @Inject(DevelopmentSecurityDatabase)
    private readonly database: {
      scanStore: Pick<PostgresScanStore, "healthCheck">;
    },
  ) {}

  async isStorageAvailable(): Promise<boolean> {
    return this.database.scanStore.healthCheck();
  }
}

@Controller("health")
export class DevelopmentSecurityHealthController {
  constructor(private readonly health: DevelopmentSecurityHealthService) {}

  @Get()
  async getHealth(): Promise<{ status: "ok" }> {
    if (!(await this.health.isStorageAvailable())) {
      throw new ServiceUnavailableException("development_security_unavailable");
    }
    return { status: "ok" };
  }
}

@Module({
  controllers: [DevelopmentSecurityHealthController, PublicScanController],
  providers: [
    DevelopmentSecurityDatabase,
    DevelopmentSecurityHealthService,
    PublicScanRateLimiter,
    PublicScanRateLimitGuard,
    {
      provide: PublicScanService,
      inject: [DevelopmentSecurityDatabase],
      useFactory: (database: DevelopmentSecurityDatabase) =>
        new PublicScanService(database),
    },
  ],
})
export class DevelopmentSecurityApiModule {}
