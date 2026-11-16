package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"pigradient/server/config"
	"pigradient/server/logger"
)

type ScheduleConfig struct {
	Enabled                 bool   `json:"enabled"`
	DayTimeStart            string `json:"dayTimeStart"`            // HH:MM
	DayTimeEnd              string `json:"dayTimeEnd"`              // HH:MM
	LedBarBrightnessDay     int    `json:"ledBarBrightnessDay"`     // 0-100
	LedBarBrightnessNight   int    `json:"ledBarBrightnessNight"`   // 0-100
	DisplayBrightnessDay    int    `json:"displayBrightnessDay"`    // 0-100
	DisplayBrightnessNight  int    `json:"displayBrightnessNight"`  // 0-100
	DisplayNightLifetimeOff bool   `json:"displayNightLifetimeOff"` // 02:00 - 03:00 screen off
}

type ScheduleManager struct {
	mu        sync.RWMutex
	cfg       ScheduleConfig
	filePath  string
	target    *config.TargetStore
	client    *http.Client
	lastPhase string
}

func NewScheduleManager(storageDir string, target *config.TargetStore) *ScheduleManager {
	sm := &ScheduleManager{
		filePath: filepath.Join(storageDir, "schedule.json"),
		target:   target,
		client:   &http.Client{Timeout: 3 * time.Second},
		cfg: ScheduleConfig{
			Enabled:                 true,
			DayTimeStart:            "08:00",
			DayTimeEnd:              "22:00",
			LedBarBrightnessDay:     100,
			LedBarBrightnessNight:   5,
			DisplayBrightnessDay:    50,
			DisplayBrightnessNight:  1,
			DisplayNightLifetimeOff: true,
		},
	}
	sm.load()
	return sm
}

func clampBrightness(v int) int {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
}

func isValidHHMM(s string) bool {
	if len(s) != 5 || s[2] != ':' {
		return false
	}
	hh, errH := strconv.Atoi(s[:2])
	mm, errM := strconv.Atoi(s[3:])
	return errH == nil && errM == nil && hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59
}

func (s *ScheduleManager) load() {
	data, err := os.ReadFile(s.filePath)
	if err != nil {
		return
	}
	var loaded ScheduleConfig
	if err := json.Unmarshal(data, &loaded); err != nil {
		logger.Warn("Scheduler", "Failed parsing schedule file (%v); keeping defaults", err)
		return
	}
	if !isValidHHMM(loaded.DayTimeStart) {
		loaded.DayTimeStart = "08:00"
	}
	if !isValidHHMM(loaded.DayTimeEnd) {
		loaded.DayTimeEnd = "22:00"
	}
	loaded.LedBarBrightnessDay = clampBrightness(loaded.LedBarBrightnessDay)
	loaded.LedBarBrightnessNight = clampBrightness(loaded.LedBarBrightnessNight)
	loaded.DisplayBrightnessDay = clampBrightness(loaded.DisplayBrightnessDay)
	loaded.DisplayBrightnessNight = clampBrightness(loaded.DisplayBrightnessNight)

	s.mu.Lock()
	s.cfg = loaded
	s.mu.Unlock()
}

func (s *ScheduleManager) saveLocked() {
	data, err := json.MarshalIndent(s.cfg, "", "  ")
	if err != nil {
		logger.Warn("Scheduler", "Failed encoding schedule: %v", err)
		return
	}
	if err := config.AtomicWriteFile(s.filePath, data, 0644); err != nil {
		logger.Warn("Scheduler", "Failed persisting schedule to %s: %v", s.filePath, err)
	}
}

func (s *ScheduleManager) Start(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	// Apply immediately on startup if enabled
	s.applyIfDue(ctx, time.Now())

	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			s.applyIfDue(ctx, now)
		}
	}
}

