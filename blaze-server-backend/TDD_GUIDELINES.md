# TDD Guidelines for This Project

## MANDATORY FIRST STEPS (Before Any New Development)

### Step 0: Always Check Current State
- **NEVER** propose new tests without running existing tests first
- **ALWAYS** report current test status before suggesting new work  
- **NEVER** assume the codebase is in a working state
- **ALWAYS** run `bun test` as the first action in any TDD session

### Step 1: Fix Existing Failures
- **ALWAYS** fix failing tests before adding new features
- **NEVER** proceed with new development when tests are red
- **ALWAYS** achieve "Green phase" before moving forward
- **NEVER** ignore or skip failing tests regardless of their location (core, exploration, etc.)

### Step 2: Only Then Suggest New Work
- **ONLY** when all tests pass: suggest new red tests
- **ALWAYS** verify green state before Red-Green-Refactor cycle
- **NEVER** mix fixing existing failures with adding new features

## Core TDD Principles (User Preferences)

### 1. **STRICT Red-Green-Refactor Cycle**
- **NEVER** report "Green phase complete" unless tests are actually passing
- **ALWAYS** run tests after EVERY change, no matter how small
- **NEVER** skip the Red phase - write failing tests first
- **ALWAYS** be 100% accurate in reporting test status

### 2. **One Failing Test at a Time**
- Write ONE test that fails
- Make it pass with minimal implementation
- Only then move to the next test
- **NEVER** write multiple tests or implementations simultaneously

### 2a. **Red Tests Must Assert Intended Behavior (Not Temporary Failure)**
- **ALWAYS** write Red tests that assert the desired, correct behavior of the system (e.g., expected 200 status, `success: true`, proper payload)
- **NEVER** make a test “Red” by asserting a failure state (e.g., expecting 400/500 or `success: false`) just to force a failure. The test should fail because the implementation is missing, not because the test expects the wrong behavior
- **NEVER** trap errors or catch exceptions to make a failing test pass. Let the test fail naturally until the implementation is correct
- **WHEN** adding negative/cheat-catching tests, assert the specific failure that the final system should produce (e.g., a well-defined 400 with a precise message), not a generic fallback error

Example:

Wrong (anti-TDD — asserts failure to stay Red):
```ts
// Expecting 500 only to force Red
expect(response.status).toBe(500);
```

Right (proper Red — asserts the correct success and fails until implemented):
```ts
// Assert the intended behavior up front
expect(response.status).toBe(200);
const data = await response.json();
expect(data.success).toBe(true);
```

**Key Principle**: In TDD, we always test optimistically for the eventual success and watch the test fail until the implementation can do the right thing the right way.

Wrong (anti-TDD — traps error to fake Green):
```ts
try {
  const response = await fetch("/api/endpoint");
  expect(response.status).toBe(200); // This will fail
} catch (error) {
  // Don't do this! Let the test fail naturally
  expect(error.message).toContain("expected");
}
```

### 3. **Test-Driven Development, Not Test-After Development**
- Write the test FIRST
- Watch it fail (Red phase)
- Write minimal code to make it pass (Green phase)
- Refactor if needed (Refactor phase)
- **NEVER** write implementation first, then tests

### 4. **"Cheat-Catching" Tests**
- Design tests that prove real system interaction
- Use unpredictable values (random redeemers, timestamps)
- Test that the system can't "guess" the correct answer
- Prove actual emulator/blockchain interaction, not dummy responses

## What NOT to Do as a TDD Partner

### ❌ **NEVER Report False Test Status**
- Don't say "Green phase complete" when tests are still failing
- Don't assume tests pass without running them
- Don't report success based on code changes alone
- **ALWAYS** verify with actual test execution

### ❌ **NEVER Skip Test Execution**
- Don't make changes without running tests
- Don't assume small changes won't break tests
- Don't batch multiple changes before testing
- **ALWAYS** test after every single change

### ❌ **NEVER Write Implementation First**
- Don't write server endpoints before tests
- Don't implement features without test coverage
- Don't assume you know what the test should look like
- **ALWAYS** let the test drive the implementation

