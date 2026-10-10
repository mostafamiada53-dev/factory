try {
  require("dotenv").config();
} catch (_) {}

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5000;

/* الباسورد لازم يكون في ملف .env بس (MONGODB_URI=...) */
const MONGODB_URI =
  process.env.MONGODB_URI ||
  "mongodb://current_readings:GbvifHLBkEhpsbY4AS@35.198.147.153:27018/garment?authSource=admin&directConnection=true";

if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI is missing. Put it in a .env file next to server.js");
  process.exit(1);
}


const PUBLIC_API = ("https://glass.garmentio.com/backend"||"http://localhost:5000").replace(/\/+$/, "");
const PUBLIC_API_TIMEOUT_MS = 30000;
const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

try {
  app.use(require("compression")());
} catch (_) {
  console.warn("compression not installed (npm i compression) - skipping");
}

/* =========================================================
   CORS + ngrok
========================================================= */

app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "ngrok-skip-browser-warning"],
    maxAge: 86400
  })
);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

/* =========================================================
   MACHINE DEFINITIONS
========================================================= */

const MACHINES = {
  K007: { mac: "C4:5B:BE:5D:D5:6E", name: "Waistband (K)" },
  F007: { mac: "C4:5B:BE:57:47:C4", name: "Fermatura (F)" },
  S260: { mac: "C4:5B:BE:57:91:DE", name: "Single-needle (S)" }
};

/* =========================================================
   PROCESS NAMES
========================================================= */

const PROCESS_NAMES = {
  PA0050: "تركيب كمر فولدر",

  PB0030: "فارماتورة جيب خلفى *4",
  PB0031: "فارماتورة جيب خلفي هلال*4",

  PC0119: "تثبيت جيب عمله علي الخياله من اعلي",
  PC0346: "مللى تركيب بطانه على السوسته اتجاه",
  PC0044: "تثبيت+رد بطانه جيب العمله",
  PC0353: "تكمله بطانه من اسفل *2",
  PC0183: "تكمله تركيب زاويه الموصرة من اسفل *2",

  PD0221: "تعريش + قلب قلاب زوايا *2",

  PC0219: "مللى سحري جيب عمله + قص فورد",
  PC0089: "داخلى جيب عمله يدوى (على الصدر او الخياله)",
  PC0020: "تركيب بطانه+مللى علوى جيب عمله",

  PC0171: "تركيب خياله الصدر سنجل بزاويه قائمه *2",
  PD0188: "تنشين داخلي قلاب *2",
  PC0041: "تركيب خيالات الصدر سنجل بزاويه قائمه *2",
  PD0020: "داخلى قلاب (ابرة واحدة) *2",
  PC0001: "زاويه شق جيب العمله+مللى سفلى",
  PA0244: "تثبيت سوسته الخياله مع الجنب اتجاه",
  PB0230: "حليه منتصف الجيب الخلفي *2",
  PC0352: "مللى تركيب بطانه على الفودرة+تثبيت",
  PC0042: "ثنى جيب عمله ابرة واحدة (عاديه)"
};

/* =========================================================
   CURRENT READING MODEL
========================================================= */

const currentReadingSchema = new mongoose.Schema(
  {
    timestamp: Date,

    metadata: {
      companyId: mongoose.Schema.Types.ObjectId,
      deviceId: mongoose.Schema.Types.ObjectId,
      deviceMac: { type: String, index: true },
      factoryId: mongoose.Schema.Types.ObjectId,
      machineId: mongoose.Schema.Types.Mixed,
      machineTypeId: mongoose.Schema.Types.ObjectId,
      productionLineId: mongoose.Schema.Types.ObjectId,
      sectionId: mongoose.Schema.Types.ObjectId
    },

    qualityFlags: {
      invalidSampleCount: Boolean,
      impossibleValue: Boolean,
      flatlined: Boolean
    },

    sampleIntervalMs: Number,
    packetEndTimestamp: Date,
    sampleCount: Number,

    context: {
      deviceStatus: Number,
      statusLastUpdatedAt: Date,
      operatorId: mongoose.Schema.Types.ObjectId,
      activeEmployeeIds: [mongoose.Schema.Types.ObjectId],
      lastBeatOrderId: mongoose.Schema.Types.ObjectId,
      lastLoginTimestamp: Date,
      lastOpenIdleTimeTimestamp: Date,

      assignments: [
        {
          styleId: mongoose.Schema.Types.ObjectId,
          orderId: mongoose.Schema.Types.ObjectId,
          processIds: [mongoose.Schema.Types.Mixed],
          standardProcessIds: [mongoose.Schema.Types.Mixed],
          standardProcessCodes: [String],
          processesPerScan: mongoose.Schema.Types.Mixed,
          processScanSequence: mongoose.Schema.Types.Mixed
        }
      ]
    },

    sourceTopic: String,
    sampleRateHz: Number,
    samples: [Number],
    receivedAt: Date
  },

  {
    collection: "device_current_readings",
    autoIndex: false
  }
);

