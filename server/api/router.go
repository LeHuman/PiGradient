package api

import (
	"io/fs"
	"net/http"
	"pigradient/dashboard"
	"pigradient/server/broker"
)

func SetupRouter(metrics *MetricsHandler, sse *broker.SSEBroker, proxy *ProxyHandler, sched *ScheduleManager, sys *SystemHandler) http.Handler {
	mux := http.NewServeMux()

	// REST & SSE API Routes
	mux.HandleFunc("GET /api/v1/live", metrics.HandleLive)
	mux.HandleFunc("GET /api/v1/widget", metrics.HandleWidget)
	mux.HandleFunc("GET /api/v1/history", metrics.HandleHistory)
	mux.HandleFunc("/api/v1/config", proxy.HandleConfig)
	mux.HandleFunc("/api/v1/schedule", sched.HandleSchedule)
	mux.HandleFunc("/api/v1/system", sys.HandleSystem)
	mux.HandleFunc("GET /api/v1/logs", sys.HandleLogs)
	mux.Handle("GET /api/v1/stream", sse)

	// Embedded Static UI
	sub, err := fs.Sub(dashboard.DistFS, "dist")
	if err == nil {
		mux.Handle("/", http.FileServer(http.FS(sub)))
	}

	return mux
}
