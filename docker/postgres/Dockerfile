# PostgreSQL 19 and pgvector candidate for the coordinated production upgrade.
FROM golang:1.27.4-alpine AS gosu-build
RUN apk add --no-cache git \
  && git clone --depth 1 --branch 1.19 https://github.com/tianon/gosu.git /gosu \
  && test "$(git -C /gosu rev-parse HEAD)" = 6456aaa0f3c854d199d0f037f068eb97515b7513 \
  && cd /gosu \
  && CGO_ENABLED=0 go build -trimpath -o /out/gosu .

FROM pgvector/pgvector:0.8.7-pg19-trixie
COPY --from=gosu-build /out/gosu /usr/local/bin/gosu
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y --no-install-recommends \
  && rm -rf /var/lib/apt/lists/* \
  && gosu nobody true
