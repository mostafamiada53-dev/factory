// =====================================================
// FACTORY APP - BACKEND
// server.js
// =====================================================

require("dotenv").config();

const express = require("express");
const path = require("path");
const cors = require("cors");
const mongoose = require("mongoose");
const CurrentReading = require("./CurrentReading");

const app = express();

const PORT = process.env.PORT || 5000;;

// =====================================================
// CONFIGURATION
// =====================================================

const CURRENT_READING_MAX_AGE_MS = 30000;

// =====================================================
// MONGODB CONNECTION
// =====================================================

mongoose
    .connect(process.env.MONGO_URI)
    .then(function () {

        console.log(
            "✅ MongoDB connected successfully"
        );

    })
    .catch(function (error) {

        console.error(
            "❌ MongoDB connection failed:",
            error.message
        );

    });

// =====================================================
// MIDDLEWARE
// =====================================================

app.use(cors());

app.use(
    express.json({
        limit: "10mb"
    })
);

app.use(
    express.urlencoded({
        extended: true
    })
);

// =====================================================
// STATIC FRONTEND
// =====================================================

app.use(
    express.static(__dirname)
);

// =====================================================
// NORMALIZE NUMBER
// =====================================================

function normalizeCurrent(value) {

    const number =
        Number(value);

    if (!Number.isFinite(number)) {

        return null;

    }

    return number;

}

// =====================================================
// NORMALIZE TIME
// =====================================================

function normalizeTime(value) {

    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {

        return null;

    }

    const timestamp =
        new Date(value).getTime();

    if (!Number.isFinite(timestamp)) {

        return null;

    }

    return timestamp;

}

// =====================================================
// CONVERT MONGO READING TO POINTS
// =====================================================
//
// MongoDB:
//
// {
//     timestamp: "...",
//     samples: [0.35, 0.36, 0.34],
//     sampleIntervalMs: 100
// }
//
// becomes:
//
// [
//     {
//         time: "...",
//         current: 0.35
//     }
// ]
//
// =====================================================

function mongoReadingToPoints(reading) {

    if (!reading) {

        return [];

    }

    const samples =
        Array.isArray(reading.samples)
            ? reading.samples
            : [];

    const intervalMs =
        Number(
            reading.sampleIntervalMs
        ) || 100;

    const timestamp =
        normalizeTime(
            reading.timestamp
        );

    if (timestamp === null) {

        return [];

    }

    const points = [];

    samples.forEach(
        function (sample, index) {

            const current =
                normalizeCurrent(
                    sample
                );

            if (current === null) {

                return;

            }

            const pointTime =
                timestamp +
                (
                    index *
                    intervalMs
                );

            points.push({

                time:
                    new Date(
                        pointTime
                    ).toISOString(),

                current:
                    current

            });

        }
    );

    return points;

}

// =====================================================
// GET LATEST POINT
// =====================================================

function getLatestPoint(points) {

    if (
        !Array.isArray(points) ||
        points.length === 0
    ) {

        return null;

    }

    let latestPoint =
        null;

    let latestTime =
        -Infinity;

    points.forEach(
        function (point) {

            if (!point) {

                return;

            }

            const current =
                normalizeCurrent(
                    point.current
                );

            const time =
                normalizeTime(
                    point.time
                );

            if (
                current === null ||
                time === null
            ) {

                return;

            }

            if (
                time >
                latestTime
            ) {

                latestTime =
                    time;

                latestPoint = {

                    time:
                        new Date(
                            time
                        ).toISOString(),

                    current:
                        current

                };

            }

        }
    );

    return latestPoint;

}

// =====================================================
// CHECK FRESHNESS
// =====================================================

function isFresh(point) {

    if (!point) {

        return false;

    }

    const pointTime =
        normalizeTime(
            point.time
        );

    if (pointTime === null) {

        return false;

    }

    const age =
        Date.now() -
        pointTime;

    console.log(
        "----------------------------------------"
    );

    console.log(
        "CURRENT CHECK"
    );

    console.log(
        "Point time:",
        point.time
    );

    console.log(
        "Server time:",
        new Date().toISOString()
    );

    console.log(
        "Age seconds:",
        age / 1000
    );

    console.log(
        "Current:",
        point.current
    );

    console.log(
        "Fresh:",
        age >= 0 &&
        age <= CURRENT_READING_MAX_AGE_MS
    );

    console.log(
        "----------------------------------------"
    );

    return (
        age >= 0 &&
        age <= CURRENT_READING_MAX_AGE_MS
    );

}

// =====================================================
// API: CURRENT WAVE
// =====================================================

