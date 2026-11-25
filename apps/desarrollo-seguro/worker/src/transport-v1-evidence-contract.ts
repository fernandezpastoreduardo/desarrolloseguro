/** Maximum derived fields in one bounded network-observation response. */
export const MAX_TRANSPORT_EVIDENCE_FIELDS = 64;

/** Character limits for the two structured public-policy evidence fields. */
export const MAX_TRANSPORT_PUBLIC_POLICY_DECLARATIONS_CHARS = 24 * 1024;
export const MAX_TRANSPORT_PUBLIC_POLICY_DOCUMENTS_CHARS = 128 * 1024;

/** Maximum serialized UTF-8 evidence response crossing the executor IPC socket. */
export const MAX_TRANSPORT_IPC_RESPONSE_BYTES = 512 * 1024;
