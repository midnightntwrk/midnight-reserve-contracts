# Demo Interpreter Design Specification

## Overview

The Demo Interpreter is a system for creating and executing interactive, testable demo scripts that simulate user behavior in blockchain or API-based systems. The design draws inspiration from Jupyter Notebooks, using an alternating sequence of explanatory markdown and executable code blocks. The system abstracts away boilerplate logic such as error checking and response validation while maintaining clarity and narrative flow for both technical and non-technical stakeholders.

## Core Design Principles

1. **Real Implementation**: All operations must make actual HTTP calls to the blaze server - no mocking or simulation
2. **Scope Persistence**: Variables created in one stanza must be accessible in subsequent stanzas
3. **Progressive Execution**: Interactive, user-controlled execution with visual feedback
4. **Dynamic Operation Detection**: Real-time analysis of code to provide visual indicators before execution
5. **Monadic Abstraction**: HTTP communication, session management, and error handling hidden from demo code

## System Architecture

### 1. Demo Notebook Format (`.demonb`)

The system uses a JSON-based format for demo notebooks with the following structure:

```json
{
  "name": "Demo Name",
  "description": "Demo description",
  "version": "1.0",
  "config": {
    "baseUrl": "http://localhost:3031"
  },
  "stanzas": [
    {
      "name": "stanza_name",
      "blocks": [
        {
          "type": "markdown",
          "content": ["line1", "line2", ...]
        },
        {
          "type": "code",
          "language": "javascript",
          "content": ["const x = 1;", "console.log(x);"]
        }
      ]
    }
  ]
}
```

#### Architecture Overview

**Demo Structure:**
- **Demo** = Sequence of stanzas
- **Stanza** = Named sequence of blocks (markdown, code, etc.)
- **Block** = Individual content elements (markdown block, code block, etc.)

#### Block Types

- **Markdown**: Human-readable descriptions and explanations
- **Code**: Executable code blocks with specified language (e.g., "javascript")

#### Stanza Schema

Each stanza has the following structure:
- `name`: String identifier for the stanza (e.g., "introduction", "create_wallet_jeff")
- `blocks`: Array of block objects

Each block has the following structure:
- `type`: Either "markdown" or "code"
- `language`: Required for code blocks, specifies the programming language (e.g., "javascript")
- `content`: Array of strings representing the block content (one string per line)

#### Execution Semantics

- Markdown blocks are displayed for reading
- Code blocks are executed in a shared scope where variables persist across stanza boundaries
- Errors reference stanza names and block types for better diagnostics
- All code blocks run in an async context to support blockchain operations
- Stanzas provide logical grouping of related blocks

### 2. Monadic Function Interface

The system provides pure function interfaces that abstract away HTTP communication:

```javascript
// Wallet operations
createWallet(name, initialBalance) → Promise<Wallet>
getBalance(walletName) → Promise<number>

// Contract operations  
deployContract(contractName, contractCode) → Promise<Contract>
contractAction(contractName, action, parameters) → Promise<Result>
getContractState(contractName) → Promise<State>

// Time operations
advanceTime(seconds) → Promise<void>
waitFor(condition) → Promise<void>
```

#### Implementation Requirements

- **Real HTTP Integration**: Direct calls to blaze server API endpoints with no synthetic delays
- **Error Handling**: All HTTP/error handling occurs at the monadic level; user code blocks don't handle errors
- **Session Management**: Automatic session creation and management hidden from demo code
- **Response Validation**: Automatic validation of server responses with meaningful error messages

### 3. Scope Persistence Implementation

#### Technical Approach

- **CommonJS Modules**: Used to enable `with` statements for scope persistence
- **Shared Execution Scope**: Variables persist across stanza boundaries using `with (scope)` within `Function` constructors
- **Direct Assignment**: Demo code uses `variable = value` instead of `const variable = value` to ensure variables are added to the shared scope object

#### Implementation Details

```javascript
// Each code stanza executes in a shared scope
const scopedEval = (code) => {
  return new Function('scope', `
    with (scope) {
      return (async () => { ${code} })();
    }
  `)(this.executionScope);
};
```

