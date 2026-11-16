package collector

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"pigradient/server/config"
	"pigradient/server/logger"
)

const maxMeasureResponseBytes = 1 << 20 // 1 MiB cap on /measures/current payload

const (
	minSaneEpoch         = int64(1735689600) // 2025-01-01 00:00:00 UTC; older "now" implies an unsynced clock
	statusNotifyInterval = 30 * time.Second  // re-ping UI while the collector stays offline
)

type Collector struct {
	target      *config.TargetStore
	client      *http.Client
	isPolling   atomic.Bool
	consecFails atomic.Int32
	lastSuccess atomic.Int64
	latencyMs   atomic.Int64
	lastErrMu   sync.RWMutex
	lastErr     string
	outChan     chan<- SensorRecord
	wakeCh      chan struct{}
	subscribers []chan SensorRecord
	subMu       sync.RWMutex
	deviceInfo  DeviceInfo
	infoMu      sync.RWMutex

	statusNotify     chan struct{} // cap-1 ping broadcast on collector status transitions
	lastStatusNotify atomic.Int64  // unix seconds of last StatusChangeChan send (rate limit)
	badClockActive   atomic.Bool   // set while local clock is behind minSaneEpoch
	badClockLastLog  atomic.Int64  // unix seconds of last bad-clock Error log (rate limit)
}

func NewCollector(target *config.TargetStore, outChan chan<- SensorRecord) *Collector {
	return &Collector{
		target: target,
		client: &http.Client{
			Timeout: 1800 * time.Millisecond,
			Transport: &http.Transport{
				MaxIdleConnsPerHost: 2,
				IdleConnTimeout:     30 * time.Second,
				DisableKeepAlives:   false,
			},
		},
		outChan: outChan,
		wakeCh:  make(chan struct{}, 1),

		statusNotify: make(chan struct{}, 1),
	}
}

// StatusChangeChan returns a cap-1 channel pinged whenever the collector crosses
// an online<->offline boundary, plus a re-ping every ~30s while still offline.
// Consumers must broadcast their current snapshot on receipt so UIs never show
// frozen KPIs after a device stops responding.
func (c *Collector) StatusChangeChan() <-chan struct{} {
	return c.statusNotify
}

func (c *Collector) notifyStatusChange() {
	c.lastStatusNotify.Store(time.Now().UTC().Unix())
	select {
	case c.statusNotify <- struct{}{}:
	default:
	}
}

// TriggerImmediatePoll wakes a sleeping/backed-off collector loop so URL or cadence changes take effect immediately.
func (c *Collector) TriggerImmediatePoll() {
	select {
	case c.wakeCh <- struct{}{}:
	default:
	}
}

func (c *Collector) Subscribe() <-chan SensorRecord {
	c.subMu.Lock()
	defer c.subMu.Unlock()
	ch := make(chan SensorRecord, 50)
	c.subscribers = append(c.subscribers, ch)
	return ch
}

func (c *Collector) LastSeenSecondsAgo() int64 {
	last := c.lastSuccess.Load()
	if last == 0 {
		return -1
	}
	ago := time.Now().UTC().Unix() - last
	if ago < 0 {
		return 0
	}
	return ago
}

func (c *Collector) Status() string {
	fails := c.consecFails.Load()
	if fails == 0 {
		if c.lastSuccess.Load() == 0 {
			return "degraded"
		}
		return "online"
	} else if fails < 10 {
		return "degraded"
	}
	return "offline"
}

func (c *Collector) ConsecutiveFailures() int32 {
	return c.consecFails.Load()
}

func (c *Collector) LatencyMs() int64 {
	return c.latencyMs.Load()
}

func (c *Collector) LastError() string {
	c.lastErrMu.RLock()
	defer c.lastErrMu.RUnlock()
	return c.lastErr
}

func (c *Collector) setLastError(msg string) {
	c.lastErrMu.Lock()
	c.lastErr = msg
	c.lastErrMu.Unlock()
}

