const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5000;

const MONGODB_URI =
  process.env.MONGODB_URI ||
  "mongodb://current_readings:GbvifHLBkEhpsbY4AS@35.198.147.153:27018/garment?authSource=admin&directConnection=true";

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

/* =========================================================
   MACHINE DEFINITIONS
========================================================= */

const MACHINES = {
  K007: {
    mac: "C4:5B:BE:5D:D5:6E",
    name: "Waistband (K)"
  },

  F007: {
    mac: "C4:5B:BE:57:47:C4",
    name: "Fermatura (F)"
  },

  S260: {
    mac: "C4:5B:BE:57:91:DE",
    name: "Single-needle (S)"
  }
};

/* =========================================================
   PROCESS NAMES
========================================================= */

const PROCESS_NAMES = {
  PA0050: "تركيب كمر فولدر",
  PB000030: "فارماتورة جيب خلفى *4",
  PB000031: "فارماتورة جيب خلفي هلال*4",
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

      deviceMac: {
        type: String,
        index: true
      },

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
    collection: "device_current_readings"
  }
);

currentReadingSchema.index(
  {
    "metadata.deviceMac": 1,
    timestamp: 1
  },
  {
    name: "deviceMac_timestamp_idx"
  }
);

const CurrentReading = mongoose.model(
  "CurrentReading",
  currentReadingSchema
);

/* =========================================================
   PROCESS PIECE RECORD MODEL
========================================================= */

const processRecordSchema = new mongoose.Schema(
  {
    machineId: {
      type: String,
      required: true,
      index: true
    },

    processId: {
      type: String,
      required: true,
      index: true
    },

    deviceMac: {
      type: String,
      index: true
    },

    machineType: String,
    processName: String,

    date: {
      type: String,
      index: true
    },

    startTimestamp: {
      type: Date,
      required: true,
      index: true
    },

    endTimestamp: {
      type: Date,
      required: true,
      index: true
    },

    duration: {
      type: Number,
      required: true
    }
  },
  {
    collection: "process_piece_records",
    timestamps: true
  }
);

processRecordSchema.index({
  machineId: 1,
  startTimestamp: -1
});

processRecordSchema.index({
  processId: 1,
  startTimestamp: -1
});

processRecordSchema.index({
  deviceMac: 1,
  date: 1,
  startTimestamp: -1
});

const ProcessRecord = mongoose.model(
  "ProcessRecord",
  processRecordSchema
);

/* =========================================================
   HELPERS
========================================================= */

function normalizeMac(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function isValidDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(
    String(date || "")
  );
}

function cairoOffsetMinutes(utcDate) {
  const parts = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: "Africa/Cairo",
      timeZoneName: "longOffset",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }
  ).formatToParts(utcDate);

  const zone =
    parts.find(
      p => p.type === "timeZoneName"
    )?.value || "GMT+02:00";

  const match =
    zone.match(
      /GMT([+-])(\d{2}):(\d{2})/
    );

  if (!match) return 120;

  const sign =
    match[1] === "+"
      ? 1
      : -1;

  return (
    sign *
    (
      Number(match[2]) * 60 +
      Number(match[3])
    )
  );
}

function cairoLocalDateToUTC(dateString) {
  const [year, month, day] =
    dateString.split("-").map(Number);

  const approximation =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day,
        0,
        0,
        0,
        0
      )
    );

  const offsetMinutes =
    cairoOffsetMinutes(
      approximation
    );

  return new Date(
    approximation.getTime() -
      offsetMinutes * 60 * 1000
  );
}

function getDayRange(date) {
  if (!isValidDate(date)) {
    throw new Error(
      "date must be YYYY-MM-DD"
    );
  }

  const start =
    cairoLocalDateToUTC(date);

  const nextDay =
    new Date(
      start.getTime() +
        24 * 60 * 60 * 1000
    );

  const endOffsetMinutes =
    cairoOffsetMinutes(nextDay);

  const end =
    new Date(
      nextDay.getTime() -
        (
          endOffsetMinutes -
          cairoOffsetMinutes(start)
        ) *
          60 *
          1000
    );

  return {
    start,
    end
  };
}

