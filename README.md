# LymphoVista MD

Doctor-facing prototype for longitudinal cervical lymphatic monitoring.

## Run

Open `index.html` directly, or serve the folder locally:

```powershell
python -m http.server 4174
```

Then visit:

```text
http://127.0.0.1:4174
```

For real USB serial connection, use Microsoft Edge or Chrome. If the browser blocks Web Serial from `file://`, serve the folder from localhost and open `http://127.0.0.1:4174`.

## What is inside

- Live cervical monitoring dashboard for physicians
- Simulated ultrasound view with lymph-node morphology cues
- Bilateral patch telemetry and scan acquisition flow
- Longitudinal 14-day trend chart
- Clinical interpretation layer that avoids engineering equations in the UI
- Patient surveillance queue and next-step care plan

## Real Serial Device Link

The dashboard can connect directly to an Arduino/XIAO-class board through the browser Web Serial API. Click **Serial Link**, choose the baud rate, then click **Connect Serial** and select the COM port.

Before clinical-style analysis, open **Register** and save the patient/device profile. The registration is stored in browser `localStorage` and includes patient ID, device ID, bilateral baseline impedance, and baseline phase. The dashboard uses that saved baseline for all live calculations.

Useful workflow:

1. Fill patient/device registration.
2. Connect the serial device.
3. When the device is in a clean baseline posture/contact state, click **Use Live as Baseline**.
4. Click **Save Registration**.
5. Continue streaming. KPI cards, quality cards, trends, and physician interpretation will recalculate from the live packet.

The device should send one packet per line. JSON Lines is recommended:

```json
{"left":429,"right":520,"phaseLeft":6.44,"phaseRight":6.83,"motion":86,"contact":92,"battery":91,"confidence":82}
```

CSV is also accepted:

```text
429,520,6.44,6.83,86,92,91,82
```

Key-value packets are accepted too:

```text
left=429,right=520,phaseLeft=6.44,phaseRight=6.83,motion=86,contact=92,battery=91,confidence=82
```

Supported fields:

- `left`, `right`: impedance magnitude in ohm-equivalent units
- Also accepted for left/right: `leftOhm`, `rightOhm`, `impedanceLeft`, `impedanceRight`, `zLeft`, `zRight`, `zL`, `zR`, `ch1`, `ch2`, `sensor1`, `sensor2`, `value1`, `value2`
- `phaseLeft`, `phaseRight`: phase angle values
- `motion`: motion quality percentage, 0-100
- `contact`: electrode contact quality percentage, 0-100
- `battery`: device battery percentage
- `confidence`: optional acquisition confidence percentage
- `risk`, `asymmetry`: optional precomputed model outputs
- `patientId`, `deviceId`: optional identifiers used to check packet/registration match

Live analysis uses:

- Baseline deviation: `(registered baseline - current reading) / registered baseline`
- Bilateral asymmetry: calculated from left/right readings when `asymmetry` is not supplied
- Risk index: calculated from dominant baseline deviation, asymmetry, and acquisition confidence when `risk` is not supplied
- Dashboard values: updated on every accepted serial packet

Minimal Arduino-style firmware loop:

```cpp
void setup() {
  Serial.begin(115200);
  while (!Serial) {}
}

void loop() {
  float leftOhm = 429.0 + random(-8, 9) * 0.4;
  float rightOhm = 520.0 + random(-5, 6) * 0.4;
  float phaseLeft = 6.44 + random(-5, 6) * 0.01;
  float phaseRight = 6.83 + random(-4, 5) * 0.01;
  int motion = 86;
  int contact = 92;
  int battery = 91;
  int confidence = 82;

  Serial.print("{\"left\":");
  Serial.print(leftOhm, 1);
  Serial.print(",\"right\":");
  Serial.print(rightOhm, 1);
  Serial.print(",\"phaseLeft\":");
  Serial.print(phaseLeft, 2);
  Serial.print(",\"phaseRight\":");
  Serial.print(phaseRight, 2);
  Serial.print(",\"motion\":");
  Serial.print(motion);
  Serial.print(",\"contact\":");
  Serial.print(contact);
  Serial.print(",\"battery\":");
  Serial.print(battery);
  Serial.print(",\"confidence\":");
  Serial.print(confidence);
  Serial.println("}");

  delay(1000);
}
```

## Paper-informed clinical markers

The UI logic uses clinically framed signals drawn from the provided paper:

- Stable healthy variation near 2.5%
- Healthy bilateral asymmetry typically below 1.5%
- Suspected abnormal reduction around 4-7% from personal baseline
- Sustained unilateral asymmetry around 4-8%
- Abnormal drift around -3 to -4 ohm/day
- Healthy phase angle around 6.7-6.9 degrees
- Abnormal phase angle around 6.2-6.5 degrees

These are presented as longitudinal surveillance and risk-screening cues, not as a definitive medical diagnosis.