app.get(
    "/api/current-wave",
    async function (req, res) {

        try {

            const deviceMac =
                String(
                    req.query.deviceMac || ""
                ).trim();

            console.log("");
            console.log(
                "========================================"
            );

            console.log(
                "CURRENT WAVE REQUEST"
            );

            console.log(
                "Device MAC:",
                deviceMac
            );

            console.log(
                "========================================"
            );

            // =========================================
            // VALIDATE MAC
            // =========================================

            if (!deviceMac) {

                return res.status(400).json({

                    success: false,

                    error:
                        "deviceMac is required"

                });

            }

            // =========================================
            // GET LATEST MONGO PACKETS
            // =========================================

            const readings =
                await CurrentReading
                    .find({

                        "metadata.deviceMac":
                            deviceMac

                    })
                    .sort({

                        timestamp:
                            -1

                    })
                    .limit(10)
                    .lean();

            console.log(
                "Mongo packets found:",
                readings.length
            );

            // =========================================
            // NO DATA
            // =========================================

            if (
                !readings ||
                readings.length === 0
            ) {

                console.log(
                    "❌ No MongoDB readings"
                );

                return res.json({

                    success: true,

                    deviceMac:
                        deviceMac,

                    hasCurrentReading:
                        false,

                    latestReading:
                        null,

                    current:
                        null,

                    time:
                        null,

                    count:
                        0,

                    points:
                        []

                });

            }

            // =========================================
            // CONVERT ALL PACKETS
            // =========================================

            let points = [];

            readings.forEach(
                function (reading) {

                    const readingPoints =
                        mongoReadingToPoints(
                            reading
                        );

                    points =
                        points.concat(
                            readingPoints
                        );

                }
            );

            // =========================================
            // SORT OLDEST -> NEWEST
            // =========================================

            points.sort(
                function (a, b) {

                    return (
                        normalizeTime(a.time)
                        -
                        normalizeTime(b.time)
                    );

                }
            );

            // =========================================
            // LATEST POINT
            // =========================================

            const latestPoint =
                getLatestPoint(
                    points
                );

            // =========================================
            // CHECK NUMERIC CURRENT
            // =========================================

            const hasNumericCurrent =
                latestPoint !== null &&
                Number.isFinite(
                    latestPoint.current
                );

            // =========================================
            // CHECK FRESHNESS
            // =========================================

            const fresh =
                isFresh(
                    latestPoint
                );

            // =========================================
            // IMPORTANT
            // =========================================
            //
            // hasCurrentReading is true only
            // when we have a valid numeric point
            // AND it is fresh.
            //
            // But we STILL return current/time
            // even if freshness fails.
            //
            // This allows the frontend to know
            // exactly what MongoDB contains.
            //
            // =========================================

            const current =
                hasNumericCurrent
                    ? latestPoint.current
                    : null;

            const time =
                latestPoint
                    ? latestPoint.time
                    : null;

            console.log(
                "Latest point:",
                latestPoint
            );

            console.log(
                "Numeric current:",
                hasNumericCurrent
            );

            console.log(
                "Fresh:",
                fresh
            );

            // =========================================
            // RESPONSE
            // =========================================

            return res.json({

                success: true,

                deviceMac:
                    deviceMac,

                hasCurrentReading:
                    hasNumericCurrent,

                isFresh:
                    fresh,

                latestReading:
                    latestPoint,

                // IMPORTANT:
                // Explicit top-level values
                current:
                    current,

                time:
                    time,

                count:
                    points.length,

                points:
                    points

            });

        }

        catch (error) {

            console.error(
                "❌ current-wave error:",
                error
            );

            return res.status(500).json({

                success: false,

                error:
                    "Failed to read current data",

                current:
                    null,

                time:
                    null,

                latestReading:
                    null,

                points:
                    []

            });

        }

    }
);

// =====================================================
// API: HEALTH CHECK
// =====================================================

app.get(
    "/api/health",
    function (req, res) {

        res.json({

            success:
                true,

            server:
                "running",

            mongodb:
                mongoose.connection.readyState === 1
                    ? "connected"
                    : "disconnected",

            time:
                new Date().toISOString()

        });

    }
);

// =====================================================
// FRONTEND ROUTE
// =====================================================

app.get(
    "*splat",
    function (req, res) {

        res.sendFile(
            path.join(
                __dirname,
                "index.html"
            )
        );

    }
);

// =====================================================
// TEST MONGODB
// =====================================================

async function testMongoCurrent() {

    try {

        const mac =
            "C4:5B:BE:57:47:C4";

        const reading =
            await CurrentReading
                .findOne({

                    "metadata.deviceMac":
                        mac

                })
                .sort({

                    timestamp:
                        -1

                })
                .lean();

        if (!reading) {

            console.log(
                "❌ No MongoDB document found for:",
                mac
            );

            return;

        }

        console.log("");
        console.log(
            "========================================"
        );
        console.log(
            "MONGODB CURRENT TEST"
        );
        console.log(
            "========================================"
        );

        console.log(
            "Device:",
            reading.metadata?.deviceMac
        );

        console.log(
            "Timestamp:",
            reading.timestamp
        );

        console.log(
            "Sample Count:",
            reading.samples?.length || 0
        );

        console.log(
            "Sample Interval:",
            reading.sampleIntervalMs
        );

        console.log(
            "First Samples:",
            reading.samples?.slice(
                0,
                10
            )
        );

        console.log(
            "========================================"
        );
        console.log("");

    }

    catch (error) {

        console.error(
            "❌ MongoDB test error:",
            error
        );

    }

}

// =====================================================
// START SERVER
// =====================================================

app.listen(
    PORT,
    "0.0.0.0",
    function () {

        console.log("");
        console.log(
            "========================================"
        );

        console.log(
            " FACTORY APP SERVER"
        );

        console.log(
            "========================================"
        );

        console.log(
            `Server running on http://localhost:${PORT}`
        );

        console.log(
            `Frontend: http://localhost:${PORT}`
        );

        console.log(
            "========================================"
        );

        console.log("");

        testMongoCurrent();

    }
);