func (c *Collector) GetDeviceInfo() DeviceInfo {
	c.infoMu.RLock()
	defer c.infoMu.RUnlock()
	return c.deviceInfo
}

func (c *Collector) Start(ctx context.Context) {
	timer := time.NewTimer(0)
	defer timer.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-c.wakeCh:
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
		case <-timer.C:
		}

		var nextWait time.Duration
		if !c.isPolling.CompareAndSwap(false, true) {
			nextWait = c.target.PollInterval()
		} else {
			prevFails := c.consecFails.Load()
			success, errMsg := c.poll(ctx)
			c.isPolling.Store(false)

			nominal := c.target.PollInterval()
			if success {
				c.consecFails.Store(0)
				c.lastSuccess.Store(time.Now().UTC().Unix())
				c.setLastError("")
				if prevFails >= 3 {
					logger.Info("Collector", "Monitor connection restored (%s)", c.target.DeviceURL())
				}
				if prevFails >= 1 {
					// Off/line -> online transition: ping UIs so stale snapshots refresh immediately.
					c.notifyStatusChange()
				}
				// Align successful polls to nominal wall-clock boundaries so the 1 Hz
				// cadence covers every unix second instead of drifting by HTTP RTT.
				nextWait = alignedWait(nominal)
			} else {
				c.setLastError(errMsg)
				fails := c.consecFails.Add(1)
				if fails == 1 {
					logger.Warn("Collector", "Poll failed (%s): %s", c.target.DeviceURL(), errMsg)
					// Online -> degraded/offline transition: ping UIs immediately.
					c.notifyStatusChange()
				} else if fails == 3 {
					logger.Warn("Collector", "Transitioned to DEGRADED backoff state (5s cadence): %s", errMsg)
				} else if fails == 10 {
					logger.Error("Collector", "Transitioned to OFFLINE backoff state (15s cadence): %s", errMsg)
					// Degraded -> offline transition: ping UIs immediately
					// instead of waiting for the next 30s re-assert.
					c.notifyStatusChange()
				}

				if fails >= 10 {
					nextWait = 15 * time.Second
				} else if fails >= 3 {
					nextWait = 5 * time.Second
				} else {
					nextWait = nominal
				}
			}
		}

		// While offline, re-assert the status change at most every 30s so freshly
		// connected SSE clients and recovering UIs also learn about the outage.
		if c.consecFails.Load() > 0 && time.Since(time.Unix(c.lastStatusNotify.Load(), 0)) >= statusNotifyInterval {
			c.notifyStatusChange()
		}

		timer.Reset(nextWait)
	}
}

// alignedWait returns the duration until the next nominal wall-clock boundary
// (now.Truncate(nominal)+nominal), so poll timestamps stay glued to whole
// intervals instead of absorbing the HTTP round-trip each cycle.
func alignedWait(nominal time.Duration) time.Duration {
	if nominal <= 0 {
		return time.Second
	}
	now := time.Now()
	wait := now.Truncate(nominal).Add(nominal).Sub(now)
	if wait < 20*time.Millisecond {
		// RTT overran the boundary; fall back to the plain nominal cadence.
		return nominal
	}
	return wait
}

func sanitizeFloat(v, fallback, minVal, maxVal float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return fallback
	}
	if v < minVal {
		return minVal
	}
	if v > maxVal {
		return maxVal
	}
	return v
}

func clampInt(v, minVal, maxVal int) int {
	if v < minVal {
		return minVal
	}
	if v > maxVal {
		return maxVal
	}
	return v
}

