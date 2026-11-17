package store

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	_ "modernc.org/sqlite"
	"pigradient/server/collector"
	"pigradient/server/logger"
)

const (
	// maxRetryBuffer retains up to 6 hours of 1 Hz samples when storage
	// temporarily fails (~2.4 MB of RAM) instead of dropping history early.
	maxRetryBuffer = 21600

	// flushChunkSize bounds each recordBatch transaction during a flush so
	// even a full retry buffer commits in well-under-5s slices on slow USB
	// storage instead of rolling back wholesale on a single timeout.
	flushChunkSize = 2000

	// checkpointInterval is how often the writer forces a WAL TRUNCATE
	// checkpoint even when flushes are not happening.
	checkpointInterval = 15 * time.Minute

	// minSaneRecordEpoch (2025-01-01 00:00:00 UTC) rejects samples stamped by
	// an unsynced clock; a 1970 timestamp would poison monthly partitions.
	minSaneRecordEpoch = int64(1735689600)

	// backwardsClockSlack tolerates up to 24 h of clock skew versus the newest
	// stored sample; anything older is treated as a backwards clock jump.
	backwardsClockSlack = int64(86400)
)

// upsertSQL keeps retried same-second samples updating in place instead of
// being silently dropped by INSERT OR IGNORE (all 13 value columns).
const upsertSQL = `
	INSERT INTO readings (
		timestamp, pm01, pm02, pm10, pm02_comp,
		rco2, atmp, atmp_comp, rhum, rhum_comp,
		tvoc_index, tvoc_raw, nox_index, nox_raw,
		pm01_standard, pm02_standard, pm10_standard,
		pm003_count, pm005_count, pm01_count, pm02_count, pm50_count, pm10_count
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(timestamp) DO UPDATE SET
		pm01 = excluded.pm01, pm02 = excluded.pm02, pm10 = excluded.pm10, pm02_comp = excluded.pm02_comp,
		rco2 = excluded.rco2, atmp = excluded.atmp, atmp_comp = excluded.atmp_comp,
		rhum = excluded.rhum, rhum_comp = excluded.rhum_comp,
		tvoc_index = excluded.tvoc_index, tvoc_raw = excluded.tvoc_raw,
		nox_index = excluded.nox_index, nox_raw = excluded.nox_raw,
		pm01_standard = excluded.pm01_standard, pm02_standard = excluded.pm02_standard,
		pm10_standard = excluded.pm10_standard,
		pm003_count = excluded.pm003_count, pm005_count = excluded.pm005_count,
		pm01_count = excluded.pm01_count, pm02_count = excluded.pm02_count,
		pm50_count = excluded.pm50_count, pm10_count = excluded.pm10_count
`

func dbDSN(path string) string {
	return path + "?_pragma=busy_timeout(5000)"
}

// readOnlyDSN opens an existing partition for history/export queries without
// any chance of mutating it (mode=ro + query_only). The file: URI prefix is
// required: modernc.org/sqlite only honors URI parameters (and SQLITE_OPEN_READONLY)
// for file: DSNs; a bare path would silently open READWRITE|CREATE, letting a
// history query touch closed partitions (-wal/-shm churn).
func readOnlyDSN(path string) string {
	return "file:" + filepath.ToSlash(path) + "?mode=ro&_pragma=busy_timeout(3000)&_pragma=query_only(1)"
}

// storageStats is a mutex-guarded snapshot decoupled from sm.mu so GetStats /
// /api/v1/system never block on (or race with) the writer's insert transaction.
type storageStats struct {
	mu               sync.RWMutex
	activeFile       string
	dbSize           int64
	lastWriteError   string
	lastWriteErrorAt time.Time
	lastSuccessAt    time.Time
}

