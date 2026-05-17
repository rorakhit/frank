.PHONY: build test

build:
	mkdir -p bin
	go build -o bin/frank-etl ./cmd/etl
	go build -o bin/frank-scrape ./cmd/scrape
	go build -o bin/frank-server ./cmd/server
	go build -o bin/frank-insights ./cmd/insights

test:
	go test ./...