function clamp(value, min, max) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

function machineCodeFromMac(mac) {
  const normalized =
    normalizeMac(mac);

  for (
    const [code, machine]
    of Object.entries(MACHINES)
  ) {
    if (
      normalizeMac(machine.mac) ===
      normalized
    ) {
      return code;
    }
  }

  return null;
}

function cleanProcessId(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    value._bsontype === "ObjectID"
  ) {
    return String(value);
  }

  const text =
    String(value).trim();

  return text || null;
}

function addProcess(
  map,
  processId,
  processName = ""
) {
  const id =
    cleanProcessId(processId);

  if (!id) return;

  const name =
    String(
      processName || ""
    ).trim() ||
    PROCESS_NAMES[id] ||
    "";

  if (!map.has(id)) {
    map.set(id, {
      processId: id,
      name
    });
  } else if (
    !map.get(id).name &&
    name
  ) {
    map.get(id).name = name;
  }
}

function extractProcessesFromAssignment(
  assignment,
  processMap
) {
  if (
    !assignment ||
    typeof assignment !== "object"
  ) {
    return;
  }

  const codes =
    Array.isArray(
      assignment.standardProcessCodes
    )
      ? assignment.standardProcessCodes
      : [];

  codes.forEach(code =>
    addProcess(
      processMap,
      code
    )
  );

  const processIds =
    Array.isArray(
      assignment.processIds
    )
      ? assignment.processIds
      : [];

  processIds.forEach(id =>
    addProcess(
      processMap,
      id
    )
  );

  const standardIds =
    Array.isArray(
      assignment.standardProcessIds
    )
      ? assignment.standardProcessIds
      : [];

  standardIds.forEach(id =>
    addProcess(
      processMap,
      id
    )
  );

  const scanCandidates = [
    assignment.processesPerScan,
    assignment.processScanSequence
  ];

  for (
    const candidate
    of scanCandidates
  ) {
    if (!candidate) continue;

    if (Array.isArray(candidate)) {
      for (
        const item
        of candidate
      ) {
        if (
          typeof item === "string"
        ) {
          addProcess(
            processMap,
            item
          );
        } else if (
          item &&
          typeof item === "object"
        ) {
          addProcess(
            processMap,
            item.processId ??
              item.standardProcessId ??
              item.processCode ??
              item.code ??
              item.id
          );
        }
      }
    } else if (
      typeof candidate === "object"
    ) {
      for (
        const [key, value]
        of Object.entries(candidate)
      ) {
        if (
          typeof key === "string"
        ) {
          addProcess(
            processMap,
            key
          );
        }

        if (
          typeof value === "string"
        ) {
          addProcess(
            processMap,
            value
          );
        } else if (
          Array.isArray(value)
        ) {
          value.forEach(v => {
            if (
              typeof v === "string"
            ) {
              addProcess(
                processMap,
                v
              );
            } else if (
              v &&
              typeof v === "object"
            ) {
              addProcess(
                processMap,
                v.processId ??
                  v.standardProcessId ??
                  v.processCode ??
                  v.code ??
                  v.id
              );
            }
          });
        }
      }
    }
  }
}

function processIdsMatch(a, b) {
  const aa =
    cleanProcessId(a);

  const bb =
    cleanProcessId(b);

  if (!aa || !bb) {
    return false;
  }

  return aa === bb;
}

function calculateDuration(
  start,
  end
) {
  const s =
    new Date(start).getTime();

  const e =
    new Date(end).getTime();

  if (
    !Number.isFinite(s) ||
    !Number.isFinite(e)
  ) {
    throw new Error(
      "Invalid start or end time"
    );
  }

  if (e <= s) {
    throw new Error(
      "END must be after START"
    );
  }

  return Number(
    (
      (e - s) /
      1000
    ).toFixed(3)
  );
}

