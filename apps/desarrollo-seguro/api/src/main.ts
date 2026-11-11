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
  app.enableCors({
    origin: ["https://grumphya.com", "https://desarrolloseguro.org"],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    maxAge: 600,
  });
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.DS_API_PORT ?? DEFAULT_PORT), "0.0.0.0");
}

bootstrap().catch((error: unknown) => {
  const safeCategory = getSafeStartupFailureCategory(error);
  process.stderr.write(
    `development_security_api_startup_failed category=${safeCategory}\n`,
  );
  process.exitCode = 1;
});

function getSafeStartupFailureCategory(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  if (/^[a-z][a-z0-9_]*$/u.test(error.message)) return error.message;

  const code = (error as NodeJS.ErrnoException).code;
  if (typeof code === "string" && /^[A-Z0-9_]+$/u.test(code)) return code;

  return "unknown";
}
