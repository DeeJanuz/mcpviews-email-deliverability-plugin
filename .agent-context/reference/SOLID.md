# SOLID Design Principles

## Context
Use these principles when designing, reviewing, or refactoring code. SOLID principles create maintainable, scalable, and testable software.

---

## S - Single Responsibility Principle (SRP)
**Rule:** A class/module should have one, and only one, reason to change.

**Application:**
- Each class should do ONE thing well
- If you can describe a class with "AND", it likely violates SRP
- Separate data access, business logic, and presentation concerns

**Example - Before:**
```
class UserManager {
  validateUser(user) { ... }
  saveToDatabase(user) { ... }
  sendWelcomeEmail(user) { ... }
  generateReport(user) { ... }
}
```

**Example - After:**
```
class UserValidator {
  validate(user) { ... }
}

class UserRepository {
  save(user) { ... }
}

class EmailService {
  sendWelcomeEmail(user) { ... }
}

class ReportGenerator {
  generateUserReport(user) { ... }
}
```

---

## O - Open/Closed Principle (OCP)
**Rule:** Software entities should be open for extension, but closed for modification.

**Application:**
- Use interfaces/abstract classes for extensibility
- Prefer composition and dependency injection over modification
- Use strategy pattern for varying behaviors

**Example - Before:**
```
class PaymentProcessor {
  process(type, amount) {
    if (type === 'credit') { ... }
    else if (type === 'paypal') { ... }
    else if (type === 'crypto') { ... }
  }
}
```

**Example - After:**
```
interface PaymentMethod {
  process(amount): Result
}

class CreditCardPayment implements PaymentMethod {
  process(amount) { ... }
}

class PayPalPayment implements PaymentMethod {
  process(amount) { ... }
}

class PaymentProcessor {
  constructor(private method: PaymentMethod) {}
  process(amount) {
    return this.method.process(amount)
  }
}
```

---

## L - Liskov Substitution Principle (LSP)
**Rule:** Subtypes must be substitutable for their base types without altering program correctness.

**Application:**
- Child classes should strengthen, not weaken, parent contracts
- Don't throw unexpected exceptions in overrides
- Maintain expected behavior and invariants

**Example - Violation:**
```
class Bird {
  fly() { ... }
}

class Penguin extends Bird {
  fly() {
    throw new Error("Penguins can't fly") // Violates LSP
  }
}
```

**Example - Correct:**
```
class Bird {
  move() { ... }
}

class FlyingBird extends Bird {
  fly() { ... }
}

class Penguin extends Bird {
  swim() { ... }
}
```

---

## I - Interface Segregation Principle (ISP)
**Rule:** Clients should not be forced to depend on interfaces they don't use.

**Application:**
- Create small, focused interfaces
- Split large interfaces into role-specific ones
- Clients should only know about methods they use

**Example - Before:**
```
interface Worker {
  work(): void
  eat(): void
  sleep(): void
}

class Robot implements Worker {
  work() { ... }
  eat() { throw new Error() } // Robot doesn't eat
  sleep() { throw new Error() } // Robot doesn't sleep
}
```

**Example - After:**
```
interface Workable {
  work(): void
}

interface Feedable {
  eat(): void
}

interface Restable {
  sleep(): void
}

class Robot implements Workable {
  work() { ... }
}

class Human implements Workable, Feedable, Restable {
  work() { ... }
  eat() { ... }
  sleep() { ... }
}
```

---

## D - Dependency Inversion Principle (DIP)
**Rule:** High-level modules should not depend on low-level modules. Both should depend on abstractions.

**Application:**
- Depend on interfaces/abstractions, not concrete implementations
- Use dependency injection
- Invert control flow through abstractions

**Example - Before:**
```
class EmailService {
  send(message) { ... }
}

class NotificationService {
  private emailService = new EmailService() // Direct dependency

  notify(message) {
    this.emailService.send(message)
  }
}
```

**Example - After:**
```
interface MessageService {
  send(message): void
}

class EmailService implements MessageService {
  send(message) { ... }
}

class SMSService implements MessageService {
  send(message) { ... }
}

class NotificationService {
  constructor(private messageService: MessageService) {} // Depends on abstraction

  notify(message) {
    this.messageService.send(message)
  }
}
```

---

## Quick Reference Checklist

When writing/reviewing code, ask:
- [ ] **SRP:** Does this class have multiple reasons to change?
- [ ] **OCP:** Can I add new behavior without modifying existing code?
- [ ] **LSP:** Can I substitute derived classes without breaking functionality?
- [ ] **ISP:** Are there unused methods in my interfaces?
- [ ] **DIP:** Am I depending on concrete implementations instead of abstractions?

---

## Common Patterns That Support SOLID

- **Strategy Pattern** → OCP, DIP
- **Factory Pattern** → OCP, DIP
- **Adapter Pattern** → LSP, ISP
- **Decorator Pattern** → OCP, SRP
- **Dependency Injection** → DIP, OCP