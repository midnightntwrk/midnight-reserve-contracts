import { Response } from 'express';
export interface ErrorResponse {
    success: false;
    error: {
        code: string;
        message: string;
        details?: any;
    };
}
export declare function formatError(error: unknown): ErrorResponse;
export declare function sendErrorResponse(res: Response, error: unknown, statusCode?: number): void;
//# sourceMappingURL=formatter.d.ts.map