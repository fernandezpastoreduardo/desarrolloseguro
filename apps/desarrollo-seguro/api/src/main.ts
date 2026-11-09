import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DevelopmentSecurityApiModule } from "./development-security-api.module.js";
import { resolveHttpsListenerOptions } from "./https-listener.js";
import { parseTrustedProxyCidrs } from "./trusted-proxy-cidrs.js";

const DEFAULT_PORT = 3001;
const API_PREFIX = "api/desarrollo-seguro/v1";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(DevelopmentSecurityApiModule, {
    httpsOptions: resolveHttpsListenerOptions(process.env),
  });
  app
    .getHttpAdapter()
    .getInstance()
    .set(
      "trust proxy",
      parseTrustedProxyCidrs(process.env.DS_TRUSTED_PROXY_CIDRS),
    );
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.DS_API_PORT ?? DEFAULT_PORT), "0.0.0.0");
}

bootstrap().catch(() => {
  process.stderr.write("development_security_api_startup_failed\n");
  process.exitCode = 1;
});
