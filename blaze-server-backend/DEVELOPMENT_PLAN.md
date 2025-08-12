# Incremental Development Plan for Aiken Demo Backend

## Overview
This plan prioritizes the most challenging technical aspects first, ensuring we prove core functionality before building convenience layers. It incorporates operational readiness, error handling, and performance considerations from the ground up.

## Phase 0: Environment Setup ⚙️
**Goal**: Establish consistent development environment and foundational infrastructure

### Setup 0.1: Prerequisites ✅
- [x] Install and verify Aiken CLI (document version in README)
- [x] Set up logging framework (Winston/pino)
- [x] Create configuration system (.env support)
- [x] Document Node.js version requirements
- **Success Criteria**: Can run `aiken --version` and load config
- **Test File**: `src/tests/phase0/test-0.1-prerequisites.test.ts`

### Setup 0.2: Error Handling Foundation ✅
- [x] Define custom error classes hierarchy
- [x] Implement error codes enum
- [x] Create error response formatter
- [x] Add global error handler
- **Success Criteria**: Consistent error handling across codebase
- **Test File**: `src/tests/phase0/test-0.2-error-handling.test.ts`

### Setup 0.3: Logging & Monitoring ✅
- [x] Configure structured logging
- [x] Add request ID tracking
- [x] Set up basic metrics collection
- [x] Create debug mode for verbose output
- **Success Criteria**: Can trace requests through logs
- **Test File**: `src/tests/phase0/test-0.3-logging.test.ts`

## Phase 1: Core Emulator Integration (Most Challenging)
**Goal**: Prove we can deploy and invoke Aiken contracts using Blaze emulator without any API/client layers

### Test 1.1: Basic Emulator Setup ✅
- [x] Set up Node.js project with Blaze SDK
- [x] Create minimal test that initializes an emulator instance
- [x] Verify we can create wallets and fund them
- [x] Test failure cases (invalid wallet names, negative balances)
- [x] Benchmark wallet creation time
- **Success Criteria**: Can create wallet with balance, handles errors gracefully
- **Test File**: `src/tests/phase1/test-1.1-emulator-setup.test.ts`

### Test 1.2: Aiken Contract Compilation ✅
- [x] Install Aiken CLI
- [x] Create PRD-compliant hello_world.ak contract (datum == redeemer)
- [x] Fix PRD validator syntax issues (validator block vs pub fn)
- [x] Compile contract to Plutus JSON
- [x] Load compiled contract in Node.js
- [x] Test compilation error handling (malformed contracts)
- [x] Measure compilation time
- **Success Criteria**: Can read compiled contract bytecode, handles compilation errors
- **Test File**: `src/tests/phase1/test-1.2-aiken-compilation.test.ts`

### Test 1.3: Direct Contract Deployment 🟡
- [ ] Deploy compiled Aiken contract to emulator
- [ ] Build transaction to lock funds with datum
- [ ] Build transaction to unlock with redeemer
- [ ] Test unlock failure with incorrect redeemer
- [ ] Execute both transactions directly via emulator
- [ ] Benchmark transaction execution time
- **Success Criteria**: Contract executes correctly, rejects invalid redeemers
- **Test File**: `src/tests/phase1/test-1.3-contract-deployment.test.ts`

## Phase 2: Session Management Layer
**Goal**: Add single-session management for demo scenarios

### Test 2.1: Session Manager ✅
- [x] Create SessionManager class with single emulator instance
- [x] Test creating sessions with unique IDs
- [x] Test session retrieval and validation
- [x] Implement singleton pattern (one active session)
- [x] Test session replacement (new session destroys old)
- **Success Criteria**: Single session management works, handles session validation
- **Test File**: `src/tests/phase2/test-2.1-session-manager.test.ts`

### Test 2.2: Wallet Service ⬜
- [ ] Implement WalletService using emulator.register()
- [ ] Test wallet creation in current session
- [ ] Test wallet signing capabilities
- [ ] Implement secure key storage (even for demo)
- [ ] Test wallet operations in single session
- [ ] Add wallet operation audit logging
- **Success Criteria**: Wallets work in current session, proper validation
- **Test File**: `src/tests/phase2/test-2.2-wallet-service.test.ts`


## Phase 3: Contract Services
**Goal**: Dynamic contract loading and instantiation with versioning

### Test 3.1: Contract Registry ⬜
- [ ] Scan contracts/ directory for .ak files
- [ ] Auto-compile on startup
- [ ] Implement contract versioning strategy
- [ ] Handle compilation failures gracefully
- [ ] Make contracts available via API
- [ ] Add contract metadata (description, parameters)
- [ ] Document contract registry API
- **Success Criteria**: Contracts auto-load with version support
- **Test File**: `src/tests/phase3/test-3.1-contract-registry.ts`

