# Catálogo inicial de conocimiento de privacidad v2

> **Estado:** implementado y verificado en el PR 34; pendiente de integrar.
> **Fecha de revisión de fuentes:** 23 de noviembre de 2026.

## Objetivo

Este documento conserva el alcance histórico de `privacy-knowledge-v2`.
Las reglas de mapas de calor añadidas después se especifican en
[`privacy-knowledge-catalog-v3-heatmaps.md`](privacy-knowledge-catalog-v3-heatmaps.md).

Ampliar el catálogo local de Solistos para identificar, con evidencia técnica
reproducible, un conjunto inicial de servicios de analítica, publicidad,
publicidad social y gestión del consentimiento en páginas de inicio observadas
desde España/EEE. El catálogo describe señales observables; no aprueba un
producto, no certifica su privacidad o seguridad y no interpreta el cumplimiento
legal.

La aprobación de incluir Matomo se refiere exclusivamente a reglas de
identificación locales en el auditor. **No se instalará ni utilizará Matomo como
analítica de Desarrollo Seguro.** No se añade un SDK, dependencia, script,
cuenta, cookie, endpoint ni comunicación directa de la aplicación, worker o
infraestructura de Desarrollo Seguro con Matomo. La página evaluada aún puede
iniciar solicitudes desde el navegador aislado según la política de egreso ya
aprobada. Las reglas se compilan dentro del worker y no consultan una fuente
externa durante un análisis.

## Alcance aprobado

| Grupo | Proveedores/productos del conjunto inicial |
| --- | --- |
| Analítica y medición publicitaria | Google Analytics (reglas actuales), Google Ads / Conversion Linker y Matomo Cloud |
| Publicidad y píxeles sociales | Meta Pixel, TikTok Pixel y LinkedIn Insight Tag |
| Gestión del consentimiento (CMP) | Cookiebot, Didomi, iubenda, OneTrust/CookiePro y Usercentrics |

Esta lista es un punto de partida acotado, no una afirmación de cuota de mercado
ni una cobertura completa. El conjunto se priorizó por relevancia del entorno
web España/EEE y por señales documentadas por proveedor, no por una comparación
entre dominios.

Microsoft Clarity y UET quedan fuera de esta versión hasta que se aclare una
fuente reutilizable compatible con el uso comercial del catálogo. Los demás
proveedores quedan sin atribución confirmada y no se penalizan por coincidencias
no catalogadas.

## Modalidades y límites de Matomo

- Las reglas reconocen el destino de Matomo Cloud cuando el host observado lo
  atribuye. El catálogo no inspecciona rutas, nombres de archivo ni parámetros.
- No se intenta identificar genéricamente Matomo On-Premise: cada instalación
  puede usar un dominio, proxy o endpoint distinto. Sin un host localmente
  catalogado y corroboración inequívoca, queda sin atribución; no se inspeccionan
  rutas para detectarla.
- La auditoría del navegador solo puede describir solicitudes, cookies y
  almacenamiento observados en el cliente. No puede probar a qué servicios
  reenvía datos el servidor On-Premise, verificar contratos ni confirmar el uso
  posterior de datos. Ninguna marca recibe una valoración positiva por sus
  promesas comerciales.
- Si Matomo Cloud aparece como destino externo, se registra el dominio externo
  observado y la actividad del navegador se evalúa con los criterios generales
  ya publicados. La marca por sí sola no produce penalización.
- La aplicación y los servicios de Desarrollo Seguro no instalan Matomo ni
  crean cookies de Matomo. La visita aislada puede enviar solicitudes y cookies
  a los destinos que la página evaluada invoque por sí misma, dentro del
  presupuesto y la política de egreso ya aprobados. Este catálogo no añade
  destinos ni solicitudes. Solo se conserva la evidencia pública permitida
  (nombres, dominios y proveedor); rutas y valores permanecen efímeros.

## Fuentes y procedencia

Las reglas son datos locales versionados y revisados manualmente. Cada regla
conserva URL de fuente, fecha de revisión, estado de licencia, confianza y
falsos positivos conocidos. Se anotan únicamente identificadores técnicos y
metadatos factuales expresados con texto propio; no se copian bloques de
documentación, listas de terceros con licencia no comercial, valores de
almacenamiento ni muestras de usuarios. Si una página no declara una licencia
de reutilización, la entrada debe decirlo de forma expresa; no debe etiquetarse
como CC-BY por inferencia.

