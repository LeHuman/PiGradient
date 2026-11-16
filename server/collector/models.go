package collector

type AirGradientRaw struct {
	SerialNo        string   `json:"serialno"`
	WiFi            int      `json:"wifi"`
	Firmware        string   `json:"firmware"`
	Model           string   `json:"model"`
	PM01            float64  `json:"pm01"`
	PM02            float64  `json:"pm02"`
	PM10            float64  `json:"pm10"`
	PM02Compensated *float64 `json:"pm02Compensated"`
	RCO2            int      `json:"rco2"`
	ATmp            float64  `json:"atmp"`
	ATmpCompensated *float64 `json:"atmpCompensated"`
	RHum            float64  `json:"rhum"`
	RHumCompensated *float64 `json:"rhumCompensated"`
	TVOCIndex       int      `json:"tvocIndex"`
	TVOCRaw         int      `json:"tvocRaw"`
	NOxIndex        int      `json:"noxIndex"`
	NOxRaw          int      `json:"noxRaw"`
	BootCount       int      `json:"bootCount"`
}

type DeviceInfo struct {
	SerialNo  string `json:"serialno"`
	Firmware  string `json:"firmware"`
	Model     string `json:"model"`
	WiFiRSSI  int    `json:"wifi_rssi"`
	BootCount int    `json:"boot_count"`
}

type SensorRecord struct {
	Timestamp int64   `json:"timestamp"`
	PM01      float64 `json:"pm01"`
	PM02      float64 `json:"pm02"`
	PM10      float64 `json:"pm10"`
	PM02Comp  float64 `json:"pm02_comp"`
	RCO2      int     `json:"rco2"`
	ATmp      float64 `json:"atmp"`
	ATmpComp  float64 `json:"atmp_comp"`
	RHum      float64 `json:"rhum"`
	RHumComp  float64 `json:"rhum_comp"`
	TVOCIndex int     `json:"tvoc_index"`
	TVOCRaw   int     `json:"tvoc_raw"`
	NOxIndex  int     `json:"nox_index"`
	NOxRaw    int     `json:"nox_raw"`
}
