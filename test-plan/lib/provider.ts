import { Emulator } from "@blaze-cardano/emulator";
import { Blaze } from "@blaze-cardano/sdk";
import {
  TransactionUnspentOutput,
  TransactionId,
  PaymentAddress,
} from "@blaze-cardano/core";
import type { TestMode } from "./types";

export interface TestProvider {
  getBlaze(walletId: string): Promise<Blaze>;
  setup(): Promise<void>;
  cleanup(): Promise<void>;
}

export class EmulatorProvider implements TestProvider {
  private emulator: Emulator;
  private blazeCache: Map<string, Blaze>;

  constructor() {
    this.emulator = new Emulator([]);
    this.blazeCache = new Map();
  }

  async setup(): Promise<void> {
    await this.emulator.as("deployer", async (_, addr) => {
      this.emulator.addUtxo(
        TransactionUnspentOutput.fromCore([
          {
            index: 0,
            txId: TransactionId("0".repeat(64)),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: {
              coins: 1000_000_000n,
            },
          },
        ])
      );
    });
  }

  async cleanup(): Promise<void> {
    this.blazeCache.clear();
  }

  async getBlaze(walletId: string): Promise<Blaze> {
    if (this.blazeCache.has(walletId)) {
      return this.blazeCache.get(walletId)!;
    }

    let blaze: Blaze | undefined;
    await this.emulator.as(walletId, async (b) => {
      blaze = b;
    });

    if (!blaze) {
      throw new Error(`Failed to get Blaze instance for ${walletId}`);
    }

    this.blazeCache.set(walletId, blaze);
    return blaze;
  }
}

export class NetworkProvider implements TestProvider {
  constructor(private network: "preview" | "preprod" | "mainnet") {}

  async setup(): Promise<void> {
    // TODO: Initialize network provider (Blockfrost, Maestro, etc)
    throw new Error("Network provider not yet implemented");
  }

  async cleanup(): Promise<void> {
    // Nothing to clean up for network provider
  }

  async getBlaze(walletId: string): Promise<Blaze> {
    // TODO: Create Blaze instance with real wallet
    throw new Error("Network provider not yet implemented");
  }
}

export function createProvider(mode: TestMode): TestProvider {
  switch (mode) {
    case "emulator":
      return new EmulatorProvider();
    case "testnet":
      return new NetworkProvider("preview");
    case "mainnet":
      return new NetworkProvider("mainnet");
  }
}
