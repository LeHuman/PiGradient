package analytics

import "math"

func CalculateDewPoint(tempC, rh float64) float64 {
	if math.IsNaN(tempC) || math.IsInf(tempC, 0) || math.IsNaN(rh) || math.IsInf(rh, 0) {
		return 0
	}
	if rh <= 0 {
		return 0
	}
	if rh > 100 {
		rh = 100
	}
	a := 17.27
	b := 237.7
	if math.Abs(b+tempC) < 1e-6 {
		return 0
	}
	alpha := ((a * tempC) / (b + tempC)) + math.Log(rh/100.0)
	if math.Abs(a-alpha) < 1e-6 {
		return tempC
	}
	dp := (b * alpha) / (a - alpha)
	if math.IsNaN(dp) || math.IsInf(dp, 0) {
		return 0
	}
	return math.Round(dp*10) / 10
}

func CalculateHeatIndex(tempC, rh float64) float64 {
	if math.IsNaN(tempC) || math.IsInf(tempC, 0) || math.IsNaN(rh) || math.IsInf(rh, 0) {
		return 0
	}
	if rh < 0 {
		rh = 0
	} else if rh > 100 {
		rh = 100
	}
	tF := (tempC * 9.0 / 5.0) + 32.0
	if tF < 80.0 {
		return math.Round(tempC*10) / 10
	}
	hiF := -42.379 + 2.04901523*tF + 10.14333127*rh -
		0.22475541*tF*rh - 0.00683783*tF*tF -
		0.05481717*rh*rh + 0.00122874*tF*tF*rh +
		0.00085282*tF*rh*rh - 0.00000199*tF*tF*rh*rh
	return math.Round(((hiF-32.0)*5.0/9.0)*10) / 10
}

func GetCO2Level(co2 int) string {
	switch {
	case co2 < 800:
		return "Good (<800 ppm · Well-ventilated)"
	case co2 < 1000:
		return "Moderate (800–999 ppm · Acceptable)"
	case co2 < 1400:
		return "Elevated (1000–1399 ppm · Ventilate)"
	default:
		return "High (≥1400 ppm · Poor airflow)"
	}
}

func GetCO2Category(co2 int) string {
	switch {
	case co2 < 800:
		return "optimal"
	case co2 < 1000:
		return "fair"
	case co2 < 1400:
		return "poor"
	default:
		return "critical"
	}
}
