# Development Guidelines

These are critical guidelines that must be followed throughout the development of this project.

## 1. Reference Implementation
**Always use the SundaeSwap treasury contracts as the essential reference for Aiken/Blaze integration:**
- https://github.com/SundaeSwap-finance/treasury-contracts/blob/ed17bce07fdef56df0d347b1cd806f099ca55434/offchain/src/treasury/fund/index.ts
- When encountering integration issues between Aiken and Blaze, refer to this implementation
- This is a proven, working example of the technologies we're using

## 2. No Monkey Patching
**Never resort to monkey patching as a solution:**
- If monkey patching seems like the only option, STOP
- Ask for help instead of implementing workarounds
- Maintain clean, maintainable code architecture
- Proper solutions exist - find them or ask for guidance

## 3. Adhere to PRD Technologies
**Never deviate from the technologies and architecture specified in the PRD:**
- Blaze SDK for Cardano emulation and wallet services
- Aiken for smart contract development
- Node.js/TypeScript for backend
- Express for REST API
- No substitutions or alternative technologies
- If something cannot be made to work with these technologies, STOP and ask for help

## 4. When to Ask for Help
Ask for help when:
- Integration between Aiken and Blaze is unclear
- Monkey patching seems like the only solution
- Tempted to use alternative technologies
- Stuck on a technical challenge for more than 30 minutes
- Documentation is unclear or contradictory

## 5. Development Principles
- Follow the incremental plan in DEVELOPMENT_PLAN.md
- Test at every step
- Document challenges and solutions
- Keep the PRD as the source of truth
- Maintain clean, readable code

## Remember
The goal is to build a robust, maintainable solution using the exact technology stack specified. There are working examples (like SundaeSwap) that prove this stack works - we just need to implement it correctly.