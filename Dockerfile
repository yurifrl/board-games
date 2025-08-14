FROM golang:1.22 AS build

WORKDIR /app

COPY go.mod ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/server ./cmd/server && \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/cli ./cmd/cli

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/server /app/server
COPY --from=build /out/cli /app/cli
COPY data/inventory.yaml /app/data/inventory.yaml
COPY config.yaml /app/config.yaml
ENV INVENTORY_PATH=/app/data/inventory.yaml
EXPOSE 8080
USER nonroot
ENTRYPOINT ["/app/server", "--config", "/app/config.yaml"]


