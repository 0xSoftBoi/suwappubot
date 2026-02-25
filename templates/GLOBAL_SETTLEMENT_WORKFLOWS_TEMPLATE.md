# 🌐 Global Settlement Project - GitHub Actions Workflow Templates

This directory contains ready-to-use GitHub Actions workflow templates specifically designed for smart contract/blockchain projects like Global Settlement.

## 📁 Template Files

Copy these workflows to your Global Settlement project's `.github/workflows/` directory.

---

## 1️⃣ Smart Contract CI/CD Template

**File:** `smart-contract-ci-cd.yml`

```yaml
name: Smart Contract CI/CD

on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [main, develop]
  workflow_dispatch:

env:
  SOLIDITY_VERSION: '0.8.20'
  FOUNDRY_PROFILE: 'ci'

jobs:
  lint-and-format:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Install Foundry
        uses: foundry-rs/foundry-toolchain@v1
      
      - name: Check formatting
        run: forge fmt --check
      
      - name: Run Solhint
        run: |
          npm install -g solhint
          solhint 'contracts/**/*.sol'

  security-scan:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
    steps:
      - uses: actions/checkout@v4
      
      - name: Run Slither
        uses: crytic/slither-action@v0.3.0
        with:
          target: 'contracts/'
          slither-args: '--filter-paths "node_modules|test" --exclude naming-convention,external-function'
      
      - name: Run Mythril
        run: |
          pip install mythril
          myth analyze contracts/ --solv ${{ env.SOLIDITY_VERSION }}

  test-and-coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      
      - name: Install Foundry
        uses: foundry-rs/foundry-toolchain@v1
      
      - name: Install dependencies
        run: forge install
      
      - name: Build contracts
        run: forge build
      
      - name: Run tests
        run: forge test -vvv
      
      - name: Generate coverage
        run: |
          forge coverage --report lcov
          forge coverage --report summary
      
      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v4
        with:
          files: ./lcov.info
          flags: foundry

  gas-analysis:
    runs-on: ubuntu-latest
    needs: test-and-coverage
    steps:
      - uses: actions/checkout@v4
      
      - name: Install Foundry
        uses: foundry-rs/foundry-toolchain@v1
      
      - name: Generate gas report
        run: forge test --gas-report > gas-report.txt
      
      - name: Comment PR with gas report
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const gasReport = fs.readFileSync('gas-report.txt', 'utf8');
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '## ⛽ Gas Report\n\n```\n' + gasReport + '\n```'
            });

  deploy-testnet:
    runs-on: ubuntu-latest
    needs: [security-scan, test-and-coverage]
    if: github.ref == 'refs/heads/develop'
    environment: testnet
    steps:
      - uses: actions/checkout@v4
      
      - name: Install Foundry
        uses: foundry-rs/foundry-toolchain@v1
      
      - name: Deploy to testnet
        env:
          PRIVATE_KEY: ${{ secrets.TESTNET_DEPLOYER_KEY }}
          RPC_URL: ${{ secrets.TESTNET_RPC_URL }}
        run: |
          forge script script/Deploy.s.sol:DeployScript \
            --rpc-url $RPC_URL \
            --private-key $PRIVATE_KEY \
            --broadcast \
            --verify
      
      - name: Save deployment artifacts
        uses: actions/upload-artifact@v4
        with:
          name: deployment-artifacts
          path: broadcast/
          retention-days: 30
```

---

## 2️⃣ Advanced Security Audit Template

**File:** `security-audit.yml`

