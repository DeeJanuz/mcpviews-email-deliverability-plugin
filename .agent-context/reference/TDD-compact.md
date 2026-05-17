# TDD - Compact Reference

## The Cycle
```
RED → Write failing test
GREEN → Minimal code to pass
REFACTOR → Improve while green
```

---

## Layer-Based Testing Decision Tree

```
What am I testing?
│
├─ Pure business logic (no I/O)?
│  └─ Domain Unit Test
│     Location: tests/domain/[FileName].test.ts
│     Strategy: No mocks, fast, test all edge cases
│
├─ Use case coordinating domain objects?
│  └─ Application Integration Test
│     Location: tests/application/[FileName].test.ts
│     Strategy: Real domain objects, mock ports only
│
├─ Database/API/File I/O?
│  └─ Adapter Integration Test
│     Location: tests/adapters/[FileName].test.ts
│     Strategy: Real external systems (test DB/in-memory)
│
└─ Complete user workflow?
   └─ E2E Test
      Location: tests/e2e/[feature-name].test.ts
      Strategy: Through HTTP/UI, real services
```

---

## File Location Rules

### Pattern
```
Source:  src/[layer]/[FileName].ts
Test:    tests/[layer]/[FileName].test.ts
```

### Examples
```
src/domain/Order.ts              → tests/domain/Order.test.ts
src/application/PlaceOrder.ts    → tests/application/PlaceOrder.test.ts
src/adapters/PostgresRepo.ts     → tests/adapters/PostgresRepo.test.ts
User workflow                    → tests/e2e/[workflow-name].test.ts
```

### Test Helpers
```
In-memory fakes    → tests/helpers/fakes/[Name].ts
Test builders      → tests/helpers/builders/[Name]Builder.ts
Fixtures/data      → tests/helpers/fixtures/[data].json
```

---

## Before Writing a Test

**Check for duplicates:**
```bash
# 1. Does test file exist?
ls tests/[mirror-path]/[FileName].test.ts

# 2. Does test case exist?
grep -r "test description" tests/
```

**Checklist:**
- [ ] Test file exists? → Add to existing
- [ ] `describe` block exists? → Add test case
- [ ] Scenario covered? → Skip or enhance

---

## Test Distribution (SOLID-Aligned)

```
Domain Layer:      50% (many fast unit tests)
Application Layer: 30% (integration tests)
Adapter Layer:     15% (I/O verification)
E2E:               5%  (critical paths only)
```

---

## Test Structure: AAA

```typescript
test('should [behavior] when [condition]', () => {
  // Arrange: Setup
  const service = new Service(dependencies)

  // Act: Execute
  const result = service.method(input)

  // Assert: Verify
  expect(result).toBe(expected)
})
```

---

## SOLID → Testing Strategy

```
DIP → Inject test doubles at port boundaries
SRP → Each layer tests one concern
ISP → Small interfaces = easy fakes
LSP → Test doubles substitute cleanly
OCP → Add tests without modifying existing
```

---

## Domain Layer Example

```typescript
// src/domain/Order.ts
class Order {
  calculateTotal(): Money { ... }
}

// tests/domain/Order.test.ts
test('calculates total from items', () => {
  const order = new Order([
    new OrderItem(Money.dollars(10), 2)
  ])

  expect(order.calculateTotal()).toEqual(Money.dollars(20))
})
// No mocks, pure logic, fast
```

---

## Application Layer Example

```typescript
// src/application/PlaceOrderUseCase.ts
class PlaceOrderUseCase {
  constructor(
    private orderRepo: IOrderRepository,  // Port
    private payment: IPaymentGateway      // Port
  ) {}
}

// tests/application/PlaceOrderUseCase.test.ts
test('places order when payment succeeds', async () => {
  const orderRepo = new InMemoryOrderRepository()     // Fake
  const payment = new FakePaymentGateway({ ok: true }) // Fake
  const useCase = new PlaceOrderUseCase(orderRepo, payment)

  await useCase.execute(items)

  expect(orderRepo.orders).toHaveLength(1)
})
// Mock only at boundaries
```

---

## Adapter Layer Example

```typescript
// tests/adapters/PostgresOrderRepository.test.ts
test('saves order to database', async () => {
  const db = await createTestDatabase()
  const repo = new PostgresOrderRepository(db)

  await repo.save(order)

  const saved = await db.query('SELECT * FROM orders')
  expect(saved.rows).toHaveLength(1)
})
// Real database (test instance)
```

---

## E2E Example

```typescript
// tests/e2e/order-flow.test.ts
test('user places order via API', async () => {
  const response = await request(app)
    .post('/api/orders')
    .send({ items: [...] })

  expect(response.status).toBe(201)
})
// Entire stack
```

---

## Edge Cases to Test

- **Boundaries:** 0, 1, max, min
- **Empty:** null, undefined, [], ""
- **Invalid:** wrong types, out of range
- **Errors:** exceptions, network failures

---

## Test Naming

```
describe('[ClassName/ModuleName]', () => {
  describe('[methodName]', () => {
    test('should [behavior] when [condition]', () => {})
  })
})
```

---

## Anti-Patterns

| Anti-Pattern | Fix |
|--------------|-----|
| Testing implementation details | Test behavior |
| Interdependent tests | Isolate each test |
| Slow tests | Mock I/O |
| Duplicate tests | Check before writing |
| No test structure | Use describe blocks |

---

## TDD for Bug Fixes

```
1. Write test that reproduces bug (RED)
2. Fix code to pass test (GREEN)
3. Refactor if needed
Result: Bug can never return
```

---

## Quick Commands

```bash
# Watch mode
npm test -- --watch

# Run specific test
npm test Order.test.ts

# Coverage
npm test -- --coverage

# Find existing tests
grep -r "test description" tests/
```

---

## Test Doubles

```typescript
// Fake: Real implementation for testing
class InMemoryRepository implements IRepository {
  data = []
  async save(item) { this.data.push(item) }
}

// Builder: Construct test data
class OrderBuilder {
  withItem(price, qty) { ... }
  build() { return new Order(...) }
}
```

---

## FIRST Principles

- **F**ast: Milliseconds
- **I**ndependent: No dependencies between tests
- **R**epeatable: Same result every time
- **S**elf-Validating: Pass/fail automatically
- **T**imely: Written just before production code