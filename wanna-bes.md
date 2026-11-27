# Ideas aplazadas

Añade aquí solo cambios o features que el usuario haya decidido expresamente posponer. Al implementar una idea, elimínala de esta lista y documenta el resultado para personas en `doc/`.

## Integración simplificada de certificación por cliente

### Objetivo

Reducir la complejidad de integrar un cliente para su certificación sin relajar
las garantías de seguridad, privacidad, trazabilidad ni el comportamiento
fail-closed. Esta planificación no modifica el contrato actual de Grumphya;
propone una evolución compatible para clientes futuros.

### Problema actual

La integración actual coordina dos repositorios y varias superficies operativas:

- JWT EdDSA, `kid`, claves públicas y atestación de releases.
- ACL de red basada en la IP observada por el proxy.
- Siete rutas de auditoría y varios scopes.
- Canal TLS de escritura y roles PostgreSQL separados.
- Validación de digest, expiración, cardinalidad y firma.
- Preflights, smoke tests y comprobaciones operativas en el VPS.

El diseño es seguro, pero demasiadas decisiones manuales hacen probable que
fallen las claves, los `kid`, las ACL, las rutas o los permisos de base de
datos.

### Solución propuesta

#### 1. Adaptador instalable

Ofrecer un adaptador versionado, distribuido como contenedor o servicio, que el
cliente instale junto a su aplicación. El adaptador tendrá healthcheck y solo
salida HTTPS hacia Desarrollo Seguro.

No tendrá acceso a PostgreSQL, al socket Docker, a secretos de la aplicación ni
a redes Docker compartidas.

#### 2. Envolvente única de evidencias

Sustituir las siete lecturas coordinadas por una única envolvente versionada:

```text
clientId
domain
environment
deploymentDigest
observedAt
validUntil
evidence[]
attestation
```

Cada evidencia contendrá únicamente datos acotados:

```text
criterionId
category
status
value
reasonCode
source
```

No se enviarán cookies crudas, HTML, capturas, usuarios, tokens, URLs
privadas ni datos de bases de datos.

#### 3. Inscripción automática

Incorporar un flujo equivalente a:

```sh
ds cert enroll --domain grumphya.com --environment production
```

El flujo generará la identidad del cliente, una credencial efímera de
instalación, la configuración del adaptador, la política de evidencias y los
datos del gateway. La clave privada permanecerá en el cliente; Desarrollo
Seguro conservará la clave pública y la revocación.

#### 4. Gateway central

El gateway de Desarrollo Seguro validará identidad, dominio, entorno, firma,
frescura, replay, digest, esquema, cardinalidad y revocación. Después
normalizará las evidencias y generará el informe.

Grumphya podrá consumir un informe certificado firmado por Desarrollo Seguro,
sin tener que exponer siete rutas ni coordinar toda la criptografía con cada
cliente.

#### 5. Activación controlada

La activación tendrá dos pasos:

1. Preflight automático.
2. Activación explícita.

Si falla una comprobación, la certificación permanece en `pending`; no se
activa la auditoría ni se emite un sello.

#### 6. Migración compatible con Grumphya

1. Mantener el contrato D actual mientras se construye el nuevo flujo.
2. Implementar gateway y adaptador.
3. Añadir un puente hacia el modelo actual.
4. Probar Grumphya con la nueva envolvente.
5. Retirar gradualmente las siete lecturas y la coordinación manual.

### Fases de implementación

1. **Contrato y decisión:** congelar el esquema `certification-adapter-v1`,
   decidir push firmado frente a pull y documentar los límites de confianza.
2. **Enrolamiento:** crear el flujo `cert enroll`, identidad por cliente,
   rotación y revocación.
3. **Adaptador:** construir el servicio aislado, sus healthchecks y su política
   de salida.
4. **Gateway:** validar y almacenar la envolvente, con códigos de diagnóstico
   seguros y correlación por `clientId`/`requestId`.
5. **Puente de Grumphya:** convertir la envolvente nueva al modelo actual sin
   activar aún la auditoría privada.
6. **Gates:** añadir preflight, pruebas de esquema, firma, expiración, replay,
   revocación, aislamiento y smoke de certificación.
7. **Piloto y documentación:** probar primero con Grumphya y publicar una guía
   de instalación, rotación, revocación y rollback.

### Impacto estimado

| Área | Integración actual | Integración propuesta |
| --- | --- | --- |
| Repositorios | Dos repositorios coordinados | Un adaptador y un contrato estable |
| Evidencias | Siete rutas y scopes | Una envolvente tipada |
| Credenciales | JWT, varios `kid`, atestación y ACL manual | Identidad por cliente gestionada centralmente |
| Red | Descubrir la IP vista por Caddy | Una salida HTTPS al gateway |
| Base de datos | Roles y canal de ingesta en el cliente | Sin acceso del adaptador a la base |
| Diagnóstico | Fallos distribuidos | Etapa, código seguro y `requestId` |
| Activación | Varias configuraciones manuales | Preflight y activación explícita |
| Revocación | Coordinación entre sistemas | Revocación central por cliente |

Como estimación inicial, el flujo actual requiere aproximadamente 10–20 pasos
operativos y entre varias horas y varios días de coordinación. Con la plataforma
preparada, un cliente nuevo debería requerir 4–6 pasos y unos 30–90 minutos de
trabajo operativo. La primera construcción del gateway, adaptador y puente
requerirá varios días; las cifras son orientativas y deberán medirse con el
piloto.

### Garantías que se mantienen

- Evidencias mínimas, agregadas y allowlisted.
- Firma, expiración, protección contra replay y revocación.
- Separación de entornos y redes aisladas.
- Estado `unknown` cuando no exista evidencia.
- Certificación bloqueada si falta cobertura crítica.
- Ningún uso de fixtures como evidencia de producción.
- Sin cookies de terceros ni datos de usuarios en el canal de certificación.

## Edición y actualización de Actualidad

La página actual es estática y sus artículos se añaden manualmente. La
ingestión automática de noticias, un panel editorial y la moderación continúan
aplazados; requieren definir fuentes, derechos de uso y responsabilidades de
revisión.