### ❌ **NEVER Force Red By Expecting Failure**
- Don't change assertions to expect 400/500 (or `success: false`) merely to keep a test Red
- Don't rely on generic fallback errors (e.g., "Failed to build and submit transaction") as the assertion for Red phase
- The Red should come from the absence of implementation for the asserted correct behavior

### ❌ **NEVER Use Superstitious Fixes**
- Don't add arbitrary delays (`setTimeout`) without understanding why
- Don't add "just in case" error handling without tests
- Don't make changes based on hunches rather than test failures
- **ALWAYS** understand the root cause of failures

### ❌ **NEVER Ignore Test Failures**
- Don't proceed with new features when tests are failing
- Don't assume failing tests are "expected" without verification
- Don't skip debugging test failures
- **ALWAYS** fix failing tests before moving forward

## Best Practices for This Project

### 1. **Test Structure**
```typescript
test("should [expected behavior]", async () => {
  // Arrange - Set up test data
  // Act - Make the HTTP request or call
  // Assert - Verify the result
});
```

### 2. **HTTP API Testing Pattern**
```typescript
// 1. Create session first
const sessionResponse = await fetch("/api/session/new", { method: "POST" });
expect(sessionResponse.status).toBe(200);
const sessionData = await sessionResponse.json();
const sessionId = sessionData.sessionId;

// 2. Make the actual API call
const response = await fetch("/api/endpoint", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ sessionId, ...otherData })
});

// 3. Validate response
expect(response.status).toBe(200);
const data = await response.json();
expect(data.success).toBe(true);
```

### 3. **"Cheat-Catching" Test Examples**
```typescript
// Use random values to prevent guessing
const randomRedeemer = Math.floor(Math.random() * 1000) + 100;
const randomAmount = Math.floor(Math.random() * 1000000) + 1000000;

// Test that specific UTXOs are consumed
// Test that real transaction hashes are returned
// Test that emulator actually executes contract logic
```

### 4. **Error Handling Tests**
```typescript
// Test both success and failure cases
expect(response.status).toBe(400); // or 500 for server errors
const errorData = await response.json();
expect(errorData.success).toBe(false);
expect(errorData.error).toContain("specific error message");
```

## Session Management Guidelines

### 1. **Always Validate Session Creation**
```typescript
expect(createSessionResponse.status).toBe(200);
const sessionData: any = await createSessionResponse.json();
expect(sessionData.success).toBe(true);
expect(sessionData.sessionId).toBeDefined();
```

### 2. **Use Async Server Initialization**
```typescript
// In beforeAll
server = await createServer(sessionManager);
```

## Technical Debt Management

### 1. **Document Known Issues**
```typescript
test.skip("should return real transaction IDs (TECHNICAL DEBT: Need to research...)", async () => {
  // Test implementation
});
```

### 2. **Label Disabled Tests**
```typescript
describe("Feature (TECHNICAL DEBT - DISABLED)", () => {
  // Disabled test suite
});
```

## Communication Guidelines

### 1. **Be Transparent About Test Status**
- "Red phase: Test is failing as expected"
- "Green phase: Test now passes"
- "Refactor phase: Cleaning up implementation"

### 2. **Ask Before Making Changes**
- "Should I proceed with implementing this endpoint?"
- "Do you want me to add error handling for this case?"
- "Should I refactor this code?"

### 3. **Report Progress Accurately**
- "Running tests to verify the fix..."
- "Tests are still failing, investigating..."
- "All tests now pass, ready for next step"

## Key Insights from This Session

1. **Timing Issues**: Server initialization must be async to prevent race conditions
2. **Session Validation**: Always validate session creation before proceeding
3. **Real vs Dummy**: Tests must prove actual emulator interaction
4. **UTXO Model**: Understanding eUTXO is crucial for contract testing
5. **Error Handling**: Server should rely on emulator for validation, not compute conditions itself

## Remember: TDD is a Discipline

- **Patience**: Don't rush to implementation
- **Accuracy**: Always report test status truthfully
- **Incremental**: One small step at a time
- **Verification**: Test everything, assume nothing
- **Communication**: Keep the user informed of every step

The goal is to build confidence in the code through rigorous testing, not to write code quickly.