const CurrentReading =
  mongoose.models.CurrentReading ||
  mongoose.model("CurrentReading", currentReadingSchema);

/* =========================================================
   HELPERS
========================================================= */

function normalizeMac(value) {
  return String(value || "").trim().toUpperCase();
}

function isValidDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(date || ""));
}

function cairoOffsetMinutes(utcDate) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    timeZoneName: "longOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(utcDate);

  const zone = parts.find(p => p.type === "timeZoneName")?.value || "GMT+02:00";
  const match = zone.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 120;

  const sign = match[1] === "+" ? 1 : -1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

function cairoLocalDateToUTC(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const approximation = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const offsetMinutes = cairoOffsetMinutes(approximation);
  return new Date(approximation.getTime() - offsetMinutes * 60 * 1000);
}

function getDayRange(date) {
  if (!isValidDate(date)) throw new Error("date must be YYYY-MM-DD");

  const start = cairoLocalDateToUTC(date);
  const nextDay = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const endOffsetMinutes = cairoOffsetMinutes(nextDay);

  const end = new Date(
    nextDay.getTime() - (endOffsetMinutes - cairoOffsetMinutes(start)) * 60 * 1000
  );

  return { start, end };
}

function todayInCairo() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
}

function machineCodeFromMac(mac) {
  const normalized = normalizeMac(mac);
  for (const [code, machine] of Object.entries(MACHINES)) {
    if (normalizeMac(machine.mac) === normalized) return code;
  }
  return null;
}

function cleanProcessId(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && value._bsontype === "ObjectID") return String(value);
  const text = String(value).trim();
  return text || null;
}

function addProcess(map, processId, processName = "") {
  const id = cleanProcessId(processId);
  if (!id) return;

  const name = String(processName || "").trim() || PROCESS_NAMES[id] || "";

  if (!map.has(id)) {
    map.set(id, { processId: id, name });
  } else if (!map.get(id).name && name) {
    map.get(id).name = name;
  }
}

/* =========================================================
   HEALTH
========================================================= */

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    server: "FACTORY APP",
    mongoState: mongoose.connection.readyState,
    mongoStateText: mongoose.connection.readyState === 1 ? "connected" : "not-connected",
    mongoDatabase: mongoose.connection.name || null,
    recordsApi: PUBLIC_API,
    time: new Date().toISOString()
  });
});

/* =========================================================
   PROCESS PIECE RECORDS (proxy to the public API)
   مش بيحتاج Mongo متوصل، فحطيناه قبل check الـ 503
========================================================= */

function validateRecordBody(body) {
  const { machine, process: processId, startTimestamp, endTimestamp } = body || {};

  if (!OBJECT_ID_RE.test(String(machine || ""))) {
    return { error: "machine must be a 24-char ObjectId" };
  }
  if (!OBJECT_ID_RE.test(String(processId || ""))) {
    return { error: "process must be a 24-char ObjectId" };
  }
  if (!startTimestamp || !endTimestamp) {
    return { error: "startTimestamp and endTimestamp are required" };
  }

  const start = new Date(startTimestamp);
  const end = new Date(endTimestamp);

  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return { error: "Invalid startTimestamp or endTimestamp" };
  }
  if (end.getTime() <= start.getTime()) {
    return { error: "endTimestamp must be after startTimestamp" };
  }

  return {
    payload: {
      machine: String(machine),
      process: String(processId),
      startTimestamp: start.toISOString(),
      endTimestamp: end.toISOString()
    }
  };
}

async function forwardToPublicApi(method, urlPath, payload, res, label) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PUBLIC_API_TIMEOUT_MS);

  try {
    const response = await fetch(PUBLIC_API + urlPath, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = { success: response.ok, message: text || "Empty response from records API" };
    }

    if (!response.ok) {
      console.error(label, response.status, text);
    }

    return res.status(response.status).json(data);

  } catch (error) {
    console.error(label, error);
    const message =
      error.name === "AbortError"
        ? "Records API timed out"
        : "Could not reach records API: " + error.message;
    return res.status(502).json({ success: false, message });
  } finally {
    clearTimeout(timeoutId);
  }
}

