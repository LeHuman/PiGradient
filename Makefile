APP=pigradient
VERSION ?= 1.0.0

.PHONY: all frontend build build-pi build-armhf build-amd64 deb deb-armhf deb-amd64 clean test

all: build

frontend:
	npm run build
	mkdir -p dashboard/dist
	rm -rf dashboard/dist/*
	cp -r dist/* dashboard/dist/

build: frontend
	go mod tidy
	go build -ldflags="-s -w -X main.Version=$(VERSION)" -o bin/$(APP) ./server/cmd/pigradient

build-pi: frontend
	go mod tidy
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="-s -w -X main.Version=$(VERSION)" -o bin/$(APP)-arm64 ./server/cmd/pigradient

build-armhf: frontend
	go mod tidy
	CGO_ENABLED=0 GOOS=linux GOARCH=arm GOARM=7 go build -ldflags="-s -w -X main.Version=$(VERSION)" -o bin/$(APP)-armhf ./server/cmd/pigradient

build-amd64: frontend
	go mod tidy
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w -X main.Version=$(VERSION)" -o bin/$(APP)-amd64 ./server/cmd/pigradient

define package_deb
	set -e; \
	pkgroot=`mktemp -d`; \
	trap 'rm -rf "$$pkgroot"' EXIT; \
	mkdir -p bin "$$pkgroot/DEBIAN" "$$pkgroot/usr/local/bin" "$$pkgroot/etc/pigradient" "$$pkgroot/etc/systemd/system"; \
	cp bin/$(APP)-$(1) "$$pkgroot/usr/local/bin/$(APP)"; \
	cp packaging/config.yaml "$$pkgroot/etc/pigradient/config.yaml"; \
	cp packaging/pigradient.service "$$pkgroot/etc/systemd/system/pigradient.service"; \
	sed -e "s/{{VERSION}}/$(VERSION)/g" -e "s/{{ARCH}}/$(1)/g" packaging/debian/DEBIAN/control > "$$pkgroot/DEBIAN/control"; \
	cp packaging/debian/DEBIAN/conffiles "$$pkgroot/DEBIAN/conffiles"; \
	cp packaging/debian/DEBIAN/postinst "$$pkgroot/DEBIAN/postinst"; \
	cp packaging/debian/DEBIAN/prerm "$$pkgroot/DEBIAN/prerm"; \
	chmod 644 "$$pkgroot/etc/pigradient/config.yaml" "$$pkgroot/etc/systemd/system/pigradient.service" "$$pkgroot/DEBIAN/control" "$$pkgroot/DEBIAN/conffiles"; \
	chmod 755 "$$pkgroot/usr/local/bin/$(APP)" "$$pkgroot/DEBIAN/postinst" "$$pkgroot/DEBIAN/prerm"; \
	dpkg-deb --root-owner-group --build "$$pkgroot" bin/$(APP)_$(VERSION)_$(1).deb
endef

deb: build-pi
	$(call package_deb,arm64)

deb-armhf: build-armhf
	$(call package_deb,armhf)

deb-amd64: build-amd64
	$(call package_deb,amd64)

test:
	go test -v ./server/...

clean:
	rm -rf bin/ pkg/ dist/ dist-deb/ dashboard/dist/