func (c *Collector) poll(ctx context.Context) (bool, string) {
	start := time.Now()
	url := c.target.DeviceURL() + "/measures/current"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false, err.Error()
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.client.Do(req)
	c.latencyMs.Store(time.Since(start).Milliseconds())
	if err != nil {
		return false, err.Error()
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		snippetBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		snippet := strings.TrimSpace(string(snippetBytes))
		if snippet != "" {
			return false, fmt.Sprintf("HTTP %d: %s", resp.StatusCode, snippet)
		}
		return false, fmt.Sprintf("HTTP %d", resp.StatusCode)
	}

	var raw AirGradientRaw
	dec := json.NewDecoder(io.LimitReader(resp.Body, maxMeasureResponseBytes))
	if err := dec.Decode(&raw); err != nil {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return false, "JSON decode error: " + err.Error()
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))

	// Reject empty/uninitialized warmup payloads so SQLite isn't polluted with zeroed frames
	if raw.RCO2 <= 0 && raw.PM02 <= 0 && raw.ATmp == 0 && raw.RHum == 0 {
		return false, "Monitor sensors warming up (empty telemetry frame)"
	}

	pm01 := sanitizeFloat(raw.PM01, 0, 0, 5000)
	pm02 := sanitizeFloat(raw.PM02, 0, 0, 5000)
	pm10 := sanitizeFloat(raw.PM10, 0, 0, 5000)
	pm02Comp := pm02
	if raw.PM02Compensated != nil {
		pm02Comp = sanitizeFloat(*raw.PM02Compensated, pm02, 0, 5000)
	}

	atmp := sanitizeFloat(raw.ATmp, 0, -50, 100)
	atmpComp := atmp
	if raw.ATmpCompensated != nil {
		atmpComp = sanitizeFloat(*raw.ATmpCompensated, atmp, -50, 100)
	}

	rhum := sanitizeFloat(raw.RHum, 0, 0, 100)
	rhumComp := rhum
	if raw.RHumCompensated != nil {
		rhumComp = sanitizeFloat(*raw.RHumCompensated, rhum, 0, 100)
	}

	rco2 := clampInt(raw.RCO2, 0, 50000)
	tvocIdx := clampInt(raw.TVOCIndex, 0, 500)
	noxIdx := clampInt(raw.NOxIndex, 0, 500)

	c.infoMu.Lock()
	c.deviceInfo = DeviceInfo{
		SerialNo:  raw.SerialNo,
		Firmware:  raw.Firmware,
		Model:     raw.Model,
		WiFiRSSI:  raw.WiFi,
		BootCount: raw.BootCount,
	}
	c.infoMu.Unlock()

	record := SensorRecord{
		Timestamp: time.Now().UTC().Unix(),
		PM01:      pm01,
		PM02:      pm02,
		PM10:      pm10,
		PM02Comp:  pm02Comp,
		RCO2:      rco2,
		ATmp:      atmp,
		ATmpComp:  atmpComp,
		RHum:      rhum,
		RHumComp:  rhumComp,
		TVOCIndex: tvocIdx,
		TVOCRaw:   raw.TVOCRaw,
		NOxIndex:  noxIdx,
		NOxRaw:    raw.NOxRaw,
	}

	// Sane-epoch guard: refuse to queue/archive samples stamped by an unsynced
	// clock; a wrong year would poison monthly partitions and history ranges.
	// The HTTP poll itself succeeded, so keep nominal cadence and just drop it.
	if record.Timestamp < minSaneEpoch {
		nowSec := time.Now().UTC().Unix()
		wasActive := c.badClockActive.Swap(true)
		last := c.badClockLastLog.Load()
		if (!wasActive || nowSec-last >= 60) && c.badClockLastLog.CompareAndSwap(last, nowSec) {
			logger.Error("Collector", "clock not synced (sample timestamp %d predates 2025-01-01); refusing to archive samples until the clock recovers", record.Timestamp)
		}
		return true, ""
	}
	if c.badClockActive.Swap(false) {
		logger.Info("Collector", "clock resynced (samples back past 2025-01-01); resuming archiving")
	}

	// Queue for storage insertion
	select {
	case c.outChan <- record:
	default:
		logger.Warn("Collector", "Write queue full; dropping sample.")
	}

	// Fan out to live subscribers
	c.subMu.RLock()
	for _, ch := range c.subscribers {
		select {
		case ch <- record:
		default:
		}
	}
	c.subMu.RUnlock()

	return true, ""
}
