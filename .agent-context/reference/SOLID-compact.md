# SOLID Principles - Compact Reference

## Quick Scan Checklist
```
SRP → One class, one responsibility, one reason to change
OCP → Extend behavior via interfaces, not modification
LSP → Subtypes must be drop-in replacements
ISP → Many small interfaces > one large interface
DIP → Depend on abstractions, not implementations
```

---

## Detection Patterns & Fixes

### S - Single Responsibility Principle
**Violation Indicators:**
- Class name contains "Manager", "Handler", "Util" with multiple unrelated methods
- Methods mixing concerns: DB access + business logic + formatting
- Class has dependencies from multiple domains

**Fix Pattern:**
```
❌ class UserManager { validate(), save(), email(), report() }
✓ Separate: UserValidator, UserRepository, EmailService, ReportGenerator
```

---

### O - Open/Closed Principle
**Violation Indicators:**
- `if/else` or `switch` statements on type/enum values
- Adding new feature requires modifying existing class
- Hard-coded algorithm variations

**Fix Pattern:**
```
❌ if (type === 'A') { ... } else if (type === 'B') { ... }
✓ interface Strategy { execute() }
  class StrategyA implements Strategy { ... }
  class StrategyB implements Strategy { ... }
```

---

### L - Liskov Substitution Principle
**Violation Indicators:**
- Subclass throws exceptions parent doesn't
- Overridden method weakens preconditions or strengthens postconditions
- `instanceof` checks before using base type
- Subclass leaves parent methods unimplemented

**Fix Pattern:**
```
❌ class Penguin extends Bird { fly() { throw Error } }
✓ Redesign hierarchy: Bird → FlyingBird, Bird → FlightlessBird
```

---

### I - Interface Segregation Principle
**Violation Indicators:**
- Implementing classes throw "not implemented" errors
- Clients import interfaces but use only 1-2 methods
- Interface has methods for multiple client roles

**Fix Pattern:**
```
❌ interface Worker { work(), eat(), sleep() }
✓ Split: Workable { work() }, Feedable { eat() }, Restable { sleep() }
```

---

### D - Dependency Inversion Principle
**Violation Indicators:**
- `new ConcreteClass()` inside high-level modules
- Direct imports of implementation classes (not interfaces)
- Hard to test due to concrete dependencies

**Fix Pattern:**
```
❌ class Service { db = new MySQLDB() }
✓ class Service { constructor(db: Database) }
  // Inject concrete implementation from composition root
```

---

## Code Review Commands

When reviewing code, execute these checks:

1. **Count responsibilities:** Can you describe the class without using "AND"?
2. **Test extensibility:** Can you add a variant without editing existing code?
3. **Substitution test:** Can you swap child for parent without knowing the difference?
4. **Interface audit:** Does every implementer use 100% of the interface?
5. **Dependency direction:** Do arrows point toward abstractions?

---

## Refactoring Priority

Fix violations in this order for maximum impact:
1. **DIP** - Enables testing and flexibility
2. **SRP** - Reduces blast radius of changes
3. **OCP** - Prevents modification cascades
4. **ISP** - Clarifies contracts
5. **LSP** - Ensures correctness

---

## Common Anti-Patterns

| Anti-Pattern | Violated Principle | Quick Fix |
|--------------|-------------------|-----------|
| God Class | SRP | Extract collaborators |
| Type Switching | OCP | Strategy pattern |
| Refused Bequest | LSP | Favor composition |
| Fat Interface | ISP | Role interfaces |
| Service Locator | DIP | Constructor injection |
| Concrete Dependencies | DIP | Depend on interfaces |