### 4. Dynamic Operation Detection

#### Purpose

Provide visual indicators about what users are about to execute before they execute it, enabling different UI rendering based on operation type.

#### Implementation Strategy

- **Sandboxed Trial Runs**: Perform controlled execution of code before rendering to analyze what operations it would perform
- **Scope Cloning**: Create a scope clone to avoid contaminating the real execution environment
- **HTTP Interception**: Intercept HTTP calls to record which server endpoints would be hit
- **Mock Responses**: Return mock responses to allow code to continue executing without affecting real state
- **Operation Analysis**: Analyze recorded operations to determine if they're transactions (POST/PUT/DELETE) or queries (GET)

#### Why Sandboxed Execution

Cannot simply scan for function names because users may define custom functions that call the blockchain API. Must actually run the functions in a controlled environment to see what endpoints they attempt to access.

#### Visual Differentiation

CSS classes provide immediate visual feedback:
- `.transaction` - Red borders/buttons for state-modifying operations (POST/PUT/DELETE)
- `.query` - Blue borders/buttons for data retrieval operations (GET)  
- `.mixed` - Orange borders/buttons with warning text for mixed operations
- `.unknown` - Gray borders/buttons for unrecognized operations

#### Smart Button Text

Dynamic button labels based on operation type:
- "Submit Transaction" for transactions
- "Query Data" for queries  
- "Execute (Modifies State)" for mixed operations
- "Execute" for unknown operations

#### Timing

Analysis happens just before code block rendering to enable proper CSS class assignment.

### 5. Progressive Web Interface

#### Core Features

- **Interactive Execution**: User-controlled execution with "Execute" buttons for each code block
- **Progressive Disclosure**: Shows one stanza at a time with user-controlled advancement
- **Visual States**: Red→yellow→green color progression for execution status
- **Immediate Execution**: No synthetic delays - server calls execute instantly

#### Viewport Management

- **Auto-scrolling**: Smooth `scrollIntoView({ behavior: 'smooth', block: 'center' })` for new content
- **Pre-scrolling**: Maintain 60vh padding-bottom to keep blank space at bottom of viewport
- **Smart Positioning**: Content appears in center of viewport with space below for next stanza
- **Timing**: 100ms delay for markdown auto-advance, 50ms for code scroll, 100ms for output scroll

#### Progress Tracking

- **Stanza Counting**: Track completed code stanzas separately from total stanzas
- **Progress Indicator**: Visual progress bar showing completion percentage
- **State Persistence**: Maintain execution state across page refreshes

### 6. CLI Runner

#### Features

- **Interactive Mode**: Pause after each stanza for user review
- **Batch Mode**: Execute entire demo without interruption
- **Error Reporting**: Clear error messages with stanza context
- **Output Formatting**: Clean, readable output with proper formatting

#### Usage

```bash
# Interactive mode
npm run demo:run -- demo-flows/simple-wallet-test.demonb

# Batch mode  
npm run demo:run -- demo-flows/simple-wallet-test.demonb --batch
```

### 7. Async Handling in Demo Code

#### User Preference

Avoid requiring "async" before calling server functions if possible.

#### Technical Challenge

JavaScript's fundamental limitation in assignment contexts:
- `jeff = await f()` (explicit, works)
- `jeff = f()` where f has async inside (immediate assignment of Promise, not resolved value)

#### Attempted Solutions Explored

- **Regex-based automatic await injection**: Fragile, removed
- **Proxy objects to defer resolution**: Complex, abandoned  
- **Fiber-like continuation approaches**: Deprecated, non-standard

#### Fundamental Limitation

JavaScript's execution model doesn't allow functions to appear synchronous while performing async operations and returning resolved values directly to assignments.

#### Final Recommendation

Accept that demo code will contain await keywords - this is the honest, standard JavaScript approach.

#### Monadic Preservation

HTTP/error handling remains hidden in runtime functions, maintaining the monadic spirit despite explicit await in demo code.

