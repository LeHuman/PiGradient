package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"pigradient/server/api"
	"pigradient/server/broker"
	"pigradient/server/collector"
	"pigradient/server/config"
	"pigradient/server/logger"
	"pigradient/server/store"
)

var Version = "1.0.0"

func main() {
	defaults := config.Default()

	configPath := flag.String("config", "", "Path to YAML configuration file (e.g. /etc/pigradient/config.yaml)")
	deviceURL := flag.String("device-url", defaults.TargetDeviceURL, "URL or IP of the AirGradient ONE device")
	storageDir := flag.String("storage-dir", defaults.StorageDirectory, "Path to SQLite monthly partition storage directory")
	listenAddr := flag.String("listen-addr", defaults.ListenAddress, "HTTP server bind address")
	pollInterval := flag.Duration("poll-interval", time.Duration(defaults.PollIntervalSeconds)*time.Second, "Nominal device poll cadence (1s default)")
	flag.Parse()

	// Track which CLI flags were explicitly provided so they override config.yaml cleanly
	explicitFlags := make(map[string]bool)
	flag.Visit(func(f *flag.Flag) {
		explicitFlags[f.Name] = true
	})

	fileCfg := config.Default()
	if *configPath != "" {
		if err := config.LoadYAML(*configPath, &fileCfg); err != nil {
			logger.Warn("Main", "Could not load config file %s (%v); using defaults/flags", *configPath, err)
		} else {
			logger.Info("Main", "Loaded configuration from %s", *configPath)
		}
	}

	effectiveDeviceURL := fileCfg.TargetDeviceURL
	if explicitFlags["device-url"] {
		effectiveDeviceURL = *deviceURL
	}
	effectiveStorageDir := fileCfg.StorageDirectory
	if explicitFlags["storage-dir"] {
		effectiveStorageDir = *storageDir
	}
	effectiveListenAddr := fileCfg.ListenAddress
	if explicitFlags["listen-addr"] {
		effectiveListenAddr = *listenAddr
	}
	effectivePollInterval := time.Duration(fileCfg.PollIntervalSeconds) * time.Second
	if explicitFlags["poll-interval"] {
		effectivePollInterval = *pollInterval
	}
	// Optional dashboard/API base path (config.yaml `base_path: /pigradient`);
	// empty means serve only at the root. Already normalized by LoadYAML.
	effectiveBasePath := fileCfg.BasePath

	logger.Info("Main", "Initializing PiGradient v%s...", Version)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// 1. Initialize Storage Engine (Monthly partitioned SQLite)
	sm, err := store.NewStorageManager(effectiveStorageDir)
	if err != nil {
		log.Fatalf("[Main] Fatal: Storage manager failed to initialize (%s): %v", effectiveStorageDir, err)
	}

	// 2. Shared Runtime Target Store (loads optional UI overrides from <storageDir>/runtime.json)
	targetStore := config.NewTargetStore(effectiveDeviceURL, effectivePollInterval, effectiveStorageDir)
	logger.Info("Main", "Target Device: %s | Storage: %s | Poll: %v", targetStore.DeviceURL(), effectiveStorageDir, targetStore.PollInterval())

	// 3. Setup Concurrency Channels & Real-time SSE Broker
	writeQueue := make(chan collector.SensorRecord, 500)
	sseBroker := broker.NewSSEBroker()

	// 4. Start Single-Flight Ingestion Collector
	col := collector.NewCollector(targetStore, writeQueue)
	go col.Start(ctx)

	// 5. Start Storage Writer Goroutine (Batched inserts + WAL sync)
	sm.SetQueueLenFunc(func() int { return len(writeQueue) }, cap(writeQueue))
	go sm.StartWriter(ctx, writeQueue)

	// 6. Initialize API, Proxy, Scheduler, and System Handlers
	metricsHandler := api.NewMetricsHandler(effectiveStorageDir, col)
	sseBroker.SetInitialProvider(metricsHandler.GetLivePayload)
	proxyHandler := api.NewProxyHandler(targetStore)
	scheduleMgr := api.NewScheduleManager(effectiveStorageDir, targetStore)
	systemHandler := api.NewSystemHandler(targetStore, col, sm)
	go scheduleMgr.Start(ctx)

	// Real-Time Fan-Out Pipeline: Taps ingestion records to live cache and SSE.
	// Subscribe() is hoisted OUT of the loop: calling it per-iteration allocated a
	// fresh cap-50 channel every sample and leaked every prior one forever.
	subCh := col.Subscribe()
	statusCh := col.StatusChangeChan()
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case r := <-subCh:
				metricsHandler.UpdateLatest(r)
				sseBroker.BroadcastJSON(metricsHandler.GetLivePayload())
			case <-statusCh:
				// Collector went offline/online (or 30s offline re-ping): re-broadcast
				// the current snapshot so UIs never present stale telemetry as live.
				sseBroker.BroadcastJSON(metricsHandler.GetLivePayload())
			}
		}
	}()

	// 7. Build HTTP Server (WriteTimeout=0 preserves persistent 1 Hz SSE streams)
	router := api.SetupRouter(metricsHandler, sseBroker, proxyHandler, scheduleMgr, systemHandler, effectiveBasePath)
	if effectiveBasePath != "" {
		logger.Info("Main", "Dashboard and API additionally served under base path %s/", effectiveBasePath)
	}
	server := &http.Server{
		Addr:              effectiveListenAddr,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       60 * time.Second,
		WriteTimeout:      0,
	}

	go func() {
		logger.Info("Main", "PiGradient HTTP gateway listening on %s", effectiveListenAddr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[Main] Server error: %v", err)
		}
	}()

	// 8. Handle Graceful Shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	logger.Info("Main", "Shutdown initiated...")
	cancel()

	// Close open SSE streams immediately so http.Server.Shutdown does not wait on persistent listeners
	sseBroker.Close()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Warn("Main", "HTTP server shutdown error: %v", err)
	}

	// Wait for StorageManager to flush queued samples, checkpoint WAL, and close SQLite
	select {
	case <-sm.Done():
		logger.Info("Store", "SQLite WAL flushed and closed cleanly.")
	case <-time.After(5 * time.Second):
		logger.Warn("Store", "Timed out waiting for SQLite writer flush on shutdown.")
	}

	logger.Info("Main", "PiGradient cleanly stopped.")
}
