# Test-Driven Development (TDD)

## Context
TDD is a development methodology where tests are written before implementation code. Use this approach when building new features, fixing bugs, or refactoring existing code.

---

## The TDD Cycle: Red → Green → Refactor

```
1. RED:    Write a failing test
2. GREEN:  Write minimal code to pass
3. REFACTOR: Improve code while keeping tests green
4. REPEAT
```

---

## Core Principles

### 1. Write Tests First
- **Rule:** No production code without a failing test first
- **Benefit:** Tests drive design, ensuring testability
- **Forces:** Clear requirements, interface-first thinking

### 2. Minimal Implementation
- **Rule:** Write only enough code to make the test pass
- **Benefit:** Prevents over-engineering, maintains focus
- **Forces:** Incremental progress, simpler solutions

### 3. Refactor Under Green
- **Rule:** Only refactor when all tests pass
- **Benefit:** Safety net prevents regression
- **Forces:** Continuous improvement, clean code

---

## Layer-Based Testing Strategy (SOLID-Aligned)

### Why Layer-Based Testing?
When following SOLID principles, your architecture naturally separates into testable layers. This strategy leverages **Dependency Inversion Principle (DIP)** to create clear testing boundaries.

### Architecture Layers → Test Types

```
┌─────────────────────────────────────────────────────┐
│ Domain Layer (Business Logic)                       │
│ • Pure functions, no I/O                            │
│ • Entities, Value Objects, Domain Services          │
│ TEST: Fast unit tests, no mocks needed              │
└─────────────────────────────────────────────────────┘
              ↓ depends on abstractions (DIP)
┌─────────────────────────────────────────────────────┐
│ Application Layer (Use Cases)                       │
│ • Orchestrates domain objects                       │
│ • Depends on port interfaces (IRepository, etc)     │
│ TEST: Integration tests, mock only ports            │
└─────────────────────────────────────────────────────┘
              ↓ depends on abstractions (DIP)
┌─────────────────────────────────────────────────────┐
│ Adapter Layer (I/O Implementation)                  │
│ • Database, API clients, File system                │
│ • Implements port interfaces                        │
│ TEST: Integration tests with real systems           │
└─────────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────────┐
│ Infrastructure (Framework, Config)                  │
│ • Express routes, DI container, Config              │
│ TEST: E2E tests or contract tests                   │
└─────────────────────────────────────────────────────┘
```

### Decision Tree: Where Should This Test Go?

```
What are you testing?
│
├─ Pure business logic (no I/O, no framework)?
│  └─ Domain Layer → Unit Test
│     • Fast (< 10ms per test)
│     • No mocks, use real objects
│     • Test all edge cases and business rules
│
├─ Workflow that coordinates multiple domain objects?
│  └─ Application Layer → Integration Test
│     • Use real domain objects
│     • Mock only at port boundaries (IRepository, IEmailService)
│     • Test use case scenarios
│
├─ Database queries, API calls, file operations?
│  └─ Adapter Layer → Integration Test
│     • Use real database (test DB or in-memory)
│     • Test actual I/O behavior
│     • Verify adapter implements port contract correctly
│
└─ Complete user workflow across entire system?
   └─ Infrastructure → E2E Test
      • Test through HTTP endpoints or UI
      • Use real services (or docker compose)
      • Fewer tests, critical paths only
```

### SOLID Principles Enable This Strategy

| SOLID Principle | Testing Benefit |
|-----------------|-----------------|
| **SRP** | Each layer has one testing concern |
| **OCP** | Add new features without changing test structure |
| **LSP** | Test doubles substitute cleanly for real implementations |
| **ISP** | Small port interfaces are easy to mock/fake |
| **DIP** | Abstractions create natural test boundaries |

### Example: Testing an Order System

#### Domain Layer (Pure Unit Test)
```typescript
// src/domain/Order.ts
class Order {
  constructor(private items: OrderItem[]) {}

  calculateTotal(): Money {
    return this.items.reduce(
      (sum, item) => sum.add(item.price.multiply(item.quantity)),
      Money.zero()
    )
  }

  canBeShipped(): boolean {
    return this.items.length > 0 && this.calculateTotal().isPositive()
  }
}

// tests/domain/Order.test.ts
test('calculates total from multiple items', () => {
  const order = new Order([
    new OrderItem(Money.dollars(10), 2),
    new OrderItem(Money.dollars(5), 3)
  ])

  expect(order.calculateTotal()).toEqual(Money.dollars(35))
})
// No mocks, no I/O, blazing fast
```

