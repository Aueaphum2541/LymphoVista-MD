(function () {
  "use strict";

  const STORAGE_KEY = "lymphovista.registration.v1";

  const DEFAULT_REGISTRATION = {
    patientId: "LV-2048",
    patientName: "Arisa W.",
    age: 42,
    sex: "Female",
    clinicalHistory: "Post-thyroid cancer neck dissection",
    treatment: "Cervical nodes + Radiotherapy, week 8",
    deviceId: "XIAO-BIS-01",
    baselineLeft: 465,
    baselineRight: 521,
    phaseLeft: 6.82,
    phaseRight: 6.86,
    registeredAt: "",
  };

  const state = {
    range: 6,
    reviewed: false,
    battery: 92,
    toastTimer: null,
    latestTelemetry: null,
    latestRaw: null,
    registration: loadRegistration(),
    serial: {
      port: null,
      reader: null,
      active: false,
      buffer: "",
      samples: 0,
      log: [],
      lastPacket: "Waiting",
      portLabel: "No device",
    },
  };

  const sessions = [
    { label: "Apr 17", left: 478, right: 581, asymmetry: 2.8 },
    { label: "Apr 24", left: 469, right: 579, asymmetry: 3.0 },
    { label: "May 01", left: 461, right: 580, asymmetry: 3.1 },
    { label: "May 08", left: 454, right: 582, asymmetry: 3.4 },
    { label: "May 15", left: 446, right: 578, asymmetry: 4.2 },
    { label: "May 19", left: 437, right: 574, asymmetry: 6.2 },
    { label: "May 22", left: 429, right: 520, asymmetry: 8.2 },
  ];

  const spectrum = {
    labels: ["5k", "10k", "50k", "100k", "500k", "1M"],
    left: [870, 720, 525, 438, 332, 260],
    right: [980, 850, 690, 545, 420, 336],
  };

  const el = {};

  document.addEventListener("DOMContentLoaded", boot);

  function boot() {
    cacheElements();
    hydrateRegistrationForm();
    bindEvents();
    exposeDebugApi();
    render();
    updateSerialUi();
    window.setInterval(() => {
      if (state.latestTelemetry && Number.isFinite(state.latestTelemetry.battery)) return;
      state.battery = Math.max(71, state.battery - 0.02);
      el.batteryValue.textContent = `${Math.round(state.battery)}%`;
    }, 3200);
  }

  function cacheElements() {
    [
      "riskIndex",
      "riskLabel",
      "dominantPattern",
      "patternNote",
      "clinicalAction",
      "actionNote",
      "confidenceValue",
      "confidenceNote",
      "batteryValue",
      "signalValue",
      "serialStatusDot",
      "serialStatusText",
      "sessionTable",
      "thaiNarrative",
      "findingList",
      "assessmentText",
      "sessionRange",
      "impedanceChart",
      "asymmetryChart",
      "spectrumChart",
      "qualityGrid",
      "baudRate",
      "serialConnectButton",
      "serialDisconnectButton",
      "serialBadge",
      "serialPortLabel",
      "serialSampleCount",
      "serialLastPacket",
      "serialLog",
      "registrationBadge",
      "registrationForm",
      "regPatientId",
      "regPatientName",
      "regAge",
      "regSex",
      "regHistory",
      "regTreatment",
      "regDeviceId",
      "regBaselineLeft",
      "regBaselineRight",
      "regPhaseLeft",
      "regPhaseRight",
      "captureBaselineButton",
      "clearRegistrationButton",
      "liveValueGrid",
      "toast",
    ].forEach((id) => {
      el[id] = document.getElementById(id);
    });
  }

  function bindEvents() {
    el.sessionRange.addEventListener("change", (event) => {
      state.range = Number(event.target.value);
      drawCharts();
      showToast(`Trend window changed to last ${state.range} sessions`);
    });

    el.serialConnectButton.addEventListener("click", connectSerial);
    el.serialDisconnectButton.addEventListener("click", disconnectSerial);
    el.registrationForm.addEventListener("submit", (event) => {
      event.preventDefault();
      saveRegistrationFromForm();
    });
    el.captureBaselineButton.addEventListener("click", captureBaselineFromLive);
    el.clearRegistrationButton.addEventListener("click", clearRegistration);

    document.querySelectorAll("[data-jump]").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".nav-item").forEach((item) => {
          item.classList.toggle("is-active", item === button);
        });
        const target = document.getElementById(button.dataset.jump);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    });

    document.addEventListener("click", (event) => {
      const reviewButton = event.target.closest("[data-action='review']");
      if (!reviewButton) return;
      state.reviewed = !state.reviewed;
      renderQuality();
      showToast(state.reviewed ? "Review status marked as complete" : "Review status returned to needs review");
    });

    if ("serial" in navigator) {
      navigator.serial.addEventListener("disconnect", (event) => {
        if (event.target === state.serial.port) {
          markSerialClosed("Serial disconnected");
        }
      });
    } else {
      el.serialBadge.textContent = "Unsupported";
      el.serialBadge.classList.add("error");
      el.serialConnectButton.disabled = true;
      writeSerialLog("Web Serial is not available. Use Microsoft Edge or Chrome on HTTPS, localhost, or a trusted file origin.");
    }

    window.addEventListener("resize", debounce(drawCharts, 120));
  }

  function exposeDebugApi() {
    window.LymphoVistaApp = {
      injectSerialLine: handleSerialLine,
      getMetrics: () => getMetrics(),
      getRegistration: () => ({ ...state.registration }),
    };
  }

  function render() {
    renderRegistration();
    renderSummary();
    renderSession();
    renderFindings();
    renderQuality();
    renderLiveValues();
    drawCharts();
  }

  function loadRegistration() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return { ...DEFAULT_REGISTRATION };
      return { ...DEFAULT_REGISTRATION, ...JSON.parse(saved) };
    } catch {
      return { ...DEFAULT_REGISTRATION };
    }
  }

  function persistRegistration() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.registration));
  }

  function hydrateRegistrationForm() {
    const reg = state.registration;
    el.regPatientId.value = reg.patientId || "";
    el.regPatientName.value = reg.patientName || "";
    el.regAge.value = reg.age || "";
    el.regSex.value = reg.sex || "Female";
    el.regHistory.value = reg.clinicalHistory || "";
    el.regTreatment.value = reg.treatment || "";
    el.regDeviceId.value = reg.deviceId || "";
    el.regBaselineLeft.value = numberOrEmpty(reg.baselineLeft);
    el.regBaselineRight.value = numberOrEmpty(reg.baselineRight);
    el.regPhaseLeft.value = numberOrEmpty(reg.phaseLeft);
    el.regPhaseRight.value = numberOrEmpty(reg.phaseRight);
  }

  function saveRegistrationFromForm() {
    state.registration = {
      patientId: el.regPatientId.value.trim() || DEFAULT_REGISTRATION.patientId,
      patientName: el.regPatientName.value.trim() || DEFAULT_REGISTRATION.patientName,
      age: Number(el.regAge.value) || DEFAULT_REGISTRATION.age,
      sex: el.regSex.value,
      clinicalHistory: el.regHistory.value.trim(),
      treatment: el.regTreatment.value.trim(),
      deviceId: el.regDeviceId.value.trim(),
      baselineLeft: Number(el.regBaselineLeft.value) || DEFAULT_REGISTRATION.baselineLeft,
      baselineRight: Number(el.regBaselineRight.value) || DEFAULT_REGISTRATION.baselineRight,
      phaseLeft: Number(el.regPhaseLeft.value) || DEFAULT_REGISTRATION.phaseLeft,
      phaseRight: Number(el.regPhaseRight.value) || DEFAULT_REGISTRATION.phaseRight,
      registeredAt: new Date().toISOString(),
    };
    persistRegistration();
    render();
    showToast("Registration saved and dashboard analysis recalculated");
  }

  function captureBaselineFromLive() {
    const live = getMetrics();
    el.regBaselineLeft.value = live.left.toFixed(1);
    el.regBaselineRight.value = live.right.toFixed(1);
    el.regPhaseLeft.value = live.phaseLeft.toFixed(2);
    el.regPhaseRight.value = live.phaseRight.toFixed(2);
    showToast("Live reading copied into baseline fields");
  }

  function clearRegistration() {
    localStorage.removeItem(STORAGE_KEY);
    state.registration = { ...DEFAULT_REGISTRATION, registeredAt: "" };
    hydrateRegistrationForm();
    render();
    showToast("Registration reset to default");
  }

  function renderRegistration() {
    const hasSaved = Boolean(state.registration.registeredAt);
    el.registrationBadge.textContent = hasSaved ? `Registered ${state.registration.patientId}` : "Default profile";
    el.registrationBadge.classList.toggle("registered", hasSaved);
  }

  function getMetrics() {
    if (state.latestTelemetry) return state.latestTelemetry;
    const latest = sessions[sessions.length - 1];
    return normalizeTelemetry({
      left: latest.left,
      right: latest.right,
      asymmetry: latest.asymmetry,
      phaseLeft: 6.44,
      phaseRight: 6.83,
      motion: 86,
      contact: 92,
      battery: state.battery,
      confidence: 82,
      risk: 96,
      source: "demo",
    });
  }

  function renderSummary() {
    const metrics = getMetrics();
    const sideName = metrics.side === "left" ? "left-side" : metrics.side === "right" ? "right-side" : "bilateral";
    const risk = metrics.risk;
    const level = risk >= 75 ? "High risk" : risk >= 50 ? "Watch" : "Stable";

    el.riskIndex.textContent = String(risk);
    el.riskLabel.textContent = level;
    el.dominantPattern.textContent = risk >= 50 ? `Progressive ${sideName} deviation` : "Stable bilateral baseline";
    el.patternNote.textContent = risk >= 50
      ? `Live ${metrics.source} stream shows ${metrics.asymmetry.toFixed(1)}% asymmetry and ${metrics.dominantDrop.toFixed(1)}% baseline deviation`
      : "Repeated readings remain close to personal baseline";
    el.clinicalAction.textContent = risk >= 75 ? "Escalate review" : risk >= 50 ? "Repeat acquisition" : "Continue monitoring";
    el.actionNote.textContent = risk >= 75 ? "Same-day clinical review recommended" : "Confirm trend with repeat clean session";
    el.confidenceValue.textContent = `${metrics.confidence}%`;
    el.confidenceNote.textContent = metrics.source === "serial" ? "Live serial packet accepted" : "Stable repeated baseline";
    el.batteryValue.textContent = `${Math.round(metrics.battery)}%`;
    el.signalValue.textContent = metrics.contact >= 90 ? "Excellent" : metrics.contact >= 75 ? "Good" : "Check patch";
    el.thaiNarrative.textContent = risk >= 75
      ? "ข้อมูลจาก serial device แสดงความเบี่ยงเบนของสัญญาณ bio-impedance แบบ real-time โดยมีความต่างซ้าย-ขวาสูงและลดลงจาก baseline ส่วนบุคคล ควรตรวจสอบตำแหน่ง patch แล้วพิจารณา clinical review ตามบริบทผู้ป่วย"
      : "ข้อมูลจาก serial device อยู่ในช่วงเฝ้าระวัง ระบบยังคงติดตาม bio-impedance แบบต่อเนื่องและจะอัปเดตแนวโน้มเมื่อมี packet ใหม่จากอุปกรณ์";
  }

  function renderSession() {
    const metrics = getMetrics();
    const reg = state.registration;
    const rows = [
      ["Patient ID", reg.patientId],
      ["Patient Name", reg.patientName],
      ["Age / Sex", `${reg.age} / ${reg.sex}`],
      ["Clinical History", reg.clinicalHistory || "-"],
      ["Treatment", reg.treatment || "-"],
      ["Device ID", reg.deviceId || "-"],
      ["Signal Source", metrics.source === "serial" ? "<span class='status-good'>Live Serial</span>" : "Demo baseline"],
      ["Patch Contact", `<span class='${metrics.contact >= 75 ? "status-good" : "status-low"}'>${metrics.contact}%</span>`],
      ["Motion Clean", `<span class='${metrics.motion >= 75 ? "status-good" : "status-low"}'>${metrics.motion}%</span>`],
      ["Baseline Match", `<span class='${metrics.dominantDrop < 4 ? "status-good" : "status-low"}'>${metrics.dominantDrop.toFixed(1)}% dev.</span>`],
    ];

    el.sessionTable.innerHTML = rows
      .map(([term, description]) => {
        return `<div class="session-row"><dt>${term}</dt><dd>${description}</dd></div>`;
      })
      .join("");
  }

  function renderFindings() {
    const metrics = getMetrics();
    const findings = [
      {
        title: "Sustained baseline deviation",
        text: `${metrics.dominantDrop.toFixed(1)}% below personal baseline from ${metrics.source} stream.`,
        tone: metrics.dominantDrop >= 4 ? "alert" : "good",
      },
      {
        title: "Bilateral asymmetry",
        text: `${metrics.asymmetry.toFixed(1)}% asymmetry; phase ${metrics.phaseLeft.toFixed(2)} deg (L) vs ${metrics.phaseRight.toFixed(2)} deg (R).`,
        tone: metrics.asymmetry >= 4 ? "alert" : "good",
      },
      {
        title: "Low-frequency resistance behavior",
        text: `Left ${metrics.left.toFixed(0)} ohm, right ${metrics.right.toFixed(0)} ohm at current acquisition window.`,
        tone: metrics.risk >= 50 ? "alert" : "good",
      },
      {
        title: "Acquisition quality",
        text: `Contact ${metrics.contact}% and motion quality ${metrics.motion}% from latest packet.`,
        tone: metrics.contact >= 75 && metrics.motion >= 75 ? "good" : "alert",
      },
    ];

    el.findingList.innerHTML = findings
      .map((finding) => {
        return `
          <div class="finding-item is-${finding.tone}">
            <i aria-hidden="true"></i>
            <div>
              <strong>${finding.title}</strong>
              <span>${finding.text}</span>
            </div>
          </div>
        `;
      })
      .join("");

    el.assessmentText.textContent = metrics.risk >= 75
      ? "Findings are concerning for functional lymphatic abnormality on the dominant side. Correlate with clinical examination and repeat acquisition quality."
      : "Current readings are usable for longitudinal surveillance. Continue monitoring and watch for persistent trend changes.";
  }

  function renderQuality() {
    const metrics = getMetrics();
    const leftDrop = dropPct(state.registration.baselineLeft, metrics.left);
    const rightDrop = dropPct(state.registration.baselineRight, metrics.right);
    const status = metrics.risk >= 50 ? "Elevated" : "Good";

    el.qualityGrid.innerHTML = `
      ${qualityMetric("Left Patch", `${leftDrop.toFixed(1)}%`, `${metrics.left.toFixed(0)} ohm equivalent`, `${metrics.phaseLeft.toFixed(2)} deg phase`, "leftSpark", leftDrop >= 4 ? "red" : "green", leftDrop >= 4 ? "Elevated" : "Good")}
      ${qualityMetric("Right Patch", `${rightDrop.toFixed(1)}%`, `${metrics.right.toFixed(0)} ohm equivalent`, `${metrics.phaseRight.toFixed(2)} deg phase`, "rightSpark", rightDrop >= 4 ? "red" : "green", rightDrop >= 4 ? "Elevated" : "Good")}
      ${qualityMetric("Asymmetry Index", `${metrics.asymmetry.toFixed(1)}%`, status, metrics.risk >= 50 ? "Concerning" : "Stable", "asymmetrySpark", metrics.risk >= 50 ? "red" : "green", status)}
      ${qualityMetric("Motion Quality", `${metrics.motion}%`, metrics.motion >= 75 ? "Good" : "Repeat sweep", "", "motionSpark", metrics.motion >= 75 ? "green" : "red", metrics.motion >= 75 ? "Good" : "Elevated")}
      <div class="quality-card">
        <h3>Contact Quality</h3>
        <strong>${metrics.contact >= 75 ? "Stable" : "Check"}</strong>
        <small>${metrics.contact}% electrode contact</small>
        <span class="check-badge" aria-hidden="true"></span>
      </div>
      <div class="quality-card">
        <h3>Frequency Sweep</h3>
        <strong>${metrics.frequencyLabel}</strong>
        <small>Multifrequency BIS</small>
        <span class="frequency-wave" aria-hidden="true">${[18, 28, 13, 32, 21, 36, 15, 26].map((height) => `<i style="height:${height}px"></i>`).join("")}</span>
      </div>
      <div class="quality-card compact">
        <h3>Last Acquisition</h3>
        <strong>${metrics.lastLabel}</strong>
        <small>${metrics.source === "serial" ? "Live serial packet" : "Demo session"}</small>
      </div>
      <div class="quality-card compact review-status">
        <button class="review-card ${state.reviewed ? "is-reviewed" : ""}" type="button" data-action="review">
          <span>
            <strong>${state.reviewed ? "Reviewed" : "Needs Review"}</strong>
            <small>${state.reviewed ? "Signed off by physician" : "Escalate clinical review"}</small>
          </span>
        </button>
      </div>
    `;

    drawSparkline("leftSpark", [...sessions.slice(-7).map((item) => item.left), metrics.left], leftDrop >= 4 ? "#ff4c45" : "#35b46d");
    drawSparkline("rightSpark", [...sessions.slice(-7).map((item) => item.right), metrics.right], rightDrop >= 4 ? "#ff4c45" : "#35b46d");
    drawSparkline("asymmetrySpark", [...sessions.slice(-7).map((item) => item.asymmetry), metrics.asymmetry], metrics.risk >= 50 ? "#ff4c45" : "#35b46d");
    drawSparkline("motionSpark", [70, 73, 69, 76, 78, 82, 79, metrics.motion], metrics.motion >= 75 ? "#35b46d" : "#ff4c45");
  }

  function renderLiveValues() {
    const metrics = getMetrics();
    const cards = [
      ["Left Z", `${metrics.left.toFixed(1)} Ω`, `Baseline ${state.registration.baselineLeft}`],
      ["Right Z", `${metrics.right.toFixed(1)} Ω`, `Baseline ${state.registration.baselineRight}`],
      ["Asymmetry", `${metrics.asymmetry.toFixed(1)}%`, "Calculated live"],
      ["Risk", `${metrics.risk}/100`, metrics.risk >= 75 ? "High" : metrics.risk >= 50 ? "Watch" : "Stable"],
      ["Phase L", `${metrics.phaseLeft.toFixed(2)}°`, `Base ${state.registration.phaseLeft}`],
      ["Phase R", `${metrics.phaseRight.toFixed(2)}°`, `Base ${state.registration.phaseRight}`],
      ["Motion", `${metrics.motion}%`, "Packet quality"],
      ["Contact", `${metrics.contact}%`, "Electrode quality"],
    ];
    const rawCards = state.latestRaw
      ? Object.entries(state.latestRaw)
          .filter(([key, value]) => typeof value !== "object" && key !== "source")
          .slice(0, 8)
          .map(([key, value]) => [`Raw ${key}`, String(value), "From packet"])
      : [];

    el.liveValueGrid.innerHTML = [...cards, ...rawCards]
      .map(([label, value, hint]) => {
        return `
          <div class="live-value-card">
            <span>${label}</span>
            <strong>${value}</strong>
            <small>${hint}</small>
          </div>
        `;
      })
      .join("");
  }

  function qualityMetric(title, value, sub, foot, canvasId, color, status) {
    const statusMarkup = status ? `<span class="${status === "Good" ? "status-good" : "status-elevated"}">${status}</span>` : "";
    return `
      <div class="quality-card">
        <h3>${title}</h3>
        <strong>${value}</strong>
        <small>${sub}</small>
        ${foot ? `<span>${foot}</span>` : ""}
        ${statusMarkup}
        <canvas class="sparkline" id="${canvasId}" width="120" height="50" aria-hidden="true"></canvas>
      </div>
    `;
  }

  async function connectSerial() {
    if (!("serial" in navigator)) {
      showToast("Web Serial is not available in this browser");
      return;
    }

    try {
      const baudRate = Number(el.baudRate.value);
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate, bufferSize: 1024 });
      state.serial.port = port;
      state.serial.active = true;
      state.serial.samples = 0;
      state.serial.buffer = "";
      state.serial.log = [];
      state.serial.portLabel = describePort(port);
      updateSerialUi();
      writeSerialLog(`Connected at ${baudRate} baud`);
      showToast("Serial device connected");
      readSerialLoop();
    } catch (error) {
      state.serial.active = false;
      updateSerialUi("error");
      writeSerialLog(`Connect failed: ${error.message}`);
      showToast(`Serial connect failed: ${error.message}`);
    }
  }

  async function disconnectSerial() {
    state.serial.active = false;

    try {
      if (state.serial.reader) {
        await state.serial.reader.cancel();
      }
    } catch (error) {
      writeSerialLog(`Reader cancel: ${error.message}`);
    }

    try {
      if (state.serial.port) {
        await state.serial.port.close();
      }
    } catch (error) {
      writeSerialLog(`Port close: ${error.message}`);
    }

    markSerialClosed("Serial offline");
    showToast("Serial device disconnected");
  }

  async function readSerialLoop() {
    const decoder = new TextDecoder();

    while (state.serial.port && state.serial.port.readable && state.serial.active) {
      state.serial.reader = state.serial.port.readable.getReader();
      try {
        while (state.serial.active) {
          const { value, done } = await state.serial.reader.read();
          if (done) break;
          if (!value) continue;
          state.serial.buffer += decoder.decode(value, { stream: true });
          processSerialBuffer();
        }
      } catch (error) {
        if (state.serial.active) {
          writeSerialLog(`Read error: ${error.message}`);
          updateSerialUi("error");
        }
      } finally {
        state.serial.reader.releaseLock();
        state.serial.reader = null;
      }
    }
  }

  function processSerialBuffer() {
    const lines = state.serial.buffer.split(/\r?\n/);
    state.serial.buffer = lines.pop() || "";
    lines.forEach((line) => {
      const cleanLine = line.trim();
      if (!cleanLine) return;
      handleSerialLine(cleanLine);
    });
  }

  function handleSerialLine(line) {
    const raw = parseSerialLine(line);
    if (!raw) {
      writeSerialLog(`Ignored: ${line.slice(0, 120)}`);
      return;
    }

    syncRegistrationHints(raw);

    const telemetry = normalizeTelemetry({ ...raw, source: "serial" });
    state.latestTelemetry = telemetry;
    state.latestRaw = raw;
    state.serial.samples += 1;
    state.serial.lastPacket = telemetry.lastLabel;
    appendSession(telemetry);
    updateSpectrumFromTelemetry(raw);
    writeSerialLog(line);
    render();
    updateSerialUi();
  }

  function syncRegistrationHints(raw) {
    const incomingDevice = raw.deviceId || raw.device || raw.device_id;
    const incomingPatient = raw.patientId || raw.patient || raw.patient_id;
    if (incomingDevice && !state.registration.deviceId) {
      state.registration.deviceId = String(incomingDevice);
      el.regDeviceId.value = state.registration.deviceId;
      persistRegistration();
    }
    if (incomingPatient && String(incomingPatient) !== state.registration.patientId) {
      writeSerialLog(`Patient packet ${incomingPatient} does not match registration ${state.registration.patientId}`);
    }
  }

  function parseSerialLine(line) {
    if (line.startsWith("{") && line.endsWith("}")) {
      try {
        return JSON.parse(line);
      } catch (error) {
        writeSerialLog(`JSON parse error: ${error.message}`);
        return null;
      }
    }

    const normalized = line.replace(/;/g, ",");
    if (normalized.includes("=") || normalized.includes(":")) {
      const object = {};
      normalized.split(",").forEach((part) => {
        const [key, ...rest] = part.split(/[:=]/);
        if (!key || rest.length === 0) return;
        object[key.trim()] = parseValue(rest.join(":").trim());
      });
      return Object.keys(object).length ? object : null;
    }

    const parts = normalized.split(",").map((item) => item.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    return {
      left: parseValue(parts[0]),
      right: parseValue(parts[1]),
      phaseLeft: parseValue(parts[2]),
      phaseRight: parseValue(parts[3]),
      motion: parseValue(parts[4]),
      contact: parseValue(parts[5]),
      battery: parseValue(parts[6]),
      confidence: parseValue(parts[7]),
    };
  }

  function normalizeTelemetry(input) {
    const baseline = state.registration;
    const left = readNumber(input, ["left", "leftOhm", "left_impedance", "leftImpedance", "impedanceLeft", "zLeft", "zL", "ch1", "channel1", "sensor1", "value1", "l", "L"], baseline.baselineLeft);
    const right = readNumber(input, ["right", "rightOhm", "right_impedance", "rightImpedance", "impedanceRight", "zRight", "zR", "ch2", "channel2", "sensor2", "value2", "r", "R"], baseline.baselineRight);
    const phaseLeft = readNumber(input, ["phaseLeft", "leftPhase", "phase_l", "left_phase", "pl", "PL"], baseline.phaseLeft);
    const phaseRight = readNumber(input, ["phaseRight", "rightPhase", "phase_r", "right_phase", "pr", "PR"], baseline.phaseRight);
    const motion = Math.round(clamp(readNumber(input, ["motion", "motionQuality", "mq"], 86), 0, 100));
    const contact = Math.round(clamp(readNumber(input, ["contact", "contactQuality", "cq"], 92), 0, 100));
    const battery = clamp(readNumber(input, ["battery", "batt", "bat", "B"], state.battery), 0, 100);
    const leftDrop = dropPct(baseline.baselineLeft, left);
    const rightDrop = dropPct(baseline.baselineRight, right);
    const side = leftDrop > rightDrop + 0.7 ? "left" : rightDrop > leftDrop + 0.7 ? "right" : "bilateral";
    const dominantDrop = Math.max(leftDrop, rightDrop);
    const asymmetry = clamp(readNumber(input, ["asymmetry", "asymmetryIndex", "ai"], calculateAsymmetry(left, right)), 0, 99);
    const confidence = Math.round(clamp(readNumber(input, ["confidence", "conf", "quality"], Math.min(contact, motion) - dominantDrop * 1.2 + 8), 10, 99));
    const risk = Math.round(clamp(readNumber(input, ["risk", "riskIndex"], dominantDrop * 8.4 + asymmetry * 4.1 + (100 - confidence) * 0.25), 0, 100));
    const frequencyLabel = input.frequency || input.freq || input.sweep || "5kHz - 1 MHz";
    const source = input.source || "demo";
    const now = new Date();

    return {
      left,
      right,
      phaseLeft,
      phaseRight,
      motion,
      contact,
      battery,
      asymmetry,
      confidence,
      risk,
      side,
      dominantDrop,
      frequencyLabel,
      source,
      lastLabel: now.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    };
  }

  function appendSession(telemetry) {
    sessions.push({
      label: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }),
      left: telemetry.left,
      right: telemetry.right,
      asymmetry: telemetry.asymmetry,
    });
    while (sessions.length > 60) sessions.shift();
  }

  function updateSpectrumFromTelemetry(raw) {
    const leftSpectrum = raw.spectrumLeft || raw.leftSpectrum || raw.zLeft;
    const rightSpectrum = raw.spectrumRight || raw.rightSpectrum || raw.zRight;
    if (Array.isArray(leftSpectrum) && leftSpectrum.length >= 3) {
      spectrum.left = leftSpectrum.map(Number).filter(Number.isFinite).slice(0, spectrum.labels.length);
    }
    if (Array.isArray(rightSpectrum) && rightSpectrum.length >= 3) {
      spectrum.right = rightSpectrum.map(Number).filter(Number.isFinite).slice(0, spectrum.labels.length);
    }
  }

  function updateSerialUi(tone) {
    const connected = state.serial.active;
    const statusTone = tone || (connected ? "connected" : "");
    el.serialBadge.textContent = connected ? "Connected" : "Web Serial";
    el.serialBadge.classList.toggle("connected", statusTone === "connected");
    el.serialBadge.classList.toggle("error", statusTone === "error");
    el.serialConnectButton.disabled = connected || !("serial" in navigator);
    el.serialDisconnectButton.disabled = !connected;
    el.baudRate.disabled = connected;
    el.serialPortLabel.textContent = state.serial.portLabel;
    el.serialSampleCount.textContent = String(state.serial.samples);
    el.serialLastPacket.textContent = state.serial.lastPacket;
    el.serialStatusText.textContent = connected ? "Serial connected" : "Serial offline";
    el.serialStatusDot.className = `dot ${statusTone === "error" ? "error" : connected ? "good" : "idle"}`;
  }

  function markSerialClosed(message) {
    state.serial.active = false;
    state.serial.port = null;
    state.serial.reader = null;
    state.serial.portLabel = "No device";
    state.serial.lastPacket = message;
    updateSerialUi();
    writeSerialLog(message);
  }

  function writeSerialLog(message) {
    state.serial.log.unshift(`[${new Date().toLocaleTimeString("th-TH")}] ${message}`);
    state.serial.log = state.serial.log.slice(0, 9);
    el.serialLog.textContent = state.serial.log.join("\n");
  }

  function describePort(port) {
    const info = port.getInfo ? port.getInfo() : {};
    const vendor = info.usbVendorId ? `VID ${info.usbVendorId.toString(16).toUpperCase()}` : "USB";
    const product = info.usbProductId ? `PID ${info.usbProductId.toString(16).toUpperCase()}` : "Serial";
    return `${vendor} / ${product}`;
  }

  function readNumber(object, keys, fallback) {
    const lookup = Object.entries(object).reduce((acc, [key, value]) => {
      acc[canonicalKey(key)] = value;
      return acc;
    }, {});
    for (const key of keys) {
      const raw = lookup[canonicalKey(key)];
      if (raw === undefined || raw === null || raw === "") continue;
      const value = Number(raw);
      if (Number.isFinite(value)) return value;
    }
    return fallback;
  }

  function canonicalKey(key) {
    return String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function numberOrEmpty(value) {
    return Number.isFinite(Number(value)) ? String(value) : "";
  }

  function parseValue(value) {
    const trimmed = String(value).trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed;
      }
    }
    const number = Number(trimmed);
    return Number.isFinite(number) ? number : trimmed;
  }

  function drawCharts() {
    const data = sessions.slice(-state.range);
    drawImpedanceChart(data);
    drawAsymmetryChart(data);
    drawSpectrumChart();
  }

  function drawImpedanceChart(data) {
    const ctx = prepareCanvas(el.impedanceChart);
    if (!ctx) return;
    const canvas = el.impedanceChart;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const values = data.flatMap((item) => [item.left, item.right]);
    const min = Math.max(100, Math.floor(Math.min(...values) - 30));
    const max = Math.ceil(Math.max(...values) + 30);
    const pad = { top: 14, right: 12, bottom: 24, left: 34 };

    clearChart(ctx, width, height);
    drawGrid(ctx, width, height, pad, makeTicks(min, max), min, max);
    drawSeries(ctx, data.map((item) => item.left), min, max, pad, width, height, "#ff4c45");
    drawSeries(ctx, data.map((item) => item.right), min, max, pad, width, height, "#2178c9");
    drawXAxis(ctx, data, pad, width, height);
    drawLegend(ctx, width, height, [{ label: "Left (L)", color: "#ff4c45" }, { label: "Right (R)", color: "#2178c9" }]);
  }

  function drawAsymmetryChart(data) {
    const ctx = prepareCanvas(el.asymmetryChart);
    if (!ctx) return;
    const canvas = el.asymmetryChart;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const max = Math.max(10, Math.ceil(Math.max(...data.map((item) => item.asymmetry)) + 2));
    const pad = { top: 14, right: 14, bottom: 24, left: 28 };

    clearChart(ctx, width, height);
    drawGrid(ctx, width, height, pad, [0, 4, 8], 0, max);
    drawThreshold(ctx, pad, width, height, 0, max, 6, "#ff4c45", "Concerning");
    drawThreshold(ctx, pad, width, height, 0, max, 3, "#e2a934", "Borderline");
    drawSeries(ctx, data.map((item) => item.asymmetry), 0, max, pad, width, height, "#ff4c45");
    drawXAxis(ctx, data, pad, width, height);
  }

  function drawSpectrumChart() {
    const ctx = prepareCanvas(el.spectrumChart);
    if (!ctx) return;
    const canvas = el.spectrumChart;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const pad = { top: 14, right: 12, bottom: 24, left: 36 };
    const values = [...spectrum.left, ...spectrum.right];
    const min = Math.max(0, Math.floor(Math.min(...values) - 40));
    const max = Math.ceil(Math.max(...values) + 80);

    clearChart(ctx, width, height);
    drawGrid(ctx, width, height, pad, makeTicks(min, max), min, max);
    drawSeries(ctx, spectrum.left, min, max, pad, width, height, "#ff4c45", false);
    drawSeries(ctx, spectrum.right, min, max, pad, width, height, "#2178c9", false);

    ctx.fillStyle = "#637386";
    ctx.font = "10px Inter, Segoe UI, sans-serif";
    spectrum.labels.forEach((label, index) => {
      const x = pad.left + ((width - pad.left - pad.right) * index) / (spectrum.labels.length - 1);
      ctx.fillText(label, x - 8, height - 7);
    });
    drawLegend(ctx, width, height, [{ label: "Left (L)", color: "#ff4c45" }, { label: "Right (R)", color: "#2178c9" }]);
  }

  function prepareCanvas(canvas) {
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (canvas.width !== width * scale || canvas.height !== height * scale) {
      canvas.width = width * scale;
      canvas.height = height * scale;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    return ctx;
  }

  function clearChart(ctx, width, height) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }

  function drawGrid(ctx, width, height, pad, ticks, min, max) {
    ctx.strokeStyle = "#e3ebf0";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#637386";
    ctx.font = "10px Inter, Segoe UI, sans-serif";
    ticks.forEach((tick) => {
      const y = yFor(tick, min, max, pad, height);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();
      ctx.fillText(String(Math.round(tick)), 4, y + 3);
    });
  }

  function drawSeries(ctx, values, min, max, pad, width, height, color, points = true) {
    if (values.length < 2) return;
    const plotWidth = width - pad.left - pad.right;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    values.forEach((value, index) => {
      const x = pad.left + (plotWidth * index) / (values.length - 1);
      const y = yFor(value, min, max, pad, height);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    if (!points) return;
    values.forEach((value, index) => {
      const x = pad.left + (plotWidth * index) / (values.length - 1);
      const y = yFor(value, min, max, pad, height);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    });
  }

  function drawXAxis(ctx, data, pad, width, height) {
    ctx.fillStyle = "#637386";
    ctx.font = "10px Inter, Segoe UI, sans-serif";
    data.forEach((item, index) => {
      if (index !== 0 && index !== data.length - 1 && index % 2 !== 0) return;
      const x = pad.left + ((width - pad.left - pad.right) * index) / (data.length - 1);
      ctx.fillText(item.label, x - 13, height - 7);
    });
  }

  function drawThreshold(ctx, pad, width, height, min, max, value, color, label) {
    const y = yFor(value, min, max, pad, height);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.45;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.font = "9px Inter, Segoe UI, sans-serif";
    ctx.fillText(label, width - pad.right - 50, y - 4);
  }

  function drawLegend(ctx, width, height, items) {
    let x = width / 2 - items.length * 34;
    const y = height - 3;
    ctx.font = "10px Inter, Segoe UI, sans-serif";
    items.forEach((item) => {
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y - 3);
      ctx.lineTo(x + 16, y - 3);
      ctx.stroke();
      ctx.fillStyle = "#637386";
      ctx.fillText(item.label, x + 20, y);
      x += 78;
    });
  }

  function yFor(value, min, max, pad, height) {
    const plotHeight = height - pad.top - pad.bottom;
    if (max === min) return pad.top + plotHeight / 2;
    return pad.top + plotHeight - ((value - min) / (max - min)) * plotHeight;
  }

  function drawSparkline(id, values, color) {
    const canvas = document.getElementById(id);
    const ctx = prepareCanvas(canvas);
    if (!ctx) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const cleanValues = values.filter(Number.isFinite);
    const min = Math.min(...cleanValues) - 2;
    const max = Math.max(...cleanValues) + 2;
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    cleanValues.forEach((value, index) => {
      const x = 2 + ((width - 4) * index) / (cleanValues.length - 1);
      const y = 3 + (height - 6) - ((value - min) / (max - min)) * (height - 6);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function makeTicks(min, max) {
    const span = max - min;
    return [min, min + span / 2, max];
  }

  function dropPct(baseline, current) {
    return Math.max(0, ((baseline - current) / baseline) * 100);
  }

  function calculateAsymmetry(left, right) {
    const midpoint = (Math.abs(left) + Math.abs(right)) / 2;
    if (!midpoint) return 0;
    return Math.abs(left - right) / midpoint * 100;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function showToast(message) {
    window.clearTimeout(state.toastTimer);
    el.toast.textContent = message;
    el.toast.classList.add("show");
    state.toastTimer = window.setTimeout(() => {
      el.toast.classList.remove("show");
    }, 2400);
  }

  function debounce(fn, wait) {
    let timer;
    return function (...args) {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn.apply(this, args), wait);
    };
  }
})();