type StorageManager struct {
	baseDir     string
	mu          sync.Mutex
	activeDB    *sql.DB
	activeMonth string
	activeFile  string
	doneCh      chan struct{}

	// finalizedCounts remembers each unmounted partition's row count so the
	// reported total keeps covering previous months after a rotation.
	finalizedCounts map[string]int64

	// Lightweight stats, safe to read while a flush is in flight.
	totalRecords       atomic.Int64
	errorCount         atomic.Int64
	droppedSamples     atomic.Int64
	maxStoredTimestamp atomic.Int64 // global high-water mark, monotonic
	stats              storageStats
	queueLen           atomic.Pointer[func() int]
	queueCap           atomic.Int64
	lastRejectLog      atomic.Int64 // unix seconds of last rate-limited reject log
}

func NewStorageManager(baseDir string) (*StorageManager, error) {
	if err := os.MkdirAll(baseDir, 0755); err != nil {
		return nil, err
	}
	sm := &StorageManager{
		baseDir:         baseDir,
		doneCh:          make(chan struct{}),
		finalizedCounts: make(map[string]int64),
	}
	// Fold orphaned -wal sidecars from previous crashed runs into their main
	// database files BEFORE mounting, so non-active partitions are left with a
	// single stable .db file for the cloud sync agent and read-only history.
	sm.checkpointOrphanedWALs(time.Now().UTC().Format("2006_01"))
	if err := sm.rotateDB(time.Now().UTC()); err != nil {
		return nil, err
	}
	return sm, nil
}

// Done closes after StartWriter drains queued samples, checkpoints WAL, and closes SQLite.
func (sm *StorageManager) Done() <-chan struct{} {
	return sm.doneCh
}

// SetQueueLenFunc wires a cheap queue-depth probe (len of the writeQueue
// channel is safe and O(1) in Go) plus that channel's capacity, used by
// StorageStatus to flag a nearly-full write queue as degraded.
func (sm *StorageManager) SetQueueLenFunc(fn func() int, queueCap int) {
	sm.queueLen.Store(&fn)
	sm.queueCap.Store(int64(queueCap))
}

// checkpointOrphanedWALs briefly opens every non-active monthly partition that
// still has a -wal sidecar and truncates it into the main file. Runs only at
// startup, before the active partition is mounted.
func (sm *StorageManager) checkpointOrphanedWALs(activeMonth string) {
	entries, err := os.ReadDir(sm.baseDir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasPrefix(name, "pigradient_") || !strings.HasSuffix(name, ".db") {
			continue
		}
		month := strings.TrimSuffix(strings.TrimPrefix(name, "pigradient_"), ".db")
		if _, err := time.Parse("2006_01", month); err != nil {
			continue
		}
		if month == activeMonth {
			continue
		}
		if _, err := os.Stat(filepath.Join(sm.baseDir, name+"-wal")); err != nil {
			continue // nothing orphaned for this partition
		}
		db, err := sql.Open("sqlite", dbDSN(filepath.Join(sm.baseDir, name)))
		if err != nil {
			logger.Warn("Store", "Could not open %s to checkpoint orphaned WAL: %v", name, err)
			continue
		}
		if _, err := db.Exec("PRAGMA wal_checkpoint(TRUNCATE);"); err != nil {
			logger.Warn("Store", "Orphaned WAL checkpoint failed for %s: %v", name, err)
		} else {
			logger.Info("Store", "Checkpointed orphaned WAL sidecar for %s", name)
		}
		_ = db.Close()
	}
}

