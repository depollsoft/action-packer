# macOS Runner Isolation Options

## Executive Summary

This document researches lightweight isolation technologies for running multiple concurrent GitHub Actions runners on macOS without excessive memory overhead. The goal is to find solutions that enable a single machine to serve several concurrent runners without each one consuming the full resources of a VM, while maintaining sufficient isolation to prevent interference between runners.

## Problem Statement

Running multiple GitHub Actions runners on a single macOS machine presents challenges:
- **Native runners** (no isolation) can interfere with each other and the host system
- **Full VMs** (like Tart) provide strong isolation but have significant memory overhead (8GB+ per VM)
- **Docker** requires a Linux VM and has compatibility issues with macOS-native workflows
- Need a balance between isolation strength and resource efficiency

## Isolation Options Comparison

### 1. Docker Containers (Currently Implemented)

**Overview**: Docker Desktop for Mac runs containers inside a Linux VM using Apple's Virtualization Framework.

**Pros**:
- ✅ Well-documented and widely used
- ✅ Good cross-platform consistency
- ✅ Native ARM64 support on Apple Silicon
- ✅ VirtioFS provides decent I/O performance
- ✅ Resource Saver mode reduces idle memory usage
- ✅ Currently implemented in Action Packer

**Cons**:
- ❌ All containers share a single Linux VM (not true isolation between containers)
- ❌ Linux-only runners (can't run macOS-native GitHub Actions)
- ❌ File I/O overhead (~3x slower than native for bind mounts)
- ❌ x86 containers on ARM require emulation (significant overhead)
- ❌ Memory overhead: Base VM (~2-3GB) + container overhead
- ❌ Licensing costs for commercial use

**Resource Requirements**:
- Base VM: 2-3GB RAM minimum
- Per container: 500MB-2GB depending on workload
- Storage: Variable based on images

**Use Case**: Best for Linux-based workflows where macOS-specific features aren't needed.

---

### 2. Tart Virtualization (Planned)

**Overview**: Native macOS and Linux virtualization using Apple's Virtualization Framework, designed for CI/CD workloads.

**Pros**:
- ✅ Native Apple Silicon support with minimal overhead
- ✅ True VM-level isolation (strongest security)
- ✅ Near-native performance (~12% overhead for parallel VMs)
- ✅ Can run full macOS for macOS-native workflows
- ✅ 2-3x faster than GitHub-hosted runners
- ✅ Open source and free
- ✅ Built for CI/CD use cases
- ✅ Fast snapshot/restore capabilities

**Cons**:
- ❌ **Apple licensing limit: Maximum 2 concurrent macOS VMs per host**
- ❌ High memory per VM (8GB minimum, 16GB recommended)
- ❌ Disk space: 25-54GB per macOS image
- ❌ Only works on Apple Silicon (no Intel support for macOS VMs)
- ❌ Each VM is a full OS instance
- ❌ Longer startup time than containers (~30-60 seconds)

**Resource Requirements**:
- Per macOS VM: 8GB RAM minimum, 16GB recommended
- Per Linux VM: 4GB RAM minimum
- Storage: 25GB (base) to 54GB (with Xcode) per macOS image
- Recommended host: 32GB+ RAM for 2 concurrent macOS VMs

**Use Case**: Best for workflows requiring full macOS environments (Xcode builds, iOS testing, macOS-specific tooling). **Limited to 2 concurrent runners per physical machine due to Apple licensing.**

**Memory Calculation for Multiple Runners**:
```
Scenario: Mac mini M2 with 32GB RAM
- Host OS: 6GB
- 2 macOS VMs @ 12GB each: 24GB
- Overhead: 2GB
Total: 32GB (fully utilized)

Realistically supports: 2 concurrent macOS runners maximum
```

---

### 3. Apple's Native Containerization (Future, macOS 26+)

**Overview**: Apple's new OCI-compliant containerization framework introduced in macOS 26 Tahoe (expected 2025). Each container runs as an extremely lightweight Linux VM.

**Pros**:
- ✅ One VM per container (VM-level isolation)
- ✅ Sub-second startup times
- ✅ Minimal memory overhead (unused containers consume no resources)
- ✅ Native integration with macOS APIs (Keychain, XPC, vmnet)
- ✅ Each container gets its own IP (no port forwarding needed)
- ✅ Built-in Swift-based init system (vminitd)
- ✅ Minimal attack surface (no core utilities in filesystem)
- ✅ First-party Apple support

**Cons**:
- ❌ Requires macOS 26 Tahoe or later (future only)
- ❌ Linux containers only (no macOS container support)
- ❌ New/immature ecosystem
- ❌ Feature parity not yet complete (e.g., memory ballooning)
- ❌ May require workflow adjustments for edge cases

**Resource Requirements**:
- Per container VM: Minimal (~100-500MB idle)
- Fast startup and teardown
- Expected to be more efficient than Docker Desktop

**Use Case**: **Future consideration** when macOS 26 is released. Would be ideal for Linux-based workflows with better isolation than current Docker Desktop. **Not available yet.**

---

### 4. macOS Sandbox API (Process-Level Isolation)

**Overview**: Native macOS process sandboxing using Seatbelt (App Sandbox) or custom profiles via `sandbox-exec`.

**Pros**:
- ✅ Extremely lightweight (near-native performance)
- ✅ No virtualization overhead
- ✅ Built into macOS (no additional software)
- ✅ Can restrict filesystem, network, and resource access
- ✅ Inheritable to child processes
- ✅ Fine-grained control via custom profiles

**Cons**:
- ❌ **Weakest isolation** (shared kernel, visible processes)
- ❌ Can't prevent runners from seeing each other's processes
- ❌ Shared network stack (port conflicts possible)
- ❌ Restrictions only apply to new resource acquisitions
- ❌ Underdocumented APIs
- ❌ Profile syntax (Scheme/LISP dialect) is obscure
- ❌ Won't prevent sophisticated interference attempts

**Resource Requirements**:
- Negligible overhead (< 50MB per sandboxed process)

**Example Sandbox Profile**:
```scheme
(version 1)
(deny default)
(allow file-read* (subpath "/Users/runner/work"))
(allow file-write* (subpath "/Users/runner/work"))
(allow network-outbound)
(allow process-fork)
(allow process-exec (subpath "/usr/bin"))
```

**Use Case**: Suitable only for **trusted workflows** where you want basic resource isolation but don't need strong security boundaries. Not recommended for production multi-tenant scenarios.

---

### 5. User Account Isolation

**Overview**: Run each runner under a separate macOS user account for basic filesystem and permission isolation.

**Pros**:
- ✅ Simple to implement
- ✅ No additional software required
- ✅ Filesystem-level isolation via permissions
- ✅ Minimal overhead
- ✅ Native macOS feature

**Cons**:
- ❌ **Very weak isolation** (users share kernel and see each other's processes)
- ❌ No network isolation (port conflicts)
- ❌ No resource limits (one runner can starve others)
- ❌ Management overhead (creating/maintaining users)
- ❌ Shared system libraries and global state
- ❌ Can't prevent process-level interference

**Resource Requirements**:
- Negligible overhead

**Use Case**: **Not recommended** for concurrent runners. Only suitable for sequential runner execution or completely trusted workloads.

---

### 6. chroot Jails

**Overview**: Traditional Unix filesystem isolation by changing the apparent root directory.

**Pros**:
- ✅ Lightweight (minimal overhead)
- ✅ Filesystem isolation
- ✅ Available on macOS

**Cons**:
- ❌ **Filesystem-only isolation** (no process, network, or IPC isolation)
- ❌ Requires root privileges to set up
- ❌ No resource controls
- ❌ Runners can still see and potentially interfere with each other
- ❌ macOS lacks Linux-style namespaces
- ❌ Complex to set up and maintain

**Resource Requirements**:
- Minimal (just filesystem duplication)

**Use Case**: **Not recommended** for GitHub Actions runners. Too limited for meaningful isolation.

---

## Recommended Approach

Based on the research, here's the recommended strategy for Action Packer:

### Tier 1: Current Implementation (Keep)
**Docker Containers** - Already implemented, works well for Linux workflows
- Continue supporting for Linux-based GitHub Actions
- Document memory requirements clearly
- Optimize image selection (prefer ARM64 native images)

### Tier 2: High Priority Addition
**Tart VMs** - Best for macOS-native workflows despite memory cost
- Implement support for Tart virtualization
- **Document the 2-VM licensing limitation clearly**
- Target users with powerful hardware (32GB+ RAM)
- Use case: iOS/macOS builds, Xcode projects
- Memory consideration: Each runner needs 8-12GB, limit to 2 concurrent macOS VMs

### Tier 3: Hybrid Lightweight Option
**Process-level sandboxing** - For trusted, lightweight concurrent runners
- Implement as an option for users who understand the tradeoffs
- Combine `sandbox-exec` with resource limits (`setrlimit`)
- Use separate working directories and port ranges
- **Clearly label as "low isolation" mode**
- Best for: High concurrency, trusted code, CI workloads that don't need strong isolation

### Tier 4: Future Enhancement
**Apple Containerization** - Monitor and plan for macOS 26+
- Research and prototype once macOS 26 is released
- Would replace Docker for Linux workflows with better performance
- Not actionable until late 2025/early 2026

## Implementation Recommendations

### For Multiple Concurrent Runners on One Mac

**Scenario 1: Linux-only workflows (Current)**
```
Mac mini M2 Pro (32GB RAM)
Strategy: Docker containers
- Docker VM: 8GB
- Runner containers: 4-6 containers @ 2-3GB each
- Host overhead: 6GB
Total: 6-8 concurrent runners possible
```

**Scenario 2: macOS-native workflows (Tart)**
```
Mac Studio M2 Max (64GB RAM)
Strategy: Tart VMs for macOS
- Host OS: 8GB
- 2 macOS VMs @ 16GB each: 32GB (Apple licensing limit)
- Additional Linux runners via Docker: 4 containers @ 3GB = 12GB
- Overhead: 12GB
Total: 2 macOS runners + 4 Linux runners
```

**Scenario 3: High concurrency, trusted code (Hybrid)**
```
Mac mini M2 (24GB RAM)
Strategy: Sandboxed native processes
- Host OS: 4GB
- 10-15 sandboxed runner processes @ 1-1.5GB each
- Overhead: 2GB
Total: 10-15 concurrent runners possible (low isolation)
```

### Priority Implementation Order

1. **Phase 1**: Document current Docker implementation limitations
2. **Phase 2**: Add Tart VM support with clear documentation about:
   - 2-VM Apple licensing limitation
   - Memory requirements (8-12GB per VM)
   - Target audience (macOS-native builds)
3. **Phase 3**: Add sandboxed native runner option with:
   - Clear "low isolation" warnings
   - Resource limit enforcement
   - Separate working directories
   - Port range management
4. **Phase 4**: Monitor Apple Containerization for future adoption

## Key Considerations

### Memory Planning
- **Docker**: Plan for 2-3GB base VM + 2GB per container
- **Tart**: Plan for 8-12GB per macOS VM, maximum 2 VMs
- **Sandbox**: Plan for 1-1.5GB per runner, minimal overhead

### Isolation Levels
1. **Strong**: Tart VMs (full VM isolation)
2. **Medium**: Docker containers (shared VM, container isolation)
3. **Medium**: Apple Containerization (lightweight VM per container, future)
4. **Weak**: Sandboxed processes (filesystem + permission restrictions)
5. **Very Weak**: User accounts (filesystem permissions only)

### Use Case Mapping
- **iOS/macOS builds**: Tart (only option, limited to 2 concurrent)
- **Linux-based CI**: Docker (current) → Apple Containerization (future)
- **High-concurrency trusted code**: Sandboxed native processes
- **General purpose**: Docker (best balance currently)

## References

1. [Tart Virtualization](https://tart.run/) - Official documentation
2. [Self-hosting macOS GitHub Runners](https://josephduffy.co.uk/posts/self-hosting-macos-github-runners) - Real-world experience
3. [Docker Desktop Performance Guide](https://m.academy/articles/docker-desktop-performance-guide-mac/)
4. [macOS Sandbox Documentation](https://developer.apple.com/documentation/xcode/configuring-the-macos-app-sandbox)
5. [Apple Containerization Overview](https://www.theregister.com/2025/06/10/apple_tries_to_contain_itself/)

## Conclusion

There is **no perfect solution** for running many concurrent runners on macOS:

- **Tart VMs** provide the best isolation and macOS compatibility but are **limited to 2 concurrent VMs** and require significant memory (8-12GB each)
- **Docker** works well for Linux workflows but can't run macOS-native tasks and has moderate memory overhead
- **Process sandboxing** enables high concurrency with low overhead but provides **weak isolation** suitable only for trusted workloads
- **Apple's Containerization** may be ideal in the future but requires macOS 26+ (not yet released)

The recommended approach is to support multiple isolation types and let users choose based on their specific needs, memory constraints, and workload trust levels.
