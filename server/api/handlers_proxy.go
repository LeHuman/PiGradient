package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"pigradient/server/config"
	"pigradient/server/logger"
)

const (
	maxProxyRequestBytes  = 64 << 10 // 64 KiB
	maxProxyResponseBytes = 1 << 20  // 1 MiB
)

type ProxyHandler struct {
	target *config.TargetStore
	client *http.Client
}

func NewProxyHandler(target *config.TargetStore) *ProxyHandler {
	return &ProxyHandler{
		target: target,
		client: &http.Client{
			Timeout: 3 * time.Second,
			Transport: &http.Transport{
				MaxIdleConnsPerHost: 2,
				IdleConnTimeout:     30 * time.Second,
			},
		},
	}
}

func validateConfigField(key string, val any) bool {
	switch key {
	case "ledBarBrightness", "displayBrightness":
		n, ok := val.(float64)
		return ok && n >= 0 && n <= 100
	case "abcDays":
		n, ok := val.(float64)
		return ok && n >= 0 && n <= 365
	case "tvocLearningOffset", "noxLearningOffset":
		n, ok := val.(float64)
		return ok && n >= 0 && n <= 1000
	case "pmStandard":
		s, ok := val.(string)
		return ok && (s == "ugm3" || s == "us-aqi")
	case "ledBarMode":
		s, ok := val.(string)
		return ok && (s == "pm" || s == "co2" || s == "off")
	case "temperatureUnit":
		s, ok := val.(string)
		return ok && (s == "c" || s == "f")
	case "configurationControl":
		s, ok := val.(string)
		return ok && (s == "local" || s == "cloud" || s == "both")
	case "country", "mqttBrokerUrl":
		s, ok := val.(string)
		return ok && len(s) <= 512
	case "postDataToAirGradient", "disableCloudConnection", "offlineMode",
		"monitorDisplayCompensatedValues", "co2CalibrationRequested", "ledBarTestRequested":
		_, ok := val.(bool)
		return ok
	case "corrections":
		corr, ok := val.(map[string]any)
		if !ok {
			return false
		}
		for sectionKey, sectionRaw := range corr {
			sec, ok := sectionRaw.(map[string]any)
			if !ok {
				return false
			}
			switch sectionKey {
			case "pm02":
				if algo, exists := sec["correctionAlgorithm"]; exists {
					s, ok := algo.(string)
					if !ok || (s != "epa_2021" && s != "none" && s != "") {
						return false
					}
				}
			case "temp", "rhum":
				if algo, exists := sec["correctionAlgorithm"]; exists {
					s, ok := algo.(string)
					if !ok || (s != "ag_pms5003t_default" && s != "slr" && s != "none" && s != "") {
						return false
					}
				}
				if slrRaw, exists := sec["slr"]; exists {
					slr, ok := slrRaw.(map[string]any)
					if !ok {
						return false
					}
					if v, has := slr["intercept"]; has {
						n, ok := v.(float64)
						if !ok || n < -100 || n > 100 {
							return false
						}
					}
					if v, has := slr["scalingFactor"]; has {
						n, ok := v.(float64)
						if !ok || n <= 0 || n > 10 {
							return false
						}
					}
				}
			default:
				return false
			}
		}
		return true
	default:
		return false
	}
}

func (h *ProxyHandler) HandleConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, PUT, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	targetURL := h.target.DeviceURL() + "/config"

	switch r.Method {
	case http.MethodGet:
		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, targetURL, nil)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		resp, err := h.client.Do(req)
		if err != nil {
			logger.Warn("Config", "Failed querying %s: %v", targetURL, err)
			writeJSONError(w, http.StatusBadGateway, "Proxy error: "+err.Error())
			return
		}
		defer resp.Body.Close()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, io.LimitReader(resp.Body, maxProxyResponseBytes))
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))

	case http.MethodPut:
		r.Body = http.MaxBytesReader(w, r.Body, maxProxyRequestBytes)
		var incoming map[string]any
		if err := json.NewDecoder(r.Body).Decode(&incoming); err != nil {
			var maxErr *http.MaxBytesError
			if errors.As(err, &maxErr) {
				writeJSONError(w, http.StatusRequestEntityTooLarge, "Request body too large")
				return
			}
			writeJSONError(w, http.StatusBadRequest, "Invalid JSON payload")
			return
		}
		if incoming == nil {
			writeJSONError(w, http.StatusBadRequest, "JSON body must be an object")
			return
		}

		// Forward only genuine AirGradient Local Server API /config keys to ESP32 NVS
		allowedKeys := map[string]bool{
			"country":                         true,
			"pmStandard":                      true,
			"ledBarMode":                      true,
			"abcDays":                         true,
			"tvocLearningOffset":              true,
			"noxLearningOffset":               true,
			"mqttBrokerUrl":                   true,
			"temperatureUnit":                 true,
			"configurationControl":            true,
			"postDataToAirGradient":           true,
			"disableCloudConnection":          true,
			"offlineMode":                     true,
			"ledBarBrightness":                true,
			"displayBrightness":               true,
			"monitorDisplayCompensatedValues": true,
			"corrections":                     true,
			"co2CalibrationRequested":         true,
			"ledBarTestRequested":             true,
		}

		cfg := make(map[string]any)
		for k, v := range incoming {
			if !allowedKeys[k] {
				continue
			}
			if !validateConfigField(k, v) {
				writeJSONError(w, http.StatusBadRequest, "Invalid value for config field: "+k)
				return
			}
			cfg[k] = v
		}
		if _, ok := cfg["configurationControl"]; !ok {
			cfg["configurationControl"] = "local"
		}

		// Buffer JSON so ESP32 WebServer gets an explicit Content-Length header
		bodyBytes, err := json.Marshal(cfg)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}

		req, err := http.NewRequestWithContext(r.Context(), http.MethodPut, targetURL, bytes.NewReader(bodyBytes))
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		req.Header.Set("Content-Type", "application/json")

		resp, err := h.client.Do(req)
		if err != nil {
			logger.Error("Config", "PUT %s failed: %v", targetURL, err)
			writeJSONError(w, http.StatusBadGateway, "Proxy error: "+err.Error())
			return
		}
		defer resp.Body.Close()

		if v, ok := cfg["co2CalibrationRequested"].(bool); ok && v {
			logger.Warn("Config", "Sent manual 400 ppm CO2 calibration request to %s", targetURL)
		} else if v, ok := cfg["ledBarTestRequested"].(bool); ok && v {
			logger.Info("Config", "Sent 9-LED bar test trigger to %s", targetURL)
		} else {
			logger.Info("Config", "Updated AirGradient NVS configuration at %s", targetURL)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, io.LimitReader(resp.Body, maxProxyResponseBytes))
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))

	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}
