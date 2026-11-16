package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"

	"pigradient/server/logger"
	_ "modernc.org/sqlite"
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

func ResolveMonthlyPartitions(baseDir string, start, end time.Time) []string {
	if start.After(end) {
		start, end = end, start
	}
	var files []string
	cursor := time.Date(start.Year(), start.Month(), 1, 0, 0, 0, 0, time.UTC)
	endMonth := time.Date(end.Year(), end.Month(), 1, 0, 0, 0, 0, time.UTC)

	for !cursor.After(endMonth) {
		path := filepath.Join(baseDir, fmt.Sprintf("pigradient_%s.db", cursor.Format("2006_01")))
		if _, err := os.Stat(path); err == nil {
			files = append(files, path)
		}
		cursor = cursor.AddDate(0, 1, 0)
	}
	return files
}

func QueryHistoricalBuckets(baseDir string, start, end int64, interval int) ([]HistoricalPoint, error) {
	if start > end {
		start, end = end, start
	}
	if interval < 1 {
		interval = 1
	} else if interval > 86400 {
		interval = 86400
	}

	startTime := time.Unix(start, 0).UTC()
	endTime := time.Unix(end, 0).UTC()
	dbPaths := ResolveMonthlyPartitions(baseDir, startTime, endTime)

	query := `
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

	var combined []HistoricalPoint

	for _, dbPath := range dbPaths {
		db, err := sql.Open("sqlite", dbPath+"?_pragma=busy_timeout(3000)&_pragma=query_only(1)")
		if err != nil {
			logger.Warn("Store", "Failed opening historical partition %s: %v", filepath.Base(dbPath), err)
			continue
		}

		rows, err := db.Query(query, interval, interval, start, end)
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
	if combined == nil {
		combined = []HistoricalPoint{}
	}
	return combined, nil
}
