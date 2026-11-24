/** Reviewed public sources and plain-language facts for known providers. */
export type PublicServiceProviderInfo = {
  displayName: string;
  serviceSummary: string;
  serviceSourceUrl: string;
  privacyPolicyUrl: string;
  reviewedAt: string;
};

export const PUBLIC_SERVICE_PROVIDER_INFO: Readonly<Record<string, PublicServiceProviderInfo>> = {
  "google-analytics": {
    displayName: "Google Analytics",
    serviceSummary: "Google explica que Analytics mide interacciones con una web mediante cookies o identificadores. Los datos pueden usarse para anuncios si quien administra la cuenta activa esas opciones.",
    serviceSourceUrl: "https://support.google.com/analytics/answer/6004245?hl=es",
    privacyPolicyUrl: "https://policies.google.com/privacy?hl=es",
    reviewedAt: "2026-11-24",
  },
  "google-ads-conversion-linker": {
    displayName: "Google Ads / Conversion Linker",
    serviceSummary: "Google documenta este servicio como una herramienta para medir resultados de campañas publicitarias. La actividad observada no demuestra qué datos concretos recibió.",
    serviceSourceUrl: "https://support.google.com/tagmanager/answer/7549390?hl=es",
    privacyPolicyUrl: "https://policies.google.com/privacy?hl=es",
    reviewedAt: "2026-11-24",
  },
  "meta-pixel": {
    displayName: "Meta Pixel",
    serviceSummary: "La documentación de Meta presenta Pixel como una herramienta para medir acciones en una web y ayudar a medir o mejorar campañas. La conexión observada no demuestra qué información recibió.",
    serviceSourceUrl: "https://www.facebook.com/business/tools/meta-pixel",
    privacyPolicyUrl: "https://www.facebook.com/privacy/policy/",
    reviewedAt: "2026-11-24",
  },
  "tiktok-pixel": {
    displayName: "TikTok Pixel",
    serviceSummary: "TikTok explica que sus cookies pueden relacionar eventos con personas que interactúan con contenido en TikTok, medir campañas y crear públicos de anuncios según la configuración.",
    serviceSourceUrl: "https://ads.tiktok.com/resources/help/article/how-to-use-cookies-with-tiktok-pixel",
    privacyPolicyUrl: "https://www.tiktok.com/legal/page/eea/privacy-policy/en",
    reviewedAt: "2026-11-24",
  },
  "linkedin-insight-tag": {
    displayName: "LinkedIn Insight Tag",
    serviceSummary: "LinkedIn presenta esta etiqueta como una herramienta para medir visitas y conversiones de campañas publicitarias.",
    serviceSourceUrl: "https://www.linkedin.com/help/lms/answer/a427660",
    privacyPolicyUrl: "https://www.linkedin.com/legal/privacy-policy",
    reviewedAt: "2026-11-24",
  },
  matomo: {
    displayName: "Matomo",
    serviceSummary: "Matomo describe su producto como una herramienta de analítica web. El nombre del producto no permite saber si se aloja en el propio dominio ni qué configuración usa.",
    serviceSourceUrl: "https://matomo.org/guide/",
    privacyPolicyUrl: "https://matomo.org/privacy-policy/",
    reviewedAt: "2026-11-24",
  },
  cookiebot: {
    displayName: "Cookiebot",
    serviceSummary: "Cookiebot documenta una plataforma para detectar cookies y gestionar avisos y preferencias de privacidad.",
    serviceSourceUrl: "https://support.cookiebot.com/",
    privacyPolicyUrl: "https://www.cookiebot.com/en/privacy-policy/",
    reviewedAt: "2026-11-24",
  },
  didomi: {
    displayName: "Didomi",
    serviceSummary: "Didomi documenta herramientas para mostrar avisos y guardar preferencias de consentimiento.",
    serviceSourceUrl: "https://developers.didomi.io/",
    privacyPolicyUrl: "https://privacy.didomi.io/",
    reviewedAt: "2026-11-24",
  },
  iubenda: {
    displayName: "iubenda",
    serviceSummary: "iubenda ofrece herramientas para publicar avisos y gestionar preferencias de privacidad.",
    serviceSourceUrl: "https://www.iubenda.com/en/help",
    privacyPolicyUrl: "https://www.iubenda.com/privacy-policy/",
    reviewedAt: "2026-11-24",
  },
  "one-trust-cookie-pro": {
    displayName: "OneTrust / CookiePro",
    serviceSummary: "OneTrust documenta herramientas para registrar preferencias de cookies y aplicar controles de consentimiento.",
    serviceSourceUrl: "https://docs.onetrust.com/",
    privacyPolicyUrl: "https://www.onetrust.com/privacy-notice/",
    reviewedAt: "2026-11-24",
  },
  usercentrics: {
    displayName: "Usercentrics",
    serviceSummary: "Usercentrics documenta una plataforma para mostrar opciones de privacidad y guardar las preferencias seleccionadas.",
    serviceSourceUrl: "https://usercentrics.com/docs/",
    privacyPolicyUrl: "https://usercentrics.com/privacy-policy/",
    reviewedAt: "2026-11-24",
  },
  "openai-api": {
    displayName: "OpenAI API",
    serviceSummary: "OpenAI declara que los datos enviados a la API no se usan para entrenar modelos salvo que el cliente lo autorice. También indica que, por defecto, los registros de control de abuso pueden conservar prompts y respuestas hasta 30 días.",
    serviceSourceUrl: "https://developers.openai.com/api/docs/guides/your-data",
    privacyPolicyUrl: "https://openai.com/policies/privacy-policy/",
    reviewedAt: "2026-11-24",
  },
  ionos: {
    displayName: "IONOS",
    serviceSummary: "IONOS explica que SMTP envía correo y documenta su servidor de salida con cifrado SSL/TLS en el puerto 465. Esa página técnica no concreta cuánto tiempo conserva los mensajes enviados.",
    serviceSourceUrl: "https://www.ionos.com/help/index.php?id=2490",
    privacyPolicyUrl: "https://www.ionos.com/terms-gtc/privacy-policy/",
    reviewedAt: "2026-11-24",
  },
};

export const PUBLIC_SERVICE_LEGAL_RULES = {
  "eea-nonessential-cookie-before-choice": {
    instrument: "Directiva 2002/58/CE, interpretada por el Tribunal de Justicia de la Unión Europea",
    article: "artículo 5, apartado 3; asunto C-673/17, apartados 62–63",
    sourceUrl: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62017CJ0673",
    summary: "Se detectó una cookie de medición o publicidad antes de que la persona pudiera elegir. La norma europea exige informar y obtener una decisión válida para acceder a información del dispositivo, salvo que sea estrictamente necesaria para el servicio solicitado.",
  },
} as const;

export type PublicServiceLegalRuleId = keyof typeof PUBLIC_SERVICE_LEGAL_RULES;
