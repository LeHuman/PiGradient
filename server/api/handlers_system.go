package api

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"runtime"
	"time"

	"pigradient/server/collector"
	"pigradient/server/config"
	"pigradient/server/logger"
	"pigradient/server/store"
)

type SystemHandler struct {
	target    *config.TargetStore
	collector *collector.Collector
	storage   *store.StorageManager
	startTime time.Time
}

func NewSystemHandler(target *config.TargetStore, c *collector.Collector, sm *store.StorageManager) *SystemHandler {
	return &SystemHandler{
		target:    target,
		collector: c,
		storage:   sm,
		startTime: time.Now(),
	}
}

func (h *SystemHandler) HandleSystem(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, PUT, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	switch r.Method {
	case http.MethodGet:
		var mem runtime.MemStats
		runtime.ReadMemStats(&mem)
		memMB := math.Round((float64(mem.Alloc)/1024.0/1024.0)*10) / 10
		activePartition, dbSize, totalRecords := h.storage.GetStats()

		payload := map[string]any{
			"targetDeviceUrl":      h.target.DeviceURL(),
			"pollIntervalSec":      int(h.target.PollInterval().Seconds()),
			"collectorStatus":      h.collector.Status(),
			"consecutiveFailures":  h.collector.ConsecutiveFailures(),
			"latencyMs":            h.collector.LatencyMs(),
			"activePartition":      activePartition,
			"dbSizeBytes":          dbSize,
			"totalRecordsRecorded": totalRecords,
			"uptimeSeconds":        int64(time.Since(h.startTime).Seconds()),
			"memoryMb":             memMB,
			"goroutines":           runtime.NumGoroutine(),
			"simulatedMode":        false,
			"device":               h.collector.GetDeviceInfo(),

			// Storage pipeline health (never blocks on the writer mutex):
			"storageStatus":  h.storage.StorageStatus(),
			"lastWriteError": h.storage.LastWriteError(),
			"droppedRecords": h.storage.DroppedSamples(),
			"queuedRecords":  h.storage.QueuedRecords(),
			"diskFreeBytes":  h.storage.DiskFreeBytes(), // -1 when unknown (non-Linux)
		}
		_ = json.NewEncoder(w).Encode(payload)

	case http.MethodPut:
		r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
		var incoming struct {
			TargetURL *string `json:"targetUrl"`
			PollSec   *int    `json:"pollSec"`
		}
		if err := json.NewDecoder(r.Body).Decode(&incoming); err != nil {
			var maxErr *http.MaxBytesError
			if errors.As(err, &maxErr) {
				writeJSONError(w, http.StatusRequestEntityTooLarge, "Request body too large")
				return
			}
			writeJSONError(w, http.StatusBadRequest, "Invalid JSON payload")
			return
		}

		var validatedURL string
		if incoming.TargetURL != nil {
			u, err := config.ValidateDeviceURL(*incoming.TargetURL)
			if err != nil {
				writeJSONError(w, http.StatusBadRequest, "Invalid targetUrl: "+err.Error())
				return
			}
			validatedURL = u
		}

		if incoming.PollSec != nil {
			if *incoming.PollSec < 1 || *incoming.PollSec > 3600 {
				writeJSONError(w, http.StatusBadRequest, "pollSec must be between 1 and 3600 seconds")
				return
			}
		}

		changed := false
		if validatedURL != "" {
			normalized := h.target.SetDeviceURL(validatedURL)
			logger.Info("System", "Target AirGradient device URL updated to %s", normalized)
			changed = true
		}
		if incoming.PollSec != nil {
			d := h.target.SetPollIntervalSec(*incoming.PollSec)
			logger.Info("System", "Nominal poll cadence updated to %v", d)
			changed = true
		}
		if changed {
			h.collector.TriggerImmediatePoll()
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"success":         true,
			"targetDeviceUrl": h.target.DeviceURL(),
			"pollIntervalSec": int(h.target.PollInterval().Seconds()),
		})

	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

func (h *SystemHandler) HandleLogs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	_ = json.NewEncoder(w).Encode(logger.Entries())
}
