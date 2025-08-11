# Aiken Validator Compilation Tutorial

This tutorial provides a simple guide on how to compile Aiken validators to generate `plutus.json` files, using a basic hello-world example.

## Prerequisites

- Aiken compiler installed (version 1.1.17 or later)
- Basic understanding of Cardano smart contracts

## Project Structure

A minimal Aiken project should have the following structure:

```
my-aiken-project/
├── aiken.toml          # Project configuration
├── validators/          # Validator source files
│   └── hello_world.ak
├── build/               # Generated build artifacts
└── plutus.json          # Generated blueprint (after build)
```

## Step 1: Project Configuration

Create an `aiken.toml` file in your project root:

```toml
name = "demo/hello_world"
version = "0.1.0"
compiler = "v1.1.17"
plutus = "v3"
license = "Apache-2.0"
description = "Simple hello world validator"

[repository]
user = "your-username"
project = "hello_world"
platform = "github"

[[dependencies]]
name = "aiken-lang/stdlib"
version = "v2.2.0"
source = "github"

[config]
```

## Step 2: Writing a Simple Hello World Validator

Create `validators/hello_world.ak`:

```aiken
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/transaction.{OutputReference, Transaction}

pub type Datum {
  owner: VerificationKeyHash,
  message: ByteArray,
}

pub type Redeemer {
  msg: ByteArray,
}

validator hello_world {
  spend(
    datum: Option<Datum>,
    redeemer: Redeemer,
    _output_reference: OutputReference,
    self: Transaction,
  ) {
    when datum is {
      None -> False
      Some(d) -> {
        let must_say_hello = redeemer.msg == "Hello, World!"
        let must_be_signed = 
          list.any(self.extra_signatories, fn(vkh) { vkh == d.owner })
        
        must_say_hello && must_be_signed
      }
    }
  }
}

test hello_world_success() {
  let datum = Datum {
    owner: "verification_key_hash_here",
    message: "Hello, World!",
  }
  let redeemer = Redeemer { msg: "Hello, World!" }
  
  hello_world(Some(datum), redeemer, undefined, undefined)
}

test hello_world_failure() {
  let datum = Datum {
    owner: "verification_key_hash_here", 
    message: "Hello, World!",
  }
  let redeemer = Redeemer { msg: "Wrong message" }
  
  !hello_world(Some(datum), redeemer, undefined, undefined)
}
```

## Step 3: Compilation Process

### 1. Check Your Code

First, validate your Aiken code:

```bash
aiken check
```

Expected output:
```
    Compiling demo/hello_world 0.1.0 (.)
    Compiling aiken-lang/stdlib v2.2.0 (./build/packages/aiken-lang-stdlib)
   Collecting all tests scenarios across all modules
      Summary 0 errors, 0 warnings
```

### 2. Build the Project

Generate the `plutus.json` blueprint:

```bash
aiken build
```

Expected output:
```
    Compiling demo/hello_world 0.1.0 (.)
    Compiling aiken-lang/stdlib v2.2.0 (./build/packages/aiken-lang-stdlib)
   Generating project's blueprint (./plutus.json)
      Summary 0 errors, 0 warnings
```

### 3. Verify the Output

Check that `plutus.json` was generated:

```bash
ls -la plutus.json
```

The file should be created and contain the compiled validator information.

## Step 4: Understanding the Generated plutus.json

The generated `plutus.json` will contain:

### Preamble Section
```json
{
  "preamble": {
    "title": "demo/hello_world",
    "description": "Simple hello world validator",
    "version": "0.1.0",
    "plutusVersion": "v3",
    "compiler": {
      "name": "Aiken",
      "version": "v1.1.17+c3a7fba"
    },
    "license": "Apache-2.0"
  }
}
```

### Validators Section
Your hello_world validator will have entries like:

```json
{
  "title": "hello_world.hello_world.spend",
  "datum": {
    "title": "datum",
    "schema": {
      "$ref": "#/definitions/hello_world~1Datum"
    }
  },
  "redeemer": {
    "title": "redeemer",
    "schema": {
      "$ref": "#/definitions/hello_world~1Redeemer"
    }
  },
  "compiledCode": "59010401010029800aba2aba1aab9faab9eaab9dab9a48888896600264646644b30013370e900118031baa00189919912cc004cdc3a400060126ea801626464b3001300f0028acc004cdc3a400460166ea800e2942264b30013371e6eb8c03cc034dd50042450d48656c6c6f2c20576f726c642100899198008009bac301030113011301130113011301130113011300e3754602001644b30010018a508acc004cdc79bae3011001375c6022601e6ea800e29462660040046024002806901045282016300e300c375400680522c8068dd7180680098051baa0058b2010300a001300a300b00130073754003164014600e002600e6010002600e00260066ea801e29344d9590011",
  "hash": "6131eb9f18f2739b05a913f0a7321bd8b8356ca3db7d855bff3f619e"
}
```

