package api

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"

	"pigradient/server/analytics"
	"pigradient/server/collector"
	"pigradient/server/store"
)

type MetricsHandler struct {
	baseDir   string
	collector *collector.Collector
	latestMu  sync.RWMutex
	latest    collector.SensorRecord
}

func NewMetricsHandler(baseDir string, c *collector.Collector) *MetricsHandler {
	return &MetricsHandler{
		baseDir:   baseDir,
		collector: c,
	}
}

func (h *MetricsHandler) UpdateLatest(r collector.SensorRecord) {
	h.latestMu.Lock()
	h.latest = r
	h.latestMu.Unlock()
}

func (h *MetricsHandler) GetLivePayload() map[string]any {
	h.latestMu.RLock()
	record := h.latest
	h.latestMu.RUnlock()

	devInfo := h.collector.GetDeviceInfo()
	aqi := analytics.CalculateAQI(record.PM02Comp)
	co2Level := analytics.GetCO2Level(record.RCO2)
	co2Category := analytics.GetCO2Category(record.RCO2)
	tempF := mathRound((record.ATmpComp*9.0/5.0)+32.0, 1)
	dewC := analytics.CalculateDewPoint(record.ATmpComp, record.RHumComp)
	dewF := mathRound((dewC*9.0/5.0)+32.0, 1)
	hiC := analytics.CalculateHeatIndex(record.ATmpComp, record.RHumComp)
	hiF := mathRound((hiC*9.0/5.0)+32.0, 1)

	var errMsg any = nil
	if msg := h.collector.LastError(); msg != "" {
		errMsg = msg
	}

	return map[string]any{
		"status":                h.collector.Status(),
		"is_simulated":          false,
		"error_message":         errMsg,
		"last_seen_seconds_ago": h.collector.LastSeenSecondsAgo(),
		"timestamp":             record.Timestamp,
		"latency_ms":            h.collector.LatencyMs(),
		"device":                devInfo,
		"raw": map[string]any{
			"pm01":       record.PM01,
			"pm02":       record.PM02,
			"pm10":       record.PM10,
			"pm02_comp":  record.PM02Comp,
			"rco2":       record.RCO2,
			"atmp":       record.ATmp,
			"atmp_comp":  record.ATmpComp,
			"rhum":       record.RHum,
			"rhum_comp":  record.RHumComp,
			"tvoc_index": record.TVOCIndex,
			"tvoc_raw":   record.TVOCRaw,
			"nox_index":  record.NOxIndex,
			"nox_raw":    record.NOxRaw,
			"boot_count": devInfo.BootCount,
		},
		"processed": map[string]any{
			"aqi_pm25":     aqi.AQI,
			"aqi_category": aqi.Category,
			"aqi_color":    aqi.ColorHex,
			"nowcast_aqi":  aqi.AQI,
			"co2_level":    co2Level,
			"co2_category": co2Category,
			"temp_f":       tempF,
			"temp_c":       mathRound(record.ATmpComp, 1),
			"humidity":     mathRound(record.RHumComp, 1),
			"dew_point_c":  dewC,
			"dew_point_f":  dewF,
			"heat_index_c": hiC,
			"heat_index_f": hiF,
		},
	}
}

func writeJSONError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func (h *MetricsHandler) HandleLive(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	_ = json.NewEncoder(w).Encode(h.GetLivePayload())
}

func (h *MetricsHandler) HandleWidget(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	h.latestMu.RLock()
	record := h.latest
	h.latestMu.RUnlock()

	aqi := analytics.CalculateAQI(record.PM02Comp)
	tempF := math.Round((record.ATmpComp * 9.0 / 5.0) + 32.0)
	updated := "--"
	if record.Timestamp > 0 {
		updated = time.Unix(record.Timestamp, 0).Local().Format("03:04 PM")
	}

	widgetData := map[string]any{
		"aqi":       aqi.AQI,
		"aqi_desc":  aqi.Category,
		"aqi_color": aqi.ColorHex,
		"co2":       record.RCO2,
		"temp":      fmt.Sprintf("%.0f°F", tempF),
		"temp_c":    fmt.Sprintf("%.0f°C", math.Round(record.ATmpComp)),
		"humidity":  fmt.Sprintf("%.0f%%", math.Round(record.RHumComp)),
		"updated":   updated,
	}
	_ = json.NewEncoder(w).Encode(widgetData)
}

func (h *MetricsHandler) HandleHistory(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	q := r.URL.Query()
	var start, end int64
	if raw := q.Get("start"); raw != "" {
		v, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || v < 0 {
			writeJSONError(w, http.StatusBadRequest, "Invalid 'start' unix timestamp")
			return
		}
		start = v
	}
	if raw := q.Get("end"); raw != "" {
		v, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || v < 0 {
			writeJSONError(w, http.StatusBadRequest, "Invalid 'end' unix timestamp")
			return
		}
		end = v
	}

	interval := 300
	if raw := q.Get("interval"); raw != "" {
		v, err := strconv.Atoi(raw)
		if err != nil || v < 1 {
			writeJSONError(w, http.StatusBadRequest, "Invalid 'interval' bucket size (must be >= 1 second)")
			return
		}
		interval = v
	}

	if start == 0 || end == 0 {
		now := time.Now().UTC().Unix()
		if start == 0 {
			start = now - 86400
		}
		if end == 0 {
			end = now
		}
	}

	points, err := store.QueryHistoricalBuckets(h.baseDir, start, end, interval)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = json.NewEncoder(w).Encode(points)
}

func mathRound(val float64, precision int) float64 {
	p := math.Pow(10, float64(precision))
	return math.Round(val*p) / p
}
