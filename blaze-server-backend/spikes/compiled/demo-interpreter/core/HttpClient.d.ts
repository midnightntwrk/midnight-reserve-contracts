import { HttpRequest } from '../types/DemoFlow';
/**
 * HTTP Client with automatic session injection
 * Handles all requests to the blaze-server backend
 */
export declare class HttpClient {
    private baseUrl;
    private sessionId;
    constructor(baseUrl: string);
    setSessionId(sessionId: string): void;
    getSessionId(): string | null;
    request(httpRequest: HttpRequest): Promise<any>;
    private buildUrl;
    createSession(): Promise<string>;
}
//# sourceMappingURL=HttpClient.d.ts.map