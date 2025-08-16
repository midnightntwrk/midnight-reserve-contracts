import { StateQuery, StateSnapshot } from '../types/DemoFlow';
import { HttpClient } from './HttpClient';

/**
 * State Monitor for querying on-chain state
 * Captures before/after state snapshots for demo steps
 */
export class StateMonitor {
  private httpClient: HttpClient;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
  }

  setSessionId(sessionId: string): void {
    this.httpClient.setSessionId(sessionId);
  }

  async queryState(queries: Record<string, StateQuery>): Promise<StateSnapshot> {
    const results: Record<string, any> = {};
    const timestamp = Date.now();

    for (const [name, query] of Object.entries(queries)) {
      try {
        results[name] = await this.executeQuery(query);
      } catch (error) {
        console.warn(`Failed to query state for ${name}:`, (error as Error).message);
        results[name] = { error: (error as Error).message };
      }
    }

    return {
      timestamp,
      data: results
    };
  }

  private async executeQuery(query: StateQuery): Promise<any> {
    switch (query.type) {
      case 'wallet_utxos':
        return this.getWalletUtxos(query.wallet!);

      case 'contract_utxos':
        if (query.address) {
          return this.getContractUtxosByAddress(query.address);
        } else if (query.script_hash) {
          return this.getContractUtxosByScriptHash(query.script_hash);
        } else {
          throw new Error('contract_utxos query requires either address or script_hash');
        }

      case 'wallet_balance':
        return this.getWalletBalance(query.wallet!);

      case 'contract_balance':
        return this.getContractBalance(query.address!);

      case 'all_utxos':
        return this.getAllUtxos();

      case 'network_tip':
        return this.getNetworkTip();

      case 'emulator_time':
        return this.getEmulatorTime();

      default:
        throw new Error(`Unsupported query type: ${(query as any).type}`);
    }
  }

  private async getWalletUtxos(walletName: string): Promise<any> {
    const response = await this.httpClient.request({
      method: 'GET',
      endpoint: `/api/wallet/${walletName}/utxos`
    });
    return response.data;
  }

  private async getContractUtxosByAddress(address: string): Promise<any> {
    const response = await this.httpClient.request({
      method: 'GET',
      endpoint: '/api/utxos',
      params: { address }
    });
    return response.data;
  }

  private async getContractUtxosByScriptHash(scriptHash: string): Promise<any> {
    const response = await this.httpClient.request({
      method: 'GET',
      endpoint: '/api/utxos',
      params: { script_hash: scriptHash }
    });
    return response.data;
  }

  private async getWalletBalance(walletName: string): Promise<any> {
    const response = await this.httpClient.request({
      method: 'GET',
      endpoint: `/api/wallet/${walletName}/balance`
    });
    return response.data;
  }

  private async getContractBalance(address: string): Promise<any> {
    const response = await this.httpClient.request({
      method: 'GET',
      endpoint: '/api/balance',
      params: { address }
    });
    return response.data;
  }

  private async getAllUtxos(): Promise<any> {
    const response = await this.httpClient.request({
      method: 'GET',
      endpoint: '/api/utxos'
    });
    return response.data;
  }

  private async getNetworkTip(): Promise<any> {
    const response = await this.httpClient.request({
      method: 'GET',
      endpoint: '/api/network/tip'
    });
    return response.data;
  }

  private async getEmulatorTime(): Promise<any> {
    const response = await this.httpClient.request({
      method: 'GET',
      endpoint: '/api/time/current'
    });
    return response.data;
  }
}