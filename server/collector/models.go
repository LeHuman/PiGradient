package collector

type AirGradientRaw struct {
	SerialNo        string   `json:"serialno"`
	WiFi            float64  `json:"wifi"`
	Firmware        string   `json:"firmware"`
	Model           string   `json:"model"`
	PM01            float64  `json:"pm01"`
	PM02            float64  `json:"pm02"`
	PM10            float64  `json:"pm10"`
	PM02Compensated *float64 `json:"pm02Compensated"`
	PM01Standard    *float64 `json:"pm01Standard"`
	PM02Standard    *float64 `json:"pm02Standard"`
	PM10Standard    *float64 `json:"pm10Standard"`
	PM003Count      *float64 `json:"pm003Count"`
	PM005Count      *float64 `json:"pm005Count"`
	PM01Count       *float64 `json:"pm01Count"`
	PM02Count       *float64 `json:"pm02Count"`
	PM50Count       *float64 `json:"pm50Count"`
	PM10Count       *float64 `json:"pm10Count"`
	RCO2            float64  `json:"rco2"`
	ATmp            float64  `json:"atmp"`
	ATmpCompensated *float64 `json:"atmpCompensated"`
	RHum            float64  `json:"rhum"`
	RHumCompensated *float64 `json:"rhumCompensated"`
	TVOCIndex       float64  `json:"tvocIndex"`
	TVOCRaw         float64  `json:"tvocRaw"`
	NOxIndex        float64  `json:"noxIndex"`
	NOxRaw          float64  `json:"noxRaw"`
	BootCount       float64  `json:"bootCount"`
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
	// Particle counts / standard PM are nullable: firmware builds without
	// these JSON keys (or pre-extension rows) must archive as NULL, never 0.
	PM01Std   *float64 `json:"pm01_standard"`
	PM02Std   *float64 `json:"pm02_standard"`
	PM10Std   *float64 `json:"pm10_standard"`
	PM003Cnt  *float64 `json:"pm003_count"`
	PM005Cnt  *float64 `json:"pm005_count"`
	PM01Cnt   *float64 `json:"pm01_count"`
	PM02Cnt   *float64 `json:"pm02_count"`
	PM50Cnt   *float64 `json:"pm50_count"`
	PM10Cnt   *float64 `json:"pm10_count"`
	RCO2      int     `json:"rco2"`
	ATmp      float64 `json:"atmp"`
	ATmpComp  float64 `json:"atmp_comp"`
	RHum      float64 `json:"rhum"`
	RHumComp  float64 `json:"rhum_comp"`
	TVOCIndex int `json:"tvoc_index"`
	// Raw SGP41 tick averages keep full device precision (2 dp); the SQLite
	// columns have INTEGER affinity but hold REAL whenever not lossless-int.
	TVOCRaw  float64 `json:"tvoc_raw"`
	NOxIndex int     `json:"nox_index"`
	NOxRaw   float64 `json:"nox_raw"`
}