func (s *ScheduleManager) applyIfDue(ctx context.Context, now time.Time) {
	s.mu.RLock()
	cfg := s.cfg
	prevPhase := s.lastPhase
	s.mu.RUnlock()

	if !cfg.Enabled {
		return
	}

	hhmm := now.Format("15:04")
	var phase string
	var led, disp int

	if cfg.DisplayNightLifetimeOff && hhmm >= "02:00" && hhmm < "03:00" {
		phase = "oled_saver"
		led = cfg.LedBarBrightnessNight
		disp = 0
	} else if isWithinDayWindow(hhmm, cfg.DayTimeStart, cfg.DayTimeEnd) {
		phase = "day"
		led = cfg.LedBarBrightnessDay
		disp = cfg.DisplayBrightnessDay
	} else {
		phase = "night"
		led = cfg.LedBarBrightnessNight
		disp = cfg.DisplayBrightnessNight
	}

	if prevPhase == phase {
		return
	}

	// Only mark lastPhase after the monitor acknowledges the update so transient outages automatically retry
	if s.pushBrightness(ctx, clampBrightness(led), clampBrightness(disp), phase) {
		s.mu.Lock()
		if s.cfg.Enabled {
			s.lastPhase = phase
		}
		s.mu.Unlock()
	}
}

func (s *ScheduleManager) pushBrightness(ctx context.Context, led, disp int, phase string) bool {
	payload := map[string]any{
		"configurationControl": "local",
		"ledBarBrightness":     led,
		"displayBrightness":    disp,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return false
	}
	targetURL := s.target.DeviceURL() + "/config"
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, targetURL, bytes.NewReader(body))
	if err != nil {
		return false
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		logger.Warn("Scheduler", "Failed pushing %s brightness to %s: %v", phase, targetURL, err)
		return false
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	_ = resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		logger.Warn("Scheduler", "Monitor %s rejected %s brightness update with HTTP %d", targetURL, phase, resp.StatusCode)
		return false
	}
	logger.Info("Scheduler", "Applied %s preset (LED=%d%%, Display=%d%%)", phase, led, disp)
	return true
}

func isWithinDayWindow(now, start, end string) bool {
	if start <= end {
		return now >= start && now < end
	}
	return now >= start || now < end
}

func (s *ScheduleManager) HandleSchedule(w http.ResponseWriter, r *http.Request) {
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
		s.mu.RLock()
		cfg := s.cfg
		s.mu.RUnlock()
		_ = json.NewEncoder(w).Encode(cfg)

	case http.MethodPut:
		r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
		var incoming ScheduleConfig
		if err := json.NewDecoder(r.Body).Decode(&incoming); err != nil {
			var maxErr *http.MaxBytesError
			if errors.As(err, &maxErr) {
				writeJSONError(w, http.StatusRequestEntityTooLarge, "Request body too large")
				return
			}
			writeJSONError(w, http.StatusBadRequest, "Invalid JSON payload")
			return
		}
		if !isValidHHMM(incoming.DayTimeStart) || !isValidHHMM(incoming.DayTimeEnd) {
			writeJSONError(w, http.StatusBadRequest, "dayTimeStart and dayTimeEnd must use HH:MM (00:00–23:59)")
			return
		}
		incoming.LedBarBrightnessDay = clampBrightness(incoming.LedBarBrightnessDay)
		incoming.LedBarBrightnessNight = clampBrightness(incoming.LedBarBrightnessNight)
		incoming.DisplayBrightnessDay = clampBrightness(incoming.DisplayBrightnessDay)
		incoming.DisplayBrightnessNight = clampBrightness(incoming.DisplayBrightnessNight)

		s.mu.Lock()
		s.cfg = incoming
		s.lastPhase = "" // Force immediate re-evaluation
		s.saveLocked()
		s.mu.Unlock()

		logger.Info("Scheduler", "Updated schedule (Enabled=%v, Day=%s-%s)", incoming.Enabled, incoming.DayTimeStart, incoming.DayTimeEnd)
		go func() {
			pushCtx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
			defer cancel()
			s.applyIfDue(pushCtx, time.Now())
		}()
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "schedule": incoming})

	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}