### Test 3.2: Contract Instantiation ⬜
- [ ] Support parameterized contracts
- [ ] Test instantiation with different parameters
- [ ] Validate parameter types and ranges
- [ ] Test invalid parameter handling
- [ ] Cache compiled contracts for performance
- **Success Criteria**: Can create contract instances safely
- **Test File**: `src/tests/phase3/test-3.2-contract-instantiation.ts`

## Phase 4: REST API Layer
**Goal**: HTTP interface for single-session demo tool with proper error handling

### Test 4.1: Core Endpoints ⬜
- [ ] Session creation endpoint (POST /api/session/new)
- [ ] Session validation middleware
- [ ] Wallet endpoints with session validation
- [ ] Network query endpoints with session validation
- [ ] Input validation middleware
- [ ] Error responses for invalid session IDs
- [ ] API documentation (OpenAPI/Swagger)
- **Success Criteria**: Basic API works with session validation
- **Test File**: `src/tests/phase4/test-4.1-core-endpoints.test.ts`

### Test 4.2: Transaction Endpoints ⬜
- [ ] Sign transaction endpoint with session validation
- [ ] Sign and submit endpoint with session validation
- [ ] Fee estimation endpoint with session validation
- [ ] Transaction validation before submission
- [ ] Test transaction submissions in single session
- [ ] Add transaction status tracking
- **Success Criteria**: Can build/sign/submit via API safely with session validation
- **Test File**: `src/tests/phase4/test-4.2-transaction-endpoints.test.ts`

### Test 4.3: API Error Handling ⬜
- [ ] Test all error scenarios
- [ ] Verify consistent error format
- [ ] Test timeout handling
- [ ] Test large request rejection
- **Success Criteria**: All errors handled gracefully
- **Test File**: `src/tests/phase4/test-4.3-error-handling.ts`

## Phase 5: TypeScript Client Library
**Goal**: Client-side transaction building

### Test 5.1: Basic Client ⬜
- [ ] API client wrapper
- [ ] Type definitions
- [ ] Session/wallet management
- **Success Criteria**: Can interact with server
- **Test File**: `src/tests/phase5/test-5.1-basic-client.ts`

### Test 5.2: Transaction Builder Integration ⬜
- [ ] Integrate transaction building library (CSL/Lucid)
- [ ] Build lock/unlock transactions
- [ ] End-to-end hello world test
- **Success Criteria**: Complete flow works
- **Test File**: `src/tests/phase5/test-5.2-transaction-builder.ts`

## Phase 6: Advanced Features
**Goal**: Complete PRD requirements

### Test 6.1: Reference Scripts ⬜
- [ ] Deploy reference scripts
- [ ] Query by script hash
- [ ] Track usage
- **Success Criteria**: Reference scripts work
- **Test File**: `src/tests/phase6/test-6.1-reference-scripts.ts`

### Test 6.2: State Queries ⬜
- [ ] Contract state by address
- [ ] Contracts by script hash
- [ ] Transaction history
- **Success Criteria**: All queries work
- **Test File**: `src/tests/phase6/test-6.2-state-queries.ts`

## Key Technical Challenges (Front-loaded)
1. **Blaze/Aiken Integration**: Ensuring compiled Aiken contracts work with Blaze emulator
2. **Transaction Building**: Correct script witness construction
3. **Session Management**: Managing single emulator instance with validation
4. **Contract Parameterization**: Dynamic validator instantiation
5. **Session Validation**: Ensuring proper session ID validation across all endpoints
6. **Resource Management**: Controlling memory usage with single emulator
7. **Error Recovery**: Handling emulator crashes gracefully

## Testing Strategy
- Unit tests for each service class
- Integration tests for each phase milestone
- End-to-end test with hello world contract
- Performance tests for multiple sessions
- Failure case testing for each component
- Load testing for concurrent operations
- Security testing for wallet operations

## Progress Tracking
- ⬜ Not Started
- 🟡 In Progress
- ✅ Completed
- ❌ Blocked

## Running Tests
```bash
# Run all tests
npm test

# Run specific phase tests
npm run test:phase1
npm run test:phase2
# etc...

# Run specific test file
bun test src/tests/phase1/test-1.1-emulator-setup.test.ts
```

## Notes
- Each test file should be self-contained and runnable independently
- Tests should output clear success messages
- Failed tests should provide debugging information
- Keep test execution time under 5 seconds per file
- Performance benchmarks should be recorded in `PERFORMANCE.md`
- Security considerations should be documented in `SECURITY.md`
- API documentation should be auto-generated from code

## Performance Goals
- Session creation: < 100ms
- Transaction submission: < 500ms
- Contract compilation: < 2s
- Support minimum 20 concurrent sessions
- Memory usage: < 50MB per session

## Documentation Requirements
- README.md with quickstart guide
- API documentation (auto-generated)
- Architecture decision records (ADRs)
- Performance benchmark results
- Security considerations document
- Troubleshooting guide