"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpClient = void 0;
/**
 * HTTP Client with automatic session injection
 * Handles all requests to the blaze-server backend
 */
class HttpClient {
    constructor(baseUrl) {
        this.sessionId = null;
        this.baseUrl = baseUrl;
    }
    setSessionId(sessionId) {
        this.sessionId = sessionId;
    }
    getSessionId() {
        return this.sessionId;
    }
    async request(httpRequest) {
        const url = this.buildUrl(httpRequest.endpoint, httpRequest.params);
        // Prepare request body with automatic sessionId injection
        let body = httpRequest.body;
        if (body && typeof body === 'object' && this.sessionId) {
            body = { ...body, sessionId: this.sessionId };
        }
        // Prepare headers
        const headers = {
            'Content-Type': 'application/json',
            ...httpRequest.headers
        };
        const fetchOptions = {
            method: httpRequest.method,
            headers
        };
        if (body && httpRequest.method !== 'GET') {
            fetchOptions.body = JSON.stringify(body);
        }
        try {
            const response = await fetch(url, fetchOptions);
            const responseData = await response.json();
            if (!response.ok) {
                const errorMsg = responseData?.error || response.statusText;
                throw new Error(`HTTP ${response.status}: ${errorMsg}`);
            }
            return {
                statusCode: response.status,
                data: responseData
            };
        }
        catch (error) {
            throw new Error(`Request failed: ${error.message}`);
        }
    }
    buildUrl(endpoint, params) {
        let url = `${this.baseUrl}${endpoint}`;
        // Add sessionId to query params for GET requests
        const queryParams = new URLSearchParams();
        if (params) {
            Object.entries(params).forEach(([key, value]) => {
                queryParams.append(key, value);
            });
        }
        // Auto-inject sessionId for GET requests
        if (this.sessionId && !queryParams.has('sessionId')) {
            queryParams.append('sessionId', this.sessionId);
        }
        if (queryParams.toString()) {
            url += `?${queryParams.toString()}`;
        }
        return url;
    }
    async createSession() {
        const response = await this.request({
            method: 'POST',
            endpoint: '/api/session/new',
            body: {}
        });
        const sessionId = response.data.sessionId;
        this.sessionId = sessionId;
        return sessionId;
    }
}
exports.HttpClient = HttpClient;