/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/api/health",
  async (
    req,
    res
  ) => {
    res.json({
      success: true,
      server: "FACTORY APP",

      mongoState:
        mongoose.connection.readyState,

      mongoStateText:
        mongoose.connection
          .readyState === 1
          ? "connected"
          : "not-connected",

      time:
        new Date().toISOString()
    });
  }
);

/* =========================================================
   CURRENT WAVE
========================================================= */

app.get(
  "/api/current-wave",
  async (
    req,
    res
  ) => {

    try {

      const deviceMac =
        normalizeMac(
          req.query.deviceMac
        );

      if (!deviceMac) {

        return res.status(400).json({
          success: false,
          message:
            "deviceMac is required"
        });
      }

      const now =
        Date.now();

      const freshnessMs =
        5000;

      const latest =
        await CurrentReading
          .findOne(
            {
              "metadata.deviceMac":
                deviceMac
            },
            {
              timestamp: 1,
              samples: 1,
              sampleIntervalMs: 1,
              sampleCount: 1,
              receivedAt: 1
            }
          )
          .sort({
            timestamp: -1,
            _id: -1
          })
          .lean();

      if (!latest) {

        return res.json({
          success: true,
          hasCurrentReading: false,
          isFresh: false,
          points: []
        });
      }

      const baseTimestamp =
        latest.timestamp
          ? new Date(
              latest.timestamp
            ).getTime()
          : latest.receivedAt
            ? new Date(
                latest.receivedAt
              ).getTime()
            : now;

      const samples =
        Array.isArray(
          latest.samples
        )
          ? latest.samples
          : [];

      const interval =
        Number(
          latest.sampleIntervalMs
        ) > 0
          ? Number(
              latest.sampleIntervalMs
            )
          : 100;

      const points =
        samples.map(
          (
            value,
            index
          ) => ({
            time:
              new Date(
                baseTimestamp -
                  (
                    samples.length -
                    1 -
                    index
                  ) *
                    interval
              ).toISOString(),

            current:
              Number(value)
          })
        );

      const current =
        points.length > 0
          ? points[
              points.length - 1
            ].current
          : null;

      const timestampMs =
        baseTimestamp;

      const isFresh =
        Number.isFinite(
          timestampMs
        ) &&
        now -
          timestampMs <=
          freshnessMs;

      return res.json({

        success: true,

        hasCurrentReading:
          true,

        isFresh,

        current,

        time:
          Number.isFinite(
            timestampMs
          )
            ? new Date(
                timestampMs
              ).toISOString()
            : null,

        latestReading: {
          current,

          time:
            Number.isFinite(
              timestampMs
            )
              ? new Date(
                  timestampMs
                ).toISOString()
              : null
        },

        sampleCount:
          samples.length,

        points
      });

    } catch (error) {

      console.error(
        "CURRENT WAVE ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          error.message
      });
    }
  }
);

/* =========================================================
   HISTORICAL OPTIONS
   OPTIMIZED VERSION
========================================================= */