app.post("/api/process-piece-records", async (req, res) => {
  const result = validateRecordBody(req.body);
  if (result.error) {
    return res.status(400).json({ success: false, message: result.error });
  }
  return forwardToPublicApi(
    "POST",
    "/api/process-piece-records",
    result.payload,
    res,
    "PROCESS PIECE RECORD CREATE ERROR:"
  );
});

app.put("/api/process-piece-records/:id", async (req, res) => {
  if (!OBJECT_ID_RE.test(String(req.params.id || ""))) {
    return res.status(400).json({ success: false, message: "Invalid record id" });
  }

  const result = validateRecordBody(req.body);
  if (result.error) {
    return res.status(400).json({ success: false, message: result.error });
  }

  return forwardToPublicApi(
    "PUT",
    "/api/process-piece-records/" + req.params.id,
    result.payload,
    res,
    "PROCESS PIECE RECORD UPDATE ERROR:"
  );
});

/* =========================================================
   MONGO CONNECTION CHECK (للـ routes اللي بتقرأ من Mongo)
========================================================= */

app.use("/api", (req, res, next) => {
  if (mongoose.connection.readyState === 1) return next();

  return res.status(503).json({
    success: false,
    message: "Database not connected yet, retrying..."
  });
});

/* =========================================================
   CURRENT WAVE
========================================================= */

