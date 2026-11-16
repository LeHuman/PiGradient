package store

import (
	"context"
	"database/sql"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
	"pigradient/server/logger"
)

type HistoricalPoint struct {
	Timestamp int64   `json:"timestamp"`
	PM01      float64 `json:"pm01"`
	PM02Comp  float64 `json:"pm02_comp"`
	PM10      float64 `json:"pm10"`
	RCO2      int     `json:"rco2"`
	ATmpComp  float64 `json:"atmp_comp"`
	RHumComp  float64 `json:"rhum_comp"`
	TVOCIndex int     `json:"tvoc_index"`
	NOxIndex  int     `json:"nox_index"`
}

// ExportRow carries one raw (or bucket-averaged) sample with all 14 stored
// columns for the CSV export stream.
type ExportRow struct {
	Timestamp int64
	PM01      float64
	PM02      float64
	PM10      float64
	PM02Comp  float64
	RCO2      int64
	ATmp      float64
	ATmpComp  float64
	RHum      float64
	RHumComp  float64
	TVOCIndex int64
	TVOCRaw   int64
	NOxIndex  int64
	NOxRaw    int64
}

// ResolveMonthlyPartitions discovers existing pigradient_*.db partitions on
// disk (instead of blindly probing every month from the range start) and
// returns the ones whose month overlaps [start, end], sorted chronologically.
func ResolveMonthlyPartitions(baseDir string, start, end time.Time) []string {
	if start.After(end) {
		start, end = end, start
	}
	entries, err := os.ReadDir(baseDir)
	if err != nil {
		logger.Warn("Store", "Could not list storage directory %s: %v", baseDir, err)
		return nil
	}
	var files []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasPrefix(name, "pigradient_") || !strings.HasSuffix(name, ".db") {
			continue
		}
		monthStr := strings.TrimSuffix(strings.TrimPrefix(name, "pigradient_"), ".db")
		monthStart, err := time.Parse("2006_01", monthStr)
		if err != nil {
			continue
		}
		monthEnd := monthStart.AddDate(0, 1, 0)
		// Overlap: partition covers any second of the requested range.
		if !monthStart.After(end) && monthEnd.After(start) {
			files = append(files, filepath.Join(baseDir, name))
		}
	}
	sort.Strings(files)
	return files
}

const historyBucketQuery = `
	SELECT
		(timestamp / ?) * ? AS bucket,
		ROUND(AVG(pm01), 1),
		ROUND(AVG(pm02_comp), 1),
		ROUND(AVG(pm10), 1),
		CAST(ROUND(AVG(rco2)) AS INTEGER),
		ROUND(AVG(atmp_comp), 1),
		ROUND(AVG(rhum_comp), 1),
		CAST(ROUND(AVG(tvoc_index)) AS INTEGER),
		CAST(ROUND(AVG(nox_index)) AS INTEGER)
	FROM readings
	WHERE timestamp >= ? AND timestamp <= ?
	GROUP BY bucket
	ORDER BY bucket ASC;
`

const exportRawQuery = `
	SELECT timestamp, pm01, pm02, pm10, pm02_comp, rco2, atmp, atmp_comp,
	       rhum, rhum_comp, tvoc_index, tvoc_raw, nox_index, nox_raw
	FROM readings
	WHERE timestamp >= ? AND timestamp <= ?
	ORDER BY timestamp ASC;
`

const exportBucketQuery = `
	SELECT
		(timestamp / ?) * ? AS bucket,
		ROUND(AVG(pm01), 2), ROUND(AVG(pm02), 2), ROUND(AVG(pm10), 2), ROUND(AVG(pm02_comp), 2),
		CAST(ROUND(AVG(rco2)) AS INTEGER),
		ROUND(AVG(atmp), 2), ROUND(AVG(atmp_comp), 2), ROUND(AVG(rhum), 2), ROUND(AVG(rhum_comp), 2),
		CAST(ROUND(AVG(tvoc_index)) AS INTEGER), CAST(ROUND(AVG(tvoc_raw)) AS INTEGER),
		CAST(ROUND(AVG(nox_index)) AS INTEGER), CAST(ROUND(AVG(nox_raw)) AS INTEGER)
	FROM readings
	WHERE timestamp >= ? AND timestamp <= ?
	GROUP BY bucket
	ORDER BY bucket ASC;
`