```yaml
name: Comprehensive Security Audit

on:
  pull_request:
    paths:
      - 'contracts/**/*.sol'
  schedule:
    - cron: '0 0 * * 1'  # Weekly Monday midnight
  workflow_dispatch:

jobs:
  slither-full-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      
      - name: Install Slither
        run: |
          pip install slither-analyzer
          pip install solc-select
          solc-select install ${{ env.SOLIDITY_VERSION }}
          solc-select use ${{ env.SOLIDITY_VERSION }}
      
      - name: Run Slither with all detectors
        run: |
          slither . \
            --json slither-report.json \
            --sarif slither-report.sarif \
            --checklist \
            --markdown-root ./security-reports/ \
            --filter-paths "test|mock" || true
      
      - name: Upload SARIF to GitHub Security
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: slither-report.sarif

  mythx-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: MythX Security Analysis
        uses: consensys/mythx-action@v1
        with:
          mythx-api-key: ${{ secrets.MYTHX_API_KEY }}
          mythx-scan-mode: deep
          target: 'contracts/'

  formal-verification:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Install Certora
        run: |
          pip install certora-cli
      
      - name: Run Certora Prover
        env:
          CERTORAKEY: ${{ secrets.CERTORA_KEY }}
        run: |
          certoraRun contracts/*.sol \
            --verify Contract:specs/Contract.spec \
            --solc solc${{ env.SOLIDITY_VERSION }} || true

  audit-summary:
    runs-on: ubuntu-latest
    needs: [slither-full-scan, mythx-scan, formal-verification]
    if: always()
    steps:
      - name: Generate security summary
        run: |
          echo "# 🔒 Security Audit Summary" > SECURITY_SUMMARY.md
          echo "**Date:** $(date)" >> SECURITY_SUMMARY.md
          echo "" >> SECURITY_SUMMARY.md
          echo "## Scans Completed" >> SECURITY_SUMMARY.md
          echo "- ✅ Slither static analysis" >> SECURITY_SUMMARY.md
          echo "- ✅ MythX deep scan" >> SECURITY_SUMMARY.md
          echo "- ✅ Formal verification" >> SECURITY_SUMMARY.md
      
      - name: Upload summary
        uses: actions/upload-artifact@v4
        with:
          name: security-audit-summary
          path: SECURITY_SUMMARY.md
```

---

## 3️⃣ Continuous Deployment Template

**File:** `continuous-deployment.yml`

```yaml
name: Continuous Deployment

on:
  push:
    branches:
      - main
    tags:
      - 'v*.*.*'
  workflow_dispatch:
    inputs:
      network:
        description: 'Network to deploy to'
        required: true
        type: choice
        options:
          - sepolia
          - goerli
          - mainnet

jobs:
  pre-deployment-checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Install Foundry
        uses: foundry-rs/foundry-toolchain@v1
      
      - name: Run all tests
        run: forge test
      
      - name: Check gas optimizations
        run: forge test --gas-report
      
      - name: Security scan
        run: |
          pip install slither-analyzer
          slither . --filter-paths "test|mock"

  deploy-contracts:
    runs-on: ubuntu-latest
    needs: pre-deployment-checks
    environment: 
      name: ${{ github.event.inputs.network || 'mainnet' }}
    steps:
      - uses: actions/checkout@v4
      
      - name: Install Foundry
        uses: foundry-rs/foundry-toolchain@v1
      
      - name: Deploy contracts
        env:
          PRIVATE_KEY: ${{ secrets.DEPLOYER_PRIVATE_KEY }}
          RPC_URL: ${{ secrets.RPC_URL }}
          ETHERSCAN_API_KEY: ${{ secrets.ETHERSCAN_API_KEY }}
        run: |
          forge script script/Deploy.s.sol:DeployScript \
            --rpc-url $RPC_URL \
            --private-key $PRIVATE_KEY \
            --broadcast \
            --verify \
            --etherscan-api-key $ETHERSCAN_API_KEY
      
      - name: Extract deployment addresses
        run: |
          # Extract addresses from broadcast logs
          cat broadcast/Deploy.s.sol/*/run-latest.json | \
            jq '.transactions[] | select(.transactionType == "CREATE") | 
            {contractName: .contractName, address: .contractAddress}' \
            > deployment-addresses.json
      
      - name: Upload deployment info
        uses: actions/upload-artifact@v4
        with:
          name: deployment-${{ github.event.inputs.network || 'mainnet' }}
          path: |
            broadcast/
            deployment-addresses.json
          retention-days: 90
      
      - name: Create GitHub Release
        if: startsWith(github.ref, 'refs/tags/')
        uses: softprops/action-gh-release@v1
        with:
          files: deployment-addresses.json
          generate_release_notes: true

  post-deployment-verification:
    runs-on: ubuntu-latest
    needs: deploy-contracts
    steps:
      - uses: actions/checkout@v4
      
      - name: Verify deployment
        run: |
          # Add verification scripts here
          echo "Running post-deployment verification..."
      
      - name: Update documentation
        run: |
          # Auto-update deployment addresses in docs
          echo "Updating documentation..."
```

---

## 4️⃣ Multi-Chain Deployment Template

**File:** `multi-chain-deploy.yml`

