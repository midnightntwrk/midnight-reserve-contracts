import { describe, test, expect } from "bun:test";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

describe("Phase 1.2: Aiken Contract Compilation", () => {
  test("should have compiled hello_world contract", () => {
    const plutusJsonPath = path.join(process.cwd(), "plutus.json");

    expect(fs.existsSync(plutusJsonPath)).toBe(true);
    console.log("✓ plutus.json exists");
  });

  test("should load and parse plutus.json", () => {
    const plutusJsonPath = path.join(process.cwd(), "plutus.json");
    const plutusJson = JSON.parse(fs.readFileSync(plutusJsonPath, "utf-8"));

    expect(plutusJson).toBeDefined();
    expect(plutusJson.preamble).toBeDefined();
    expect(plutusJson.validators).toBeDefined();
    expect(Array.isArray(plutusJson.validators)).toBe(true);

    console.log("✓ Plutus JSON structure is valid");
    console.log("  - Title:", plutusJson.preamble.title);
    console.log("  - Version:", plutusJson.preamble.version);
    console.log("  - Plutus Version:", plutusJson.preamble.plutusVersion);
    console.log("  - Validators found:", plutusJson.validators.length);
  });

  test("should contain hello_world validator", () => {
    const plutusJsonPath = path.join(process.cwd(), "plutus.json");
    const plutusJson = JSON.parse(fs.readFileSync(plutusJsonPath, "utf-8"));

    const helloWorldValidator = plutusJson.validators.find(
      (v: any) => v.title.includes("hello_world") && v.title.includes("spend"),
    );

    expect(helloWorldValidator).toBeDefined();
    expect(helloWorldValidator.compiledCode).toBeDefined();
    expect(helloWorldValidator.hash).toBeDefined();

    console.log("✓ Hello world validator found");
    console.log("  - Title:", helloWorldValidator.title);
    console.log("  - Hash:", helloWorldValidator.hash);
    console.log(
      "  - Compiled code length:",
      helloWorldValidator.compiledCode.length,
    );
  });

  test("should measure compilation time", () => {
    const contractPath = path.join(
      process.cwd(),
      "validators",
      "hello_world.ak",
    );
    const aikenPath = "aiken";

    // Touch the contract file to trigger recompilation
    fs.utimesSync(contractPath, new Date(), new Date());

    const startTime = Date.now();
    execSync(`${aikenPath} build`, { cwd: process.cwd() });
    const compilationTime = Date.now() - startTime;

    expect(compilationTime).toBeGreaterThan(0);
    expect(compilationTime).toBeLessThan(10000); // Should be under 10 seconds

    console.log("✓ Compilation completed in", compilationTime, "ms");
  });

  test("should handle compilation errors gracefully", () => {
    const contractPath = path.join(
      process.cwd(),
      "validators",
      "hello_world.ak",
    );
    const backupPath = contractPath + ".backup";
    const aikenPath = "aiken";

    // Backup original
    fs.copyFileSync(contractPath, backupPath);

    try {
      // Write invalid Aiken code
      fs.writeFileSync(contractPath, "invalid aiken code that should fail");

      // Try to compile - should fail
      expect(() => {
        execSync(`${aikenPath} build`, { cwd: process.cwd(), stdio: "pipe" });
      }).toThrow();

      console.log("✓ Compilation errors are handled properly");
    } finally {
      // Restore original
      fs.copyFileSync(backupPath, contractPath);
      fs.unlinkSync(backupPath);

      // Recompile to ensure we're back to working state
      execSync(`${aikenPath} build`, { cwd: process.cwd(), stdio: "pipe" });
    }
  });
});
