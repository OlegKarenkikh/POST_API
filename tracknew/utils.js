// utils.js
// Вспомогательные функции и кастомные ошибки

// --- Кастомные Классы Ошибок ---
class ApiError extends Error {
    constructor(message, statusCode = 500, details = null) {
        super(message);
        this.name = 'ApiError';
        this.statusCode = statusCode; // HTTP status code related to the API error
        this.details = details; // Optional additional details
    }
}

class BatchNotReadyError extends Error {
    constructor(message = "Batch results not ready yet.") {
        super(message);
        this.name = 'BatchNotReadyError';
        // No specific status code needed, handled by sending 202 in the route
    }
}

class ParsingError extends Error {
    constructor(message = "Failed to parse response.", originalError = null) {
        super(message);
        this.name = 'ParsingError';
        this.originalError = originalError; // Store original error if available
    }
}

// --- Функции Валидации ---
function validateCredentials(login, password) {
    // Basic check: ensure both are non-empty strings
    return Boolean(
        login && typeof login === 'string' && login.trim() !== '' &&
        password && typeof password === 'string' && password.trim() !== ''
    );
}

function validateSingleTrack(barcode) {
    // Basic check: ensure it's a non-empty string
    // More specific regex could be added here if needed,
    // but the API will likely reject invalid formats anyway.
    return Boolean(barcode && typeof barcode === 'string' && barcode.trim() !== '');
}

function validateBatchTrack(barcodes) {
    // Check if it's a non-empty array of non-empty strings
    return Boolean(
        barcodes && Array.isArray(barcodes) && barcodes.length > 0 &&
        barcodes.every(bc => typeof bc === 'string' && bc.trim() !== '')
    );
}

function validateTicket(ticket) {
    // Basic check: ensure it's a non-empty string
    return Boolean(ticket && typeof ticket === 'string' && ticket.trim() !== '');
}

module.exports = {
    ApiError,
    BatchNotReadyError,
    ParsingError,
    validateCredentials,
    validateSingleTrack,
    validateBatchTrack,
    validateTicket
};