| Proveedor/grupo | Fuentes primarias revisadas |
| --- | --- |
| Google Analytics y Google Ads | [Google Consent Mode](https://developers.google.com/tag-platform/security/concepts/consent-mode); [Conversion Linker](https://support.google.com/tagmanager/answer/7549390?hl=en); [política de contenido de Google Developers](https://developers.google.com/terms/site-policies) |
| Meta Pixel | [Documentación de Meta Pixel](https://developers.facebook.com/documentation/meta-pixel) |
| TikTok Pixel | [Cookies de TikTok Pixel](https://ads.tiktok.com/help/article/using-cookies-with-tiktok-pixel); [descripción de TikTok Pixel](https://ads.tiktok.com/resources/help/article/tiktok-pixel) |
| LinkedIn Insight Tag | [Documentación oficial de Insight Tag](https://www.business.linkedin.com/advertise/ads/insight-tag) |
| Matomo | [Cookies del tracker](https://matomo.org/faq/general/faq_146/); [Cloud y On-Premise](https://matomo.org/faq/how-to-install/what-is-the-matomo-tracker-proxy/); [descarga y modalidades](https://matomo.org/download/) |
| Cookiebot | [Señales y cookie de consentimiento](https://support.cookiebot.com/hc/en-us/articles/5007079527580-Understanding-the-scan-report) |
| Didomi | [Cookies y almacenamiento](https://developers.didomi.io/cmp/web-sdk/consent-notice/cookies); [API del SDK](https://developers.didomi.io/cmp/web-sdk/reference/api) |
| iubenda | [Implementación del banner](https://www.iubenda.com/en/help/1177-cookie-solution-getting-started/) |
| OneTrust/CookiePro | [Cookies de OneTrust](https://docs.onetrust.com/en/consent--preferences/cookie-consent/managing-cookie-scripts-cookie-blocking-and-technical-implementation/onetrust-cookies) |
| Usercentrics | [Script de Browser UI](https://usercentrics.com/docs/browser-ui-implementation); [API de controles](https://usercentrics.com/docs/control-functionality) |
| Relevancia CMP para EEE | [Lista vigente de CMP certificados de Google para editores](https://support.google.com/adsense/answer/13554116?hl=en) |

Google Developers indica que gran parte de su documentación usa CC BY 4.0,
salvo excepciones explícitas. Para las demás fuentes, se registra el aviso de
licencia que aparezca en cada página y solo se extraen identificadores factuales
revisados; no se incorpora texto, código, marcas gráficas ni datasets. La lista
de CMP de Google justifica relevancia en el contexto de publicación EEE, pero no
es una medida de popularidad ni prueba conformidad legal.

## Reglas de evaluación

- Versión nueva del conjunto de reglas: `privacy-knowledge-v2`. Las reglas v1
  no se reescriben ni se aplican a informes históricos.
- Cada regla debe declarar proveedor, producto, modalidad (Cloud/On-Premise o
  genérica cuando aplique), tipo de señal, patrón literal, propósito técnico,
  hostnames corroborantes, fuente/licencia, confianza y falsos positivos.
- Solo se confirman reglas de confianza alta que satisfagan la atribución
  específica de la regla. Los conflictos, los nombres ambiguos y las señales
  aisladas se conservan como desconocidos y no reducen la nota.
- La clasificación `consent` permite reconocer CMP y sus cookies de preferencia,
  pero su mera presencia no se cuenta como seguimiento, exceso ni infracción.
  Los criterios de paridad, persistencia y eficacia del rechazo se mantienen
  evaluados por el comportamiento visible del sitio.
- Una señal confirmada de analítica/publicidad antes de elegir se evalúa con el
  criterio y peso ya aprobados de `privacy-v1`; no se modifica el peso, umbral,
  nota, certificación ni sello por esta ampliación.
- El informe puede enumerar proveedores, nombres de cookies y dominios
  observados. No mostrará URL/ruta de script, query, fragmento ni valores de
  cookies o almacenamiento.

## Criterios de aceptación

1. La lista implementada coincide con el alcance aprobado y cada regla tiene
   metadatos de fuente, licencia, revisión y confianza completos.
2. Todo el catálogo se carga desde código local fijado a una versión; una
   auditoría no realiza consultas remotas para clasificar señales.
3. La detección usa exclusivamente señales observadas en el flujo del navegador;
   no se infiere que una librería mencionada en HTML se haya ejecutado.
4. El matcher normaliza hostnames. No captura ni compara rutas de solicitudes;
   estas permanecen fuera de resultados, excepciones y logs.
5. Las reglas de CMP pueden enumerar la plataforma, pero cookies CMP y llamadas
   propias de consentimiento no producen por sí solas penalización de
   seguimiento o exceso.
6. Un resultado desconocido, una colisión de reglas o una fuente sin confianza
   suficiente no produce penalización. Una coincidencia de alta confianza
   requiere las señales corroborantes definidas para ese proveedor.
7. Una observación sintética Matomo Cloud puede clasificar el host de servicio
   externo; instalaciones Matomo On-Premise con host propio, proxy o endpoint
   renombrado quedan `unknown`.
8. Ningún test de catálogo contacta proveedores reales. Los fixtures son
   sintéticos y conservan el aislamiento aprobado para CI.
9. Los informes históricos se mantienen inmutables y conservan su JSON y nota;
   los informes nuevos se calculan con las reglas v2, sin alterar la versión de
   la política ni los pesos publicados.
10. Las pruebas verifican que la ampliación no añade cookies ni solicitudes
    externas al sitio, el worker, la API o la web de Desarrollo Seguro.