app.get(
  "/api/historical-options",
  async (
    req,
    res
  ) => {

    try {

      const date =
        String(
          req.query.date ||
          ""
        ).trim();

      if (
        !isValidDate(date)
      ) {

        return res
          .status(400)
          .json({

            success:
              false,

            message:
              "date must be YYYY-MM-DD",

            machineCount:
              0,

            machines:
              [],

            processesByMachine:
              {}
          });
      }

      const {
        start,
        end
      } =
        getDayRange(
          date
        );

      console.log("");
      console.log(
        "========================================"
      );

      console.log(
        "📋 HISTORICAL OPTIONS REQUEST"
      );

      console.log(
        "Date:",
        date
      );

      console.log(
        "Range:",
        start.toISOString(),
        "→",
        end.toISOString()
      );

      /* =====================================================
         IMPORTANT

         Instead of loading tens of thousands of complete
         assignments into Node, MongoDB extracts only the
         process codes we need.
      ===================================================== */

      const groupedDevices =
        await CurrentReading.aggregate(
          [

            /* -----------------------------------------------
               MATCH SELECTED DAY
            ------------------------------------------------ */

            {
              $match: {

                $or: [

                  {
                    timestamp: {

                      $gte:
                        start,

                      $lt:
                        end
                    }
                  },

                  {
                    timestamp:
                      null,

                    receivedAt: {

                      $gte:
                        start,

                      $lt:
                        end
                    }
                  }
                ]
              }
            },

            /* -----------------------------------------------
               ONLY NEEDED FIELDS
            ------------------------------------------------ */

            {
              $project: {

                deviceMac:
                  "$metadata.deviceMac",

                assignments:
                  "$context.assignments"
              }
            },

            /* -----------------------------------------------
               ONLY OUR MACHINES
            ------------------------------------------------ */

            {
              $match: {

                deviceMac: {

                  $in:
                    Object.values(
                      MACHINES
                    ).map(
                      machine =>
                        normalizeMac(
                          machine.mac
                        )
                    )
                }
              }
            },

            /* -----------------------------------------------
               ONE ASSIGNMENT AT A TIME
            ------------------------------------------------ */

            {
              $unwind: {

                path:
                  "$assignments"
              }
            },

            /* -----------------------------------------------
               ONLY STANDARD PROCESS CODES
            ------------------------------------------------ */

            {
              $project: {

                deviceMac:
                  1,

                processCodes:
                  "$assignments.standardProcessCodes"
              }
            },

            /* -----------------------------------------------
               ONE PROCESS CODE AT A TIME
            ------------------------------------------------ */

            {
              $unwind: {

                path:
                  "$processCodes"
              }
            },

            /* -----------------------------------------------
               REMOVE EMPTY PROCESS CODES
            ------------------------------------------------ */

            {
              $match: {

                processCodes: {

                  $nin: [
                    null,
                    ""
                  ]
                }
              }
            },

            /* -----------------------------------------------
               UNIQUE MACHINE + PROCESS
            ------------------------------------------------ */

            {
              $group: {

                _id: {

                  deviceMac:
                    "$deviceMac",

                  processCode:
                    "$processCodes"
                }
              }
            },

            /* -----------------------------------------------
               GROUP BY MACHINE
            ------------------------------------------------ */

            {
              $group: {

                _id:
                  "$_id.deviceMac",

                processCodes: {

                  $addToSet:
                    "$_id.processCode"
                }
              }
            }

          ],
          {
            allowDiskUse:
              true
          }
        );

      console.log(
        "Unique devices found:",
        groupedDevices.length
      );

      /* =====================================================
         MAPS
      ===================================================== */

      const machinesMap =
        new Map();

      const processesByMachine =
        new Map();

      /* =====================================================
         LOOP DEVICES
      ===================================================== */

      for (
        const device
        of groupedDevices
      ) {

        const mac =
          normalizeMac(
            device._id
          );

        const machineCode =
          machineCodeFromMac(
            mac
          );

        if (!machineCode) {
          continue;
        }

        const machine =
          MACHINES[
            machineCode
          ];

        /* ---------------------------------------------------
           MACHINE
        --------------------------------------------------- */

        if (
          !machinesMap.has(
            machineCode
          )
        ) {

          machinesMap.set(
            machineCode,
            {

              machineId:
                machineCode,

              name:
                machine.name,

              machineType:
                machine.name,

              deviceMac:
                machine.mac
            }
          );
        }

        /* ---------------------------------------------------
           PROCESS MAP
        --------------------------------------------------- */

        if (
          !processesByMachine.has(
            machineCode
          )
        ) {

          processesByMachine.set(
            machineCode,
            new Map()
          );
        }

        const processMap =
          processesByMachine.get(
            machineCode
          );

        /* ---------------------------------------------------
           PROCESS CODES
        --------------------------------------------------- */

        const processCodes =
          Array.isArray(
            device.processCodes
          )
            ? device.processCodes
            : [];

        for (
          const processCode
          of processCodes
        ) {

          addProcess(
            processMap,
            processCode
          );
        }
      }

      /* =====================================================
         FINAL MACHINES
      ===================================================== */

      const machines =
        Array
          .from(
            machinesMap.values()
          )
          .sort(
            (
              a,
              b
            ) =>
              a.machineId.localeCompare(
                b.machineId
              )
          );

      /* =====================================================
         FINAL PROCESSES
      ===================================================== */

      const finalProcesses = {};

      for (
        const machine
        of machines
      ) {

        const processMap =
          processesByMachine.get(
            machine.machineId
          ) ||
          new Map();

        finalProcesses[
          machine.machineId
        ] =
          Array
            .from(
              processMap.values()
            )
            .sort(
              (
                a,
                b
              ) =>
                a.processId.localeCompare(
                  b.processId
                )
            );
      }

      /* =====================================================
         LOG
      ===================================================== */

      console.log(
        "Machines:",
        machines.length
      );

      machines.forEach(
        machine => {

          console.log(
            "Machine:",
            machine.machineId,
            "| MAC:",
            machine.deviceMac,
            "| Type:",
            machine.machineType,
            "| Processes:",
            (
              finalProcesses[
                machine.machineId
              ] ||
              []
            ).length
          );

          (
            finalProcesses[
              machine.machineId
            ] ||
            []
          ).forEach(
            process => {

              console.log(
                "   Process:",
                process.processId,
                "| Name:",
                process.name
              );
            }
          );
        }
      );

      console.log(
        "========================================"
      );

      console.log("");

      return res.json({

        success:
          true,

        date:
          date,

        machineCount:
          machines.length,

        machines:
          machines,

        processesByMachine:
          finalProcesses
      });

    } catch (error) {

      console.error(
        "❌ HISTORICAL OPTIONS ERROR:",
        error
      );

      return res
        .status(500)
        .json({

          success:
            false,

          message:
            error.message,

          machineCount:
            0,

          machines:
            [],

          processesByMachine:
            {}
        });
    }
  }
);

