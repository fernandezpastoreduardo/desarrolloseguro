type ApiProxyTarget = {
  target: string;
  changeOrigin: false;
};

export type DevelopmentSecurityApiProxy = Record<string, ApiProxyTarget>;

const DEVELOPMENT_SECURITY_API_PROXY_CONTEXT = "/api/desarrollo-seguro";
const LOCAL_PROXY_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const PROXY_TARGET_ERROR = "development_security_api_proxy_target_must_be_local";

export function createDevelopmentSecurityApiProxy(
  target: string,
): DevelopmentSecurityApiProxy {
  assertLocalTarget(target);
  return {
    [DEVELOPMENT_SECURITY_API_PROXY_CONTEXT]: {
      target,
      changeOrigin: false,
    },
  };
}

function assertLocalTarget(target: string): void {
  let parsedTarget: URL;
  try {
    parsedTarget = new URL(target);
  } catch {
    throw new Error(PROXY_TARGET_ERROR);
  }

  if (
    parsedTarget.protocol !== "http:" ||
    !LOCAL_PROXY_HOSTS.has(parsedTarget.hostname) ||
    parsedTarget.pathname !== "/" ||
    parsedTarget.search.length > 0 ||
    parsedTarget.hash.length > 0 ||
    parsedTarget.username.length > 0 ||
    parsedTarget.password.length > 0
  ) {
    throw new Error(PROXY_TARGET_ERROR);
  }
}
