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
	rm -rf pkg/deb-$(1)
	mkdir -p bin pkg/deb-$(1)/DEBIAN pkg/deb-$(1)/usr/local/bin pkg/deb-$(1)/etc/pigradient pkg/deb-$(1)/etc/systemd/system pkg/deb-$(1)/var/log/pigradient pkg/deb-$(1)/mnt/usb/pigradient
	cp bin/$(APP)-$(1) pkg/deb-$(1)/usr/local/bin/$(APP)
	cp packaging/config.yaml pkg/deb-$(1)/etc/pigradient/config.yaml
	cp packaging/pigradient.service pkg/deb-$(1)/etc/systemd/system/pigradient.service
	sed -e "s/{{VERSION}}/$(VERSION)/g" -e "s/{{ARCH}}/$(1)/g" packaging/debian/DEBIAN/control > pkg/deb-$(1)/DEBIAN/control
	cp packaging/debian/DEBIAN/conffiles pkg/deb-$(1)/DEBIAN/conffiles
	cp packaging/debian/DEBIAN/postinst pkg/deb-$(1)/DEBIAN/postinst
	cp packaging/debian/DEBIAN/prerm pkg/deb-$(1)/DEBIAN/prerm
	chmod 644 pkg/deb-$(1)/etc/pigradient/config.yaml pkg/deb-$(1)/etc/systemd/system/pigradient.service pkg/deb-$(1)/DEBIAN/control pkg/deb-$(1)/DEBIAN/conffiles
	chmod 755 pkg/deb-$(1)/usr/local/bin/$(APP) pkg/deb-$(1)/DEBIAN/postinst pkg/deb-$(1)/DEBIAN/prerm
	dpkg-deb --root-owner-group --build pkg/deb-$(1) bin/$(APP)_$(VERSION)_$(1).deb
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
