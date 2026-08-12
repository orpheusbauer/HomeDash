#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>

// Copiez ce fichier en dehors de Git puis renseignez vos secrets localement.
const char* WIFI_SSID = "VOTRE_WIFI";
const char* WIFI_PASSWORD = "VOTRE_MOT_DE_PASSE";
const char* HOMEDASH_URL = "http://192.168.1.50:4100/api/v1/sensors/ingest";
const char* SENSOR_TOKEN = "VOTRE_HOMEDASH_SENSOR_INGEST_TOKEN";
constexpr int DHT_PIN = 4;
DHT dht(DHT_PIN, DHT22);

void setup() {
  Serial.begin(115200); dht.begin(); WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) delay(500);
}

void loop() {
  const float temperature = dht.readTemperature();
  if (!isnan(temperature) && WiFi.status() == WL_CONNECTED) {
    HTTPClient http; http.begin(HOMEDASH_URL); http.addHeader("Content-Type", "application/json"); http.addHeader("X-HomeDash-Sensor", SENSOR_TOKEN);
    const String body = String("{\"id\":\"esp32-salon\",\"name\":\"Température salon\",\"type\":\"temperature\",\"location\":\"salon\",\"value\":") + String(temperature, 1) + ",\"unit\":\"°C\"}";
    Serial.printf("HomeDash HTTP %d\n", http.POST(body)); http.end();
  }
  delay(60000);
}
