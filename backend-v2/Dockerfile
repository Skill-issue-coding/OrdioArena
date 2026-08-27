# syntax=docker/dockerfile:1

FROM golang:1.27-alpine AS build
WORKDIR /src

# Dependencies change far less often than source, so they get their own layer.
# Editing a .go file then rebuilds without re-downloading the module cache.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# CGO_ENABLED=0 produces a static binary, which is why the runtime image needs
# no libc. -trimpath keeps absolute build paths out of panics and stack traces.
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/server ./cmd/server

FROM alpine:3.22

# The compose healthcheck runs wget, which alpine ships inside busybox. A
# distroless base would be smaller but has no HTTP client at all, so the
# healthcheck would have to move into the server binary as a subcommand.
RUN adduser -D -u 10001 ordio

COPY --from=build /out/server /usr/local/bin/server

USER ordio
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/server"]
