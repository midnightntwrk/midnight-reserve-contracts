import { describe, test, expect } from "bun:test";
import { Emulator } from "@blaze-cardano/emulator";
import { makeValue } from "@blaze-cardano/sdk";
import { basicProtocolParameters } from "../../src/utils/protocol-params";

describe("Emulator Time Capabilities", () => {
  test("explore emulator clock and time manipulation", async () => {
    const emulator = new Emulator([], basicProtocolParameters);
    
    console.log("\n=== Emulator Clock Exploration ===");
    
    // Check emulator properties
    console.log("Emulator properties:", Object.keys(emulator));
    
    // Explore clock object
    if ('clock' in emulator) {
      const clock = emulator.clock;
      console.log("\n✅ Emulator has clock property");
      console.log("Clock type:", typeof clock);
      console.log("Clock constructor:", clock?.constructor?.name);
      console.log("Clock properties:", Object.keys(clock));
      
      // Check current slot
      if ('slot' in clock) {
        console.log("\nCurrent slot:", clock.slot);
        console.log("Slot type:", typeof clock.slot);
      }
      
      // Check for methods
      const clockMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(clock));
      console.log("\nClock methods:", clockMethods);
      
      // Look for time advancement methods
      const timeManipulationMethods = clockMethods.filter(m => 
        m.toLowerCase().includes('advance') || 
        m.toLowerCase().includes('set') ||
        m.toLowerCase().includes('tick') ||
        m.toLowerCase().includes('increment') ||
        m.toLowerCase().includes('wait')
      );
      console.log("Time manipulation methods:", timeManipulationMethods);
      
      // Try to advance time
      console.log("\n=== Testing Time Advancement ===");
      
      const initialSlot = clock.slot;
      console.log("Initial slot:", initialSlot);
      
      // Try different methods to advance time
      if ('tick' in clock && typeof clock.tick === 'function') {
        try {
          console.log("Attempting clock.tick()...");
          clock.tick();
          console.log("Slot after tick():", clock.slot);
        } catch (error) {
          console.log("tick() error:", error.message);
        }
      }
      
      if ('tickSlots' in clock && typeof clock.tickSlots === 'function') {
        try {
          console.log("Attempting clock.tickSlots(10)...");
          clock.tickSlots(10);
          console.log("Slot after tickSlots(10):", clock.slot);
        } catch (error) {
          console.log("tickSlots() error:", error.message);
        }
      }
      
      if ('wait' in clock && typeof clock.wait === 'function') {
        try {
          console.log("Attempting clock.wait(1000)...");
          await clock.wait(1000); // 1 second
          console.log("Slot after wait(1000):", clock.slot);
        } catch (error) {
          console.log("wait() error:", error.message);
        }
      }
      
      if ('setSlot' in clock && typeof clock.setSlot === 'function') {
        try {
          console.log("Attempting clock.setSlot(100)...");
          clock.setSlot(100);
          console.log("Slot after setSlot(100):", clock.slot);
        } catch (error) {
          console.log("setSlot() error:", error.message);
        }
      }
      
      if ('incrementSlot' in clock && typeof clock.incrementSlot === 'function') {
        try {
          console.log("Attempting clock.incrementSlot(5)...");
          clock.incrementSlot(5);
          console.log("Slot after incrementSlot(5):", clock.slot);
        } catch (error) {
          console.log("incrementSlot() error:", error.message);
        }
      }
      
      // Check if slot changed
      const finalSlot = clock.slot;
      console.log("\nFinal slot:", finalSlot);
      console.log("Slots advanced:", finalSlot - initialSlot);
      
      // Check for time/epoch conversion
      if ('slotToTime' in clock && typeof clock.slotToTime === 'function') {
        try {
          const time = clock.slotToTime(clock.slot);
          console.log("Current time from slot:", time);
        } catch (error) {
          console.log("slotToTime() error:", error.message);
        }
      }
      
      if ('slotToEpoch' in clock && typeof clock.slotToEpoch === 'function') {
        try {
          const epoch = clock.slotToEpoch(clock.slot);
          console.log("Current epoch from slot:", epoch);
        } catch (error) {
          console.log("slotToEpoch() error:", error.message);
        }
      }
    } else {
      console.log("❌ Emulator does not have clock property");
    }
    
    // Check for other time-related properties
    if ('slotConfig' in emulator) {
      console.log("\n✅ Emulator has slotConfig");
      console.log("SlotConfig:", emulator.slotConfig);
    }
    
    if ('systemStart' in emulator) {
      console.log("\n✅ Emulator has systemStart");
      console.log("System start:", emulator.systemStart);
    }
    
    expect(emulator.clock).toBeDefined();
  });

  test("test time advancement with transactions", async () => {
    const emulator = new Emulator([], basicProtocolParameters);
    await emulator.register("alice", makeValue(100_000_000n));
    
    console.log("\n=== Time Advancement with Transactions ===");
    
    const clock = emulator.clock;
    const initialSlot = clock.slot;
    console.log("Initial slot:", initialSlot);
    
    // Make a transaction to see if it affects slot
    await emulator.as("alice", async (blaze, addr) => {
      const tx = blaze.newTransaction()
        .payLovelace(addr, 1_000_000n);
      
      await emulator.expectValidTransaction(blaze, tx);
    });
    
    const slotAfterTx = clock.slot;
    console.log("Slot after transaction:", slotAfterTx);
    console.log("Slots advanced by transaction:", slotAfterTx - initialSlot);
    
    // Try to manipulate time and make another transaction
    if ('tick' in clock && typeof clock.tick === 'function') {
      clock.tick();
      const slotAfterTick = clock.slot;
      console.log("Slot after tick:", slotAfterTick);
      
      // Transaction after time manipulation
      await emulator.as("alice", async (blaze, addr) => {
        const tx = blaze.newTransaction()
          .payLovelace(addr, 1_000_000n);
        
        await emulator.expectValidTransaction(blaze, tx);
      });
      
      const finalSlot = clock.slot;
      console.log("Final slot:", finalSlot);
      console.log("Total slots advanced:", finalSlot - initialSlot);
    }
    
    expect(clock.slot).toBeGreaterThanOrEqual(initialSlot);
  });

  test("explore slot configuration and time parameters", () => {
    const emulator = new Emulator([], basicProtocolParameters);
    
    console.log("\n=== Slot Configuration ===");
    
    // Check protocol parameters related to time
    console.log("Protocol parameters keys:", Object.keys(basicProtocolParameters));
    
    // Look for slot-related config
    const emulatorAny = emulator as any;
    
    if (emulatorAny.slotConfig) {
      console.log("Slot config:", emulatorAny.slotConfig);
    }
    
    if (emulatorAny.networkId) {
      console.log("Network ID:", emulatorAny.networkId);
    }
    
    // Check if there's a way to get slot length
    const clock = emulator.clock;
    if (clock) {
      const clockAny = clock as any;
      
      if (clockAny.slotLength) {
        console.log("Slot length:", clockAny.slotLength);
      }
      
      if (clockAny.slotsPerEpoch) {
        console.log("Slots per epoch:", clockAny.slotsPerEpoch);
      }
      
      if (clockAny.config) {
        console.log("Clock config:", clockAny.config);
      }
    }
    
    expect(true).toBe(true);
  });
});