package store

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"pigradient/server/collector"
	"pigradient/server/logger"
	_ "modernc.org/sqlite"
)

const maxRetryBuffer = 600 // Retain up to 10 minutes of 1 Hz samples if storage temporarily fails

type StorageManager struct {
	baseDir     string
	mu          sync.Mutex
	activeDB    *sql.DB
	activeMonth string
	activeFile  string
	totalCount  int64
	doneCh      chan struct{}
}

func NewStorageManager(baseDir string) (*StorageManager, error) {
	if err := os.MkdirAll(baseDir, 0755); err != nil {
		return nil, err
	}
	sm := &StorageManager{
		baseDir: baseDir,
		doneCh:  make(chan struct{}),
	}
	if err := sm.rotateDB(time.Now().UTC()); err != nil {
		return nil, err
	}
	return sm, nil
}

// Done closes after StartWriter drains queued samples, checkpoints WAL, and closes SQLite.
func (sm *StorageManager) Done() <-chan struct{} {
	return sm.doneCh
}

func (sm *StorageManager) rotateDB(t time.Time) error {
	monthStr := t.Format("2006_01")
	if sm.activeDB != nil && sm.activeMonth == monthStr {
		return nil
	}

	fileName := fmt.Sprintf("pigradient_%s.db", monthStr)
	dbPath := filepath.Join(sm.baseDir, fileName)
	db, err := sql.Open("sqlite", dbPath+"?_pragma=busy_timeout(5000)")
	if err != nil {
		return err
	}
	db.SetMaxOpenConns(1)

	pragmas := []string{
		"PRAGMA journal_mode = WAL;",
		"PRAGMA synchronous = NORMAL;",
		"PRAGMA wal_autocheckpoint = 1000;",
		"PRAGMA temp_store = MEMORY;",
		"PRAGMA cache_size = -8000;",
	}
	for _, p := range pragmas {
		if _, err := db.Exec(p); err != nil {
			_ = db.Close()
			return err
		}
	}

	schema := `
	CREATE TABLE IF NOT EXISTS readings (
		timestamp INTEGER PRIMARY KEY,
		pm01 REAL, pm02 REAL, pm10 REAL, pm02_comp REAL,
		rco2 INTEGER, atmp REAL, atmp_comp REAL, rhum REAL, rhum_comp REAL,
		tvoc_index INTEGER, tvoc_raw INTEGER, nox_index INTEGER, nox_raw INTEGER
	);
	CREATE INDEX IF NOT EXISTS idx_readings_timestamp ON readings(timestamp ASC);`
	if _, err := db.Exec(schema); err != nil {
		_ = db.Close()
		return err
	}

	if sm.activeDB != nil {
		_, _ = sm.activeDB.Exec("PRAGMA wal_checkpoint(TRUNCATE);")
		_ = sm.activeDB.Close()
	}

	sm.activeDB = db
	sm.activeMonth = monthStr
	sm.activeFile = fileName
	sm.refreshTotalCountLocked()
	logger.Info("Store", "Active SQLite partition mounted: %s (WAL mode)", fileName)
	return nil
}

func (sm *StorageManager) refreshTotalCountLocked() {
	if sm.activeDB == nil {
		return
	}
	var count int64
	if err := sm.activeDB.QueryRow("SELECT COUNT(*) FROM readings").Scan(&count); err == nil {
		sm.totalCount = count
	}
}

func (sm *StorageManager) GetStats() (activePartition string, dbSizeBytes int64, totalRecords int64) {
	sm.mu.Lock()
	activeFile := sm.activeFile
	total := sm.totalCount
	baseDir := sm.baseDir
	sm.mu.Unlock()

	var totalSize int64
	if activeFile != "" {
		for _, suffix := range []string{"", "-wal", "-shm"} {
			if info, err := os.Stat(filepath.Join(baseDir, activeFile+suffix)); err == nil {
				totalSize += info.Size()
			}
		}
	}
	return activeFile, totalSize, total
}

func (sm *StorageManager) StartWriter(ctx context.Context, inChan <-chan collector.SensorRecord) {
	defer close(sm.doneCh)

	buffer := make([]collector.SensorRecord, 0, 30)
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	flush := func() {
		if len(buffer) == 0 {
			return
		}
		writeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		err := sm.recordBatch(writeCtx, buffer)
		cancel()
		if err != nil {
			logger.Error("Store", "Batch insert error (retaining %d queued records): %v", len(buffer), err)
			if len(buffer) > maxRetryBuffer {
				dropped := len(buffer) - maxRetryBuffer
				copy(buffer, buffer[dropped:])
				buffer = buffer[:maxRetryBuffer]
				logger.Warn("Store", "Retry buffer exceeded %d records; dropped %d oldest samples", maxRetryBuffer, dropped)
			}
			return
		}
		buffer = buffer[:0]
	}

	for {
		select {
		case <-ctx.Done():
			// Drain any remaining buffered records from writeQueue before final commit
		drainLoop:
			for {
				select {
				case r := <-inChan:
					buffer = append(buffer, r)
				default:
					break drainLoop
				}
			}
			flush()

			sm.mu.Lock()
			if sm.activeDB != nil {
				_, _ = sm.activeDB.Exec("PRAGMA wal_checkpoint(TRUNCATE);")
				_ = sm.activeDB.Close()
				sm.activeDB = nil
			}
			sm.mu.Unlock()
			return
		case r := <-inChan:
			buffer = append(buffer, r)
			if len(buffer) >= 30 {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}

func (sm *StorageManager) recordBatch(ctx context.Context, records []collector.SensorRecord) error {
	if len(records) == 0 {
		return nil
	}

	sm.mu.Lock()
	defer sm.mu.Unlock()

	batchTime := time.Unix(records[len(records)-1].Timestamp, 0).UTC()
	if records[len(records)-1].Timestamp <= 0 {
		batchTime = time.Now().UTC()
	}
	if err := sm.rotateDB(batchTime); err != nil {
		return err
	}

	tx, err := sm.activeDB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	stmt, err := tx.PrepareContext(ctx, `
		INSERT OR IGNORE INTO readings (
			timestamp, pm01, pm02, pm10, pm02_comp,
			rco2, atmp, atmp_comp, rhum, rhum_comp,
			tvoc_index, tvoc_raw, nox_index, nox_raw
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	var inserted int64
	for _, r := range records {
		res, err := stmt.ExecContext(ctx,
			r.Timestamp, r.PM01, r.PM02, r.PM10, r.PM02Comp,
			r.RCO2, r.ATmp, r.ATmpComp, r.RHum, r.RHumComp,
			r.TVOCIndex, r.TVOCRaw, r.NOxIndex, r.NOxRaw,
		)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			inserted += n
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	sm.totalCount += inserted
	return nil
}
