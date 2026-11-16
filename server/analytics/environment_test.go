package analytics

import (
	"math"
	"testing"
)

func TestCalculateDewPointAndAQI(t *testing.T) {
	if dp := CalculateDewPoint(22.0, 0); math.IsNaN(dp) || math.IsInf(dp, 0) {
		t.Fatalf("expected finite dew point when rh=0, got %v", dp)
	}
	if dp := CalculateDewPoint(22.0, 50.0); dp < 10.0 || dp > 12.0 {
		t.Fatalf("unexpected dew point at 22C/50%%: %v", dp)
	}
	aqi := CalculateAQI(5.1)
	if aqi.AQI <= 0 || aqi.Category != "Good" {
		t.Fatalf("unexpected AQI result: %+v", aqi)
	}
	if cat := GetCO2Category(650); cat != "optimal" {
		t.Fatalf("expected optimal co2 category, got %s", cat)
	}
	if cat := GetCO2Category(1500); cat != "critical" {
		t.Fatalf("expected critical co2 category, got %s", cat)
	}
}
