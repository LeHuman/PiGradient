package analytics

import "math"

type AQIResult struct {
	AQI      int    `json:"aqi"`
	Category string `json:"category"`
	ColorHex string `json:"color_hex"`
}

type aqiBreakpoint struct {
	cLow, cHigh float64
	iLow, iHigh float64
	category    string
	color       string
}

// EPA AQI breakpoints for PM2.5 (ug/m3)
var breakpoints = []aqiBreakpoint{
	{0.0, 12.0, 0, 50, "Good", "#10B981"},
	{12.1, 35.4, 51, 100, "Moderate", "#F59E0B"},
	{35.5, 55.4, 101, 150, "Unhealthy for Sensitive Groups", "#F97316"},
	{55.5, 150.4, 151, 200, "Unhealthy", "#EF4444"},
	{150.5, 250.4, 201, 300, "Very Unhealthy", "#8B5CF6"},
	{250.5, 500.4, 301, 500, "Hazardous", "#7F1D1D"},
}

func CalculateAQI(pm25 float64) AQIResult {
	if math.IsNaN(pm25) || math.IsInf(pm25, 0) || pm25 < 0 {
		return AQIResult{AQI: 0, Category: "Good", ColorHex: "#10B981"}
	}
	c := math.Round(pm25*10) / 10

	for _, bp := range breakpoints {
		if c >= bp.cLow && c <= bp.cHigh {
			aqi := ((bp.iHigh - bp.iLow) / (bp.cHigh - bp.cLow)) * (c - bp.cLow) + bp.iLow
			return AQIResult{
				AQI:      int(math.Round(aqi)),
				Category: bp.category,
				ColorHex: bp.color,
			}
		}
	}

	if c > 500.4 {
		return AQIResult{AQI: 500, Category: "Hazardous", ColorHex: "#7F1D1D"}
	}
	return AQIResult{AQI: 0, Category: "Good", ColorHex: "#10B981"}
}
