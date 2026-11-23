/**
 * Local, versioned keyword index for public privacy-policy discovery.
 * These terms locate statements; their presence is not a legal-compliance verdict.
 * Reference: GDPR Articles 12–14, EUR-Lex, reviewed 2026-11-23.
 */
export const PUBLIC_POLICY_LANGUAGE_CATALOG = {
  version: "public-policy-language-eea-v1",
  reviewedAt: "2026-11-23",
  source: "https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng/",
  recipients: [
    "destinatario", "destinatarios", "categoría de destinatarios", "categorías de destinatarios",
    "tercero", "terceros", "proveedor", "proveedores", "encargado del tratamiento",
    "encargados del tratamiento", "recipient", "recipients", "categories of recipients",
    "third party", "third parties", "service provider", "service providers", "processor",
    "processors", "data processor",
  ],
  purposes: [
    "finalidad", "finalidades", "fines del tratamiento", "propósito", "propósitos",
    "purpose", "purposes", "purposes of processing", "processing purpose",
  ],
  accessDenial: [
    "access denied", "request blocked", "your ip has been blocked",
    "your request has been blocked", "verify you are human", "complete the security check",
    "acceso denegado", "solicitud bloqueada", "tu dirección ip ha sido bloqueada",
    "confirma que eres una persona", "completa la comprobación de seguridad",
  ],
} as const;
