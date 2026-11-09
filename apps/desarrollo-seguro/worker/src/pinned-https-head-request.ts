import { request as httpsRequest, type RequestOptions } from "node:https";
import type { ClientRequest } from "node:http";
import { normalizeHostname } from "@desarrolloseguro/core";
import { createPinnedLookup } from "./pinned-dns-lookup.js";

type HttpsRequestFactory = (options: RequestOptions) => ClientRequest;

const HTTPS_PROTOCOL = "https:";
const HTTPS_PORT = 443;
const HEAD_METHOD = "HEAD";
const ROOT_PATH = "/";
const VERIFY_TLS_CERTIFICATE = true;

export function createPinnedHttpsHeadRequest(
  inputHostname: unknown,
  requestFactory: HttpsRequestFactory = httpsRequest,
): ClientRequest {
  const hostname = normalizeHostname(inputHostname);
  const lookup = createPinnedLookup();

  return requestFactory({
    protocol: HTTPS_PROTOCOL,
    hostname,
    port: HTTPS_PORT,
    method: HEAD_METHOD,
    path: ROOT_PATH,
    servername: hostname,
    headers: { host: hostname },
    agent: false,
    rejectUnauthorized: VERIFY_TLS_CERTIFICATE,
    lookup,
  });
}
