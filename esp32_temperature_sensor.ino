/*
 * ESP32 BioMed Telemetry Monitor
 * Sensors:
 *   - DS18B20 Digital Temperature Sensor (GPIO 4 with 4.7k pull-up to 3.3V)
 *   - MAX30105 / MAX30102 SpO2 & Heart Rate Sensor (I2C: SDA=GPIO 26, SCL=GPIO 27)
 *   - 16x2 Character LCD (RS=21, EN=22, D4=18, D5=19, D6=23, D7=25)
 *
 * Destination:
 *   HTTP POST JSON to Next.js API / Supabase Database
 *
 * Required Libraries (install via Arduino Library Manager):
 *   - "SparkFun MAX3010x Pulse and Proximity Sensor Library" by SparkFun
 *   - "DallasTemperature" by Miles Burton
 *   - "OneWire" by Paul Stoffregen
 *   - "LiquidCrystal" (built-in)
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <LiquidCrystal.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include "MAX30105.h"
#include "spo2_algorithm.h"

// ─── Wi-Fi & Endpoint Configuration ──────────────────────────────────────────
const char* ssid     = "Abijith24";
const char* password = "9847102363";
const char* url      = "https://esp32-biomed.vercel.app/api/temperature";

const unsigned long SEND_INTERVAL_MS = 4000;   // Send readings every 4 seconds
const unsigned long RECONNECT_INTERVAL_MS = 10000; // Wi-Fi reconnect retry interval

// ─── Hardware Pins ───────────────────────────────────────────────────────────
// LCD:                   RS  EN  D4  D5  D6  D7
LiquidCrystal lcd(21, 22, 18, 19, 23, 25);

#define ONE_WIRE_BUS 4
#define I2C_SDA_PIN  26
#define I2C_SCL_PIN  27

OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature ds18b20(&oneWire);
MAX30105 particleSensor;

// ─── MAX30105 Algorithm Buffers ──────────────────────────────────────────────
uint32_t irBuffer[100];   // Infrared LED sensor data
uint32_t redBuffer[100];  // Red LED sensor data

int32_t spo2 = 0;
int8_t validSpO2 = 0;
int32_t heartRate = 0;
int8_t validHeartRate = 0;
bool max30105Found = false;

// ─── State Variables ─────────────────────────────────────────────────────────
float currentTemp = -127.0;
unsigned long lastSendTime = 0;
unsigned long lastReconnectAttempt = 0;
unsigned long lastTempReadTime = 0;

// Custom degree symbol glyph for 16x2 LCD
byte degreeGlyph[8] = {
  0b00110,
  0b01001,
  0b01001,
  0b00110,
  0b00000,
  0b00000,
  0b00000,
  0b00000
};

// ─── Wi-Fi Connection Helper ─────────────────────────────────────────────────
void connectWiFi() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Connecting WiFi ");
  lcd.setCursor(0, 1);
  lcd.print("Please wait...  ");

  Serial.printf("\n[WiFi] Connecting to: %s\n", ssid);

  WiFi.disconnect(true);
  delay(200);

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.begin(ssid, password);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    lcd.setCursor(attempts % 16, 1);
    lcd.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] Connected! IP: %s (RSSI: %d dBm)\n",
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("WiFi Connected! ");
    lcd.setCursor(0, 1);
    lcd.print(WiFi.localIP());
    delay(1500);
  } else {
    Serial.printf("\n[WiFi] Failed to connect (Status: %d)\n", WiFi.status());
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("WiFi Offline    ");
    lcd.setCursor(0, 1);
    lcd.print("Retrying in bg  ");
    delay(1500);
  }
}

// ─── Setup ───────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Serial.println("\n==========================================");
  Serial.println("  ESP32 BioMed Telemetry System Starting  ");
  Serial.println("==========================================");

  // 1. Initialize LCD Display
  lcd.begin(16, 2);
  lcd.createChar(0, degreeGlyph);
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(" ESP32 BioMed   ");
  lcd.setCursor(0, 1);
  lcd.print(" Temp+SpO2+HR   ");
  delay(1200);

  // 2. Initialize DS18B20 Temperature Sensor
  ds18b20.begin();
  int tempCount = ds18b20.getDeviceCount();
  Serial.printf("[DS18B20] Found %d device(s) on GPIO %d\n", tempCount, ONE_WIRE_BUS);

  // 3. Initialize I2C and MAX30105 Pulse Oximeter
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  if (!particleSensor.begin(Wire, I2C_SPEED_STANDARD)) {
    Serial.println("[MAX30105] Sensor not detected on I2C (SDA=26, SCL=27). Check wiring!");
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("MAX30105 Missing");
    lcd.setCursor(0, 1);
    lcd.print("Check I2C 26/27 ");
    delay(2000);
    max30105Found = false;
  } else {
    Serial.println("[MAX30105] Sensor initialized successfully.");
    max30105Found = true;

    // Configure MAX30105 for SpO2 & Heart Rate measurement
    particleSensor.setup();
    particleSensor.setPulseAmplitudeRed(0x1F);
    particleSensor.setPulseAmplitudeIR(0x1F);
    particleSensor.setPulseAmplitudeGreen(0);
  }

  // 4. Connect to Wi-Fi
  connectWiFi();

  // 5. Pre-fill initial 100 samples if sensor is present
  if (max30105Found) {
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Calibrating SpO2");
    lcd.setCursor(0, 1);
    lcd.print("Place Finger... ");

    for (int i = 0; i < 100; i++) {
      while (!particleSensor.available()) {
        particleSensor.check();
        delay(1);
      }
      redBuffer[i] = particleSensor.getRed();
      irBuffer[i] = particleSensor.getIR();
      particleSensor.nextSample();

      if (i % 25 == 0) {
        Serial.printf("[MAX30105] Initial buffer: %d/100\n", i);
      }
    }
    Serial.println("[MAX30105] Initial 100 samples captured.");
  }

  lcd.clear();
}

// ─── Send Telemetry to Next.js API ───────────────────────────────────────────
void sendTelemetry(float tempC, int hr, int o2, bool hasFinger) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP] WiFi offline, skipping send");
    return;
  }

  HTTPClient http;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(4000);

  // Construct JSON payload
  String body = "{\"temperature\":" + String(tempC, 2);

  if (hasFinger && validHeartRate && hr > 30 && hr < 240) {
    body += ",\"heartRate\":" + String(hr);
  } else {
    body += ",\"heartRate\":null";
  }

  if (hasFinger && validSpO2 && o2 >= 70 && o2 <= 100) {
    body += ",\"spo2\":" + String(o2);
  } else {
    body += ",\"spo2\":null";
  }

  body += "}";

  Serial.printf("[HTTP] POST %s -> %s\n", url, body.c_str());

  int httpCode = http.POST(body);
  if (httpCode > 0) {
    Serial.printf("[HTTP] Response status: %d\n", httpCode);
  } else {
    Serial.printf("[HTTP] Failed error: %s\n", http.errorToString(httpCode).c_str());
  }

  http.end();
}

// ─── Update 16x2 LCD Display ─────────────────────────────────────────────────
void updateLcdDisplay(float tempC, int hr, int o2, bool hasFinger) {
  // Row 0: Temperature and Heart Rate
  // e.g.: "T:36.5\x00C HR:75  "
  lcd.setCursor(0, 0);

  char row0[17];
  char tempStr[8];
  if (tempC == DEVICE_DISCONNECTED_C || tempC <= -100.0) {
    snprintf(tempStr, sizeof(tempStr), "Err");
  } else {
    snprintf(tempStr, sizeof(tempStr), "%.1f", tempC);
  }

  if (hasFinger && validHeartRate && hr > 0 && hr < 240) {
    snprintf(row0, sizeof(row0), "T:%sC HR:%-3d", tempStr, hr);
  } else if (hasFinger) {
    snprintf(row0, sizeof(row0), "T:%sC HR:.. ", tempStr);
  } else {
    snprintf(row0, sizeof(row0), "T:%sC HR:-- ", tempStr);
  }
  lcd.print(row0);

  // Write custom degree character in place of 'C' prefix
  // "T:xx.xC" -> position is 2 + length of tempStr
  int degPos = 2 + strlen(tempStr);
  if (degPos < 8) {
    lcd.setCursor(degPos, 0);
    lcd.write((uint8_t)0);
  }

  // Row 1: SpO2 and Status
  // e.g.: "SpO2:98% WiFi:OK" or "Place Finger    "
  lcd.setCursor(0, 1);
  char row1[17];
  const char* wifiTag = (WiFi.status() == WL_CONNECTED) ? "WiFi" : "NoNet";

  if (!hasFinger) {
    snprintf(row1, sizeof(row1), "Place Finger    ");
  } else if (validSpO2 && o2 >= 70 && o2 <= 100) {
    snprintf(row1, sizeof(row1), "SpO2:%d%% [%s] ", o2, wifiTag);
  } else {
    snprintf(row1, sizeof(row1), "SpO2:Calc [%s] ", wifiTag);
  }
  lcd.print(row1);
}

// ─── Main Execution Loop ─────────────────────────────────────────────────────
void loop() {
  unsigned long now = millis();

  // 1. Process MAX30105 Optical Sensor (collect 25 new samples per cycle)
  bool fingerPresent = false;
  if (max30105Found) {
    // Shift the most recent 75 samples forward
    for (int i = 25; i < 100; i++) {
      redBuffer[i - 25] = redBuffer[i];
      irBuffer[i - 25] = irBuffer[i];
    }

    // Collect 25 new samples
    for (int i = 75; i < 100; i++) {
      while (!particleSensor.available()) {
        particleSensor.check();
        delay(1);
      }
      redBuffer[i] = particleSensor.getRed();
      irBuffer[i] = particleSensor.getIR();
      particleSensor.nextSample();
    }

    // Run Maxim SpO2 and Heart Rate algorithm
    maxim_heart_rate_and_oxygen_saturation(
      irBuffer, 100, redBuffer,
      &spo2, &validSpO2,
      &heartRate, &validHeartRate
    );

    // Finger is considered present if IR signal exceeds threshold (50,000)
    fingerPresent = (irBuffer[99] > 50000);
  }

  // 2. Read DS18B20 Temperature periodically (every 1 second)
  if (now - lastTempReadTime >= 1000) {
    lastTempReadTime = now;
    ds18b20.requestTemperatures();
    float t = ds18b20.getTempCByIndex(0);
    if (t != DEVICE_DISCONNECTED_C && t > -100.0) {
      currentTemp = t;
    }
  }

  // 3. Serial Debug Output
  Serial.printf("[SENSORS] Temp: %.2f C | HR: %ld (valid=%d) | SpO2: %ld (valid=%d) | Finger: %s\n",
                currentTemp, heartRate, validHeartRate, spo2, validSpO2,
                fingerPresent ? "YES" : "NO");

  // 4. Update 16x2 LCD Screen
  updateLcdDisplay(currentTemp, (int)heartRate, (int)spo2, fingerPresent);

  // 5. Periodic HTTP POST Telemetry transmission
  if (now - lastSendTime >= SEND_INTERVAL_MS) {
    lastSendTime = now;
    if (currentTemp != DEVICE_DISCONNECTED_C && currentTemp > -100.0) {
      sendTelemetry(currentTemp, (int)heartRate, (int)spo2, fingerPresent);
    }
  }

  // 6. Non-blocking Wi-Fi reconnect check
  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastReconnectAttempt >= RECONNECT_INTERVAL_MS) {
      lastReconnectAttempt = now;
      Serial.println("[WiFi] Reconnecting...");
      WiFi.reconnect();
    }
  }

  delay(50);
}
