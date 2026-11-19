package api

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"

	"pigradient/server/analytics"
	"pigradient/server/collector"
	"pigradient/server/logger"
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
			// Nullable: nil when firmware does not report PM0.3 counts.
			"pm003_count": record.PM003Cnt,
			"boot_count":  devInfo.BootCount,
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

	// Guard against unbounded memory: cap the bucket count the JSON response
	// can contain, pointing fine-grained bulk reads at the CSV stream instead.
	if end < start {
		start, end = end, start
	}
	if (end-start)/int64(interval) > maxHistoryBuckets {
		writeJSONError(w, http.StatusBadRequest,
			fmt.Sprintf("Range too fine: (end-start)/interval exceeds %d buckets; use a larger interval or /api/v1/export.csv for raw streaming", maxHistoryBuckets))
		return
	}

	points, err := store.QueryHistoricalBuckets(r.Context(), h.baseDir, start, end, interval)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = json.NewEncoder(w).Encode(points)
}

const maxHistoryBuckets = 2500
const maxExportRange = int64(366) * 86400 // one year of seconds

// csvHeader is the exact 23-column raw schema order.
var csvHeader = []string{
	"timestamp", "pm01", "pm02", "pm10", "pm02_comp",
	"rco2", "atmp", "atmp_comp", "rhum", "rhum_comp",
	"tvoc_index", "tvoc_raw", "nox_index", "nox_raw",
	"pm01_standard", "pm02_standard", "pm10_standard",
	"pm003_count", "pm005_count", "pm01_count", "pm02_count", "pm50_count", "pm10_count",
}

// HandleExportCSV streams raw (interval=1) or bucket-averaged readings as
// text/csv directly to the ResponseWriter with O(1) memory: rows come from the
// store partition-by-partition and are written immediately (a single-row
// lookahead merges seam buckets that straddle a month boundary).
func (h *MetricsHandler) HandleExportCSV(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")

	q := r.URL.Query()
	var start, end int64
	var parseErr bool
	if raw := q.Get("start"); raw != "" {
		v, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || v < 0 {
			parseErr = true
		}
		start = v
	}
	if raw := q.Get("end"); raw != "" {
		v, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || v < 0 {
			parseErr = true
		}
		end = v
	}
	if parseErr {
		writeJSONError(w, http.StatusBadRequest, "Invalid 'start'/'end' unix timestamp")
		return
	}
	if start == 0 || end == 0 {
		writeJSONError(w, http.StatusBadRequest, "Both 'start' and 'end' unix timestamps are required")
		return
	}
	if start > end {
		start, end = end, start
	}
	if end-start > maxExportRange {
		writeJSONError(w, http.StatusBadRequest, "Range too large: export window is capped at 366 days")
		return
	}

	interval := 1
	if raw := q.Get("interval"); raw != "" {
		v, err := strconv.Atoi(raw)
		if err != nil || v < 1 {
			writeJSONError(w, http.StatusBadRequest, "Invalid 'interval' bucket size (must be >= 1 second)")
			return
		}
		interval = v
	}

	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"pigradient_%d_%d.csv\"", start, end))
	w.WriteHeader(http.StatusOK)

	cw := csv.NewWriter(w)
	_ = cw.Write(csvHeader)

	// Single-row lookahead: hold the newest row until we know whether the next
	// one shares its timestamp (seam bucket), merging duplicates by average.
	var pending *store.ExportRow
	emit := func(row store.ExportRow) error {
		if pending != nil {
			if row.Timestamp == pending.Timestamp {
				mergeExportRows(pending, row)
				return nil
			}
			if err := writeExportRow(cw, *pending); err != nil {
				return err
			}
		}
		pending = &row
		return nil
	}

	if err := store.StreamHistoricalRows(r.Context(), h.baseDir, start, end, interval, emit); err != nil && !errors.Is(err, context.Canceled) {
		// Headers are already sent; the truncated stream is the client's signal.
		logger.Warn("API", "Export CSV stream aborted: %v", err)
	}
	if pending != nil {
		_ = writeExportRow(cw, *pending)
	}
	cw.Flush()
	if err := cw.Error(); err != nil {
		logger.Warn("API", "Export CSV write error: %v", err)
	}
}

