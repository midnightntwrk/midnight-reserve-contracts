"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateMonitor = void 0;
/**
 * State Monitor for querying on-chain state
 * Captures before/after state snapshots for demo steps
 */
class StateMonitor {
    constructor(httpClient) {
        this.httpClient = httpClient;
    }
    setSessionId(sessionId) {
        this.httpClient.setSessionId(sessionId);
    }
    async queryState(queries) {
        const results = {};
        const timestamp = Date.now();
        for (const [name, query] of Object.entries(queries)) {
            try {
                results[name] = await this.executeQuery(query);
            }
            catch (error) {
                console.warn(`Failed to query state for ${name}:`, error.message);
                results[name] = { error: error.message };
            }
        }
        return {
            timestamp,
            data: results
        };
    }
    async executeQuery(query) {
        switch (query.type) {
            case 'wallet_utxos':
                return this.getWalletUtxos(query.wallet);
            case 'contract_utxos':
                if (query.address) {
                    return this.getContractUtxosByAddress(query.address);
                }
                else if (query.script_hash) {
                    return this.getContractUtxosByScriptHash(query.script_hash);
                }
                else {
                    throw new Error('contract_utxos query requires either address or script_hash');
                }
            case 'wallet_balance':
                return this.getWalletBalance(query.wallet);
            case 'contract_balance':
                return this.getContractBalance(query.address);
            case 'all_utxos':
                return this.getAllUtxos();
            case 'network_tip':
                return this.getNetworkTip();
            case 'emulator_time':
                return this.getEmulatorTime();
            default:
                throw new Error(`Unsupported query type: ${query.type}`);
        }
    }
    async getWalletUtxos(walletName) {
        const response = await this.httpClient.request({
            method: 'GET',
            endpoint: `/api/wallet/${walletName}/utxos`
        });
        return response.data;
    }
    async getContractUtxosByAddress(address) {
        const response = await this.httpClient.request({
            method: 'GET',
            endpoint: '/api/utxos',
            params: { address }
        });
        return response.data;
    }
    async getContractUtxosByScriptHash(scriptHash) {
        const response = await this.httpClient.request({
            method: 'GET',
            endpoint: '/api/utxos',
            params: { script_hash: scriptHash }
        });
        return response.data;
    }
    async getWalletBalance(walletName) {
        const response = await this.httpClient.request({
            method: 'GET',
            endpoint: `/api/wallet/${walletName}/balance`
        });
        return response.data;
    }
    async getContractBalance(address) {
        const response = await this.httpClient.request({
            method: 'GET',
            endpoint: '/api/balance',
            params: { address }
        });
        return response.data;
    }
    async getAllUtxos() {
        const response = await this.httpClient.request({
            method: 'GET',
            endpoint: '/api/utxos'
        });
        return response.data;
    }
    async getNetworkTip() {
        const response = await this.httpClient.request({
            method: 'GET',
            endpoint: '/api/network/tip'
        });
        return response.data;
    }
    async getEmulatorTime() {
        const response = await this.httpClient.request({
            method: 'GET',
            endpoint: '/api/time/current'
        });
        return response.data;
    }
}
exports.StateMonitor = StateMonitor;