/* =========================================================
   HISTORICAL WAVE
   READ ONLY FROM MONGODB
========================================================= */

app.get(
  "/api/historical-wave",
  async (
    req,
    res
  ) => {

    try {

      const deviceMac =
        normalizeMac(
          req.query.deviceMac
        );

      const date =
        String(
          req.query.date ||
          ""
        );

      if (!deviceMac) {

        return res.status(400).json({
          success: false,
          message:
            "deviceMac is required"
        });
      }

      if (
        !isValidDate(date)
      ) {

        return res.status(400).json({
          success: false,
          message:
            "date must be YYYY-MM-DD"
        });
      }

      const {
        start,
        end
      } =
        getDayRange(date);

      const requestedResolution =
        Number(
          req.query.resolution ||
          req.query.maxPoints ||
          0
        );

      const count =
        await CurrentReading.countDocuments({
          "metadata.deviceMac":
            deviceMac,

          timestamp: {
            $gte: start,
            $lt: end
          }
        });

      let bucketSeconds;

      if (
        Number.isFinite(
          requestedResolution
        ) &&
        requestedResolution >= 1 &&
        requestedResolution <= 3600
      ) {

        bucketSeconds =
          requestedResolution;

      } else {

        if (
          count <= 2000
        ) {
          bucketSeconds = 1;
        } else if (
          count <= 10000
        ) {
          bucketSeconds = 5;
        } else if (
          count <= 30000
        ) {
          bucketSeconds = 10;
        } else if (
          count <= 100000
        ) {
          bucketSeconds = 30;
        } else {
          bucketSeconds = 60;
        }
      }

      const bucketMs =
        bucketSeconds * 1000;

      const pipeline = [

        {
          $match: {

            "metadata.deviceMac":
              deviceMac,

            timestamp: {
              $gte: start,
              $lt: end
            }
          }
        },

        {
          $project: {

            timestamp: 1,

            avgValue: {
              $avg:
                "$samples"
            }
          }
        },

        {
          $match: {

            avgValue: {
              $ne: null
            }
          }
        },

        {
          $project: {

            bucket: {
              $toDate: {

                $multiply: [

                  {
                    $floor: {

                      $divide: [

                        {
                          $subtract: [
                            "$timestamp",
                            start
                          ]
                        },

                        bucketMs
                      ]
                    }
                  },

                  bucketMs
                ]
              }
            },

            relativeBucket: {
              $floor: {

                $divide: [

                  {
                    $subtract: [
                      "$timestamp",
                      start
                    ]
                  },

                  bucketMs
                ]
              }
            },

            avgValue: 1
          }
        },

        {
          $group: {

            _id:
              "$relativeBucket",

            avgValue: {
              $avg:
                "$avgValue"
            }
          }
        },

        {
          $sort: {
            _id: 1
          }
        },

        {
          $project: {

            _id: 0,

            timestamp: {

              $dateAdd: {

                startDate:
                  start,

                unit:
                  "millisecond",

                amount: {

                  $multiply: [

                    "$_id",

                    bucketMs

                  ]
                }
              }
            },

            current:
              "$avgValue"
          }
        }
      ];

      const rows =
        await CurrentReading
          .aggregate(
            pipeline
          )
          .allowDiskUse(true)
          .option({
            maxTimeMS: 60000
          });

      const points =
        rows
          .map(
            row => ({
              time:
                new Date(
                  row.timestamp
                ).toISOString(),

              current:
                Number(
                  row.current
                )
            })
          )
          .filter(
            p =>
              Number.isFinite(
                p.current
              )
          );

      return res.json({

        success: true,

        deviceMac,

        date,

        packetCount:
          count,

        bucketSeconds,

        pointCount:
          points.length,

        points
      });

    } catch (error) {

      console.error(
        "HISTORICAL WAVE ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          error.message
      });
    }
  }
);

