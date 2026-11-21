# Runbook de egress de la auditoría privada

Este procedimiento comprueba la ruta operativa sin activar la auditoría ni
usar GitHub Actions. Se ejecuta como `root` en el VPS y usa un contenedor
efímero conectado a `development-security-egress`.

## 1. Comprobar la red y el firewall

```sh
scripts/create-development-security-egress-network.sh verify
scripts/configure-development-security-egress-firewall.sh verify
```

Ambos comandos deben terminar con `..._ready`. No se debe modificar UFW ni
reglas de otras interfaces.

## 2. Comprobar DNS y HTTPS

La prueba debe registrar únicamente la categoría y el código HTTP:

```sh
docker run --rm --network development-security-egress \
  curlimages/curl:8.11.1 \
  -sS -o /dev/null \
  -w 'egress_probe dns=resolved tcp=tls http=%{http_code} remote=%{remote_ip}\n' \
  https://grumphya.com/
```

El `remote` esperado es la dirección pública del proxy. No se deben copiar
cabeceras, cuerpos, tokens ni cookies a los logs. La imagen de prueba se
elimina al terminar.

## 3. Confirmar la ACL

La red permite una salida concreta, pero la ACL debe basarse en la IP que
observe Caddy. El candidato actual es:

```text
31.70.130.181/32
```

Grumphya debe confirmar esa IP con una petición real o una prueba de rechazo
autenticada. No se acepta `/24`, una subnet Docker ni `0.0.0.0/0`.

## 4. Activación posterior

No se activa `AUDIT_ENABLED=true` hasta disponer de:

- clave pública JWT y `kid` instalados en Grumphya;
- clave pública de atestación y su `kid`;
- ACL confirmada por Caddy;
- roles PostgreSQL y proceso de evidencias documentados;
- preflight de configuración y rutas autenticadas correcto.

Si falla cualquier punto, se mantiene `AUDIT_ENABLED=false` y el resultado se
clasifica como no disponible; no se fabrica un informe.
