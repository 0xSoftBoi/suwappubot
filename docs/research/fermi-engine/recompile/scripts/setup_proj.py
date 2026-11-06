import os, shutil, sys
R = sys.argv[1]
S = R + '/ref/src/'
P = R + '/proj/lib/openzeppelin-contracts/contracts/'
m = {
 'lib__openzeppelin-contracts__contracts__interfaces__IERC1363.sol': 'interfaces/IERC1363.sol',
 'lib__openzeppelin-contracts__contracts__interfaces__IERC165.sol': 'interfaces/IERC165.sol',
 'lib__openzeppelin-contracts__contracts__interfaces__IERC20.sol': 'interfaces/IERC20.sol',
 'lib__openzeppelin-contracts__contracts__token__ERC20__IERC20.sol': 'token/ERC20/IERC20.sol',
 'lib__openzeppelin-contracts__contracts__token__ERC20__utils__SafeERC20.sol': 'token/ERC20/utils/SafeERC20.sol',
 'lib__openzeppelin-contracts__contracts__utils__introspection__IERC165.sol': 'utils/introspection/IERC165.sol',
 'lib__openzeppelin-contracts__contracts__utils__ReentrancyGuard.sol': 'utils/ReentrancyGuard.sol',
}
for k, v in m.items():
    os.makedirs(os.path.dirname(P + v), exist_ok=True)
    shutil.copy(S + k, P + v)
os.makedirs(R + '/proj/src/interfaces', exist_ok=True)
shutil.copy(S + 'contracts__BaseManager.sol', R + '/proj/src/BaseManager.sol')
shutil.copy(S + 'contracts__interfaces__IFermiEngine.sol', R + '/proj/src/interfaces/IFermiEngine.sol')
open(R + '/proj/foundry.toml', 'w').write('''[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.28"
evm_version = "prague"
optimizer = true
optimizer_runs = 1000000
via_ir = false
bytecode_hash = "ipfs"
cbor_metadata = true
remappings = ["@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/"]
''')