/* =========================================================
   SAVE PIECE
   METADATA ONLY
========================================================= */

app.post(
  "/api/save-piece",
  async (
    req,
    res
  ) => {

    try {

      const body =
        req.body || {};

      const machineId =
        String(
          body.machineId ||
          body.machine ||
          body.machineCode ||
          ""
        ).trim();

      const processId =
        String(
          body.processId ||
          body.process ||
          body.processCode ||
          ""
        ).trim();

      const deviceMac =
        normalizeMac(
          body.deviceMac
        );

      const machineType =
        String(
          body.machineType ||
          ""
        ).trim();

      const processName =
        String(
          body.processName ||
          PROCESS_NAMES[
            processId
          ] ||
          ""
        ).trim();

      const date =
        String(
          body.date ||
          ""
        ).trim();

      const startTime =
        body.startTime ||
        body.startTimestamp;

      const endTime =
        body.endTime ||
        body.endTimestamp;

      if (!machineId) {

        return res.status(400).json({
          success: false,
          message:
            "machineId is required"
        });
      }

      if (!processId) {

        return res.status(400).json({
          success: false,
          message:
            "processId is required"
        });
      }

      if (
        !startTime ||
        !endTime
      ) {

        return res.status(400).json({
          success: false,
          message:
            "startTime and endTime are required"
        });
      }

      const duration =
        calculateDuration(
          startTime,
          endTime
        );

      const derivedDate =
        isValidDate(date)
          ? date
          : new Date(
              startTime
            )
              .toISOString()
              .slice(0, 10);

      const record =
        await ProcessRecord.create({

          machineId,

          processId,

          deviceMac,

          machineType,

          processName,

          date:
            derivedDate,

          startTimestamp:
            new Date(
              startTime
            ),

          endTimestamp:
            new Date(
              endTime
            ),

          duration
        });

      return res.json({

        success: true,

        message:
          "Piece metadata saved successfully",

        record: {

          id:
            String(
              record._id
            ),

          machineId:
            record.machineId,

          processId:
            record.processId,

          deviceMac:
            record.deviceMac,

          machineType:
            record.machineType,

          processName:
            record.processName,

          date:
            record.date,

          startTime:
            record.startTimestamp
              .toISOString(),

          endTime:
            record.endTimestamp
              .toISOString(),

          duration:
            record.duration
        }
      });

    } catch (error) {

      console.error(
        "SAVE PIECE ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          error.message
      });
    }
  }
);

