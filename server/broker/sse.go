package broker

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

type SSEBroker struct {
	clients         map[chan []byte]bool
	mu              sync.RWMutex
	broadcast       chan []byte
	done            chan struct{}
	closeOnce       sync.Once
	initialProvider func() map[string]any
}

func NewSSEBroker() *SSEBroker {
	b := &SSEBroker{
		clients:   make(map[chan []byte]bool),
		broadcast: make(chan []byte, 100),
		done:      make(chan struct{}),
	}
	go b.run()
	return b
}

// SetInitialProvider registers a snapshot callback flushed immediately to each newly connected SSE client.
func (b *SSEBroker) SetInitialProvider(fn func() map[string]any) {
	b.mu.Lock()
	b.initialProvider = fn
	b.mu.Unlock()
}

func (b *SSEBroker) Close() {
	b.closeOnce.Do(func() {
		close(b.done)
	})
}

func (b *SSEBroker) run() {
	for {
		select {
		case <-b.done:
			return
		case msg := <-b.broadcast:
			b.mu.RLock()
			for ch := range b.clients {
				select {
				case ch <- msg:
				default:
				}
			}
			b.mu.RUnlock()
		}
	}
}

func (b *SSEBroker) BroadcastJSON(data any) {
	bytes, err := json.Marshal(data)
	if err != nil {
		return
	}
	select {
	case <-b.done:
		return
	case b.broadcast <- bytes:
	default:
	}
}

func (b *SSEBroker) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	if rc := http.NewResponseController(w); rc != nil {
		_ = rc.SetWriteDeadline(time.Time{})
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	clientChan := make(chan []byte, 16)
	b.mu.Lock()
	b.clients[clientChan] = true
	provider := b.initialProvider
	b.mu.Unlock()

	defer func() {
		b.mu.Lock()
		delete(b.clients, clientChan)
		close(clientChan)
		b.mu.Unlock()
	}()

	if provider != nil {
		if initBytes, err := json.Marshal(provider()); err == nil {
			if _, err := fmt.Fprintf(w, "data: %s\n\n", initBytes); err != nil {
				return
			}
			flusher.Flush()
		}
	}

	heartbeat := time.NewTicker(25 * time.Second)
	defer heartbeat.Stop()

	notify := r.Context().Done()
	for {
		select {
		case <-b.done:
			return
		case <-notify:
			return
		case <-heartbeat.C:
			if _, err := fmt.Fprint(w, ": keepalive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		case msg, ok := <-clientChan:
			if !ok {
				return
			}
			if _, err := fmt.Fprintf(w, "data: %s\n\n", msg); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}
