import { StateQuery, StateSnapshot } from '../types/DemoFlow';
import { HttpClient } from './HttpClient';
/**
 * State Monitor for querying on-chain state
 * Captures before/after state snapshots for demo steps
 */
export declare class StateMonitor {
    private httpClient;
    constructor(httpClient: HttpClient);
    setSessionId(sessionId: string): void;
    queryState(queries: Record<string, StateQuery>): Promise<StateSnapshot>;
    private executeQuery;
    private getWalletUtxos;
    private getContractUtxosByAddress;
    private getContractUtxosByScriptHash;
    private getWalletBalance;
    private getContractBalance;
    private getAllUtxos;
    private getNetworkTip;
    private getEmulatorTime;
}
//# sourceMappingURL=StateMonitor.d.ts.map