## Example Demo Notebook

```json
{
  "name": "Simple Wallet Demo",
  "description": "Demonstrates creating wallets and checking balances",
  "version": "1.0",
  "config": {
    "baseUrl": "http://localhost:3031"
  },
  "stanzas": [
    {
      "name": "introduction",
      "blocks": [
        {
          "type": "markdown",
          "content": [
            "# Simple Wallet Demo",
            "",
            "This demo demonstrates basic wallet operations in the blockchain emulator:",
            "1. Creating wallets with initial funds",
            "2. Checking wallet balances",
            "3. Basic wallet management"
          ]
        }
      ]
    },
    {
      "name": "create_jeff_wallet",
      "blocks": [
        {
          "type": "markdown",
          "content": [
            "Let's create a wallet for Jeff with an initial balance."
          ]
        },
        {
          "type": "code",
          "language": "javascript",
          "content": [
            "jeff = await createWallet('jeff', 50_000_000);",
            "console.log(`Jeff's wallet created!`);",
            "console.log(`Wallet name: ${jeff.name}`);",
            "console.log(`Initial balance: ${jeff.balance} lovelace`);"
          ]
        }
      ]
    },
    {
      "name": "check_jeff_balance",
      "blocks": [
        {
          "type": "markdown",
          "content": [
            "Now let's check Jeff's current balance and convert it to ADA."
          ]
        },
        {
          "type": "code",
          "language": "javascript",
          "content": [
            "jeffBalance = await getBalance('jeff');",
            "jeffAda = parseInt(jeffBalance) / 1_000_000;",
            "console.log(`Jeff's current balance: ${jeffBalance} lovelace`);",
            "console.log(`That's ${jeffAda} ADA`);"
          ]
        }
      ]
    }
  ]
}
```
```

## Non-Functional Requirements

### Performance

- **Real-time Analysis**: Dynamic operation detection must complete within 100ms
- **Immediate Execution**: Server calls execute instantly with no artificial delays
- **Responsive UI**: Smooth scrolling and transitions with minimal latency

### Reliability

- **Error Exposure**: Real failures must be exposed rather than hidden
- **Scope Integrity**: Variables must persist correctly across all stanza boundaries
- **State Consistency**: Execution state must remain consistent across interface modes

### Usability

- **Clear Visual Feedback**: Users must immediately understand what operations will be performed
- **Intuitive Controls**: Simple, predictable interaction patterns
- **Accessible Output**: Clean, readable output suitable for both technical and non-technical audiences

### Testing Requirements

- **Real Integration Tests**: Tests that cannot easily be faked by mock implementations
- **Scope Persistence Tests**: Explicit tests for variable persistence across stanza boundaries
- **Dynamic Detection Tests**: Verification that operation detection accurately identifies block types
- **Error Handling Tests**: Validation that real errors are properly exposed

## Implementation Notes

### Dependencies

- **CommonJS Modules**: Required for `with` statements and scope persistence
- **Fetch API**: For HTTP communication (native in Node.js 22+)
- **DOM APIs**: For web interface (scrollIntoView, etc.)

### Configuration

- **Base URL**: Configurable server endpoint (default: http://localhost:3031)
- **Session Management**: Automatic session creation with configurable timeouts
- **Error Handling**: Configurable error reporting levels and formats

## Future Enhancements

1. **Test Assertions**: Structured way to embed test assertions in demo notebooks
2. **Advanced Contract Operations**: More sophisticated contract interaction patterns
3. **Multi-Session Support**: Support for multiple concurrent demo sessions
4. **Export Capabilities**: Export demo execution results to various formats
5. **Plugin Architecture**: Extensible system for custom operation types

## Conclusion

This design specification provides a complete, real implementation of a demo interpreter system that maintains the monadic spirit while providing rich, interactive experiences for both technical and non-technical users. The system prioritizes real functionality over simulation, clear visual feedback, and robust error handling while maintaining the narrative clarity that makes demos effective for stakeholders.