/* =========================================================
   PROCESS RECORDS
========================================================= */

app.get(
  "/api/process-records",
  async (
    req,
    res
  ) => {

    try {

      const filter = {};

      if (
        req.query.machineId
      ) {

        filter.machineId =
          String(
            req.query.machineId
          );
      }

      if (
        req.query.processId
      ) {

        filter.processId =
          String(
            req.query.processId
          );
      }

      if (
        isValidDate(
          req.query.date
        )
      ) {

        const {
          start,
          end
        } =
          getDayRange(
            req.query.date
          );

        filter.startTimestamp = {

          $gte:
            start,

          $lt:
            end
        };
      }

      const records =
        await ProcessRecord
          .find(filter)
          .sort({
            startTimestamp: -1
          })
          .limit(500)
          .lean();

      return res.json({

        success: true,

        records:
          records.map(
            r => ({

              id:
                String(
                  r._id
                ),

              machineId:
                r.machineId,

              processId:
                r.processId,

              deviceMac:
                r.deviceMac,

              machineType:
                r.machineType,

              processName:
                r.processName,

              date:
                r.date,

              startTime:
                r.startTimestamp
                  ? r.startTimestamp
                      .toISOString()
                  : null,

              endTime:
                r.endTimestamp
                  ? r.endTimestamp
                      .toISOString()
                  : null,

              duration:
                r.duration,

              createdAt:
                r.createdAt,

              updatedAt:
                r.updatedAt
            })
          )
      });

    } catch (error) {

      console.error(
        "PROCESS RECORDS GET ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          error.message
      });
    }
  }
);

/* =========================================================
   GET PROCESS RECORD BY ID
========================================================= */

app.get(
  "/api/process-records/:id",
  async (
    req,
    res
  ) => {

    try {

      if (
        !mongoose.Types.ObjectId.isValid(
          req.params.id
        )
      ) {

        return res.status(400).json({
          success: false,
          message:
            "Invalid record id"
        });
      }

      const r =
        await ProcessRecord
          .findById(
            req.params.id
          )
          .lean();

      if (!r) {

        return res.status(404).json({
          success: false,
          message:
            "Record not found"
        });
      }

      return res.json({

        success: true,

        record: {

          id:
            String(
              r._id
            ),

          machineId:
            r.machineId,

          processId:
            r.processId,

          deviceMac:
            r.deviceMac,

          machineType:
            r.machineType,

          processName:
            r.processName,

          date:
            r.date,

          startTime:
            r.startTimestamp?.toISOString(),

          endTime:
            r.endTimestamp?.toISOString(),

          duration:
            r.duration,

          createdAt:
            r.createdAt,

          updatedAt:
            r.updatedAt
        }
      });

    } catch (error) {

      console.error(
        "PROCESS RECORD GET ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          error.message
      });
    }
  }
);

/* =========================================================
   UPDATE PROCESS RECORD
========================================================= */

