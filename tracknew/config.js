// config.js
// Конфигурация приложения
const path = require('path');
require('dotenv').config(); // Load .env variables

module.exports = {
    port: process.env.PORT || 3000,
    logDir: path.join(__dirname, 'logs'), // Use path for cross-platform compatibility
    maxLogLines: 200, // Max log lines to retrieve for the UI
    singleTrackConcurrency: 5, // Concurrency for fetching batch details (if using that approach)
    requestTimeoutMs: parseInt(process.env.API_TIMEOUT_MS || '30000', 10), // API request timeout

    services: {
        single: {
            url: process.env.POCHTA_SINGLE_URL || 'https://tracking.russianpost.ru/rtm34',
            contentType: 'application/soap+xml; charset=utf-8',
            soapAction: undefined // SOAP 1.2 doesn't typically use SOAPAction header
        },
        batch: {
            url: process.env.POCHTA_BATCH_URL || 'https://tracking.russianpost.ru/fc',
            contentType: 'text/xml; charset=utf-8',
            soapAction: '' // SOAP 1.1 requires SOAPAction, even if empty for some services
        }
    },

    // Base options for xml2js parser
    xmlParserOptionsBase: {
        tagNameProcessors: [tag => tag.replace(/^[a-zA-Z0-9]+:/, '')], // Remove ns: prefixes
    },

    // Details for "Not Ready" error from batch API
    batchNotReadyMessages: [ // Possible messages indicating processing
        "Ответ для ФК еще не готов",
        "Ticket response is not ready yet",
        "processing", // Add other potential keywords if observed
        "in progress"
    ],
    batchNotReadyErrorId: '6' // Specific ErrorTypeID if available
};