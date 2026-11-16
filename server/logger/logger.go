package logger

import (
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"
)

type Level string

const (
	INFO  Level = "INFO"
	WARN  Level = "WARN"
	ERROR Level = "ERROR"
	DEBUG Level = "DEBUG"
)

type Entry struct {
	ID        string `json:"id"`
	Timestamp int64  `json:"timestamp"`
	Level     Level  `json:"level"`
	Component string `json:"component"`
	Message   string `json:"message"`
}

const maxEntries = 500

var (
	mu      sync.RWMutex
	entries = make([]Entry, 0, maxEntries)
	seq     atomic.Uint64
)

func add(level Level, component, format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	id := fmt.Sprintf("%d-%d", time.Now().UnixNano(), seq.Add(1))
	entry := Entry{
		ID:        id,
		Timestamp: time.Now().UTC().Unix(),
		Level:     level,
		Component: component,
		Message:   msg,
	}

	mu.Lock()
	if len(entries) >= maxEntries {
		copy(entries, entries[1:])
		entries[len(entries)-1] = entry
	} else {
		entries = append(entries, entry)
	}
	mu.Unlock()

	log.Printf("[%s] [%s] %s", level, component, msg)
}

func Info(component, format string, args ...any)  { add(INFO, component, format, args...) }
func Warn(component, format string, args ...any)  { add(WARN, component, format, args...) }
func Error(component, format string, args ...any) { add(ERROR, component, format, args...) }
func Debug(component, format string, args ...any) { add(DEBUG, component, format, args...) }

func Entries() []Entry {
	mu.RLock()
	defer mu.RUnlock()
	out := make([]Entry, len(entries))
	copy(out, entries)
	return out
}