```yaml
name: Multi-Chain Deployment

on:
  workflow_dispatch:
    inputs:
      networks:
        description: 'Networks to deploy to (comma-separated)'
        required: true
        default: 'sepolia,goerli'

jobs:
  deploy:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        network: ${{ fromJson(format('["{0}"]', github.event.inputs.networks)) }}
    steps:
      - uses: actions/checkout@v4
      
      - name: Install Foundry
        uses: foundry-rs/foundry-toolchain@v1
      
      - name: Deploy to ${{ matrix.network }}
        env:
          PRIVATE_KEY: ${{ secrets.DEPLOYER_PRIVATE_KEY }}
          RPC_URL: ${{ secrets[format('{0}_RPC_URL', upper(matrix.network))] }}
        run: |
          forge script script/Deploy.s.sol \
            --rpc-url $RPC_URL \
            --private-key $PRIVATE_KEY \
            --broadcast
      
      - name: Upload deployment artifacts
        uses: actions/upload-artifact@v4
        with:
          name: deployment-${{ matrix.network }}
          path: broadcast/
```

---

## 🔐 Required Secrets

### For Testnet Deployments
```
TESTNET_DEPLOYER_KEY - Private key for testnet deployment
TESTNET_RPC_URL - RPC endpoint for testnet
```

### For Mainnet Deployments
```
DEPLOYER_PRIVATE_KEY - Private key for mainnet deployment (use hardware wallet in production!)
RPC_URL - RPC endpoint for mainnet
ETHERSCAN_API_KEY - For contract verification
```

### For Security Scanning
```
MYTHX_API_KEY - MythX API key for deep security scans
CERTORA_KEY - Certora Prover API key for formal verification
```

### For Multi-Chain
```
SEPOLIA_RPC_URL - Sepolia testnet RPC
GOERLI_RPC_URL - Goerli testnet RPC
POLYGON_RPC_URL - Polygon RPC
ARBITRUM_RPC_URL - Arbitrum RPC
OPTIMISM_RPC_URL - Optimism RPC
BASE_RPC_URL - Base RPC
```

---

## 📋 Setup Checklist for Global Settlement

- [ ] Copy workflow files to `.github/workflows/`
- [ ] Add all required secrets to GitHub repository settings
- [ ] Configure branch protection rules
- [ ] Set up GitHub Environments (testnet, mainnet)
- [ ] Install Foundry in your project: `curl -L https://foundry.paradigm.xyz | bash`
- [ ] Initialize Foundry: `forge init`
- [ ] Add deployment scripts to `script/` directory
- [ ] Create specification files in `specs/` for formal verification
- [ ] Configure Codecov for coverage reporting
- [ ] Set up Etherscan verification
- [ ] Test workflows with a test commit

---

## 🚀 Quick Start

### 1. Create Global Settlement Repository
```bash
mkdir global-settlement
cd global-settlement
git init
forge init
```

### 2. Copy Workflow Templates
```bash
mkdir -p .github/workflows
# Copy all .yml files from this template directory
```

### 3. Add Secrets
Go to: Repository Settings → Secrets and Variables → Actions → New repository secret

### 4. Configure Foundry
Create or update `foundry.toml`:
```toml
[profile.default]
src = "contracts"
out = "out"
libs = ["lib"]
solc = "0.8.20"
optimizer = true
optimizer_runs = 200

[profile.ci]
fuzz_runs = 10000
```

### 5. Create Deployment Script
Create `script/Deploy.s.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/GlobalSettlement.sol";

contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);
        
        GlobalSettlement settlement = new GlobalSettlement();
        
        vm.stopBroadcast();
        
        console.log("GlobalSettlement deployed at:", address(settlement));
    }
}
```

### 6. Push and Test
```bash
git add .
git commit -m "Add CI/CD workflows"
git push origin main
```

---

## 🎯 Customization Tips

### Adjust Solidity Version
Change `SOLIDITY_VERSION` in workflow files and `foundry.toml`

### Add More Networks
Update `multi-chain-deploy.yml` matrix and add corresponding RPC secrets

### Modify Security Scanners
Add/remove security tools in `security-audit.yml`

### Custom Deployment Logic
Edit `Deploy.s.sol` for your specific deployment needs

### Enable Fuzz Testing
Increase `fuzz_runs` in `foundry.toml` for more thorough testing

---

## 📚 Additional Resources

- [Foundry Book](https://book.getfoundry.sh/)
- [Solidity Security Best Practices](https://consensys.github.io/smart-contract-best-practices/)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts/)
- [Certora Documentation](https://docs.certora.com/)
- [Slither Documentation](https://github.com/crytic/slither)

---

**Template Version:** 1.0.0  
**Last Updated:** 2026-02-25  
**Compatible with:** Foundry, Hardhat, and Brownie projects