func writeExportRow(cw *csv.Writer, row store.ExportRow) error {
	return cw.Write([]string{
		strconv.FormatInt(row.Timestamp, 10),
		csvFloat(row.PM01), csvFloat(row.PM02), csvFloat(row.PM10), csvFloat(row.PM02Comp),
		strconv.FormatInt(row.RCO2, 10),
		csvFloat(row.ATmp), csvFloat(row.ATmpComp), csvFloat(row.RHum), csvFloat(row.RHumComp),
		strconv.FormatInt(row.TVOCIndex, 10), csvFloat(row.TVOCRaw),
		strconv.FormatInt(row.NOxIndex, 10), csvFloat(row.NOxRaw),
		csvNullable(row.PM01Std), csvNullable(row.PM02Std), csvNullable(row.PM10Std),
		csvNullable(row.PM003Cnt), csvNullable(row.PM005Cnt), csvNullable(row.PM01Cnt),
		csvNullable(row.PM02Cnt), csvNullable(row.PM50Cnt), csvNullable(row.PM10Cnt),
	})
}

// mergeExportRows averages a duplicate seam bucket (identical Timestamp from
// adjacent monthly partitions) into dst.
func mergeExportRows(dst *store.ExportRow, src store.ExportRow) {
	dst.PM01 = (dst.PM01 + src.PM01) / 2
	dst.PM02 = (dst.PM02 + src.PM02) / 2
	dst.PM10 = (dst.PM10 + src.PM10) / 2
	dst.PM02Comp = (dst.PM02Comp + src.PM02Comp) / 2
	dst.ATmp = (dst.ATmp + src.ATmp) / 2
	dst.ATmpComp = (dst.ATmpComp + src.ATmpComp) / 2
	dst.RHum = (dst.RHum + src.RHum) / 2
	dst.RHumComp = (dst.RHumComp + src.RHumComp) / 2
	dst.RCO2 = avgInt64(dst.RCO2, src.RCO2)
	dst.TVOCIndex = avgInt64(dst.TVOCIndex, src.TVOCIndex)
	dst.TVOCRaw = (dst.TVOCRaw + src.TVOCRaw) / 2
	dst.NOxIndex = avgInt64(dst.NOxIndex, src.NOxIndex)
	dst.NOxRaw = (dst.NOxRaw + src.NOxRaw) / 2
	mergeNullableFloat(&dst.PM01Std, src.PM01Std)
	mergeNullableFloat(&dst.PM02Std, src.PM02Std)
	mergeNullableFloat(&dst.PM10Std, src.PM10Std)
	mergeNullableFloat(&dst.PM003Cnt, src.PM003Cnt)
	mergeNullableFloat(&dst.PM005Cnt, src.PM005Cnt)
	mergeNullableFloat(&dst.PM01Cnt, src.PM01Cnt)
	mergeNullableFloat(&dst.PM02Cnt, src.PM02Cnt)
	mergeNullableFloat(&dst.PM50Cnt, src.PM50Cnt)
	mergeNullableFloat(&dst.PM10Cnt, src.PM10Cnt)
}

// mergeNullableFloat averages into dst when both sides carry a value and
// keeps the valid side when the other partition predates the count columns
// (so a legacy/migrated seam bucket reports the real value, not half of it).
func mergeNullableFloat(dst **float64, src *float64) {
	switch {
	case *dst == nil:
		*dst = src
	case src == nil:
		// keep dst
	default:
		v := (**dst + *src) / 2
		*dst = &v
	}
}

func avgInt64(a, b int64) int64 {
	return int64(math.Round(float64(a+b) / 2))
}

func csvFloat(v float64) string {
	return strconv.FormatFloat(v, 'f', -1, 64)
}

// csvNullable renders a NULL count column as an empty CSV cell — never "0",
// which downstream consumers would read as a genuine zero reading.
func csvNullable(v *float64) string {
	if v == nil {
		return ""
	}
	return csvFloat(*v)
}

func mathRound(val float64, precision int) float64 {
	p := math.Pow(10, float64(precision))
	return math.Round(val*p) / p
}