app.get("/api/current-wave", async (req, res) => {
  try {
    const deviceMac = normalizeMac(req.query.deviceMac);

    if (!deviceMac) {
      return res.status(400).json({ success: false, message: "deviceMac is required" });
    }

    const now = Date.now();
    const freshnessMs = 5000;

    const readings = await CurrentReading.find(
      { "metadata.deviceMac": deviceMac },
      { timestamp: 1, samples: 1, sampleIntervalMs: 1, sampleCount: 1, receivedAt: 1 }
    )
      .sort({ timestamp: -1 })
      .skip(1)
      .limit(1)
      .lean();

    const latest = readings[0] || null;

    if (!latest) {
      return res.json({
        success: true,
        hasCurrentReading: false,
        isFresh: false,
        points: []
      });
    }

    const baseTimestamp = latest.timestamp
      ? new Date(latest.timestamp).getTime()
      : latest.receivedAt
        ? new Date(latest.receivedAt).getTime()
        : now;

    const samples = Array.isArray(latest.samples) ? latest.samples : [];

    const interval = Number(latest.sampleIntervalMs) > 0 ? Number(latest.sampleIntervalMs) : 100;

    const points = samples.map((value, index) => ({
      time: new Date(baseTimestamp - (samples.length - 1 - index) * interval).toISOString(),
      current: Number(value)
    }));

    const current = points.length > 0 ? points[points.length - 1].current : null;

    const timestampMs = baseTimestamp;
    const isFresh = Number.isFinite(timestampMs) && now - timestampMs <= freshnessMs;
    const timeIso = Number.isFinite(timestampMs) ? new Date(timestampMs).toISOString() : null;

    return res.json({
      success: true,
      hasCurrentReading: true,
      isFresh,
      current,
      time: timeIso,
      latestReading: { current, time: timeIso },
      sampleCount: samples.length,
      points
    });

  } catch (error) {
    console.error("CURRENT WAVE ERROR:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/* =========================================================
   HISTORICAL OPTIONS
========================================================= */

const INCLUDE_RECEIVED_AT_FALLBACK = false;
const OPTIONS_CACHE_TTL_TODAY_MS = 60 * 1000;
const OPTIONS_CACHE_TTL_PAST_MS = 60 * 60 * 1000;
const optionsCache = new Map();

app.get("/api/historical-options", async (req, res) => {
  try {
    const date = String(req.query.date || "").trim();

    if (!isValidDate(date)) {
      return res.status(400).json({
        success: false,
        message: "date must be YYYY-MM-DD",
        machineCount: 0,
        machines: [],
        processesByMachine: {}
      });
    }

    const cached = optionsCache.get(date);

    if (cached && cached.expires > Date.now() && req.query.refresh !== "1") {
      return res.json(cached.payload);
    }

    const { start, end } = getDayRange(date);

    const timeFilter = INCLUDE_RECEIVED_AT_FALLBACK
      ? {
          $or: [
            { timestamp: { $gte: start, $lt: end } },
            { timestamp: null, receivedAt: { $gte: start, $lt: end } }
          ]
        }
      : { timestamp: { $gte: start, $lt: end } };

    const groupedDevices = await CurrentReading.aggregate(
      [
        {
          $match: {
            "metadata.deviceMac": {
              $in: Object.values(MACHINES).map(m => normalizeMac(m.mac))
            },
            ...timeFilter
          }
        },
        {
          $project: {
            _id: 0,
            deviceMac: "$metadata.deviceMac",
            processCodes: "$context.assignments.standardProcessCodes"
          }
        },
        { $unwind: { path: "$processCodes" } },
        { $unwind: { path: "$processCodes" } },
        { $match: { processCodes: { $nin: [null, ""] } } },
        {
          $group: {
            _id: "$deviceMac",
            processCodes: { $addToSet: "$processCodes" }
          }
        }
      ],
      { allowDiskUse: true }
    );

    const machinesMap = new Map();
    const processesByMachine = new Map();

    for (const device of groupedDevices) {
      const mac = normalizeMac(device._id);
      const machineCode = machineCodeFromMac(mac);
      if (!machineCode) continue;

      const machine = MACHINES[machineCode];

      if (!machinesMap.has(machineCode)) {
        machinesMap.set(machineCode, {
          machineId: machineCode,
          name: machine.name,
          machineType: machine.name,
          deviceMac: machine.mac
        });
      }

      if (!processesByMachine.has(machineCode)) {
        processesByMachine.set(machineCode, new Map());
      }

      const processMap = processesByMachine.get(machineCode);
      const processCodes = Array.isArray(device.processCodes) ? device.processCodes : [];

      for (const processCode of processCodes) {
        addProcess(processMap, processCode);
      }
    }

    const machines = Array.from(machinesMap.values()).sort((a, b) =>
      a.machineId.localeCompare(b.machineId)
    );

    const finalProcesses = {};

    for (const machine of machines) {
      const processMap = processesByMachine.get(machine.machineId) || new Map();

      finalProcesses[machine.machineId] = Array.from(processMap.values()).sort((a, b) =>
        a.processId.localeCompare(b.processId)
      );
    }

    const payload = {
      success: true,
      date,
      machineCount: machines.length,
      machines,
      processesByMachine: finalProcesses
    };

    optionsCache.set(date, {
      expires:
        Date.now() +
        (date === todayInCairo() ? OPTIONS_CACHE_TTL_TODAY_MS : OPTIONS_CACHE_TTL_PAST_MS),
      payload
    });

    return res.json(payload);

  } catch (error) {
    console.error("HISTORICAL OPTIONS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
      machineCount: 0,
      machines: [],
      processesByMachine: {}
    });
  }
});

/* =========================================================
   HISTORICAL WAVE
========================================================= */

const HISTORICAL_MAX_POINTS = 1200;
const HISTORICAL_MODE = "minmax";

function summarizeHistorical(times, values, n, maxPoints = HISTORICAL_MAX_POINTS) {
  const out = [];

  if (n === 0) return out;

  if (n <= maxPoints) {
    for (let i = 0; i < n; i++) {
      out.push({ time: new Date(times[i]).toISOString(), current: values[i] });
    }
    return out;
  }

  if (HISTORICAL_MODE === "avg") {
    const buckets = maxPoints;

    for (let b = 0; b < buckets; b++) {
      const i0 = Math.floor((b * n) / buckets);
      const i1 = Math.floor(((b + 1) * n) / buckets);
      if (i1 <= i0) continue;

      let sum = 0;
      for (let i = i0; i < i1; i++) sum += values[i];

      out.push({
        time: new Date(times[(i0 + i1) >> 1]).toISOString(),
        current: sum / (i1 - i0)
      });
    }

    return out;
  }

  const buckets = Math.max(1, Math.floor(maxPoints / 2));

  for (let b = 0; b < buckets; b++) {
    const i0 = Math.floor((b * n) / buckets);
    const i1 = Math.floor(((b + 1) * n) / buckets);
    if (i1 <= i0) continue;

    let minIdx = i0;
    let maxIdx = i0;
    let minVal = values[i0];
    let maxVal = values[i0];

    for (let i = i0 + 1; i < i1; i++) {
      const v = values[i];

      if (v < minVal) {
        minVal = v;
        minIdx = i;
      } else if (v > maxVal) {
        maxVal = v;
        maxIdx = i;
      }
    }

    if (minIdx === maxIdx) {
      out.push({ time: new Date(times[minIdx]).toISOString(), current: minVal });
    } else if (minIdx < maxIdx) {
      out.push({ time: new Date(times[minIdx]).toISOString(), current: minVal });
      out.push({ time: new Date(times[maxIdx]).toISOString(), current: maxVal });
    } else {
      out.push({ time: new Date(times[maxIdx]).toISOString(), current: maxVal });
      out.push({ time: new Date(times[minIdx]).toISOString(), current: minVal });
    }
  }

  return out;
}

/* =========================================================
   DAY CACHE
========================================================= */

const WAVE_CACHE_MAX_ENTRIES = 8;
const WAVE_CACHE_TTL_TODAY_MS = 30 * 1000;
const WAVE_CACHE_TTL_PAST_MS = 30 * 60 * 1000;
const waveCache = new Map();

function lowerBound(arr, n, target) {
  let lo = 0;
  let hi = n;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }

  return lo;
}

async function fetchDayWave(deviceMac, processCode, dayStart, dayEnd) {
  const readings = await CurrentReading.find(
    {
      "metadata.deviceMac": deviceMac,
      timestamp: { $gte: dayStart, $lt: dayEnd },
      "context.assignments": {
        $elemMatch: { standardProcessCodes: processCode }
      }
    },
    { timestamp: 1, samples: 1, sampleIntervalMs: 1 }
  )
    .sort({ timestamp: 1 })
    .lean();

  let capacity = 0;

  for (const reading of readings) {
    if (Array.isArray(reading.samples)) capacity += reading.samples.length;
  }

  let times = new Float64Array(capacity);
  let values = new Float64Array(capacity);
  const packetTimesArr = [];

  let n = 0;
  let sorted = true;
  let prevT = -Infinity;

  for (const reading of readings) {
    const samples = reading.samples;

    if (!Array.isArray(samples) || samples.length === 0) continue;

    const baseTimestamp = reading.timestamp ? reading.timestamp.getTime() : NaN;
    if (!Number.isFinite(baseTimestamp)) continue;

    packetTimesArr.push(baseTimestamp);

    const interval = Number(reading.sampleIntervalMs) > 0 ? Number(reading.sampleIntervalMs) : 100;
    const last = samples.length - 1;

    for (let i = 0; i <= last; i++) {
      const value = samples[i];

      if (typeof value !== "number" || !Number.isFinite(value)) continue;

      const t = baseTimestamp - (last - i) * interval;

      if (t < prevT) sorted = false;
      prevT = t;

      times[n] = t;
      values[n] = value;
      n++;
    }
  }

  if (!sorted && n > 1) {
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;

    idx.sort((a, b) => times[a] - times[b]);

    const t2 = new Float64Array(n);
    const v2 = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      t2[i] = times[idx[i]];
      v2[i] = values[idx[i]];
    }

    times = t2;
    values = v2;
  }

  return {
    times,
    values,
    n,
    packetTimes: Float64Array.from(packetTimesArr).sort()
  };
}

function loadDayWave(deviceMac, date, processCode, dayStart, dayEnd) {
  const key = `${deviceMac}|${date}|${processCode}`;
  const hit = waveCache.get(key);

  if (hit && hit.expires > Date.now()) {
    waveCache.delete(key);
    waveCache.set(key, hit);
    return hit.promise;
  }

  const ttl = date === todayInCairo() ? WAVE_CACHE_TTL_TODAY_MS : WAVE_CACHE_TTL_PAST_MS;

  const promise = fetchDayWave(deviceMac, processCode, dayStart, dayEnd);

  waveCache.set(key, { expires: Date.now() + ttl, promise });

  promise.catch(() => waveCache.delete(key));

  while (waveCache.size > WAVE_CACHE_MAX_ENTRIES) {
    waveCache.delete(waveCache.keys().next().value);
  }

  return promise;
}

app.get("/api/historical-wave", async (req, res) => {
  try {
    const deviceMac = normalizeMac(req.query.deviceMac);
    const date = String(req.query.date || "").trim();
    const processCode = String(req.query.processCode || "").trim();
    const startTimestamp = String(req.query.startTimestamp || "").trim();
    const endTimestamp = String(req.query.endTimestamp || "").trim();

    if (!deviceMac) {
      return res.status(400).json({ success: false, message: "deviceMac is required" });
    }

    if (!isValidDate(date)) {
      return res.status(400).json({ success: false, message: "date must be YYYY-MM-DD" });
    }

    if (!processCode) {
      return res.status(400).json({ success: false, message: "processCode is required" });
    }

    const { start: dayStart, end: dayEnd } = getDayRange(date);

    let rangeStart = dayStart;
    let rangeEnd = dayEnd;

    if (startTimestamp || endTimestamp) {
      if (!startTimestamp || !endTimestamp) {
        return res.status(400).json({
          success: false,
          message: "startTimestamp and endTimestamp must be provided together"
        });
      }

      const parsedStart = new Date(startTimestamp);
      const parsedEnd = new Date(endTimestamp);

      if (!Number.isFinite(parsedStart.getTime())) {
        return res.status(400).json({ success: false, message: "startTimestamp is invalid" });
      }

      if (!Number.isFinite(parsedEnd.getTime())) {
        return res.status(400).json({ success: false, message: "endTimestamp is invalid" });
      }

      if (parsedStart >= parsedEnd) {
        return res.status(400).json({
          success: false,
          message: "startTimestamp must be before endTimestamp"
        });
      }

      rangeStart = parsedStart;
      rangeEnd = parsedEnd;
    }

    if (rangeStart < dayStart) rangeStart = dayStart;
    if (rangeEnd > dayEnd) rangeEnd = dayEnd;

    const rangeBase = {
      success: true,
      deviceMac,
      date,
      processCode,
      range: {
        startTimestamp: rangeStart.toISOString(),
        endTimestamp: rangeEnd.toISOString()
      }
    };

    if (rangeStart >= rangeEnd) {
      return res.json({
        ...rangeBase,
        packetCount: 0,
        rawPointCount: 0,
        pointCount: 0,
        points: []
      });
    }

    const day = await loadDayWave(deviceMac, date, processCode, dayStart, dayEnd);

    const lo = lowerBound(day.times, day.n, rangeStart.getTime());
    const hi = lowerBound(day.times, day.n, rangeEnd.getTime());
    const count = Math.max(0, hi - lo);

    const points = summarizeHistorical(
      day.times.subarray(lo, hi),
      day.values.subarray(lo, hi),
      count
    );

    const packetCount =
      lowerBound(day.packetTimes, day.packetTimes.length, rangeEnd.getTime()) -
      lowerBound(day.packetTimes, day.packetTimes.length, rangeStart.getTime());

    return res.json({
      ...rangeBase,
      packetCount,
      rawPointCount: count,
      pointCount: points.length,
      points
    });

  } catch (error) {
    console.error("HISTORICAL WAVE ERROR:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/* =========================================================
   STATIC FRONTEND
========================================================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.use(express.static(__dirname, { dotfiles: "ignore" }));

/* =========================================================
   404
========================================================= */

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ success: false, message: "API route not found" });
  }

  res.status(404).send("Not found");
});

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use((error, req, res, next) => {
  console.error("EXPRESS ERROR:", error);

  res.status(500).json({
    success: false,
    message: error.message || "Server error"
  });
});

/* =========================================================
   MONGO + SERVER START
========================================================= */

const mongoOptions = {
  serverSelectionTimeoutMS: 30000,
  connectTimeoutMS: 30000,
  socketTimeoutMS: 120000,
  heartbeatFrequencyMS: 10000,
  maxPoolSize: 10,
  minPoolSize: 1,
  retryReads: true,
  retryWrites: false,
  autoIndex: false
};

async function connectMongo() {
  try {
    await mongoose.connect(MONGODB_URI, mongoOptions);

    console.log("✅ MongoDB connected");
    console.log("MongoDB database:", mongoose.connection.name);

  } catch (error) {
    console.error("MongoDB connection failed, retrying in 5s:", error.message);
    setTimeout(connectMongo, 5000);
  }
}

mongoose.connection.on("disconnected", () =>
  console.warn("⚠️ MongoDB disconnected (driver will auto-reconnect)")
);

process.on("unhandledRejection", err => console.error("UNHANDLED REJECTION:", err));
process.on("uncaughtException", err => console.error("UNCAUGHT EXCEPTION:", err));

/* =========================================================
   START SERVER
========================================================= */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Piece records are forwarded to: ${PUBLIC_API}`);
  connectMongo();
});