func (sm *StorageManager) rotateDB(t time.Time) error {
	monthStr := t.Format("2006_01")
	if sm.activeDB != nil && sm.activeMonth == monthStr {
		return nil
	}

	fileName := fmt.Sprintf("pigradient_%s.db", monthStr)
	dbPath := filepath.Join(sm.baseDir, fileName)
	db, err := sql.Open("sqlite", dbDSN(dbPath))
	if err != nil {
		return err
	}
	db.SetMaxOpenConns(1)

	pragmas := []string{
		"PRAGMA journal_mode = WAL;",
		"PRAGMA synchronous = NORMAL;",
		// Autocheckpoint disabled: the main .db file only ever changes during
		// our own explicit checkpoints (after each flush + every 15 minutes),
		// so a cloud sync agent never snapshots a torn mid-autocheckpoint file.
		"PRAGMA wal_autocheckpoint = 0;",
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
		tvoc_index INTEGER, tvoc_raw INTEGER, nox_index INTEGER, nox_raw INTEGER,
		pm01_standard REAL, pm02_standard REAL, pm10_standard REAL,
		pm003_count REAL, pm005_count REAL, pm01_count REAL,
		pm02_count REAL, pm50_count REAL, pm10_count REAL
	);`
	// idx_readings_timestamp removed: redundant with the INTEGER PRIMARY KEY rowid.
	if _, err := db.Exec(schema); err != nil {
		_ = db.Close()
		return err
	}

	// Migrate pre-existing partitions created before the particle-count
	// archive extension: ALTER each new column in; older rows keep NULL.
	// Skip when already migrated (avoids nine guaranteed-duplicate ALTERs on
	// every re-mount); "duplicate column name" errors mean the partition was
	// migrated concurrently or mid-loop by an earlier run — tolerated, since
	// a partially migrated table safely degrades to the legacy export path.
	if !partitionHasCountColumns(db) {
		for _, col := range []string{
			"pm01_standard", "pm02_standard", "pm10_standard",
			"pm003_count", "pm005_count", "pm01_count", "pm02_count", "pm50_count", "pm10_count",
		} {
			if _, err := db.Exec("ALTER TABLE readings ADD COLUMN " + col + " REAL"); err != nil {
				if !strings.Contains(err.Error(), "duplicate column name") {
					_ = db.Close()
					return err
				}
			}
		}
	}

	if sm.activeDB != nil {
		// Remember the outgoing partition's row count before letting it go so
		// the reported total keeps covering previous months.
		if n, err := countRows(sm.activeDB); err == nil {
			sm.finalizedCounts[sm.activeMonth] = n
		}
		_, _ = sm.activeDB.Exec("PRAGMA wal_checkpoint(TRUNCATE);")
		_ = sm.activeDB.Close()
	}

	sm.activeDB = db
	sm.activeMonth = monthStr
	sm.activeFile = fileName
	sm.refreshPartitionStatsLocked()
	logger.Info("Store", "Active SQLite partition mounted: %s (WAL mode, autocheckpoint off)", fileName)
	return nil
}

func countRows(db *sql.DB) (int64, error) {
	var n int64
	err := db.QueryRow("SELECT COUNT(*) FROM readings").Scan(&n)
	return n, err
}

// refreshPartitionStatsLocked must be called with sm.mu held. Re-seeds the
// total record count (previous months + freshly mounted partition) and raises
// the global timestamp watermark so same-second retries are never double-counted.
func (sm *StorageManager) refreshPartitionStatsLocked() {
	if sm.activeDB == nil {
		return
	}
	var activeCount int64
	if n, err := countRows(sm.activeDB); err == nil {
		activeCount = n
	}
	var prior int64
	for month, n := range sm.finalizedCounts {
		if month != sm.activeMonth {
			prior += n
		}
	}
	sm.totalRecords.Store(prior + activeCount)

	var maxTS sql.NullInt64
	if err := sm.activeDB.QueryRow("SELECT MAX(timestamp) FROM readings").Scan(&maxTS); err == nil && maxTS.Valid {
		// Watermark is monotonic: remounting an older partition (late samples
		// within the 24 h slack) must never rewind it, or newer rows would be
		// re-counted as inserts on the next flush.
		if maxTS.Int64 > sm.maxStoredTimestamp.Load() {
			sm.maxStoredTimestamp.Store(maxTS.Int64)
		}
	}
	sm.stats.mu.Lock()
	sm.stats.activeFile = sm.activeFile
	sm.stats.mu.Unlock()
	sm.refreshStats()
}

// refreshStats recomputes the on-disk size of the active partition after a
// checkpoint or rotation, without touching sm.mu.
func (sm *StorageManager) refreshStats() {
	sm.stats.mu.RLock()
	file := sm.stats.activeFile
	sm.stats.mu.RUnlock()
	if file == "" {
		return
	}
	var size int64
	if info, err := os.Stat(filepath.Join(sm.baseDir, file)); err == nil {
		size = info.Size()
	}
	sm.stats.mu.Lock()
	sm.stats.dbSize = size
	sm.stats.mu.Unlock()
}

// checkpointActive forces a WAL TRUNCATE checkpoint on the active partition.
// Only ever called OUTSIDE insert transactions (sm.mu serializes against
// recordBatch), so the cloud sync agent never observes a torn checkpoint.
func (sm *StorageManager) checkpointActive() {
	sm.mu.Lock()
	db := sm.activeDB
	if db != nil {
		_, _ = db.Exec("PRAGMA wal_checkpoint(TRUNCATE);")
	}
	sm.mu.Unlock()
	if db != nil {
		sm.refreshStats()
	}
}

// GetStats is non-blocking: it never takes sm.mu and always answers from the
// lightweight stats snapshot (or cheap atomics).
func (sm *StorageManager) GetStats() (activePartition string, dbSizeBytes int64, totalRecords int64) {
	sm.stats.mu.RLock()
	activeFile, size := sm.stats.activeFile, sm.stats.dbSize
	sm.stats.mu.RUnlock()
	return activeFile, size, sm.totalRecords.Load()
}

// DroppedSamples reports how many samples were discarded because the retry
// buffer overflowed during a storage outage.
func (sm *StorageManager) DroppedSamples() int64 {
	return sm.droppedSamples.Load()
}

// QueuedRecords reports the current writeQueue depth (-1 when no probe wired).
func (sm *StorageManager) QueuedRecords() int {
	if fn := sm.queueLen.Load(); fn != nil {
		return (*fn)()
	}
	return -1
}

// DiskFreeBytes reports available space on the storage partition's filesystem
// (-1 when unknown, e.g. non-Linux targets).
func (sm *StorageManager) DiskFreeBytes() int64 {
	return freeDiskSpaceBytes(sm.baseDir)
}

// LastWriteError returns the most recent write error while it is still the
// latest state ("" once a later write succeeds, "" when nothing ever failed).
func (sm *StorageManager) LastWriteError() string {
	sm.stats.mu.RLock()
	defer sm.stats.mu.RUnlock()
	if sm.stats.lastWriteErrorAt.IsZero() || sm.stats.lastSuccessAt.After(sm.stats.lastWriteErrorAt) {
		return ""
	}
	return sm.stats.lastWriteError
}

// StorageStatus classifies the storage pipeline for the system endpoint:
// "error" when the latest event was a failed write, "degraded" when samples
// have been dropped or the write queue is nearly full, otherwise "ok".
func (sm *StorageManager) StorageStatus() string {
	sm.stats.mu.RLock()
	errAt, okAt := sm.stats.lastWriteErrorAt, sm.stats.lastSuccessAt
	sm.stats.mu.RUnlock()
	if !errAt.IsZero() && (okAt.IsZero() || errAt.After(okAt)) {
		return "error"
	}
	if sm.droppedSamples.Load() > 0 {
		return "degraded"
	}
	if qcap := sm.queueCap.Load(); qcap > 0 {
		if fn := sm.queueLen.Load(); fn != nil && int64((*fn)())*5 > qcap*4 {
			return "degraded"
		}
	}
	return "ok"
}

func (sm *StorageManager) recordWriteError(err error) {
	sm.errorCount.Add(1)
	msg := err.Error()
	now := time.Now()
	sm.stats.mu.Lock()
	sm.stats.lastWriteError = msg
	sm.stats.lastWriteErrorAt = now
	sm.stats.mu.Unlock()
}

func (sm *StorageManager) recordWriteSuccess() {
	sm.stats.mu.Lock()
	sm.stats.lastSuccessAt = time.Now()
	sm.stats.mu.Unlock()
}

// logRejectedSample rate-limits poisoned-sample warnings to one per minute.
func (sm *StorageManager) logRejectedSample(reason string, r collector.SensorRecord) {
	now := time.Now().UTC().Unix()
	last := sm.lastRejectLog.Load()
	if last != 0 && now-last < 60 {
		return
	}
	if sm.lastRejectLog.CompareAndSwap(last, now) {
		logger.Error("Store", "%s; dropping sample (ts=%d, rate-limited to once per minute)", reason, r.Timestamp)
	}
}

func (sm *StorageManager) StartWriter(ctx context.Context, inChan <-chan collector.SensorRecord) {
	defer close(sm.doneCh)

	buffer := make([]collector.SensorRecord, 0, 30)
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	ckptTicker := time.NewTicker(checkpointInterval)
	defer ckptTicker.Stop()

	healthy := true           // false from the first failed flush until one succeeds
	failing := false          // inside a consecutive-error run (for log rate limiting)
	lastErrLog := time.Time{} // last time a batch-insert error was logged

	flush := func() {
		if len(buffer) == 0 {
			return
		}
		// Flush in bounded chunks: a full 21600-row retry buffer cannot commit
		// inside a single 5s transaction on slow USB storage (upserts plus a
		// possible month rotation), so it would roll back whole every tick and
		// livelock. Each chunk gets its own fresh 5s timeout; loop until the
		// buffer is drained or a chunk fails.
		flushed := 0
		var flushErr error
		for flushed < len(buffer) {
			end := flushed + flushChunkSize
			if end > len(buffer) {
				end = len(buffer)
			}
			writeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			err := sm.recordBatch(writeCtx, buffer[flushed:end])
			cancel()
			if err != nil {
				flushErr = err
				break
			}
			flushed = end
		}
		if flushErr != nil {
			healthy = false
			failing = true
			// Rate limit: first error of a failure run immediately, then at
			// most one line per minute while the outage continues.
			if lastErrLog.IsZero() || time.Since(lastErrLog) >= time.Minute {
				logger.Error("Store", "Batch insert error (retaining %d queued records): %v", len(buffer)-flushed, flushErr)
				lastErrLog = time.Now()
			}
			sm.recordWriteError(flushErr)
			// Keep only the un-flushed remainder for retry (chunks that
			// already committed are done), then trim to the retry cap,
			// dropping the oldest samples on overflow.
			if flushed > 0 {
				copy(buffer, buffer[flushed:])
				buffer = buffer[:len(buffer)-flushed]
			}
			if len(buffer) > maxRetryBuffer {
				dropped := len(buffer) - maxRetryBuffer
				copy(buffer, buffer[dropped:])
				buffer = buffer[:maxRetryBuffer]
				sm.droppedSamples.Add(int64(dropped))
				logger.Warn("Store", "Retry buffer exceeded %d records; dropped %d oldest samples", maxRetryBuffer, dropped)
			}
			return
		}
		n := len(buffer)
		if failing {
			failing = false
			lastErrLog = time.Time{}
			logger.Info("Store", "Storage write recovered; flushed %d queued samples", n)
		}
		healthy = true
		buffer = buffer[:0]
		sm.recordWriteSuccess()
		// Checkpoint right after a successful flush — outside the insert
		// transaction (recordBatch already released sm.mu) — so the .db file's
		// mutations stay under our control for the cloud sync agent.
		sm.checkpointActive()
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
			sm.refreshStats()
			return
		case r := <-inChan:
			buffer = append(buffer, r)
			// While writes are failing, only the 5s ticker flushes; re-trying
			// the same broken storage once per incoming sample just burns I/O.
			if healthy && len(buffer) >= 30 {
				flush()
			}
		case <-ticker.C:
			flush()
		case <-ckptTicker.C:
			// Periodic WAL truncation keeps sidecars tiny even when writes are
			// idle or the queue is stalled.
			sm.checkpointActive()
		}
	}
}

func (sm *StorageManager) recordBatch(ctx context.Context, records []collector.SensorRecord) error {
	if len(records) == 0 {
		return nil
	}

	// Group records by YYYY_MM partition (a batch straddling a month boundary
	// must be split) while dropping samples from an unsynced or backwards
	// jumping clock.
	globalMax := sm.maxStoredTimestamp.Load()
	groups := make(map[string][]collector.SensorRecord)
	var months []string
	for _, r := range records {
		if r.Timestamp < minSaneRecordEpoch {
			sm.logRejectedSample("clock not synced (timestamp predates 2025-01-01)", r)
			continue
		}
		if globalMax > 0 && r.Timestamp < globalMax-backwardsClockSlack {
			sm.logRejectedSample(fmt.Sprintf("backwards clock (timestamp %d is over 24h older than newest stored %d)", r.Timestamp, globalMax), r)
			continue
		}
		month := time.Unix(r.Timestamp, 0).UTC().Format("2006_01")
		if _, seen := groups[month]; !seen {
			months = append(months, month)
		}
		groups[month] = append(groups[month], r)
	}
	if len(months) == 0 {
		return nil
	}
	// Ascending order keeps rotations monotonic within a batch.
	sort.Strings(months)

	sm.mu.Lock()
	defer sm.mu.Unlock()

	for _, month := range months {
		recs := groups[month]
		// Intra-group ordering makes new-row counting (and inserts) exact even
		// when a batch arrives out of order.
		sort.Slice(recs, func(i, j int) bool { return recs[i].Timestamp < recs[j].Timestamp })
		if err := sm.rotateDB(time.Unix(recs[0].Timestamp, 0).UTC()); err != nil {
			sm.resetActiveDBLocked()
			return err
		}
		inserted, groupMax, err := sm.insertGroup(ctx, recs)
		if err != nil {
			sm.resetActiveDBLocked()
			return err
		}
		if inserted > 0 {
			sm.totalRecords.Add(inserted)
		}
		// The global watermark only advances after a group commits, so failed
		// batches stay fully retryable while committed rows count exactly once.
		if groupMax > globalMax {
			globalMax = groupMax
			sm.maxStoredTimestamp.Store(globalMax)
		}
	}
	return nil
}

// resetActiveDBLocked (caller holds sm.mu) closes the active connection so the
// next flush reopens/rotates cleanly instead of reusing a suspect handle.
// activeFile/activeMonth are kept; the next rotateDB reopens or rotates.
func (sm *StorageManager) resetActiveDBLocked() {
	if sm.activeDB != nil {
		_ = sm.activeDB.Close()
		sm.activeDB = nil
	}
}

// insertGroup upserts one month's records in a single transaction. New-row
// counting is seeded from the partition's actual MAX(timestamp): rows beyond
// it are genuinely new (including rows newer than the global watermark when a
// batch arrives out of order), while retried same-second samples only update.
// Returns the inserted count and the partition's post-insert max timestamp.
func (sm *StorageManager) insertGroup(ctx context.Context, recs []collector.SensorRecord) (int64, int64, error) {
	var maxScan sql.NullInt64
	if err := sm.activeDB.QueryRow("SELECT MAX(timestamp) FROM readings").Scan(&maxScan); err != nil {
		return 0, 0, err
	}
	partitionMax := int64(0)
	if maxScan.Valid {
		partitionMax = maxScan.Int64
	}

	tx, err := sm.activeDB.BeginTx(ctx, nil)
	if err != nil {
		return 0, partitionMax, err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	stmt, err := tx.PrepareContext(ctx, upsertSQL)
	if err != nil {
		return 0, partitionMax, err
	}
	defer stmt.Close()

	var inserted int64
	for _, r := range recs {
		if _, err := stmt.ExecContext(ctx,
			r.Timestamp, r.PM01, r.PM02, r.PM10, r.PM02Comp,
			r.RCO2, r.ATmp, r.ATmpComp, r.RHum, r.RHumComp,
			r.TVOCIndex, r.TVOCRaw, r.NOxIndex, r.NOxRaw,
			r.PM01Std, r.PM02Std, r.PM10Std,
			r.PM003Cnt, r.PM005Cnt, r.PM01Cnt, r.PM02Cnt, r.PM50Cnt, r.PM10Cnt,
		); err != nil {
			return 0, partitionMax, err
		}
		if r.Timestamp > partitionMax {
			inserted++
			partitionMax = r.Timestamp
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, partitionMax, err
	}
	return inserted, partitionMax, nil
}
