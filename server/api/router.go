package api

import (
	"io/fs"
	"net/http"

	"pigradient/dashboard"
	"pigradient/server/broker"
)

// SetupRouter builds the HTTP mux. When basePath is non-empty (e.g.
// "/pigradient" from config.yaml `base_path:`), every API/SSE route is
// registered twice — once at the root prefix and once under basePath — and the
// dashboard is additionally served at basePath/ (with basePath itself
// redirecting to basePath/ so relative asset URLs resolve correctly).
func SetupRouter(metrics *MetricsHandler, sse *broker.SSEBroker, proxy *ProxyHandler, sched *ScheduleManager, sys *SystemHandler, basePath string) http.Handler {
	mux := http.NewServeMux()

	registerAPIRoutes := func(prefix string) {
		// REST & SSE API Routes
		mux.HandleFunc("GET "+prefix+"/api/v1/live", metrics.HandleLive)
		mux.HandleFunc("GET "+prefix+"/api/v1/widget", metrics.HandleWidget)
		mux.HandleFunc("GET "+prefix+"/api/v1/history", metrics.HandleHistory)
		mux.HandleFunc("GET "+prefix+"/api/v1/export.csv", metrics.HandleExportCSV)
		mux.HandleFunc(prefix+"/api/v1/config", proxy.HandleConfig)
		mux.HandleFunc(prefix+"/api/v1/schedule", sched.HandleSchedule)
		mux.HandleFunc(prefix+"/api/v1/system", sys.HandleSystem)
		mux.HandleFunc("GET "+prefix+"/api/v1/logs", sys.HandleLogs)
		mux.Handle("GET "+prefix+"/api/v1/stream", sse)
	}

	if basePath == "" {
		registerAPIRoutes("")
	} else {
		registerAPIRoutes("")
		registerAPIRoutes(basePath)
	}

	// Embedded Static UI
	sub, err := fs.Sub(dashboard.DistFS, "dist")
	if err == nil {
		root := http.FileServer(http.FS(sub))
		mux.Handle("/", root)
		if basePath != "" {
			// Exact basePath hit redirects to basePath/ so the browser's base
			// URL ends in a slash and relative asset URLs carry the prefix.
			mux.HandleFunc("GET "+basePath, func(w http.ResponseWriter, r *http.Request) {
				http.Redirect(w, r, basePath+"/", http.StatusMovedPermanently)
			})
			// Same dashboard FS under the base path (assets already carry the
			// prefix; strip it before handing the request to the FileServer).
			mux.Handle(basePath+"/", http.StripPrefix(basePath, root))
		}
	}

	return mux
}