#### Application Layer (Integration Test with Port Mocks)
```typescript
// src/application/PlaceOrderUseCase.ts
interface IOrderRepository {  // Port (DIP)
  save(order: Order): Promise<void>
}

interface IPaymentGateway {  // Port (DIP)
  charge(amount: Money): Promise<PaymentResult>
}

class PlaceOrderUseCase {
  constructor(
    private orderRepo: IOrderRepository,
    private paymentGateway: IPaymentGateway
  ) {}

  async execute(items: OrderItem[]): Promise<Result> {
    const order = new Order(items)  // Real domain object

    if (!order.canBeShipped()) {
      return Result.fail('Order cannot be shipped')
    }

    const payment = await this.paymentGateway.charge(order.calculateTotal())
    if (!payment.success) {
      return Result.fail('Payment failed')
    }

    await this.orderRepo.save(order)
    return Result.ok()
  }
}

// tests/application/PlaceOrderUseCase.test.ts
test('places order when payment succeeds', async () => {
  // Use in-memory fakes (real implementations for testing)
  const orderRepo = new InMemoryOrderRepository()
  const paymentGateway = new FakePaymentGateway({ shouldSucceed: true })
  const useCase = new PlaceOrderUseCase(orderRepo, paymentGateway)

  const result = await useCase.execute([
    new OrderItem(Money.dollars(10), 1)
  ])

  expect(result.isSuccess).toBe(true)
  expect(orderRepo.orders).toHaveLength(1)
})
// Mocks only at boundaries, tests real coordination
```

#### Adapter Layer (Integration Test with Real System)
```typescript
// src/adapters/PostgresOrderRepository.ts
class PostgresOrderRepository implements IOrderRepository {
  async save(order: Order): Promise<void> {
    await db.query(
      'INSERT INTO orders (id, total) VALUES ($1, $2)',
      [order.id, order.calculateTotal().cents]
    )
  }
}

// tests/adapters/PostgresOrderRepository.test.ts
test('saves order to database', async () => {
  const db = await createTestDatabase()
  const repo = new PostgresOrderRepository(db)
  const order = new Order([new OrderItem(Money.dollars(10), 1)])

  await repo.save(order)

  const saved = await db.query('SELECT * FROM orders WHERE id = $1', [order.id])
  expect(saved.rows[0].total).toBe(1000)  // 1000 cents
})
// Test against real database (test instance or in-memory)
```

#### Infrastructure (E2E Test)
```typescript
// tests/e2e/order-flow.test.ts
test('user can place order through API', async () => {
  const response = await request(app)
    .post('/api/orders')
    .send({
      items: [{ productId: '123', quantity: 2 }]
    })

  expect(response.status).toBe(201)
  expect(response.body.orderId).toBeDefined()
})
// Tests entire stack, fewer tests, critical paths only
```

### Test Distribution by Layer

**Recommended ratio:**
- Domain Layer: 50% of tests (many fast unit tests)
- Application Layer: 30% of tests (focused integration tests)
- Adapter Layer: 15% of tests (verify I/O works)
- Infrastructure: 5% of tests (critical E2E flows)

---

## TDD Workflow Example

### Scenario: Implementing a password validator

