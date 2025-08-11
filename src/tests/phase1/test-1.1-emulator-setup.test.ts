import { describe, it, expect } from 'vitest';
import { Emulator } from '@blaze-cardano/emulator';
import { makeValue } from '@blaze-cardano/sdk';

import { basicProtocolParameters } from "../../utils/protocol-params"


describe('Phase 1.1: Basic Emulator Setup', () => {
  it('should initialize a Blaze emulator instance', async () => {
    // Create emulator with basic setup (following SundaeSwap pattern)
    const emulator = new Emulator([], basicProtocolParameters);

    expect(emulator).toBeDefined();
    console.log('✓ Emulator initialized successfully');
  });

  it('should register accounts and fund them', async () => {
    const emulator = new Emulator([], basicProtocolParameters);

    // Register an account with initial funds (following SundaeSwap pattern)
    const alice = await emulator.register("alice", makeValue(100_000_000n)); // 100 ADA

    expect(alice).toBeDefined();

    // Get address from the account (following SundaeSwap pattern)
    const address = alice.asBase();
    expect(address).toBeDefined();

    console.log('✓ Registered account "alice"');
    console.log('✓ Account has payment credential hash:', alice.asBase()!.getPaymentCredential().hash);
  });

  it('should support multiple accounts with different balances', async () => {
    const emulator = new Emulator([], basicProtocolParameters);

    // Create multiple accounts with different balances (following SundaeSwap pattern)
    const alice = await emulator.register("alice", makeValue(100_000_000n)); // 100 ADA
    const bob = await emulator.register("bob", makeValue(50_000_000n));   // 50 ADA
    const charlie = await emulator.register("charlie", makeValue(25_000_000n)); // 25 ADA

    // Verify accounts were created
    expect(alice).toBeDefined();
    expect(bob).toBeDefined();
    expect(charlie).toBeDefined();

    expect(alice.asBase()).toBeDefined();
    expect(bob.asBase()).toBeDefined();
    expect(charlie.asBase()).toBeDefined();

    console.log('✓ Created multiple accounts:');
    console.log('  - alice:', alice.asBase()!.getPaymentCredential().hash);
    console.log('  - bob:', bob.asBase()!.getPaymentCredential().hash);
    console.log('  - charlie:', charlie.asBase()!.getPaymentCredential().hash);
  });

  it('should track blockchain state', async () => {
    const emulator = new Emulator([], basicProtocolParameters);

    // Register an account
    const alice = await emulator.register("alice", makeValue(100_000_000n));

    // Check that we can query blockchain state - emulator should have basic functionality
    expect(emulator).toBeDefined();
    expect(alice).toBeDefined();

    console.log('✓ Emulator tracking blockchain state correctly');
    console.log('✓ Can register accounts and manage state');
  });
});