// QueryHistoricalBuckets aggregates readings into interval-sized buckets.
// Partitions are discovered from the directory, opened read-only, and queried
// with ctx cancellation; duplicate seam buckets (one bucket straddling a month
// boundary) are merged by averaging the two rows.
func QueryHistoricalBuckets(ctx context.Context, baseDir string, start, end int64, interval int) ([]HistoricalPoint, error) {
	if start > end {
		start, end = end, start
	}
	if interval < 1 {
		interval = 1
	} else if interval > 86400 {
		interval = 86400
	}

	dbPaths := ResolveMonthlyPartitions(baseDir, time.Unix(start, 0).UTC(), time.Unix(end, 0).UTC())

	var combined []HistoricalPoint

	for _, dbPath := range dbPaths {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		db, err := sql.Open("sqlite", readOnlyDSN(dbPath))
		if err != nil {
			logger.Warn("Store", "Failed opening historical partition %s: %v", filepath.Base(dbPath), err)
			continue
		}

		rows, err := db.QueryContext(ctx, historyBucketQuery, interval, interval, start, end)
		if err != nil {
			logger.Warn("Store", "Historical query failed on %s: %v", filepath.Base(dbPath), err)
			_ = db.Close()
			continue
		}

		for rows.Next() {
			var p HistoricalPoint
			if err := rows.Scan(&p.Timestamp, &p.PM01, &p.PM02Comp, &p.PM10, &p.RCO2, &p.ATmpComp, &p.RHumComp, &p.TVOCIndex, &p.NOxIndex); err == nil {
				combined = append(combined, p)
			}
		}
		if err := rows.Err(); err != nil {
			logger.Warn("Store", "Row iteration error on %s: %v", filepath.Base(dbPath), err)
		}
		_ = rows.Close()
		_ = db.Close()
	}

	if len(combined) > 1 {
		sort.Slice(combined, func(i, j int) bool {
			return combined[i].Timestamp < combined[j].Timestamp
		})
	}
	mergeDuplicateBuckets(combined)
	if combined == nil {
		combined = []HistoricalPoint{}
	}
	return combined, nil
}

// mergeDuplicateBuckets averages adjacent rows sharing a Timestamp. Such
// duplicates only occur when a bucket straddles a monthly partition seam.
func mergeDuplicateBuckets(points []HistoricalPoint) {
	out := points[:0]
	for i, p := range points {
		if i > 0 && p.Timestamp == out[len(out)-1].Timestamp {
			last := &out[len(out)-1]
			last.PM01 = (last.PM01 + p.PM01) / 2
			last.PM02Comp = (last.PM02Comp + p.PM02Comp) / 2
			last.PM10 = (last.PM10 + p.PM10) / 2
			last.ATmpComp = (last.ATmpComp + p.ATmpComp) / 2
			last.RHumComp = (last.RHumComp + p.RHumComp) / 2
			last.RCO2 = int(math.Round(float64(last.RCO2+p.RCO2) / 2))
			last.TVOCIndex = int(math.Round(float64(last.TVOCIndex+p.TVOCIndex) / 2))
			last.NOxIndex = int(math.Round(float64(last.NOxIndex+p.NOxIndex) / 2))
			continue
		}
		out = append(out, p)
	}
}

// StreamHistoricalRows feeds every matching raw (interval==1) or
// bucket-averaged (interval>1) row to emit in chronological order, one
// partition at a time, so callers can stream with O(1) memory. A seam bucket
// may be emitted once per adjacent partition; callers merge identical
// timestamps. Emitted rows honor ctx cancellation between partitions and
// during queries.
func StreamHistoricalRows(ctx context.Context, baseDir string, start, end int64, interval int, emit func(ExportRow) error) error {
	if start > end {
		start, end = end, start
	}
	if interval < 1 {
		interval = 1
	} else if interval > 86400 {
		interval = 86400
	}

	dbPaths := ResolveMonthlyPartitions(baseDir, time.Unix(start, 0).UTC(), time.Unix(end, 0).UTC())

	for _, dbPath := range dbPaths {
		if err := ctx.Err(); err != nil {
			return err
		}
		db, err := sql.Open("sqlite", readOnlyDSN(dbPath))
		if err != nil {
			logger.Warn("Store", "Failed opening export partition %s: %v", filepath.Base(dbPath), err)
			continue
		}

		var rows *sql.Rows
		if interval == 1 {
			rows, err = db.QueryContext(ctx, exportRawQuery, start, end)
		} else {
			rows, err = db.QueryContext(ctx, exportBucketQuery, interval, interval, start, end)
		}
		if err != nil {
			logger.Warn("Store", "Export query failed on %s: %v", filepath.Base(dbPath), err)
			_ = db.Close()
			continue
		}

		abort := false
		var emitErr error
		for rows.Next() {
			var row ExportRow
			if err := rows.Scan(&row.Timestamp, &row.PM01, &row.PM02, &row.PM10, &row.PM02Comp,
				&row.RCO2, &row.ATmp, &row.ATmpComp, &row.RHum, &row.RHumComp,
				&row.TVOCIndex, &row.TVOCRaw, &row.NOxIndex, &row.NOxRaw); err != nil {
				logger.Warn("Store", "Export row scan error on %s: %v", filepath.Base(dbPath), err)
				continue
			}
			if err := emit(row); err != nil {
				emitErr = err
				abort = true
				break
			}
		}
		if err := rows.Err(); err != nil {
			logger.Warn("Store", "Export row iteration error on %s: %v", filepath.Base(dbPath), err)
		}
		_ = rows.Close()
		_ = db.Close()
		if abort {
			if cerr := ctx.Err(); cerr != nil {
				return cerr
			}
			return emitErr
		}
	}
	return nil
}
