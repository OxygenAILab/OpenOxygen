# Contributing to OpenOxygen Next

Thank you for your interest in contributing to OpenOxygen Next! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Submitting Changes](#submitting-changes)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Code Review Process](#code-review-process)

## Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct:

- Be respectful and constructive
- Welcome newcomers and help them learn
- Focus on what is best for the community and project
- Show empathy towards others

## Getting Started

### Prerequisites

- **Rust**: 1.75+ ([Install](https://rustup.rs/))
- **Node.js**: 18+ ([Install](https://nodejs.org/))
- **Python**: 3.10+ (optional, for Python bindings)
- **Tesseract OCR**: (for OCR functionality)
- **Windows**: Windows 10/11 with UI Automation support

### Fork and Clone

```bash
# Fork the repository on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/OpenOxygen.git
cd OpenOxygen

# Add upstream remote
git remote add upstream https://github.com/StarsailsClover/OpenOxygen.git
```

## Development Setup

### 1. Install Rust Dependencies

```bash
# Install Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Install required tools
cargo install cargo-watch cargo-edit cargo-audit
```

### 2. Install Node.js Dependencies

```bash
# Install npm dependencies
npm install

# Install development tools
npm install -g @microsoft/rush pnpm
```

### 3. Install Tesseract OCR

```bash
# Windows (Chocolatey)
choco install tesseract

# Ubuntu/Debian
sudo apt-get install tesseract-ocr

# macOS
brew install tesseract
```

### 4. Environment Configuration

```bash
# Copy example environment file
cp .env.example .env

# Edit .env with your configuration
# Required: OPENAI_API_KEY (for VLM functionality)
```

### 5. Build the Project

```bash
# Build Rust components
cargo build --release

# Build TypeScript components
npm run build

# Run tests
cargo test
npm test
```

## Development Workflow

### Project Structure

```
OpenOxygen/
├── crates/              # Rust components
│   ├── core/           # Core runtime
│   ├── gui-control/    # GUI automation
│   ├── cli-executor/   # CLI execution
│   ├── perception/     # OCR and vision
│   ├── agent-bridge/   # Multi-agent
│   ├── vlm-connector/  # VLM providers
│   ├── memory/         # Persistence
│   ├── ouv/            # Vision fusion
│   └── htn-planner/    # Task planning
│
├── src/                # TypeScript components
│   ├── orchestrator/   # Task orchestration
│   ├── llm/            # LLM integration
│   ├── skills/         # Skills system
│   └── browser/        # Browser automation
│
├── python/             # Python bindings
├── docs/               # Documentation
├── tests/              # Test suites
└── examples/           # Example usage
```

### Making Changes

#### 1. Create a Branch

```bash
# Create a feature branch
git checkout -b feature/my-new-feature

# Or create a bugfix branch
git checkout -b fix/issue-description
```

#### 2. Write Code

**Rust Guidelines:**
- Follow the [Rust Style Guide](https://doc.rust-lang.org/1.0.0/style/)
- Run `cargo fmt` before committing
- Run `cargo clippy` and fix warnings
- Add tests for new functionality
- Document public APIs with doc comments

**TypeScript Guidelines:**
- Follow the [TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)
- Use strict TypeScript settings
- Add JSDoc comments for public APIs
- Write tests with Jest

**General Guidelines:**
- Keep functions small and focused
- Use meaningful variable names
- Add error handling
- Log appropriately

#### 3. Test Your Changes

```bash
# Run Rust tests
cargo test --all

# Run TypeScript tests
npm test

# Run integration tests
cargo test --test integration

# Check formatting
cargo fmt -- --check

# Run linter
cargo clippy -- -D warnings
```

#### 4. Update Documentation

- Update README.md if adding new features
- Update API.md for new APIs
- Add examples for new functionality
- Update CHANGELOG.md

### Commit Message Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `chore`: Build process or auxiliary tool changes

**Examples:**

```
feat(gui): add Windows UIA element highlighting

Add support for highlighting UI elements during automation
by drawing colored rectangles around them.

Closes #123
```

```
fix(ocr): correct text coordinate calculation

The bounding box coordinates were offset by the window
coordinates. Now using absolute screen coordinates.

Fixes #456
```

### Submitting Changes

#### 1. Push Your Branch

```bash
git push origin feature/my-new-feature
```

#### 2. Create a Pull Request

1. Go to the repository on GitHub
2. Click "New Pull Request"
3. Select your branch
4. Fill in the PR template:
   - Description of changes
   - Related issues
   - Testing performed
   - Screenshots (if applicable)

#### 3. Code Review

- Address reviewer feedback promptly
- Keep discussion focused and professional
- Make requested changes and push updates
- Request re-review when ready

### Pull Request Template

```markdown
## Description
Brief description of the changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing performed

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] Tests added/updated
- [ ] No new warnings

## Related Issues
Fixes #XXX
Related to #YYY
```

## Development Tips

### Debugging Rust Code

```bash
# Run with backtrace
RUST_BACKTRACE=1 cargo run

# Run specific test
cargo test test_name -- --nocapture

# Run with logging
RUST_LOG=debug cargo run
```

### Debugging TypeScript Code

```bash
# Run with debugger
npm run dev -- --inspect

# Enable verbose logging
DEBUG=* npm run dev
```

### Performance Profiling

```bash
# Rust profiling
cargo build --release
./target/release/openoxygen
# Use perf, flamegraph, etc.

# TypeScript profiling
node --prof dist/index.js
node --prof-process isolate-*.log > profile.txt
```

## Testing Guidelines

### Unit Tests

```rust
// Rust test example
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_element_finding() {
        let automation = UiaAutomation::new().unwrap();
        // Test logic
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_async_operation() {
        // Async test logic
    }
}
```

```typescript
// TypeScript test example
describe('TaskOrchestrator', () => {
    it('should execute a simple task', async () => {
        const orchestrator = new TaskOrchestrator(config);
        const result = await orchestrator.execute(request);
        expect(result.success).toBe(true);
    });
});
```

### Integration Tests

Integration tests are in `tests/` directory and test end-to-end functionality.

### Manual Testing

For GUI automation changes:
1. Test on Windows 10/11
2. Test with different applications
3. Test with various control types
4. Verify screenshots are accurate

## Release Process

1. Update version numbers in:
   - `Cargo.toml`
   - `package.json`
   - `VERSION.txt`

2. Update CHANGELOG.md

3. Create a release commit:
   ```bash
   git commit -m "chore(release): prepare for v1.x.x"
   ```

4. Tag the release:
   ```bash
   git tag -a v1.x.x -m "Release v1.x.x"
   git push origin v1.x.x
   ```

5. Create GitHub Release with release notes

## Questions?

- Open an issue for bugs or feature requests
- Join our discussions for questions
- Check the [Documentation](docs/)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

Thank you for contributing to OpenOxygen Next! 🚀