app.put(
  "/api/process-records/:id",
  async (
    req,
    res
  ) => {

    try {

      if (
        !mongoose.Types.ObjectId.isValid(
          req.params.id
        )
      ) {

        return res.status(400).json({
          success: false,
          message:
            "Invalid record id"
        });
      }

      const startTime =
        req.body.startTime ||
        req.body.startTimestamp;

      const endTime =
        req.body.endTime ||
        req.body.endTimestamp;

      if (
        !startTime ||
        !endTime
      ) {

        return res.status(400).json({
          success: false,
          message:
            "startTime and endTime are required"
        });
      }

      const duration =
        calculateDuration(
          startTime,
          endTime
        );

      const updated =
        await ProcessRecord
          .findByIdAndUpdate(
            req.params.id,
            {
              $set: {

                startTimestamp:
                  new Date(
                    startTime
                  ),

                endTimestamp:
                  new Date(
                    endTime
                  ),

                duration
              }
            },
            {
              new: true,
              runValidators: true
            }
          )
          .lean();

      if (!updated) {

        return res.status(404).json({
          success: false,
          message:
            "Record not found"
        });
      }

      return res.json({

        success: true,

        message:
          "Record updated",

        record: {

          id:
            String(
              updated._id
            ),

          machineId:
            updated.machineId,

          processId:
            updated.processId,

          startTime:
            updated.startTimestamp
              .toISOString(),

          endTime:
            updated.endTimestamp
              .toISOString(),

          duration:
            updated.duration
        }
      });

    } catch (error) {

      console.error(
        "PROCESS RECORD UPDATE ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          error.message
      });
    }
  }
);

/* =========================================================
   DELETE PROCESS RECORD
========================================================= */

app.delete(
  "/api/process-records/:id",
  async (
    req,
    res
  ) => {

    try {

      if (
        !mongoose.Types.ObjectId.isValid(
          req.params.id
        )
      ) {

        return res.status(400).json({
          success: false,
          message:
            "Invalid record id"
        });
      }

      const deleted =
        await ProcessRecord
          .findByIdAndDelete(
            req.params.id
          );

      if (!deleted) {

        return res.status(404).json({
          success: false,
          message:
            "Record not found"
        });
      }

      return res.json({

        success: true,

        message:
          "Record deleted"
      });

    } catch (error) {

      console.error(
        "PROCESS RECORD DELETE ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          error.message
      });
    }
  }
);

/* =========================================================
   STATIC FRONTEND
========================================================= */

app.get(
  "/",
  (
    req,
    res
  ) => {

    res.sendFile(
      path.join(
        __dirname,
        "index.html"
      )
    );
  }
);

app.use(
  express.static(
    __dirname
  )
);

/* =========================================================
   404
========================================================= */

app.use(
  (
    req,
    res
  ) => {

    if (
      req.path.startsWith(
        "/api/"
      )
    ) {

      return res
        .status(404)
        .json({

          success: false,

          message:
            "API route not found"
        });
    }

    res
      .status(404)
      .send(
        "Not found"
      );
  }
);

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {

    console.error(
      "EXPRESS ERROR:",
      error
    );

    res
      .status(500)
      .json({

        success: false,

        message:
          error.message ||
          "Server error"
      });
  }
);

/* =========================================================
   MONGO + SERVER START
========================================================= */

async function startServer() {

  try {

    console.log("");

    console.log(
      "======================================"
    );

    console.log(
      "       FACTORY APP SERVER"
    );

    console.log(
      "======================================"
    );

    console.log(
      "Mongo target: 35.198.147.153:27018 / garment"
    );

    await mongoose.connect(
      MONGODB_URI,
      {

        serverSelectionTimeoutMS:
          30000,

        connectTimeoutMS:
          30000,

        socketTimeoutMS:
          120000,

        heartbeatFrequencyMS:
          10000,

        maxPoolSize:
          10,

        minPoolSize:
          1,

        retryReads:
          true,

        retryWrites:
          false
      }
    );

    console.log(
      "MongoDB connected successfully"
    );

    app.listen(
      PORT,
      "0.0.0.0",
      () => {

        console.log(
          `Server running on http://localhost:${PORT}`
        );
      }
    );

  } catch (error) {

    console.error(
      "MongoDB connection failed:",
      error
    );

    process.exit(1);
  }
}

startServer();
