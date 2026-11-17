# PiGradient Setup & Packaging Guide

## 1. Prerequisites
- **Frontend / Dev Preview**: Node.js `22+` and `npm`
- **Production Binary & `.deb` Packaging**: Go `1.26+` and `dpkg-deb` (on Linux/Debian/Ubuntu, or CI via GitHub Actions)
- **Hardware (Target Runtime)**: Raspberry Pi (64-bit `arm64` or 32-bit `armhf` Raspberry Pi OS) on the same LAN as an AirGradient ONE monitor running firmware `v3.0.10+` (`v3.1.4+` recommended for EPA/SLR corrections).

---

## 2. Local Development Setup

```bash
npm install
npm run dev
```

- `npm run dev` starts the Vite dev server on `http://localhost:3000` and proxies `/api/*` (REST + SSE) to the Go daemon.
- Run the Go API alongside it:
  ```bash
  go run ./server/cmd/pigradient
  ```
  The daemon listens on `http://localhost:8080` (simulation does not exist in the stack — it ingests only from a configured monitor).
- To connect to a real monitor on your LAN during local dev, either start with:
  ```bash
  go run ./server/cmd/pigradient -device-url http://<monitor-ip-or-mdns>
  ```
  or configure the URL in the UI under **Device Controls → Connectivity**.
- Verify build & TypeScript checks:
  ```bash
  npm run lint
  npm run build
  make test   # Go unit tests (requires Go 1.26+)
  ```

---

## 3. Building Standalone Binaries & `.deb` Packages

The Go daemon embeds the compiled Vite dashboard (`dashboard/dist/*` via `dashboard/embed.go`), so frontend assets are always built and synced before `go build`.

```bash
# Run Go unit tests
make test

# Build Raspberry Pi ARM64 binary (bin/pigradient-arm64)
make build-pi

# Build installable .deb packages (artifacts written to bin/)
make deb          # ARM64 (Raspberry Pi 3/4/5 64-bit OS)
make deb-armhf    # ARMv7 (32-bit Raspberry Pi OS)
make deb-amd64    # x86_64 Linux hosts
```

Pass `VERSION=1.2.3` (e.g. `make deb VERSION=1.2.3`) to set both the Debian package version and `main.Version`.

---

## 4. Installing & Configuring on Raspberry Pi

1. Copy and install the `.deb` package:
   ```bash
   scp bin/pigradient_1.0.0_arm64.deb pi@raspberrypi.local:~
   sudo dpkg -i ~/pigradient_1.0.0_arm64.deb
   ```
   On installation, `DEBIAN/postinst`:
   - Creates the `pigradient` system user/group.
   - Leaves `/etc/pigradient` root-owned (dir `755`, `config.yaml` `644`) — the daemon only needs read access.
   - Does **not** create `/mnt/usb` or `/var/log/pigradient` (the storage drive may be unmounted or FAT at install time, which would abort `dpkg -i`) — set ownership up manually (step 3).
   - Registers and starts `pigradient.service` via `systemd`; the unit adds `RequiresMountsFor=/mnt/usb` (no silent fallback writes to the microSD when the drive is unmounted) and `time-sync.target` ordering (no bogus monthly partitions from a fake-hwclock boot).
   - `DEBIAN/conffiles` ensures future `.deb` upgrades preserve your `/etc/pigradient/config.yaml`.

2. Configure your AirGradient monitor URL:
   - **Option A (Web UI)**: Open `http://<raspberry-pi-ip>:8080`, click the connection indicator in the top-right (or **Device Controls → Connectivity**), enter `http://airgradient_<serial>.local` or its static LAN IP, and click **Save & Connect**. Runtime overrides persist in `<storage_directory>/runtime.json`.
   - **Option B (YAML Config)**: Edit `/etc/pigradient/config.yaml`:
     ```yaml
     target_device_url: "http://airgradient_<serial>.local"
     poll_interval_seconds: 1
     listen_address: ":8080"
     storage_directory: "/mnt/usb/pigradient"
     base_path: "" # set to "/pigradient" to also serve the dashboard at http://<host>:8080/pigradient/ (root keeps working either way)
     ```
     Then restart the daemon:
     ```bash
     sudo systemctl restart pigradient
     sudo journalctl -u pigradient -f
     ```

   - **Multi-service Pi**: the recommended production pattern is **Caddy** (or nginx) fronting several services and routing `/pigradient/*` to the daemon — set `base_path: "/pigradient"` and keep the Go daemon on `:8080`.

3. *(Optional)* Recommended USB flash storage mount for `/mnt/usb/pigradient`:
   - Mount an ext4 USB drive at `/mnt/usb` (e.g. via `/etc/fstab` with `defaults,noatime,nofail`) and ensure `sudo chown -R pigradient:pigradient /mnt/usb/pigradient`.
   - **Cloud sync agents**: sync `/mnt/usb/pigradient` **one-way (send-only)** and exclude `*.db-wal`, `*.db-shm`, `*.db-journal`, and `*.tmp*` — the daemon checkpoints WAL every 15 min so `.db` files are stable between checkpoints, but the sidecars must never be synced, and one-way sync prevents the agent overwriting an open database.

---

## 5. Automated CI/CD Pipeline (`.github/workflows/build-deb.yml`)

Triggered on pushes/PRs to `main`, version tags `v*`, or manual `workflow_dispatch`:
1. **Frontend (`Node 22`)**: Installs dependencies, runs `npm run lint` (`tsc --noEmit`), builds Vite assets (`npm run build`), and syncs `dist/*` -> `dashboard/dist/`.
2. **Backend (`Go 1.27`)**: Runs `go mod tidy`, executes `go test -v ./server/...`, and cross-compiles static `CGO_ENABLED=0` binaries for `arm64`, `armhf` (`GOARM=7`), and `amd64`.
3. **Debian Packaging**:
   - Normalizes Debian-compatible `pkg_version` (`X.Y.Z` for `v*` tags; `1.0.0-snapshot.<run>` for branches/PRs).
   - Stages `/usr/local/bin/pigradient`, `/etc/pigradient/config.yaml`, `/etc/systemd/system/pigradient.service`, `DEBIAN/control`, `DEBIAN/conffiles`, `DEBIAN/postinst`, and `DEBIAN/prerm` with explicit permissions (`0755` / `0644`) and `--root-owner-group`.
   - Verifies the `.deb` archive with `dpkg-deb --info` and `dpkg-deb --contents`.
   - Uploads `.deb` artifacts for all 3 architectures and attaches them to GitHub Releases on `v*` tags.