### Definitions Section
Type definitions for your custom types:

```json
{
  "definitions": {
    "hello_world~1Datum": {
      "title": "Datum",
      "dataType": "constructor",
      "index": 0,
      "fields": [
        {
          "title": "owner",
          "$ref": "#/definitions/aiken~1crypto~1VerificationKeyHash"
        },
        {
          "title": "message",
          "$ref": "#/definitions/ByteArray"
        }
      ]
    },
    "hello_world~1Redeemer": {
      "title": "Redeemer",
      "dataType": "constructor",
      "index": 0,
      "fields": [
        {
          "title": "msg",
          "$ref": "#/definitions/ByteArray"
        }
      ]
    }
  }
}
```

## Step 5: Common Issues and Solutions

### Issue 1: Syntax Errors

**Problem**: Invalid Aiken syntax
```
Error aiken::parser
  × While parsing files...
  ╰─▶ I found an unexpected token '{'.
```

**Solution**: 
- Check for missing semicolons, brackets, or parentheses
- Ensure proper validator syntax
- Verify import statements

### Issue 2: Type Errors

**Problem**: Type mismatches or undefined types
```
Error aiken::type_error
  × Type error in function...
```

**Solution**:
- Check type definitions
- Verify import statements
- Ensure proper type annotations

### Issue 3: Missing Dependencies

**Problem**: Undefined modules or functions
```
Error aiken::type_error
  × Unknown type...
```

**Solution**:
- Add missing dependencies to `aiken.toml`
- Check import statements
- Verify module paths

## Step 6: Testing Your Validator

### Running Tests

```bash
aiken check
```

This will run all tests and report results. You should see:
```
    Compiling demo/hello_world 0.1.0 (.)
    Compiling aiken-lang/stdlib v2.2.0 (./build/packages/aiken-lang-stdlib)
   Collecting all tests scenarios across all modules
      Summary 0 errors, 0 warnings
```

## Step 7: Complete Working Example

Here's a complete minimal example that will generate `plutus.json`:

### Directory Structure
```
hello-world-demo/
├── aiken.toml
└── validators/
    └── hello_world.ak
```

### aiken.toml
```toml
name = "demo/hello_world"
version = "0.1.0"
compiler = "v1.1.17"
plutus = "v3"
license = "Apache-2.0"
description = "Simple hello world validator"

[repository]
user = "demo"
project = "hello_world"
platform = "github"

[[dependencies]]
name = "aiken-lang/stdlib"
version = "v2.2.0"
source = "github"

[config]
```

### validators/hello_world.ak
```aiken
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/transaction.{OutputReference, Transaction}

pub type Datum {
  owner: VerificationKeyHash,
  message: ByteArray,
}

pub type Redeemer {
  msg: ByteArray,
}

validator hello_world {
  spend(
    datum: Option<Datum>,
    redeemer: Redeemer,
    _output_reference: OutputReference,
    self: Transaction,
  ) {
    when datum is {
      None -> False
      Some(d) -> {
        let must_say_hello = redeemer.msg == "Hello, World!"
        let must_be_signed = 
          list.any(self.extra_signatories, fn(vkh) { vkh == d.owner })
        
        must_say_hello && must_be_signed
      }
    }
  }
}

test hello_world_success() {
  let datum = Datum {
    owner: "verification_key_hash_here",
    message: "Hello, World!",
  }
  let redeemer = Redeemer { msg: "Hello, World!" }
  
  hello_world(Some(datum), redeemer, undefined, undefined)
}

test hello_world_failure() {
  let datum = Datum {
    owner: "verification_key_hash_here",
    message: "Hello, World!",
  }
  let redeemer = Redeemer { msg: "Wrong message" }
  
  !hello_world(Some(datum), redeemer, undefined, undefined)
}
```

### Commands to Run
```bash
# Check the code
aiken check

# Build and generate plutus.json
aiken build

# Verify the output
ls -la plutus.json
```

## Troubleshooting Checklist

- [ ] Aiken compiler is installed and up to date
- [ ] `aiken.toml` is properly configured
- [ ] All syntax is valid (run `aiken check`)
- [ ] All types are properly defined
- [ ] Dependencies are correctly specified
- [ ] Project structure follows conventions
- [ ] Tests pass (`aiken check` shows 0 errors)
- [ ] Build succeeds (`aiken build` generates `plutus.json`)

## Conclusion

This tutorial covers the complete process of compiling a simple Aiken hello-world validator to generate `plutus.json` files. The process is straightforward:

1. Set up proper project configuration
2. Write a simple validator with correct syntax
3. Check for errors with `aiken check`
4. Build with `aiken build`
5. Verify the generated `plutus.json`

The key is following the proper project structure and using the correct Aiken syntax. This example demonstrates that Aiken compilation is reliable and produces consistent results. 