**Iteration 1: RED**
```javascript
// Test: Password must be at least 8 characters
test('rejects password shorter than 8 characters', () => {
  const validator = new PasswordValidator()
  expect(validator.isValid('abc123')).toBe(false)
})
```
*Run test → FAILS (PasswordValidator doesn't exist)*

**Iteration 1: GREEN**
```javascript
class PasswordValidator {
  isValid(password) {
    return password.length >= 8
  }
}
```
*Run test → PASSES*

**Iteration 2: RED**
```javascript
test('requires at least one uppercase letter', () => {
  const validator = new PasswordValidator()
  expect(validator.isValid('password123')).toBe(false)
  expect(validator.isValid('Password123')).toBe(true)
})
```
*Run test → FAILS*

**Iteration 2: GREEN**
```javascript
class PasswordValidator {
  isValid(password) {
    return password.length >= 8 && /[A-Z]/.test(password)
  }
}
```
*Run test → PASSES*

**Iteration 2: REFACTOR**
```javascript
class PasswordValidator {
  isValid(password) {
    return this.hasMinLength(password) && this.hasUppercase(password)
  }

  private hasMinLength(password) {
    return password.length >= 8
  }

  private hasUppercase(password) {
    return /[A-Z]/.test(password)
  }
}
```
*Run tests → ALL PASS, code is cleaner*

---

## TDD Rules (The Three Laws)

1. **Don't write production code** until you have a failing test
2. **Don't write more test** than is sufficient to fail
3. **Don't write more production code** than necessary to pass the test

---

## Test Structure: AAA Pattern

```
// Arrange: Set up test data and dependencies
const calculator = new Calculator()
const a = 5
const b = 3

// Act: Execute the behavior being tested
const result = calculator.add(a, b)

// Assert: Verify the outcome
expect(result).toBe(8)
```

---

## What Makes a Good Unit Test?

### FIRST Principles
- **Fast:** Runs in milliseconds
- **Independent:** No dependencies between tests
- **Repeatable:** Same result every time
- **Self-Validating:** Pass/fail, no manual inspection
- **Timely:** Written just before production code

### Test Naming Convention
```
test('should [expected behavior] when [condition]', () => { ... })

Examples:
- should return null when user not found
- should throw error when email is invalid
- should calculate total with tax when items exist
```

---

## Common TDD Patterns

### 1. Obvious Implementation
When solution is simple, write it directly:
```
test('should add two numbers', () => {
  expect(add(2, 3)).toBe(5)
})

function add(a, b) {
  return a + b  // Obvious
}
```

### 2. Fake It
Start with hard-coded values, then generalize:
```
// First test
test('should return 1 for single item', () => {
  expect(count([1])).toBe(1)
})
function count(items) { return 1 }  // Fake it

// Second test forces generalization
test('should return 3 for three items', () => {
  expect(count([1,2,3])).toBe(3)
})
function count(items) { return items.length }  // Now real
```

### 3. Triangulation
Use multiple examples to drive the general solution:
```
test('fibonacci of 0 is 0', () => expect(fib(0)).toBe(0))
test('fibonacci of 1 is 1', () => expect(fib(1)).toBe(1))
test('fibonacci of 2 is 1', () => expect(fib(2)).toBe(1))
test('fibonacci of 5 is 5', () => expect(fib(5)).toBe(5))
// Multiple tests triangulate toward the correct algorithm
```

---

## Testing Edge Cases

Always test:
- **Boundaries:** 0, 1, max, min values
- **Empty inputs:** null, undefined, empty arrays/strings
- **Invalid inputs:** Wrong types, out-of-range values
- **Error conditions:** Network failures, missing resources

```javascript
test('boundary: empty array', () => {
  expect(sum([])).toBe(0)
})

test('boundary: single element', () => {
  expect(sum([5])).toBe(5)
})

test('edge case: null input', () => {
  expect(() => sum(null)).toThrow()
})
```

---

## TDD for Bug Fixes

**Workflow:**
1. Write a test that reproduces the bug (RED)
2. Fix the code to make the test pass (GREEN)
3. Refactor if needed (REFACTOR)

**Benefit:** Bug never returns - test catches regressions

```javascript
// Bug report: divide by zero crashes app
test('should handle division by zero', () => {
  expect(divide(10, 0)).toBe(Infinity)  // Or throw error
})

// Fix implementation
function divide(a, b) {
  if (b === 0) return Infinity  // Handle edge case
  return a / b
}
```

---

## Mocking and Test Doubles

Use test doubles to isolate units:

```javascript
// Test double types
const stub = { method: () => 'fixed value' }
const mock = { method: jest.fn().mockReturnValue('value') }
const spy = jest.spyOn(obj, 'method')

// Example: Testing without external dependencies
test('should send email notification', async () => {
  const mockEmailService = {
    send: jest.fn().mockResolvedValue(true)
  }

  const notifier = new Notifier(mockEmailService)
  await notifier.notify('user@example.com', 'Hello')

  expect(mockEmailService.send).toHaveBeenCalledWith(
    'user@example.com',
    'Hello'
  )
})
```

---

## TDD Checklist

When practicing TDD:
- [ ] Write test before implementation
- [ ] Run test and see it fail (RED)
- [ ] Write minimal code to pass (GREEN)
- [ ] Run all tests to ensure no regression
- [ ] Refactor if code can be improved
- [ ] Run tests again after refactoring
- [ ] Commit when tests are green
- [ ] Repeat for next requirement

---

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
|--------------|---------|----------|
| Testing implementation details | Brittle tests | Test behavior, not internals |
| Interdependent tests | Cascade failures | Each test self-contained |
| Slow tests | Developers skip them | Mock I/O, optimize setup |
| Vague assertions | False positives | Specific expectations |
| Testing framework code | Wasted effort | Test your code only |
| No test refactoring | Technical debt | Treat tests as first-class code |

---

## TDD Benefits

1. **Design:** Forces modular, testable code
2. **Documentation:** Tests show how code should be used
3. **Confidence:** Refactor without fear
4. **Debugging:** Pinpoint failures quickly
5. **Coverage:** High test coverage naturally emerges

---

## File System Organization

### Core Principle
**Tests live in a dedicated `tests/` directory that mirrors the `src/` structure.**

This approach:
- Keeps tests separate from production code
- Maintains clear organization
- Prevents accidental test imports in production
- Makes it easy to locate tests for any source file

### Directory Structure

```
project/
├── src/                          # Production code
│   ├── domain/                   # Domain layer
│   │   ├── entities/
│   │   │   ├── Order.ts
│   │   │   └── User.ts
│   │   ├── value-objects/
│   │   │   └── Money.ts
│   │   └── services/
│   │       └── PricingService.ts
│   ├── application/              # Application layer
│   │   ├── use-cases/
│   │   │   ├── PlaceOrderUseCase.ts
│   │   │   └── RegisterUserUseCase.ts
│   │   └── ports/                # Interfaces (DIP)
│   │       ├── IOrderRepository.ts
│   │       └── IEmailService.ts
│   ├── adapters/                 # Adapter layer
│   │   ├── repositories/
│   │   │   └── PostgresOrderRepository.ts
│   │   ├── services/
│   │   │   └── SendGridEmailService.ts
│   │   └── api/
│   │       └── StripePaymentGateway.ts
│   └── infrastructure/           # Infrastructure layer
│       ├── http/
│       │   └── routes.ts
│       ├── config/
│       │   └── database.ts
│       └── di/
│           └── container.ts
│
├── tests/                        # Test code (mirrors src/)
│   ├── domain/                   # Unit tests
│   │   ├── entities/
│   │   │   ├── Order.test.ts
│   │   │   └── User.test.ts
│   │   ├── value-objects/
│   │   │   └── Money.test.ts
│   │   └── services/
│   │       └── PricingService.test.ts
│   ├── application/              # Integration tests
│   │   └── use-cases/
│   │       ├── PlaceOrderUseCase.test.ts
│   │       └── RegisterUserUseCase.test.ts
│   ├── adapters/                 # Integration tests
│   │   ├── repositories/
│   │   │   └── PostgresOrderRepository.test.ts
│   │   └── services/
│   │       └── SendGridEmailService.test.ts
│   ├── e2e/                      # End-to-end tests
│   │   ├── order-flow.test.ts
│   │   └── user-registration.test.ts
│   └── helpers/                  # Test utilities
│       ├── fakes/                # In-memory implementations
│       │   ├── InMemoryOrderRepository.ts
│       │   └── FakeEmailService.ts
│       ├── builders/             # Test data builders
│       │   ├── OrderBuilder.ts
│       │   └── UserBuilder.ts
│       └── fixtures/             # Test data
│           └── sample-orders.json
```

### Naming Conventions

#### Test File Names
```
Source file:      src/domain/Order.ts
Test file:        tests/domain/Order.test.ts

Source file:      src/adapters/PostgresOrderRepository.ts
Test file:        tests/adapters/PostgresOrderRepository.test.ts
```

**Pattern:** `[SourceFileName].test.[ext]`

#### Test Suite Names
```typescript
// tests/domain/Order.test.ts
describe('Order', () => {
  describe('calculateTotal', () => {
    test('sums all item prices', () => { ... })
    test('returns zero for empty order', () => { ... })
  })

  describe('canBeShipped', () => {
    test('returns false when empty', () => { ... })
    test('returns true when has items', () => { ... })
  })
})
```

**Pattern:**
- Top level: Class/module name
- Nested: Method/function name
- Test: Behavior description

#### Test Helper Names

**Fakes (in-memory implementations):**
```typescript
// tests/helpers/fakes/InMemoryOrderRepository.ts
class InMemoryOrderRepository implements IOrderRepository {
  orders: Order[] = []

  async save(order: Order): Promise<void> {
    this.orders.push(order)
  }

  async findById(id: string): Promise<Order | null> {
    return this.orders.find(o => o.id === id) ?? null
  }
}
```

**Builders (test data construction):**
```typescript
// tests/helpers/builders/OrderBuilder.ts
class OrderBuilder {
  private items: OrderItem[] = []

  withItem(price: Money, quantity: number): this {
    this.items.push(new OrderItem(price, quantity))
    return this
  }

  build(): Order {
    return new Order(this.items)
  }
}

// Usage in tests
const order = new OrderBuilder()
  .withItem(Money.dollars(10), 2)
  .withItem(Money.dollars(5), 1)
  .build()
```

### Test Organization by Type

#### Unit Tests
**Location:** Mirror source structure under `tests/`
```
src/domain/Order.ts        → tests/domain/Order.test.ts
src/domain/Money.ts        → tests/domain/Money.test.ts
```

#### Integration Tests
**Location:** Mirror source structure under `tests/`
```
src/application/PlaceOrderUseCase.ts
  → tests/application/PlaceOrderUseCase.test.ts

src/adapters/PostgresOrderRepository.ts
  → tests/adapters/PostgresOrderRepository.test.ts
```

#### E2E Tests
**Location:** Organized by feature/workflow in `tests/e2e/`
```
tests/e2e/order-flow.test.ts
tests/e2e/user-registration.test.ts
tests/e2e/payment-processing.test.ts
```

### Preventing Duplicate Tests

#### Before Writing a Test
1. **Check if test file exists:**
   ```bash
   # If testing src/domain/Order.ts
   ls tests/domain/Order.test.ts
   ```

2. **Search for existing test cases:**
   ```bash
   # Search for similar test descriptions
   grep -r "calculates total" tests/
   ```

3. **Review test suite structure:**
   ```typescript
   // Look for existing describe blocks
   describe('Order', () => {
     describe('calculateTotal', () => {  // ← Already tested here?
       test('existing test', () => { ... })
     })
   })
   ```

#### Checklist Before Creating New Test
- [ ] Does `tests/[mirror-path]/[FileName].test.ts` exist?
- [ ] Is there already a `describe('[MethodName]')` block?
- [ ] Does an existing test cover this scenario?
- [ ] If yes to all: Add to existing suite, don't create new file

### Configuration Files

#### Jest Configuration
```javascript
// jest.config.js
module.exports = {
  testMatch: [
    '**/tests/**/*.test.ts',    // All .test.ts files in tests/
    '**/tests/**/*.test.js'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/'
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,js}',
    '!src/**/*.d.ts',
    '!src/**/index.ts'
  ]
}
```

#### VSCode Settings
```json
// .vscode/settings.json
{
  "jest.autoRun": "watch",
  "jest.testPathPattern": "tests/.*\\.test\\.ts$",
  "files.associations": {
    "*.test.ts": "typescript"
  }
}
```

### Git Integration

#### Don't Commit These Test Artifacts
```bash
# .gitignore
coverage/
*.test.log
.test-results/
__snapshots__/
test-db-*
*.test.db
```

#### DO Commit These
```bash
tests/              # All test files
tests/helpers/      # Test utilities
tests/fixtures/     # Test data
jest.config.js      # Test configuration
```

### Quick Reference: Finding the Right Test Location

```
I need to test...                    → Create/update test at...
─────────────────────────────────────────────────────────────
src/domain/Order.ts                  → tests/domain/Order.test.ts
src/application/PlaceOrderUseCase.ts → tests/application/PlaceOrderUseCase.test.ts
src/adapters/PostgresRepo.ts        → tests/adapters/PostgresRepo.test.ts
Complete order workflow              → tests/e2e/order-flow.test.ts
Shared test utility                  → tests/helpers/[utility-name].ts
Test data builder                    → tests/helpers/builders/[Name]Builder.ts
Fake implementation                  → tests/helpers/fakes/[Name]Fake.ts
```

---

## Quick Reference: Red-Green-Refactor Commands

```bash
# RED: Write failing test
npm test -- --watch  # See it fail

# GREEN: Implement minimal solution
npm test             # See it pass

# REFACTOR: Improve code
npm test             # Ensure still passing

# Commit
git add . && git commit -m "feat: add feature with tests"
```