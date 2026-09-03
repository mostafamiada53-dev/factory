const mongoose = require("mongoose");

const currentReadingSchema = new mongoose.Schema(
    {
        timestamp: {
            type: Date
        },

        metadata: {
            companyId: mongoose.Schema.Types.ObjectId,
            deviceId: mongoose.Schema.Types.ObjectId,

            deviceMac: {
                type: String,
                index: true
            },

            factoryId: mongoose.Schema.Types.ObjectId,
            machineId: mongoose.Schema.Types.ObjectId,
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

            activeEmployeeIds: [
                mongoose.Schema.Types.ObjectId
            ],

            lastBeatOrderId:
                mongoose.Schema.Types.ObjectId,

            lastLoginTimestamp: Date,

            lastOpenIdleTimeTimestamp: Date,

            assignments: [
                {
                    styleId:
                        mongoose.Schema.Types.ObjectId,

                    orderId:
                        mongoose.Schema.Types.ObjectId,

                    processIds: [
                        mongoose.Schema.Types.ObjectId
                    ],

                    standardProcessIds: [
                        mongoose.Schema.Types.ObjectId
                    ],

                    standardProcessCodes: [
                        String
                    ],

                    processesPerScan: mongoose.Schema.Types.Mixed,

                    processScanSequence:
                        mongoose.Schema.Types.Mixed
                }
            ]
        },

        sourceTopic: String,

        sampleRateHz: Number,

        samples: [
            Number
        ],

        receivedAt: Date
    },

    {
        collection: "device_current_readings"
    }
);

module.exports =
    mongoose.model(
        "CurrentReading",
        currentReadingSchema
    );