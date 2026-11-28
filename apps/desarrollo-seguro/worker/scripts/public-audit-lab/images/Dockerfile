ARG DS_LAB_RUN_ID
ARG DS_LAB_BROKER_BASE_IMAGE=desarrolloseguro-egress-broker:local
ARG DS_LAB_PRIVACY_EGRESS_BASE_IMAGE=desarrolloseguro-privacy-egress:local
ARG DS_LAB_PRIVACY_BROWSER_BASE_IMAGE=desarrolloseguro-privacy-browser:local

FROM ${DS_LAB_BROKER_BASE_IMAGE} AS public-audit-lab-broker
ARG DS_LAB_RUN_ID
LABEL com.desarrolloseguro.public-audit-lab.run=${DS_LAB_RUN_ID}
COPY --chown=node:node lab-egress-broker.mjs egress-adapters.mjs /workspace/apps/desarrollo-seguro/worker/scripts/public-audit-lab/
COPY --chown=node:node fixture.pem /run/public-audit-lab/fixture.pem
ENTRYPOINT ["node", "apps/desarrollo-seguro/worker/scripts/public-audit-lab/lab-egress-broker.mjs"]

FROM ${DS_LAB_PRIVACY_EGRESS_BASE_IMAGE} AS public-audit-lab-privacy-egress
ARG DS_LAB_RUN_ID
LABEL com.desarrolloseguro.public-audit-lab.run=${DS_LAB_RUN_ID}
COPY --chown=node:node lab-privacy-egress-entrypoint.mjs egress-adapters.mjs /workspace/apps/desarrollo-seguro/worker/scripts/public-audit-lab/
COPY --chown=node:node fixture.pem /run/public-audit-lab/fixture.pem
ENTRYPOINT ["node", "apps/desarrollo-seguro/worker/scripts/public-audit-lab/lab-privacy-egress-entrypoint.mjs"]

FROM ${DS_LAB_PRIVACY_BROWSER_BASE_IMAGE} AS public-audit-lab-privacy-browser
ARG DS_LAB_RUN_ID
LABEL com.desarrolloseguro.public-audit-lab.run=${DS_LAB_RUN_ID}
COPY --chown=pwuser:pwuser lab-privacy-browser-entrypoint.mjs /workspace/apps/desarrollo-seguro/worker/scripts/public-audit-lab/lab-privacy-browser-entrypoint.mjs
COPY --chown=pwuser:pwuser fixture.pem /run/public-audit-lab/fixture.pem
ENTRYPOINT ["node", "apps/desarrollo-seguro/worker/scripts/public-audit-lab/lab-privacy-browser-entrypoint.mjs"]
